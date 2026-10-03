import type { Pool } from 'pg'

import { applicationRoleName } from './roles.js'

// The database described by itself: what its catalogue says about every table,
// type and function in `public`, in the words PostgreSQL uses when it is
// asked. Two databases that arrived at the same schema by different roads say
// the same here, whatever the statements looked like that built them, and that
// is what makes this the measure for the building blocks of the foundation:
// they are held against the database the migrations of an application left
// behind, not against the text of those migrations.

/** One table, each part under its name in the words of the catalogue. */
export interface TableCatalogue {
  /** Type, whether it may be null, and the default. */
  readonly columns: Readonly<Record<string, string>>
  /** Primary, unique and foreign keys and the checks. */
  readonly constraints: Readonly<Record<string, string>>
  /** The indexes no constraint brought with it. */
  readonly indexes: Readonly<Record<string, string>>
  readonly policies: Readonly<Record<string, string>>
  readonly triggers: Readonly<Record<string, string>>
  /** Whether row level security is on, and whether it holds for the owner. */
  readonly rowSecurity: string
  /** What the application role may do, columns it may change alone included. */
  readonly grants: string
}

export interface Catalogue {
  readonly tables: Readonly<Record<string, TableCatalogue>>
  /** Every enum with its values, in the order PostgreSQL keeps them. */
  readonly enums: Readonly<Record<string, string>>
  /** Every function under its signature: the definition, and who may call it. */
  readonly functions: Readonly<Record<string, string>>
  /** Whether the application role may enter the schema at all. */
  readonly schema: string
}

function collect<Row extends { table_name: string; name: string; says: string }>(
  rows: readonly Row[],
  table: string,
): Record<string, string> {
  return Object.fromEntries(
    rows.filter((row) => row.table_name === table).map((row) => [row.name, row.says]),
  )
}

type Part = { table_name: string; name: string; says: string }

