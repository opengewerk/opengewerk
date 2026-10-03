import { rmSync } from 'node:fs'

import type { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { readCatalogue } from './catalogue.js'
import { probeDatabase, probeMigrations } from './probe-database.js'

// What the catalogue says about the indexes of a table, read from a database
// and not from a description of one. A foreign key names the index it leans on
// in `conindid`, and that index belongs to the table it points at; reading
// that as an index some constraint brought with it hid the index from every
// comparison once another table pointed at it.

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
