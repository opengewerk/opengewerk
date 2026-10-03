import { rmSync } from 'node:fs'

import type { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { catalogueDeviations, readCatalogue, type TableCatalogue } from './catalogue.js'
import { probeDatabase, probeMigrations } from './probe-database.js'

// What the catalogue says about the indexes and policies of a table, read from
// a database and not from a description of one. A foreign key names the index
// it leans on in `conindid`, and that index belongs to the table it points at;
// reading that as an index some constraint brought with it hid the index from
// every comparison once another table pointed at it. A policy says first
// whether it opens or only narrows, and the comparison reads that word.

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
