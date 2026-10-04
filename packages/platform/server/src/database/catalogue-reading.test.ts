import { rmSync } from 'node:fs'

import type { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { catalogueDeviations, readCatalogue, type TableCatalogue } from './catalogue.js'
import { probeDatabase, probeMigrations } from './probe-database.js'
import {
  instanceLogCoverage,
  logCoverage,
  tableProtections,
  unstampedTables,
} from './tenant-checks.js'

// What the catalogue says about the indexes, policies, triggers and rights of
// a table, read from a database and not from a description of one. A foreign
// key names the index it leans on in `conindid`, and that index belongs to the
// table it points at; reading that as an index some constraint brought with it
// hid the index from every comparison once another table pointed at it. A
// policy says first whether it opens or only narrows, and the comparison reads
// that word. A trigger is in the catalogue under its name whether it fires or
// not, and a right handed to PUBLIC is nobody's by name: both were there for
// everybody to use and for no comparison to see.

const folder = probeMigrations([
  {
    tag: '0000_shelves_and_notes',
    when: 1,
    sql: [
      `CREATE TABLE "shelves" (
         "id" uuid PRIMARY KEY,
         "tenant_id" uuid NOT NULL,
         "code" text NOT NULL,
         CONSTRAINT "shelves_tenant_id_key" UNIQUE ("tenant_id", "id")
       );`,
      'CREATE UNIQUE INDEX "shelves_code" ON "shelves" USING btree ("tenant_id", "code");',
      `CREATE TABLE "notes" (
         "id" uuid PRIMARY KEY,
         "tenant_id" uuid NOT NULL,
         "shelf_id" uuid NOT NULL,
         "shelf_code" text NOT NULL,
         CONSTRAINT "notes_on_a_shelf" FOREIGN KEY ("tenant_id", "shelf_id")
           REFERENCES "shelves" ("tenant_id", "id"),
         CONSTRAINT "notes_under_a_code" FOREIGN KEY ("tenant_id", "shelf_code")
           REFERENCES "shelves" ("tenant_id", "code")
       );`,
      'CREATE POLICY "shelves_open" ON "shelves" AS PERMISSIVE FOR ALL TO public USING (true);',
      `CREATE POLICY "shelves_within" ON "shelves" AS RESTRICTIVE FOR SELECT TO public
         USING ("code" <> '');`,
      'GRANT SELECT, INSERT ON "shelves" TO "opengewerk_app";',
      'GRANT UPDATE ("code") ON "shelves" TO "opengewerk_app";',
      // A table that travels, with the three triggers the questions ask for by
      // name. What they do is beside the point here, only whether they fire.
      `CREATE TABLE "letters" (
         "id" uuid PRIMARY KEY,
         "tenant_id" uuid NOT NULL,
         "change_sequence" bigint NOT NULL DEFAULT 0
       );`,
      `CREATE FUNCTION "leaves_the_row"() RETURNS trigger LANGUAGE plpgsql AS $$
       BEGIN
         RETURN new;
       END;
       $$;`,
      `CREATE TRIGGER "stamp_sync_columns" BEFORE INSERT OR UPDATE ON "letters"
         FOR EACH ROW EXECUTE FUNCTION "leaves_the_row"();`,
      `CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE ON "letters"
         FOR EACH ROW EXECUTE FUNCTION "leaves_the_row"();`,
      `CREATE TRIGGER "instance_changes" AFTER INSERT OR UPDATE ON "letters"
         FOR EACH ROW EXECUTE FUNCTION "leaves_the_row"();`,
    ].join('\n--> statement-breakpoint\n'),
  },
])
const kit = probeDatabase(folder)

let admin: Pool

beforeAll(async () => {
  admin = await kit.connect()
  await kit.resetSchema(admin)
  await kit.applyMigrations()
})

afterAll(async () => {
  await admin.end()
  rmSync(folder, { recursive: true, force: true })
})

describe('the indexes the catalogue reads', () => {
  it('hold an index another table leans on with a foreign key', async () => {
    const { tables } = await readCatalogue(admin)

    expect(tables.shelves?.indexes).toEqual({
      shelves_code:
        'CREATE UNIQUE INDEX shelves_code ON public.shelves USING btree (tenant_id, code)',
    })
  })

  it('leave the indexes of keys to the constraints, also when a foreign key leans on one', async () => {
    const { tables } = await readCatalogue(admin)

    expect(Object.keys(tables.shelves?.constraints ?? {}).sort()).toEqual([
      'shelves_pkey',
      'shelves_tenant_id_key',
    ])
    expect(Object.keys(tables.notes?.indexes ?? {})).toEqual([])
  })
})

describe('the policies the catalogue reads', () => {
  it('begin with whether they open or only narrow', async () => {
    const { tables } = await readCatalogue(admin)

    expect(tables.shelves?.policies).toEqual({
      shelves_open: 'PERMISSIVE for ALL to public using true',
      shelves_within: "RESTRICTIVE for SELECT to public using (code <> ''::text)",
    })
  })

  it('let an application name a restrictive one as its own, and no permissive one', async () => {
    // The blocks without either policy: both are then more than they gave.
    const actual = await readCatalogue(admin)
    const shelves = actual.tables.shelves as TableCatalogue
    const blocks = { ...actual, tables: { shelves: { ...shelves, policies: {} } } }

    expect(catalogueDeviations(blocks, actual, { policies: ['shelves.shelves_within'] })).toEqual([
      'table shelves, policy shelves_open: in the database and in no block',
    ])
    expect(
      catalogueDeviations(blocks, actual, {
        policies: ['shelves.shelves_within', 'shelves.shelves_open'],
      }),
    ).toEqual([
      "table shelves, policy shelves_open: named as the application's own and permissive; only a restrictive policy may be, because a permissive one opens what the others close",
    ])
  })
})

/** Sets how one of the triggers on `letters` fires, and puts it back afterwards. */
async function withTrigger<Result>(
  trigger: string,
  state: 'disable' | 'enable replica' | 'enable always',
  work: () => Promise<Result>,
): Promise<Result> {
  await admin.query(`alter table "letters" ${state} trigger "${trigger}"`)

  try {
    return await work()
  } finally {
    await admin.query(`alter table "letters" enable trigger "${trigger}"`)
  }
}

describe('the triggers the catalogue reads', () => {
  const stamp =
    'CREATE TRIGGER stamp_sync_columns BEFORE INSERT OR UPDATE ON public.letters FOR EACH ROW EXECUTE FUNCTION leaves_the_row()'

  it('say what their definition says while they fire as they were created', async () => {
    const { tables } = await readCatalogue(admin)

    expect(tables.letters?.triggers.stamp_sync_columns).toBe(stamp)
  })

  it('say so when they are switched off, and the comparison finds it', async () => {
    const sound = await readCatalogue(admin)
    const actual = await withTrigger('stamp_sync_columns', 'disable', () => readCatalogue(admin))

    expect(actual.tables.letters?.triggers.stamp_sync_columns).toBe(`${stamp}\n-- disabled`)
    expect(catalogueDeviations(sound, actual)).toEqual([
      'table letters, trigger stamp_sync_columns: line 2: the blocks say "(nothing)", the database says "-- disabled"',
    ])
    expect(catalogueDeviations(sound, await readCatalogue(admin))).toEqual([])
  })

  it('tell a trigger that fires on a replica only from one that fires here', async () => {
    const onAReplica = await withTrigger('stamp_sync_columns', 'enable replica', () =>
      readCatalogue(admin),
    )
    const always = await withTrigger('stamp_sync_columns', 'enable always', () =>
      readCatalogue(admin),
    )

    expect(onAReplica.tables.letters?.triggers.stamp_sync_columns).toBe(
      `${stamp}\n-- fires on a replica only`,
    )
    expect(always.tables.letters?.triggers.stamp_sync_columns).toBe(
      `${stamp}\n-- fires always, on a replica as well`,
    )
  })
})

describe('the questions that ask for a trigger by its name', () => {
  // Read with every table of this database counted as one that belongs in the
  // log, so that the answer is about the trigger and not about a list.
  const everythingBelongs = { prefixes: [], tables: [] }

  it('count a table as stamped only while the trigger fires', async () => {
    expect(await unstampedTables(admin)).toEqual([])
    expect(
      await withTrigger('stamp_sync_columns', 'disable', () => unstampedTables(admin)),
    ).toEqual(['letters'])
    expect(
      await withTrigger('stamp_sync_columns', 'enable replica', () => unstampedTables(admin)),
    ).toEqual(['letters'])
    expect(
      await withTrigger('stamp_sync_columns', 'enable always', () => unstampedTables(admin)),
    ).toEqual([])
  })

  it('count a table as watched by the log only while the trigger fires', async () => {
    expect((await logCoverage(admin, everythingBelongs)).watched).toEqual(['letters'])

    const off = await withTrigger('audit_changes', 'disable', () =>
      logCoverage(admin, everythingBelongs),
    )

    expect(off.watched).toEqual([])
    expect(off.unwatched).toEqual(['letters', 'notes', 'shelves'])
  })

  it('count a table as watched by the log of the instance only while the trigger fires', async () => {
    expect(await instanceLogCoverage(admin)).toEqual(['letters'])
    expect(
      await withTrigger('instance_changes', 'disable', () => instanceLogCoverage(admin)),
    ).toEqual([])
  })
})

describe('the rights the catalogue reads', () => {
  it('are those of the application role, and of nobody else while nobody else has any', async () => {
    const { tables } = await readCatalogue(admin)

    expect(tables.shelves?.grants).toBe('INSERT, SELECT, UPDATE (code)')
    expect(tables.notes?.grants).toBe('')
  })

  it('name a right handed to every role, on the table and on a single column', async () => {
    const sound = await readCatalogue(admin)

    await admin.query('grant select on "shelves" to public')
    await admin.query('grant update ("code") on "shelves" to public')

    try {
      const actual = await readCatalogue(admin)

      expect(actual.tables.shelves?.grants).toBe(
        'INSERT, SELECT, SELECT to PUBLIC, UPDATE (code), UPDATE (code) to PUBLIC',
      )
      expect(catalogueDeviations(sound, actual)).toEqual([
        'table shelves, grants: line 1: the blocks say "INSERT, SELECT, UPDATE (code)", the database says "INSERT, SELECT, SELECT to PUBLIC, UPDATE (code), UPDATE (code) to PUBLIC"',
      ])
    } finally {
      await admin.query('revoke select on "shelves" from public')
      await admin.query('revoke update ("code") on "shelves" from public')
    }

    expect(catalogueDeviations(sound, await readCatalogue(admin))).toEqual([])
  })

  it('name a right handed to a role that is neither the application nor the owner', async () => {
    // The role this test is connected as: not the one the migrations ran as,
    // so not the owner of the table.
    const { rows } = await admin.query<{ name: string }>('select current_user as name')
    const somebody = rows[0]?.name ?? ''

    await admin.query('grant delete on "notes" to current_user')

    try {
      const { tables } = await readCatalogue(admin)

      expect(tables.notes?.grants).toBe(`DELETE to ${somebody}`)
    } finally {
      await admin.query('revoke delete on "notes" from current_user')
    }
  })

  it('count a table as open to every role as soon as PUBLIC has a right on it or on a column', async () => {
    const open = async () =>
      (await tableProtections(admin)).filter((table) => table.openToEveryRole).map((t) => t.table)

    expect(await open()).toEqual([])

    await admin.query('grant select on "shelves" to public')
    await admin.query('grant update ("shelf_code") on "notes" to public')

    try {
      expect(await open()).toEqual(['notes', 'shelves'])
    } finally {
      await admin.query('revoke select on "shelves" from public')
      await admin.query('revoke update ("shelf_code") on "notes" from public')
    }

    expect(await open()).toEqual([])
  })
})
