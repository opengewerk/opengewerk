import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import { eq } from 'drizzle-orm'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { Database } from '../database/database.js'
import { newId } from '../database/identifier.js'
import { auditEntries } from '../database/schema/index.js'
import {
  allowApplicationLogin,
  applicationDatabaseUrl,
  applyMigrations,
  connect,
  resetSchema,
} from '../database/test-database.js'
import { ApiModule } from './api.module.js'
import { as, testIdentities as identities } from './test-identity.js'

/**
 * The rights are checked on the server, through the API, not in the interface.
 * Hiding a button is a courtesy to whoever is looking at the screen; these
 * tests come in the way a script would, with nothing but a request.
 */

const north = { id: newId<'tenant'>(), name: 'Elektro Nord GmbH' }
const south = { id: newId<'tenant'>(), name: 'Elektro Süd GmbH' }

let admin: Pool
let database: Database
let app: INestApplication
let northCustomer: string

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

  const created = await request(app.getHttpServer())
    .post('/customers')
    .set('x-test-identity', as(north.id, 'office'))
    .send({ kind: 'business', name: 'Bauherr Nord' })
    .expect(201)
  northCustomer = created.body.id
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
})

describe('a technician', () => {
  const technician = () => as(north.id, 'technician')

  it('can write a document', async () => {
    await request(app.getHttpServer())
      .post('/documents')
      .set('x-test-identity', technician())
      .send({
        customerId: northCustomer,
        kind: 'time_and_material_report',
        documentDate: '2026-09-18',
        subject: 'Regiebericht Störung',
      })
      .expect(201)
  })

  it('cannot issue one, not even by asking the API directly', async () => {
    const draft = await request(app.getHttpServer())
      .post('/documents')
      .set('x-test-identity', technician())
      .send({ customerId: northCustomer, kind: 'final_invoice', documentDate: '2026-09-18' })
      .expect(201)

    const refused = await request(app.getHttpServer())
      .post(`/documents/${draft.body.id}/issue`)
      .set('x-test-identity', technician())
      .expect(403)

    expect(refused.body.message).toContain('document.issue')

    // And it really did not happen, rather than being answered with a 403 and
    // going through anyway.
    const after = await request(app.getHttpServer())
      .get('/documents')
      .set('x-test-identity', technician())
      .expect(200)
    const document = (after.body as { id: string; status: string }[]).find(
      (entry) => entry.id === draft.body.id,
    )
    expect(document?.status).toBe('draft')
  })

  it('cannot change a customer', async () => {
    await request(app.getHttpServer())
      .patch(`/customers/${northCustomer}`)
      .set('x-test-identity', technician())
      .send({ name: 'Umbenannt' })
      .expect(403)
  })

  it('can create one, which is not the same right and on purpose', async () => {
    // The pair that decision #32 is about. A call out at an address nobody
    // has entered yet is the case the offline story is built around, so this
    // goes through; correcting what the office wrote down is the test above,
    // and it stays refused.
    await request(app.getHttpServer())
      .post('/customers')
      .set('x-test-identity', technician())
      .send({ kind: 'private', name: 'Notdienst Sonntag' })
      .expect(201)
  })
})

describe('the office', () => {
  it('can issue a document, and only once', async () => {
    const draft = await request(app.getHttpServer())
      .post('/documents')
      .set('x-test-identity', as(north.id, 'office'))
      .send({ customerId: northCustomer, kind: 'final_invoice', documentDate: '2026-09-18' })
      .expect(201)

    const issued = await request(app.getHttpServer())
      .post(`/documents/${draft.body.id}/issue`)
      .set('x-test-identity', as(north.id, 'office'))
      .expect(201)
    expect(issued.body.status).toBe('issued')
    expect(issued.body.issuedAt).not.toBeNull()

    await request(app.getHttpServer())
      .post(`/documents/${draft.body.id}/issue`)
      .set('x-test-identity', as(north.id, 'office'))
      .expect(409)
  })

  it('cannot edit a document once it is issued', async () => {
    const draft = await request(app.getHttpServer())
      .post('/documents')
      .set('x-test-identity', as(north.id, 'office'))
      .send({ customerId: northCustomer, kind: 'quote', documentDate: '2026-09-18' })
      .expect(201)

    await request(app.getHttpServer())
      .patch(`/documents/${draft.body.id}`)
      .set('x-test-identity', as(north.id, 'office'))
      .send({ subject: 'Noch ein Entwurf' })
      .expect(200)

    await request(app.getHttpServer())
      .post(`/documents/${draft.body.id}/issue`)
      .set('x-test-identity', as(north.id, 'office'))
      .expect(201)

    // Not editable any more. A correction is a cancellation or a credit note,
    // which is leading decision 4 and not something a PATCH may undo.
    await request(app.getHttpServer())
      .patch(`/documents/${draft.body.id}`)
      .set('x-test-identity', as(north.id, 'office'))
      .send({ subject: 'Nachträglich geändert' })
      .expect(404)
  })
})