/** Reads the catalogue of `public`. Run as a role that sees all of it. */
export async function readCatalogue(pool: Pool): Promise<Catalogue> {
  const tables = await pool.query<{ table_name: string; row_security: string; grants: string }>(
    `select c.relname as table_name,
            case when c.relrowsecurity then 'enabled' else 'disabled' end
              || case when c.relforcerowsecurity then ', forced' else ', not forced' end
              as row_security,
            concat_ws(', ',
              (select string_agg(g.privilege_type, ', ' order by g.privilege_type)
                 from aclexplode(c.relacl) g
                where g.grantee = $1::regrole),
              (select string_agg(g.privilege_type || ' (' || a.attname || ')', ', '
                                 order by g.privilege_type, a.attname)
                 from pg_attribute a
                cross join lateral aclexplode(a.attacl) g
                where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
                  and g.grantee = $1::regrole)) as grants
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
      order by c.relname`,
    [applicationRoleName],
  )

  const columns = await pool.query<Part>(
    `select c.relname as table_name, a.attname as name,
            format_type(a.atttypid, a.atttypmod)
              || case when a.attnotnull then ' not null' else '' end
              || coalesce(' default ' || pg_get_expr(d.adbin, d.adrelid), '')
              || case when a.attidentity <> '' then ' identity ' || a.attidentity::text else '' end
              || case when a.attgenerated <> '' then ' generated ' || a.attgenerated::text else '' end
              as says
       from pg_attribute a
       join pg_class c on c.oid = a.attrelid
       join pg_namespace n on n.oid = c.relnamespace
       left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
      where n.nspname = 'public' and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped`,
  )

  // Without the NOT NULL constraints. PostgreSQL 18 keeps one per column, the
  // column above says the same, and their names follow the order the columns
  // were added in rather than anything a schema decides.
  const constraints = await pool.query<Part>(
    `select c.relname as table_name, k.conname as name, pg_get_constraintdef(k.oid) as says
       from pg_constraint k
       join pg_class c on c.oid = k.conrelid
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and k.contype <> 'n'`,
  )

  // Without the indexes a primary key, a unique key or an exclusion brought
  // with it; those say what they are among the constraints. A foreign key names
  // an index in `conindid` as well, but the one it leans on, which belongs to
  // the table it points at: counted as brought with a constraint, an index
  // dropped out of the comparison as soon as another table pointed at it.
  const indexes = await pool.query<Part>(
    `select c.relname as table_name, i.relname as name, pg_get_indexdef(x.indexrelid) as says
       from pg_index x
       join pg_class c on c.oid = x.indrelid
       join pg_class i on i.oid = x.indexrelid
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and not exists (
          select 1 from pg_constraint k
           where k.conindid = x.indexrelid and k.contype in ('p', 'u', 'x')
        )`,
  )

  const policies = await pool.query<Part>(
    `select p.tablename as table_name, p.policyname as name,
            p.permissive || ' for ' || p.cmd || ' to ' || array_to_string(p.roles, ', ')
              || coalesce(' using ' || p.qual, '')
              || coalesce(' with check ' || p.with_check, '') as says
       from pg_policies p
      where p.schemaname = 'public'`,
  )

  const triggers = await pool.query<Part>(
    `select c.relname as table_name, t.tgname as name, pg_get_triggerdef(t.oid) as says
       from pg_trigger t
       join pg_class c on c.oid = t.tgrelid
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and not t.tgisinternal`,
  )

  const enums = await pool.query<{ name: string; says: string }>(
    `select t.typname as name, string_agg(e.enumlabel, ', ' order by e.enumsortorder) as says
       from pg_type t
       join pg_namespace n on n.oid = t.typnamespace
       join pg_enum e on e.enumtypid = t.oid
      where n.nspname = 'public'
      group by t.typname`,
  )

  // Without what an extension brought, as the round trip of the migrations
  // leaves it out. Who may call a function is part of what it is: one that
  // answers outside any tenant and is open to every role is a different
  // function from the same text behind a grant.
  const functions = await pool.query<{ name: string; says: string }>(
    `select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as name,
            pg_get_functiondef(p.oid) || E'\\n-- may be called by: '
              || (select string_agg(
                           case when g.grantee = 0 then 'PUBLIC'
                                else pg_get_userbyid(g.grantee) end, ', '
                           order by case when g.grantee = 0 then 'PUBLIC'
                                         else pg_get_userbyid(g.grantee) end)
                    from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
                   where g.privilege_type = 'EXECUTE') as says
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.prokind = 'f'
        and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')`,
  )

  const schema = await pool.query<{ says: string }>(
    `select case when has_schema_privilege($1, 'public', 'USAGE') then 'usage' else 'no usage' end
            as says`,
    [applicationRoleName],
  )

  return {
    tables: Object.fromEntries(
      tables.rows.map((table) => [
        table.table_name,
        {
          columns: collect(columns.rows, table.table_name),
          constraints: collect(constraints.rows, table.table_name),
          indexes: collect(indexes.rows, table.table_name),
          policies: collect(policies.rows, table.table_name),
          triggers: collect(triggers.rows, table.table_name),
          rowSecurity: table.row_security,
          grants: table.grants,
        },
      ]),
    ),
    enums: Object.fromEntries(enums.rows.map((row) => [row.name, row.says])),
    functions: Object.fromEntries(functions.rows.map((row) => [row.name, row.says])),
    schema: schema.rows[0]?.says ?? 'unknown',
  }
}

/** Where two texts first part ways, short enough to read in a test report. */
function firstDifference(expected: string, actual: string): string {
  const wanted = expected.split('\n')
  const found = actual.split('\n')
  const line = wanted.findIndex((text, position) => text !== found[position])
  const position = line < 0 ? wanted.length : line

  return (
    `line ${position + 1}: the blocks say ${JSON.stringify(wanted[position] ?? '(nothing)')}, ` +
    `the database says ${JSON.stringify(found[position] ?? '(nothing)')}`
  )
}

/** How a part of a table is held against the blocks. */
type Strictness =
  /** Everything the blocks have, and nothing looked at beyond it. */
  | 'at least'
  /** Everything the blocks have, and nothing else. */
  | 'exactly'
  /** As `exactly`, apart from what the application names as its own. */
  | { readonly own: readonly string[] }

function compare(
  what: string,
  expected: Readonly<Record<string, string>>,
  actual: Readonly<Record<string, string>>,
  strictness: Strictness,
): string[] {
  const deviations: string[] = []

  for (const [name, says] of Object.entries(expected)) {
    const found = actual[name]

    if (found === undefined) {
      deviations.push(`${what} ${name}: missing in the database`)
    } else if (found !== says) {
      deviations.push(`${what} ${name}: ${firstDifference(says, found)}`)
    }
  }

  if (strictness !== 'at least') {
    const own = strictness === 'exactly' ? [] : strictness.own

    for (const name of Object.keys(actual)) {
      if (!(name in expected) && !own.includes(name)) {
        deviations.push(`${what} ${name}: in the database and in no block`)
      }
    }
  }

  return deviations
}

