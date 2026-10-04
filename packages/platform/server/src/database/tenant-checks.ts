import type { Pool } from 'pg'

import { applicationRoleName } from './roles.js'

// The questions every application has to ask its own database about the
// separation of tenants, asked of the catalogue rather than of a list. A list
// is complete on the day it is written and quietly short one entry afterwards;
// the catalogue knows the table a later migration added.
//
// They are part of the foundation because what they guard is: a table that
// forgets FORCE, a policy that compares against the wrong setting or a key
// that leaves the tenant out is a leak nobody notices, in any application, as
// everything still works. An application runs them over its own database and
// names what it has of its own: the tables outside the log, the policies that
// reach outside a tenant, and why.

/**
 * The record of the migration runner, where an application keeps it in
 * `public`. It is nobody's data and belongs to no tenant, so the questions
 * below pass it over.
 */
const runnersRecord = ['__drizzle_migrations']

/** A table as the application role meets it. */
export interface TableProtection {
  readonly table: string
  readonly enabled: boolean
  readonly forced: boolean
  readonly policies: number
  readonly granted: boolean
  /**
   * Whether a right on the table or on one of its columns was given to
   * PUBLIC, that is to every role there is and every one that comes later.
   */
  readonly openToEveryRole: boolean
}

/**
 * Every table in `public` with the five things it needs: row level security
 * on, forced, at least one policy, a grant, and no right handed to every
 * role.
 *
 * The last is asked of the list of rights itself. `has_table_privilege`
 * answers yes for the application role whether the right was given to it or
 * to PUBLIC, so a table opened to everybody passed as granted, and the policies
 * that name the application role say nothing about the role that comes next
 * (opengewerk-haustechnik#31).
 *
 * All of them come back, the sound ones included, so that a test can also say
 * how many it expected. A query that finds no table must not pass as "no table
 * unprotected".
 */
export async function tableProtections(
  pool: Pool,
  except: readonly string[] = runnersRecord,
): Promise<TableProtection[]> {
  const { rows } = await pool.query<{
    table_name: string
    enabled: boolean
    forced: boolean
    policies: string
    granted: boolean
    open_to_every_role: boolean
  }>(
    `select c.relname as table_name,
            c.relrowsecurity as enabled,
            c.relforcerowsecurity as forced,
            (select count(*) from pg_policy p where p.polrelid = c.oid) as policies,
            has_table_privilege($1, c.oid, 'SELECT') as granted,
            (exists (select 1 from aclexplode(c.relacl) g where g.grantee = 0)
             or exists (select 1
                          from pg_attribute a
                         cross join lateral aclexplode(a.attacl) g
                         where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
                           and g.grantee = 0)) as open_to_every_role
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relkind = 'r'
        and c.relname <> all ($2::text[])
      order by c.relname`,
    [applicationRoleName, [...except]],
  )

  return rows.map((row) => ({
    table: row.table_name,
    enabled: row.enabled,
    forced: row.forced,
    policies: Number(row.policies),
    granted: row.granted,
    openToEveryRole: row.open_to_every_role,
  }))
}

/** The ones a tenant is not kept out of, nobody gets into, or everybody does. */
export function unprotected(tables: readonly TableProtection[]): TableProtection[] {
  return tables.filter(
    (table) =>
      !table.enabled ||
      !table.forced ||
      table.policies === 0 ||
      !table.granted ||
      table.openToEveryRole,
  )
}

/**
 * The policies of the foundation that open a table outside a tenant, each
 * with its reason. An application adds its own to the list it hands in.
 *
 * `tenants.created_by_setup`, the open policy the first run inserts through,
 * is deliberately not among them. It needs no excuse: the restrictive
 * `no_application_insert` beside it fences every insert of the application,
 * and the reading below sees that. Listed here it would be excused whether
 * the fence stands or not, and a migration that dropped the fence would pass.
 */
export const foundationPoliciesOutsideATenant: Readonly<Record<string, string>> = {
  'memberships.own_membership_outside_tenant':
    'the chooser after a sign in reads its own memberships, outside any tenant',
  'tenants.own_tenants_outside_tenant':
    'the chooser reads the names of the tenants somebody belongs to',
}

/** What reading the policies came to. */
export interface PolicyReading {
  /** How many tables carry a tenant, so a test can say how many it expected. */
  readonly tables: number
  /** Policies that let the application past the tenant of the transaction. */
  readonly violations: readonly string[]
  /** Entries of the list of exceptions that name no policy any more. */
  readonly stale: readonly string[]
}