describe('rights and tenants', () => {
  it('are two different questions', async () => {
    // The office of the other tenant has every right this route asks for, and
    // still sees nothing: rights say what may be done, row level security says
    // whose data it may be done to.
    const seen = await request(app.getHttpServer())
      .get('/customers')
      .set('x-test-identity', as(south.id, 'office'))
      .expect(200)

    expect(seen.body).toEqual([])

    await request(app.getHttpServer())
      .patch(`/customers/${northCustomer}`)
      .set('x-test-identity', as(south.id, 'office'))
      .send({ name: 'Fremdzugriff' })
      .expect(404)
  })

  it('cannot be smuggled past by putting a tenant in the body', async () => {
    const created = await request(app.getHttpServer())
      .post('/customers')
      .set('x-test-identity', as(south.id, 'office'))
      .send({ kind: 'business', name: 'Untergeschoben', tenantId: north.id })
      .expect(201)

    // The field was dropped before it reached the database, so the row landed
    // where the identity says, not where the body asked for.
    expect(created.body.tenantId).toBe(south.id)
  })
})

describe('without an identity', () => {
  it('nothing works, not even reading', async () => {
    await request(app.getHttpServer()).get('/customers').expect(401)
    await request(app.getHttpServer())
      .post('/customers')
      .send({ kind: 'business', name: 'Anonym' })
      .expect(401)
  })
})

describe('the number a document gets', () => {
  it('is the one the preview announced, and it is handed out only when issuing', async () => {
    const preview = await request(app.getHttpServer())
      .get('/documents/next-number/final_invoice')
      .set('x-test-identity', as(north.id, 'office'))
      .expect(200)

    const draft = await request(app.getHttpServer())
      .post('/documents')
      .set('x-test-identity', as(north.id, 'office'))
      .send({ customerId: northCustomer, kind: 'final_invoice', documentDate: '2026-09-18' })
      .expect(201)

    // A draft has no number. It gets one at the moment it is issued, which is
    // the moment it starts counting for the bookkeeping.
    expect(draft.body.number).toBeNull()

    const issued = await request(app.getHttpServer())
      .post(`/documents/${draft.body.id}/issue`)
      .set('x-test-identity', as(north.id, 'office'))
      .expect(201)

    expect(issued.body.number).toBe(preview.body.preview)
  })

  it('runs per tenant, so two businesses both start at one', async () => {
    const southCustomer = await request(app.getHttpServer())
      .post('/customers')
      .set('x-test-identity', as(south.id, 'office'))
      .send({ kind: 'business', name: 'Bauherr Süd' })
      .expect(201)

    const draft = await request(app.getHttpServer())
      .post('/documents')
      .set('x-test-identity', as(south.id, 'office'))
      .send({
        customerId: southCustomer.body.id,
        kind: 'final_invoice',
        documentDate: '2026-09-18',
      })
      .expect(201)

    const issued = await request(app.getHttpServer())
      .post(`/documents/${draft.body.id}/issue`)
      .set('x-test-identity', as(south.id, 'office'))
      .expect(201)

    expect(issued.body.number).toBe('RE-2026-0001')
  })

  it('refuses a document kind it does not know', async () => {
    await request(app.getHttpServer())
      .get('/documents/next-number/rechnung')
      .set('x-test-identity', as(north.id, 'office'))
      .expect(400)
  })
})

describe('what the audit log says about a request', () => {
  function entriesFor(recordId: string) {
    return database.forTenant({ tenantId: north.id }, (tx) =>
      tx
        .select()
        .from(auditEntries)
        .where(eq(auditEntries.recordId, recordId))
        .orderBy(auditEntries.changedAt, auditEntries.field),
    )
  }

  it('names the person behind the request', async () => {
    const created = await request(app.getHttpServer())
      .post('/customers')
      .set('x-test-identity', as(north.id, 'office'))
      .send({ kind: 'business', name: 'Protokoll GmbH' })
      .expect(201)

    const entries = await entriesFor(created.body.id)

    expect(entries.find((entry) => entry.field === 'name')).toMatchObject({
      operation: 'insert',
      newValue: 'Protokoll GmbH',
      userId: 'test',
      reason: 'customer.create',
    })
  })

  it('takes the reason from the route that ran, not from a handler that remembered to pass one', async () => {
    const draft = await request(app.getHttpServer())
      .post('/documents')
      .set('x-test-identity', as(north.id, 'office'))
      .send({ customerId: northCustomer, kind: 'quote', documentDate: '2026-09-18' })
      .expect(201)

    await request(app.getHttpServer())
      .post(`/documents/${draft.body.id}/issue`)
      .set('x-test-identity', as(north.id, 'office'))
      .expect(201)

    const reasons = new Map((await entriesFor(draft.body.id)).map((e) => [e.field, e.reason]))

    // Two routes, one record, two reasons. Writing the draft and issuing it
    // are different rights, and the log is where that difference has to be
    // visible afterwards: a number was handed out, and this says under what
    // authority.
    expect(reasons.get('kind')).toBe('document.write')
    expect(reasons.get('number')).toBe('document.issue')
  })
})
