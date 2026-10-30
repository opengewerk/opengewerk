import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { notOwnDraft, permissionsOfRoles } from '@opengewerk/domain'
import { Database, newId } from '@opengewerk/platform-server'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { applicationDatabaseUrl, connect, resetToMigrated } from '../database/test-database.js'
import { ApiModule } from './api.module.js'
import { testIdentities as identities } from './test-identity.js'

/**
 * Deleting a draft (#786), decided on 30.10.2026: whoever made a draft may
 * delete it, somebody else's only whoever may delete the drafts of others,
 * at the route as through the sync of a device. A fixed document is never
 * deleted, and a deleted draft stays in the change log.
 */

const north = { id: newId<'tenant'>(), name: 'Elektro Nord GmbH' }

let admin: Pool
let database: Database
let app: INestApplication
let customerId = ''

const office = JSON.stringify({ userId: 'britta', tenantId: north.id, roles: ['office'] })
const max = JSON.stringify({ userId: 'max', tenantId: north.id, roles: ['technician'] })
const maxWhoMayDelete = JSON.stringify({
  userId: 'max',
  tenantId: north.id,
  roles: ['technician'],
  rights: [...permissionsOfRoles(['technician']), 'document.delete'],
})

function http() {
  return request(app.getHttpServer())
}

async function draft(who: string, subject: string) {
  const created = await http()
    .post('/documents')
    .set('x-test-identity', who)
    .send({ customerId, kind: 'time_and_material_report', documentDate: '2026-10-30', subject })
    .expect(201)

  return created.body as { id: string; createdBy: string | null }
}

function deleting(recordId: string) {
  return {
    id: newId<'operation'>(),
    entity: 'documents',
    recordId,
    kind: 'delete',
    baseVersion: null,
    patches: [],
    recordedAt: new Date().toISOString(),
  }
}

function creating(recordId: string, values: Record<string, string | null>) {
  return {
    id: newId<'operation'>(),
    entity: 'documents',
    recordId,
    kind: 'create',
    baseVersion: null,
    patches: Object.entries(values).map(([field, to]) => ({ field, from: null, to })),
    recordedAt: new Date().toISOString(),
  }
}

async function push(operations: unknown[], who: string, expected = 201) {
  const answer = await http()
    .post('/sync')
    .set('x-test-identity', who)
    .send({ deviceId: 'handy-max', operations })
    .expect(expected)

  return answer.body as {
    receipts?: { outcome: string; reason: string | null; fields: string[] }[]
    message?: string
  }
}

async function deletedAt(id: string): Promise<Date | null> {
  const { rows } = await admin.query<{ deleted_at: Date | null }>(
    'select deleted_at from documents where id = $1',
    [id],
  )

  return rows[0]?.deleted_at ?? null
}

beforeAll(async () => {
  admin = await connect()
  await resetToMigrated()
  await admin.query('insert into tenants (id, name) values ($1, $2)', [north.id, north.name])
  await admin.query(
    "insert into auth_users (id, name, email) values ('max', 'Max', 'max@x.de'), ('britta', 'Britta', 'britta@x.de')",
  )
  await admin.query(
    "insert into memberships (tenant_id, user_id, roles) values ($1, 'max', '{technician}'), ($1, 'britta', '{office}')",
    [north.id],
  )

  database = Database.connect(applicationDatabaseUrl())

  const built = await Test.createTestingModule({
    imports: [ApiModule.create(database, identities)],
  }).compile()

  app = built.createNestApplication()
  await app.init()

  customerId = (
    (
      await http()
        .post('/customers')
        .set('x-test-identity', office)
        .send({ kind: 'business', name: 'Hausverwaltung Süd GmbH' })
        .expect(201)
    ).body as { id: string }
  ).id
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
})

describe('a draft at the route', () => {
  it('names who made it, whatever the request says', async () => {
    const created = await http()
      .post('/documents')
      .set('x-test-identity', max)
      .send({
        customerId,
        kind: 'time_and_material_report',
        documentDate: '2026-10-30',
        createdBy: 'britta',
      })
      .expect(201)

    expect((created.body as { createdBy: string }).createdBy).toBe('max')
  })

  it('is deleted by whoever made it', async () => {
    const own = await draft(max, 'Eigener Entwurf')

    await http().delete(`/documents/${own.id}`).set('x-test-identity', max).expect(200)
    expect(await deletedAt(own.id)).not.toBeNull()
  })

  it("is not deleted by somebody else without the right to delete others' drafts", async () => {
    const theirs = await draft(office, 'Entwurf des Büros')
    const refused = await http()
      .delete(`/documents/${theirs.id}`)
      .set('x-test-identity', max)
      .expect(403)

    expect((refused.body as { message: string }).message).toBe(notOwnDraft)
    expect(await deletedAt(theirs.id)).toBeNull()

    // With the right, and by the office, which has it.
    await http()
      .delete(`/documents/${theirs.id}`)
      .set('x-test-identity', maxWhoMayDelete)
      .expect(200)

    const another = await draft(max, 'Entwurf des Monteurs')

    await http().delete(`/documents/${another.id}`).set('x-test-identity', office).expect(200)
  })

  it('is never deleted once it is fixed, and stays in the change log once it is deleted', async () => {
    const fixed = await draft(office, 'Festgeschrieben')

    await admin.query("update documents set status = 'signed' where id = $1", [fixed.id])
    await http().delete(`/documents/${fixed.id}`).set('x-test-identity', office).expect(409)

    const gone = await draft(office, 'Gelöscht')

    await http().delete(`/documents/${gone.id}`).set('x-test-identity', office).expect(200)

    const { rows } = await admin.query<{ field: string; user_id: string }>(
      `select field, user_id from audit_entries
        where table_name = 'documents' and record_id = $1 and field = 'deleted_at'`,
      [gone.id],
    )

    expect(rows).toEqual([{ field: 'deleted_at', user_id: 'britta' }])
  })
})

describe('a draft through the sync', () => {
  it('is made by the sender, and a device may not say otherwise', async () => {
    const id = newId<'document'>()
    const answer = await push(
      [
        creating(id, {
          customerId,
          kind: 'time_and_material_report',
          documentDate: '2026-10-30',
          createdBy: 'britta',
        }),
      ],
      max,
    )

    expect(answer.receipts?.[0]).toMatchObject({ outcome: 'conflict', reason: 'set_by_server' })

    const made = newId<'document'>()

    await push(
      [
        creating(made, {
          customerId,
          kind: 'time_and_material_report',
          documentDate: '2026-10-30',
        }),
      ],
      max,
    )

    const { rows } = await admin.query<{ created_by: string }>(
      'select created_by from documents where id = $1',
      [made],
    )

    expect(rows).toEqual([{ created_by: 'max' }])
  })

  it('is deleted from the device of whoever made it, and of somebody else only with the right', async () => {
    const own = newId<'document'>()

    await push(
      [creating(own, { customerId, kind: 'time_and_material_report', documentDate: '2026-10-30' })],
      max,
    )
    expect((await push([deleting(own)], max)).receipts?.[0]).toMatchObject({ outcome: 'applied' })
    expect(await deletedAt(own)).not.toBeNull()

    const theirs = await draft(office, 'Entwurf des Büros auf dem Gerät')
    const refused = await push([deleting(theirs.id)], max, 400)

    expect(refused.message).toBe(notOwnDraft)
    expect(await deletedAt(theirs.id)).toBeNull()

    expect((await push([deleting(theirs.id)], maxWhoMayDelete)).receipts?.[0]).toMatchObject({
      outcome: 'applied',
    })
  })
})