/**
 * Reads the expression of every policy the application falls under and holds
 * it against the one comparison that is allowed: the tenant of the row against
 * the tenant of the transaction.
 *
 * `tableProtections` asks whether a table has a policy, not what the policy
 * says. One with `using (true)`, or one that compares against the wrong
 * setting, passes it and opens the table to every tenant.
 *
 * A restrictive policy with that comparison covers a table on its own,
 * because it is ANDed with whatever else there is; that is how the audit log
 * and the change sequence let their trigger write while nobody else can. A
 * restrictive policy of an application narrows further and is not looked at.
 * Anything that opens a table outside a tenant has to be in `outsideATenant`
 * with its reason, and the list is checked against the catalogue as well, so
 * an entry cannot outlive its policy.
 */
export async function readPolicies(
  pool: Pool,
  outsideATenant: Readonly<Record<string, string>> = foundationPoliciesOutsideATenant,
): Promise<PolicyReading> {
  const { rows } = await pool.query<{
    table_name: string
    policy: string
    permissive: boolean
    command: string
    applies: boolean
    using: string | null
    checking: string | null
    has_tenant: boolean
  }>(
    `select c.relname as table_name,
            p.polname as policy,
            p.polpermissive as permissive,
            p.polcmd as command,
            (p.polroles = '{0}' or $1::regrole = any(p.polroles)) as applies,
            pg_get_expr(p.polqual, p.polrelid) as using,
            pg_get_expr(p.polwithcheck, p.polrelid) as checking,
            exists (
              select 1 from pg_attribute a
               where a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped
            ) as has_tenant
       from pg_policy p
       join pg_class c on c.oid = p.polrelid
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'`,
    [applicationRoleName],
  )

  const comparison = (column: string) =>
    `(${column} = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)`
  const tables = new Set(
    rows
      .filter((row) => row.has_tenant || row.table_name === 'tenants')
      .map((row) => row.table_name),
  )
  const violations: string[] = []

  for (const table of tables) {
    const expected = comparison(table === 'tenants' ? 'id' : 'tenant_id')
    const policies = rows.filter((row) => row.table_name === table && row.applies)
    const restrictive = policies.filter((row) => !row.permissive)
    const reads = (command: string) => ['*', 'r', 'w', 'd'].includes(command)
    const writes = (command: string) => ['*', 'a', 'w'].includes(command)
    const readsFenced = restrictive.some((row) => row.command === '*' && row.using === expected)
    const writesFenced = restrictive.some(
      (row) =>
        (row.command === '*' || row.command === 'a') &&
        (row.checking === expected || row.checking === 'false'),
    )

    for (const row of policies.filter((policy) => policy.permissive)) {
      if (`${table}.${row.policy}` in outsideATenant) {
        continue
      }

      if (reads(row.command) && !readsFenced && row.using !== expected) {
        violations.push(`${table}.${row.policy} reads: ${String(row.using)}`)
      }

      if (writes(row.command) && !writesFenced && row.checking !== expected) {
        violations.push(`${table}.${row.policy} writes: ${String(row.checking)}`)
      }
    }
  }

  const listed = new Set(rows.map((row) => `${row.table_name}.${row.policy}`))

  return {
    tables: tables.size,
    violations,
    stale: Object.keys(outsideATenant).filter((entry) => !listed.has(entry)),
  }
}

/**
 * The functions of the foundation that run as their definer, each with its
 * reason. An application adds its own to the list it hands in.
 *
 * Such a function runs as the owner of the tables, whoever calls it. It is a
 * way past what the caller may see, on purpose and for one question each, and
 * therefore worth a list: one more of them is a decision, and one left behind
 * by a migration is a way nobody is looking at any more.
 */
export const foundationDefinerFunctions: Readonly<Record<string, string>> = {
  'create_first_tenant(company text)':
    'the one tenant a first run creates; the application has no insert on tenants',
  'create_tenant(company text)':
    'a further tenant, the only other way one is created; the server decides who may ask',
  'every_tenant()': 'the jobs in the background work for every tenant and act for no person',
  'instance_is_empty()': 'asked before anybody is signed in, when no membership opens a tenant',
  'invitation_for(hash text)':
    'a redemption arrives without a session, and only the token names the tenant',
  'next_sync_sequence(tenant uuid)':
    'the application may not write the counter of a tenant; the number is handed out by this alone',
  'record_change()': 'the trigger writes the log of a tenant whoever made the change',
  'record_instance_change()': 'the trigger writes the log of the instance whoever made the change',
  'tenants_with_leads()':
    'whoever runs the instance sees every tenant by name, day and who leads it, and no row of one',
}

