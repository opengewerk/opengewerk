import { createHash } from 'node:crypto'

import { applicationRoleName, type TenantId } from '@opengewerk/platform-domain'
import { sql } from 'drizzle-orm'
import { pgTable, text, uuid } from 'drizzle-orm/pg-core'
import type { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { type ProbeFoundation, probeFoundation } from '../authentication/probe-application.js'
import { Database, type TenantTransaction } from '../database/database.js'
import { newId } from '../database/identifier.js'
import { fileUploads } from '../database/schema/files.js'
import { mayNameFile } from './naming.js'
import { fileRowFor } from './rows.js'

/**
 * Who may name a stored file in a record of their own: whoever stored it, and
 * whoever sees a row that names it already, under the policies of the person.
 *
 * The probe application has no areas, so the test makes a table that has:
 * cards that name files, each in the area of north or of south, and a person
 * sees the cards of their own area. Nora works in the north, Sven in the
 * south, both for the same tenant; Tom works for another tenant.
 */

const tenant = { id: newId<'tenant'>() as TenantId, name: 'Mandant' }
const other = { id: newId<'tenant'>() as TenantId, name: 'Anderer Mandant' }

/** The cards of the test, as the application would declare them. */
const cards = pgTable('probe_cards', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  area: text('area').notNull(),
  sha256: text('sha256').notNull(),
})

const hashOf = (text: string) => createHash('sha256').update(text).digest('hex')

/** A plan Nora stored in the north, and a photo nobody has named anywhere. */
const plan = { sha256: hashOf('Plan des Nordflügels'), sizeBytes: 21 }
const photo = { sha256: hashOf('Foto aus dem Keller Nord'), sizeBytes: 24 }

let foundation: ProbeFoundation
let admin: Pool
let database: Database

function as<Result>(
  userId: string | undefined,
  work: (tx: TenantTransaction) => Promise<Result>,
  tenantId: TenantId = tenant.id,
): Promise<Result> {
  return database.forTenant(
    { tenantId, reason: 'probe', ...(userId === undefined ? {} : { userId }) },
    work,
  )
}

function mayName(userId: string, sha256: string, withCards = true, tenantId?: TenantId) {
  return as(userId, (tx) => mayNameFile(tx, sha256, withCards ? [cards.sha256] : []), tenantId)
}

beforeAll(async () => {
  foundation = await probeFoundation()
  admin = await foundation.kit.connect()
  await foundation.empty()
  await foundation.tenants(admin, [tenant, other])
  database = Database.connect(foundation.kit.applicationDatabaseUrl())

  // The areas of the people and the cards in them, under a policy that lets a
  // person see the cards of their own area and none of another.
  await admin.query(`
    create table probe_areas (user_id text primary key, area text not null);
    insert into probe_areas values ('nora', 'north'), ('sven', 'south'), ('tom', 'north');
    create table probe_cards (
      id uuid primary key,
      tenant_id uuid not null,
      area text not null,
      sha256 text not null
    );
    alter table probe_cards enable row level security;
    alter table probe_cards force row level security;
    create policy cards_of_the_tenant on probe_cards to ${applicationRoleName}
      using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
    create policy cards_of_the_area on probe_cards as restrictive to ${applicationRoleName}
      using (area = (select a.area from probe_areas a
        where a.user_id = nullif(current_setting('app.user_id', true), '')));
    grant select on probe_areas, probe_cards to ${applicationRoleName};
  `)

  await admin.query(
    "insert into probe_cards (id, tenant_id, area, sha256) values ($1, $2, 'north', $3)",
    [newId<'card'>(), tenant.id, plan.sha256],
  )
}, 60_000)

afterAll(async () => {
  await database.close()
  await admin.end()
  foundation.remove()
})