/**
 * What an application has hung on tables of the foundation, each written
 * `table.name`. Listed so that it is a decision: a trigger the list does not
 * name is either missing from the blocks or should not be there.
 *
 * Columns and constraints are for the one table made to carry some of an
 * application's own, the outbox of its mail, whose messages point at the
 * records they are about. Named on another table they are allowed just the
 * same, and stand in the list for everybody to see.
 */
export interface OwnAdditions {
  readonly triggers?: readonly string[]
  readonly indexes?: readonly string[]
  readonly columns?: readonly string[]
  readonly constraints?: readonly string[]
}

/** The names of one table in such a list, and the entries that name nothing. */
function ownOf(
  listed: readonly string[] | undefined,
  table: string,
  found: Readonly<Record<string, string>>,
  what: string,
): { own: string[]; stale: string[] } {
  const own = (listed ?? [])
    .filter((entry) => entry.startsWith(`${table}.`))
    .map((entry) => entry.slice(table.length + 1))

  return {
    own,
    stale: own
      .filter((name) => !(name in found))
      .map(
        (name) => `table ${table}, ${what} ${name}: named as the application's own and not there`,
      ),
  }
}

/**
 * Where a database departs from the foundation.
 *
 * `expected` is the catalogue of a database built from the blocks alone,
 * `actual` the one an application's migrations left behind. Everything the
 * foundation consists of has to be in the second exactly as in the first.
 *
 * What an application has of its own is not looked at: its tables, its types
 * and its functions. A table of the foundation is held in both directions. A
 * policy or a right more than the blocks gave is a deviation, because each of
 * them changes what the foundation promises about that table. So is a column,
 * a key, a trigger or an index more, unless the application names it as its
 * own: that is how a trigger the blocks forgot is told from one the
 * application added.
 */
export function catalogueDeviations(
  expected: Catalogue,
  actual: Catalogue,
  own: OwnAdditions = {},
): string[] {
  const deviations: string[] = []

  if (expected.schema !== actual.schema) {
    deviations.push(
      `schema public: the blocks say ${JSON.stringify(expected.schema)}, the database says ${JSON.stringify(actual.schema)}`,
    )
  }

  for (const [name, table] of Object.entries(expected.tables)) {
    const found = actual.tables[name]

    if (!found) {
      deviations.push(`table ${name}: missing in the database`)
      continue
    }

    const whole = { 'row level security': table.rowSecurity, grants: table.grants }
    const wholeFound = { 'row level security': found.rowSecurity, grants: found.grants }
    const triggers = ownOf(own.triggers, name, found.triggers, 'trigger')
    const indexes = ownOf(own.indexes, name, found.indexes, 'index')
    const columns = ownOf(own.columns, name, found.columns, 'column')
    const constraints = ownOf(own.constraints, name, found.constraints, 'constraint')

    deviations.push(
      ...compare(`table ${name},`, whole, wholeFound, 'exactly'),
      ...compare(`table ${name}, column`, table.columns, found.columns, columns),
      ...compare(`table ${name}, constraint`, table.constraints, found.constraints, constraints),
      ...compare(`table ${name}, policy`, table.policies, found.policies, 'exactly'),
      ...compare(`table ${name}, index`, table.indexes, found.indexes, indexes),
      ...compare(`table ${name}, trigger`, table.triggers, found.triggers, triggers),
      ...columns.stale,
      ...constraints.stale,
      ...indexes.stale,
      ...triggers.stale,
    )
  }

  for (const entry of [
    ...(own.triggers ?? []),
    ...(own.indexes ?? []),
    ...(own.columns ?? []),
    ...(own.constraints ?? []),
  ]) {
    const table = entry.slice(0, entry.indexOf('.'))

    if (!(table in expected.tables)) {
      deviations.push(
        `${entry}: named as the application's own on a table the foundation does not have`,
      )
    }
  }

  deviations.push(
    ...compare('enum', expected.enums, actual.enums, 'at least'),
    ...compare('function', expected.functions, actual.functions, 'at least'),
  )

  return deviations
}