/** What reading the functions that run as their definer came to. */
export interface DefinerReading {
  /** Functions that run as their definer and are on no list. */
  readonly unexplained: readonly string[]
  /** Entries of the list that name no such function any more. */
  readonly stale: readonly string[]
  /**
   * Functions that run as their definer and may be called by every role,
   * listed or not. A function is open to PUBLIC until its migration takes
   * that away, and one that runs as the owner of the tables is then a way
   * past the policies for any role the cluster has or gets.
   */
  readonly openToEveryRole: readonly string[]
}

/**
 * Every function in `public` that runs as its definer, held against the list
 * of the ones that have a reason to.
 *
 * `catalogueDeviations` compares the functions of the building blocks and
 * lets an application have more: it has functions of its own. This asks the
 * narrower question it leaves open, which of all of them walk past the
 * policies.
 *
 * And who may call them. The comparison holds that against the blocks, which
 * says nothing when a block left a function open as well: the counter of the
 * sync was created without a word about it and stayed callable by every role
 * in both (#471). A trigger function is not counted. It cannot be called,
 * only hung on a table, and that takes the owner of the table.
 */
export async function readDefinerFunctions(
  pool: Pool,
  explained: Readonly<Record<string, string>> = foundationDefinerFunctions,
): Promise<DefinerReading> {
  const { rows } = await pool.query<{ signature: string; open: boolean }>(
    `select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as signature,
            (p.prorettype <> 'trigger'::regtype
             and exists (select 1
                           from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
                          where g.grantee = 0 and g.privilege_type = 'EXECUTE')) as open
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.prosecdef
      order by 1`,
  )
  const found = rows.map((row) => row.signature)

  return {
    unexplained: found.filter((signature) => !(signature in explained)),
    stale: Object.keys(explained).filter((signature) => !found.includes(signature)),
    openToEveryRole: rows.filter((row) => row.open).map((row) => row.signature),
  }
}

/** A foreign key between two tables that both carry a tenant. */
export interface TenantKey {
  readonly key: string
  /** The columns on the side that points, in the order of the key. */
  readonly columns: string
  /** The columns it points at. */
  readonly target: string
}

/**
 * Every foreign key between two tables of a tenant.
 *
 * A foreign key is checked past row level security: the database looks the
 * parent up as the owner of its table, so a key on the id alone finds the
 * record of any tenant, and a record of this one could be hung on a record of
 * the next. Between two tables of a tenant the tenant therefore comes first on
 * both sides, and `withoutTheTenant` names the keys where it does not.
 */
export async function keysBetweenTenantTables(pool: Pool): Promise<TenantKey[]> {
  const { rows } = await pool.query<TenantKey>(
    `select c.conname as key,
            (select string_agg(a.attname, ',' order by k.ord)
               from unnest(c.conkey) with ordinality k(attnum, ord)
               join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) as columns,
            (select string_agg(a.attname, ',' order by k.ord)
               from unnest(c.confkey) with ordinality k(attnum, ord)
               join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.attnum) as target
       from pg_constraint c
      where c.contype = 'f'
        and c.connamespace = 'public'::regnamespace
        and exists (select 1 from pg_attribute a
                     where a.attrelid = c.conrelid and a.attname = 'tenant_id' and not a.attisdropped)
        and exists (select 1 from pg_attribute a
                     where a.attrelid = c.confrelid and a.attname = 'tenant_id' and not a.attisdropped)
      order by c.conname`,
  )

  return rows
}

export function withoutTheTenant(keys: readonly TenantKey[]): TenantKey[] {
  return keys.filter(
    (key) => !key.columns.startsWith('tenant_id,') || !key.target.startsWith('tenant_id,'),
  )
}

/**
 * The columns of an audit entry, and they are frozen.
 *
 * The chain is hashed over the whole row. Measured, not assumed: adding a
 * single column makes every existing entry disagree with its own fingerprint,
 * and a chain that was sound reports a break at entry one. On an installation
 * that has been running, an update with one extra column here would tell the
 * tenant its audit log had been tampered with.
 *
 * So this list is not a duplicate of the schema, it is the promise, and it is
 * the same in every application (ADR 0010, point 9). If a column really has to
 * be added, the way through is a second fingerprint that old entries keep
 * being measured by, not a quiet ALTER TABLE.
 */
export const auditEntryColumns: readonly string[] = [
  'change_id',
  'changed_at',
  'database_role',
  'field',
  'hash',
  'id',
  'new_value',
  'old_value',
  'operation',
  'previous_hash',
  'reason',
  'record_id',
  'sequence',
  'table_name',
  'tenant_id',
  'user_id',
]