describe('who stored a file', () => {
  it('is written down for the person of the transaction, once however often they send it', async () => {
    await as('nora', async (tx) => {
      await fileRowFor(tx, tenant.id, plan, 'application/pdf')
      await fileRowFor(tx, tenant.id, photo, 'image/jpeg')
      await fileRowFor(tx, tenant.id, photo, 'image/jpeg')
    })

    const { rows } = await admin.query<{ user_id: string; sha256: string }>(
      'select user_id, sha256 from file_uploads where tenant_id = $1 order by sha256',
      [tenant.id],
    )

    expect(rows).toEqual(
      [plan.sha256, photo.sha256].sort().map((sha256) => ({ user_id: 'nora', sha256 })),
    )
  })
})

describe('naming a stored file', () => {
  it('is for whoever stored it, and not for somebody of another area who knows the hash', async () => {
    expect(await mayName('nora', photo.sha256)).toBe(true)
    expect(await mayName('sven', photo.sha256)).toBe(false)
    expect(await mayName('sven', plan.sha256)).toBe(false)
  })

  it('is for whoever sees a row that names the file, under the policies of that person', async () => {
    await admin.query(
      "insert into probe_cards (id, tenant_id, area, sha256) values ($1, $2, 'south', $3)",
      [newId<'card'>(), tenant.id, photo.sha256],
    )

    try {
      expect(await mayName('sven', photo.sha256)).toBe(true)
      // The card of the plan lies in the north, out of his reach.
      expect(await mayName('sven', plan.sha256)).toBe(false)
      // And a row counts only where the application lists its place.
      expect(await mayName('sven', photo.sha256, false)).toBe(false)
    } finally {
      await admin.query('delete from probe_cards where sha256 = $1', [photo.sha256])
    }
  })

  it('is for a second person once they have sent the same bytes themselves', async () => {
    await as('sven', (tx) => fileRowFor(tx, tenant.id, plan, 'application/pdf'))

    expect(await mayName('sven', plan.sha256, false)).toBe(true)
  })

  it('asks a place that is a question of the application', async () => {
    const asked: string[] = []
    const answer = (yes: boolean) => (_tx: TenantTransaction, sha256: string) => {
      asked.push(sha256)

      return Promise.resolve(yes)
    }

    expect(await as('sven', (tx) => mayNameFile(tx, photo.sha256, [answer(false)]))).toBe(false)
    expect(await as('sven', (tx) => mayNameFile(tx, photo.sha256, [answer(true)]))).toBe(true)
    expect(asked).toEqual([photo.sha256, photo.sha256])
  })

  it('is never for a person of another tenant, whatever its rows say', async () => {
    expect(await mayName('tom', plan.sha256, true, other.id)).toBe(false)
    expect(await mayName('tom', photo.sha256, true, other.id)).toBe(false)
  })
})

describe('who else stored a file', () => {
  it('is written down for nobody when the transaction has no person', async () => {
    const outside = { sha256: hashOf('Foto von außen'), sizeBytes: 14 }

    await as(undefined, (tx) => fileRowFor(tx, tenant.id, outside, 'image/jpeg'))

    const { rows } = await admin.query('select 1 from file_uploads where sha256 = $1', [
      outside.sha256,
    ])

    expect(rows).toEqual([])
    expect(await mayName('nora', outside.sha256)).toBe(false)
  })

  it('is seen by that person alone, and nobody writes it down for somebody else', async () => {
    const seen = await as('sven', (tx) =>
      tx.select({ userId: fileUploads.userId, sha256: fileUploads.sha256 }).from(fileUploads),
    )

    expect(seen.every((row) => row.userId === 'sven')).toBe(true)
    expect(seen.map((row) => row.sha256)).toEqual([plan.sha256])

    const forged = await as('sven', (tx) =>
      tx
        .insert(fileUploads)
        .values({ tenantId: tenant.id, sha256: photo.sha256, userId: 'nora' })
        .then(
          () => null,
          (error: unknown) => error,
        ),
    )

    expect(String((forged as { cause?: unknown } | null)?.cause ?? forged)).toMatch(
      /row-level security/,
    )
    expect(await mayName('sven', photo.sha256)).toBe(false)
    expect(
      await as('sven', (tx) =>
        tx.execute(sql`select count(*)::int as n from file_uploads where user_id = 'nora'`),
      ).then((result) => result.rows[0]),
    ).toEqual({ n: 0 })
  })
})
