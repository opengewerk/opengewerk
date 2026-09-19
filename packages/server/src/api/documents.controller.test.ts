import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { type Identity, type RoleKey, type TenantId } from '@opengewerk/domain'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { Database } from '../database/database.js'
import { newId } from '../database/identifier.js'
import {
  allowApplicationLogin,
  applicationDatabaseUrl,
  applyMigrations,
  connect,
  resetSchema,
} from '../database/test-database.js'
import { ApiModule } from './api.module.js'
import type { IdentitySource } from './identity.js'

/**
 * The one route where a mistake cannot be undone afterwards.
 *
 * Issuing spends a number out of the counter and puts an entry in the hash
 * chain, and both are built to be impossible to take back. Every other route
 * can afford a second attempt; this one has to be right the first time, so
 * what it refuses is worth its own tests.
 *
 * That it works at all, and only once, is in `authorization.test.ts` next to
 * the rights it hangs on. Here is what happens when the document is not there
 * any more, which looks exactly like a document that is there.
 */

const north = { id: newId<'tenant'>(), name: 'Elektro Nord GmbH' }
const south = { id: newId<'tenant'>(), name: 'Elektro Süd GmbH' }

let admin: Pool
let database: Database
let app: INestApplication
let customerId: string

const identities: IdentitySource = {
  identify: async (incoming: unknown) => {
    const header = (incoming as { headers?: Record<string, string> }).headers?.['x-test-identity']

    return header ? (JSON.parse(header) as Identity) : null
  },
}

function as(tenantId: TenantId, ...roles: RoleKey[]): string {
  return JSON.stringify({ userId: 'test', tenantId, roles } satisfies Identity)
}

const office = () => as(north.id, 'office')

function http() {
  return request(app.getHttpServer())
}

async function draft(subject: string) {
  const created = await http()
    .post('/documents')
    .set('x-test-identity', office())
    .send({ customerId, kind: 'final_invoice', documentDate: '2026-09-19', subject })
    .expect(201)

  return created.body as { id: string; status: string; number: string | null }
}

/** What the counter would hand out next. A preview, and here a witness. */
async function nextNumber() {
  const answer = await http()
    .get('/documents/next-number/final_invoice')
    .set('x-test-identity', office())
    .expect(200)

  return (answer.body as { preview: string }).preview
}

beforeAll(async () => {
  admin = await connect()
  await resetSchema(admin)
  await applyMigrations()
  await allowApplicationLogin(admin)
  await admin.query('insert into tenants (id, name) values ($1, $2), ($3, $4)', [
    north.id,
    north.name,
    south.id,
    south.name,
  ])

  database = Database.connect(applicationDatabaseUrl())

  const built = await Test.createTestingModule({
    imports: [ApiModule.create(database, identities)],
  }).compile()

  app = built.createNestApplication()
  await app.init()

  const customer = await http()
    .post('/customers')
    .set('x-test-identity', office())
    .send({ kind: 'business', name: 'Bauherr Nord' })
    .expect(201)
  customerId = customer.body.id
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
})

describe('issuing a document that is no longer there', () => {
  it('is refused after it has been deleted', async () => {
    const document = await draft('Gelöscht und dann doch')

    await http().delete(`/documents/${document.id}`).set('x-test-identity', office()).expect(200)

    // Deleting leaves the status on `draft` and only sets `deletedAt`, so
    // neither the status check nor the trigger on the table catches this. What
    // came out was a number spent for nothing, an entry in the hash chain and
    // a document fixed forever that `GET /documents` never shows again. On a
    // running installation none of that can be put right.
    await http()
      .post(`/documents/${document.id}/issue`)
      .set('x-test-identity', office())
      .expect(404)

    const listed = await http().get('/documents').set('x-test-identity', office()).expect(200)
    expect((listed.body as { id: string }[]).some((entry) => entry.id === document.id)).toBe(false)
  })

  it('leaves the counter where it was', async () => {
    const document = await draft('Zähler bleibt stehen')
    const before = await nextNumber()

    await http().delete(`/documents/${document.id}`).set('x-test-identity', office()).expect(200)

    await http()
      .post(`/documents/${document.id}/issue`)
      .set('x-test-identity', office())
      .expect(404)

    // The number is handed out inside the same transaction as everything else,
    // so a refusal further down takes it back with it. A gap in the sequence
    // is the thing a tax audit asks about, and no answer exists for it.
    expect(await nextNumber()).toBe(before)
  })

  it('is refused for a document of another tenant, which looks the same from here', async () => {
    const document = await draft('Fremder Beleg')

    await http()
      .post(`/documents/${document.id}/issue`)
      .set('x-test-identity', as(south.id, 'office'))
      .expect(404)

    const mine = await http().get('/documents').set('x-test-identity', office()).expect(200)
    const still = (mine.body as { id: string; status: string }[]).find(
      (entry) => entry.id === document.id,
    )
    expect(still?.status).toBe('draft')
  })
})