/** The tables that stay out of the audit log. */
export interface OutsideTheLog {
  /** Families of tables, by the beginning of their name, so the next one is covered. */
  readonly prefixes: readonly string[]
  /** Single tables, each a decision of its own. */
  readonly tables: readonly string[]
}

/**
 * What of the foundation stays out, matched by prefix rather than by name so
 * that the next table of a family is covered as well.
 *
 * The log and the sync layer are what the log is made of and what it already
 * describes: the log would record its own recording. The accounts are out for
 * a different reason worth keeping straight. Logging them is not redundant but
 * impossible: an entry needs a tenant, these rows belong to the instance and
 * have none, and the trigger would fail rather than write a wrong one. What a
 * tenant may see of somebody signing in is `tenant_sessions`, which carries
 * the trigger like everything else.
 *
 * What belongs to the instance is out for the same reason as the accounts,
 * and is not without a record for it: it has a log of its own, written by a
 * trigger of its own (`instanceLogCoverage`).
 *
 * `deadline_runs` is out because it is a heartbeat: the deadline engine writes
 * it after every pass, once a minute, and in the log it would bury every
 * change a person made under its own.
 */
export const foundationOutsideTheLog: OutsideTheLog = {
  prefixes: ['audit_', 'sync_', 'auth_', 'instance_'],
  tables: ['deadline_runs'],
}

/** Which tables the audit trigger watches, held against which it should. */
export interface LogCoverage {
  readonly watched: readonly string[]
  /** Tables of a tenant without the trigger: their changes leave no trace. */
  readonly unwatched: readonly string[]
  /** Tables that should stay out and carry it all the same. */
  readonly watchedAgainstTheList: readonly string[]
}

/**
 * A trigger that fires for a change an ordinary session makes: created as it
 * comes (`O`) or set to fire always (`A`). One that is disabled, or fires on a
 * replica only, is in the catalogue under its name and watches nothing, and a
 * question that asked for the name alone called such a table watched
 * (opengewerk-haustechnik#31).
 */
const fires = `t.tgenabled in ('O', 'A')`

export async function logCoverage(
  pool: Pool,
  outside: OutsideTheLog = foundationOutsideTheLog,
  except: readonly string[] = runnersRecord,
): Promise<LogCoverage> {
  const { rows } = await pool.query<{ table_name: string; watched: boolean }>(
    `select c.relname as table_name,
            exists (select 1 from pg_trigger t
                     where t.tgrelid = c.oid and t.tgname = 'audit_changes'
                       and ${fires}) as watched
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relkind = 'r'
        and c.relname <> all ($1::text[])
      order by c.relname`,
    [[...except]],
  )

  const staysOut = (table: string) =>
    outside.tables.includes(table) || outside.prefixes.some((prefix) => table.startsWith(prefix))

  return {
    watched: rows.filter((row) => row.watched).map((row) => row.table_name),
    unwatched: rows
      .filter((row) => !row.watched && !staysOut(row.table_name))
      .map((row) => row.table_name),
    watchedAgainstTheList: rows
      .filter((row) => row.watched && staysOut(row.table_name))
      .map((row) => row.table_name),
  }
}

/**
 * The tables the log of the instance watches: who runs it, its settings, and
 * `tenants` for a tenant being created or removed. The log itself is what is
 * written, so it carries no writer.
 */
export async function instanceLogCoverage(pool: Pool): Promise<string[]> {
  const { rows } = await pool.query<{ table_name: string }>(
    `select c.relname as table_name
       from pg_trigger t
       join pg_class c on c.oid = t.tgrelid
      where t.tgname = 'instance_changes'
        and ${fires}
      order by c.relname`,
  )

  return rows.map((row) => row.table_name)
}

/**
 * Tables that carry the sync columns without the trigger that keeps them
 * true, or with one that is switched off. A row there would travel with a
 * version that never moves, and the next device to change it would overwrite
 * without a conflict.
 */
export async function unstampedTables(pool: Pool): Promise<string[]> {
  const { rows } = await pool.query<{ table_name: string }>(
    `select c.relname as table_name
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       join pg_attribute a on a.attrelid = c.oid
        and a.attname = 'change_sequence' and not a.attisdropped
      where n.nspname = 'public'
        and c.relkind = 'r'
        and not exists (select 1 from pg_trigger t
                         where t.tgrelid = c.oid and t.tgname = 'stamp_sync_columns'
                           and ${fires})
      order by c.relname`,
  )

  return rows.map((row) => row.table_name)
}
