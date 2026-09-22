import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
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
import { as, testIdentities as identities } from './test-identity.js'
import { invoiceable, issuableDraft, oneLine, readyToInvoice } from './test-invoice.js'

/**
 * The payment term, from the setting to the frozen document.
 *
 * A business sets it once, a document states its own when it differs, the
 * documents made out of it carry that along, and whatever applied is frozen
 * with the document: as days on a quote, as the day payment is due on an
 * invoice. The setting is read on the document's date, so a change applies to
 * what comes after it and not to what was written before.
 *
 * The tests run in order and share one business, and the setting only ever
 * moves forward. The first ones therefore see the default, and everything
 * dated from October on sees the thirty days set in the middle.
 */

const north = { id: newId<'tenant'>(), name: 'Elektro Nord GmbH' }

let admin: Pool
let database: Database
let app: INestApplication
let customerId: string

const office = () => as(north.id, 'office')
const owner = () => as(north.id, 'owner')

const outOfRange = 'Das Zahlungsziel liegt zwischen 0 und 365 Tagen, 0 heißt sofort zahlbar.'

interface Term {
  readonly days: number
  readonly dueOn: string | null
}

function http() {
  return request(app.getHttpServer())
}

async function issue(documentId: string) {
  await http().post(`/documents/${documentId}/issue`).set('x-test-identity', office()).expect(201)
}

/** What the document froze about its payment term when it was issued. */
async function frozenTerm(documentId: string): Promise<Term | null> {
  const { rows } = await admin.query<{ content: { paymentTerm: Term | null } }>(
    'select content from document_snapshots where document_id = $1',
    [documentId],
  )

  if (!rows[0]) {
    throw new Error(`Document ${documentId} froze nothing.`)
  }

  return rows[0].content.paymentTerm
}

/** A quote with one line, still a draft. */
async function quote(fields: Record<string, unknown> = {}) {
  const created = await http()
    .post('/documents')
    .set('x-test-identity', office())
    .send({ customerId, kind: 'quote', documentDate: '2026-09-21', ...fields })
    .expect(201)
  const id = (created.body as { id: string }).id

  await http()
    .post(`/documents/${id}/lines`)
    .set('x-test-identity', office())
    .send(oneLine)
    .expect(201)

  return id
}

function change(documentId: string, fields: Record<string, unknown>) {
  return http().patch(`/documents/${documentId}`).set('x-test-identity', office()).send(fields)
}

function setting(value: unknown, from: string, who = owner()) {
  return http()
    .post('/settings/parameters')
    .set('x-test-identity', who)
    .send({ key: 'invoice.payment_term_days', from, value })
}

beforeAll(async () => {
  admin = await connect()
  await resetSchema(admin)
  await applyMigrations()
  await allowApplicationLogin(admin)
  await admin.query('insert into tenants (id, name) values ($1, $2)', [north.id, north.name])
  await readyToInvoice(admin, north.id)

  database = Database.connect(applicationDatabaseUrl())

  const built = await Test.createTestingModule({
    imports: [ApiModule.create(database, identities)],
  }).compile()

  app = built.createNestApplication()
  await app.init()

  const customer = await http()
    .post('/customers')
    .set('x-test-identity', office())
    .send({ kind: 'private', name: 'Familie Berg', ...invoiceable })
    .expect(201)

  customerId = (customer.body as { id: string }).id
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
})

describe('before the business has set a payment term', () => {
  it('an invoice asks for payment fourteen days after its date', async () => {
    const invoice = await issuableDraft(app, office(), customerId)
    await issue(invoice)

    expect(await frozenTerm(invoice)).toEqual({ days: 14, dueOn: '2026-10-02' })
  })

  it('a quote states the fourteen days, since its invoice has no date yet', async () => {
    const draft = await quote()
    await issue(draft)

    expect(await frozenTerm(draft)).toEqual({ days: 14, dueOn: null })
  })
})

describe('the setting', () => {
  it('is refused outside the range a document may state, with the same sentence', async () => {
    for (const wrong of [-1, 366]) {
      const refused = await setting(wrong, '2026-10-01').expect(400)

      expect((refused.body as { message: string }).message).toBe(outOfRange)
    }
  })

  it('is set by the owner and nobody else', async () => {
    await setting(30, '2026-10-01', office()).expect(403)
  })

  it('applies from its day on, and leaves what is dated before it alone', async () => {
    await setting(30, '2026-10-01').expect(201)

    const before = await issuableDraft(app, office(), customerId, { documentDate: '2026-09-30' })
    const after = await issuableDraft(app, office(), customerId, { documentDate: '2026-10-05' })
    await issue(before)
    await issue(after)

    expect(await frozenTerm(before)).toEqual({ days: 14, dueOn: '2026-10-14' })
    expect(await frozenTerm(after)).toEqual({ days: 30, dueOn: '2026-11-04' })
  })
})

describe('a term of the document itself', () => {
  it('takes the place of the setting, and null hands the document back to it', async () => {
    const invoice = await issuableDraft(app, office(), customerId, {
      documentDate: '2026-10-06',
      paymentTermDays: 7,
    })

    const cleared = await change(invoice, { paymentTermDays: null }).expect(200)
    expect((cleared.body as { paymentTermDays: number | null }).paymentTermDays).toBeNull()

    await change(invoice, { paymentTermDays: 0 }).expect(200)
    await issue(invoice)

    expect(await frozenTerm(invoice)).toEqual({ days: 0, dueOn: '2026-10-06' })
  })

  it('is refused outside what a form would send, with the sentence the form shows', async () => {
    const draft = await quote({ documentDate: '2026-10-06' })

    for (const wrong of [-1, 366]) {
      const refused = await change(draft, { paymentTermDays: wrong }).expect(400)

      expect((refused.body as { message: string }).message).toBe(outOfRange)
    }

    for (const wrong of [1.5, '14']) {
      const refused = await change(draft, { paymentTermDays: wrong }).expect(400)

      expect((refused.body as { message: string }).message).toBe(
        'Das Zahlungsziel ist eine ganze Zahl von Tagen.',
      )
    }

    await http()
      .post('/documents')
      .set('x-test-identity', office())
      .send({ customerId, kind: 'quote', documentDate: '2026-10-06', paymentTermDays: 400 })
      .expect(400)
  })

  it('is fixed with the rest once the document is issued', async () => {
    const draft = await quote({ documentDate: '2026-10-06' })
    await issue(draft)

    const refused = await change(draft, { paymentTermDays: 5 }).expect(409)

    expect((refused.body as { message: string }).message).toContain('festgeschrieben')
    expect(await frozenTerm(draft)).toEqual({ days: 30, dueOn: null })
  })

  it('goes along the chain, because the customer agreed on it with the quote', async () => {
    const agreed = await quote({ documentDate: '2026-10-06', paymentTermDays: 45 })
    const plain = await quote({ documentDate: '2026-10-06' })
    await issue(agreed)
    await issue(plain)

    const confirmation = await http()
      .post(`/documents/${agreed}/successors`)
      .set('x-test-identity', office())
      .send({ kind: 'order_confirmation', documentDate: '2026-10-07' })
      .expect(201)
    const unstated = await http()
      .post(`/documents/${plain}/successors`)
      .set('x-test-identity', office())
      .send({ kind: 'order_confirmation', documentDate: '2026-10-07' })
      .expect(201)

    expect((confirmation.body as { paymentTermDays: number | null }).paymentTermDays).toBe(45)
    expect((unstated.body as { paymentTermDays: number | null }).paymentTermDays).toBeNull()
  })
})

describe('a term that arrives through the sync', () => {
  function operation(documentId: string, to: unknown) {
    return {
      id: newId<'operation'>(),
      entity: 'documents',
      recordId: documentId,
      kind: 'update',
      baseVersion: null,
      patches: [{ field: 'paymentTermDays', from: null, to }],
      recordedAt: new Date().toISOString(),
    }
  }

  it('is written like any other field of a draft', async () => {
    const draft = await quote({ documentDate: '2026-10-06' })

    const answer = await http()
      .post('/sync')
      .set('x-test-identity', office())
      .send({ deviceId: 'office-desktop', operations: [operation(draft, 21)] })
      .expect(201)

    expect(
      (answer.body as { receipts: { outcome: string }[] }).receipts.map((one) => one.outcome),
    ).toEqual(['applied'])

    await issue(draft)

    expect(await frozenTerm(draft)).toEqual({ days: 21, dueOn: null })
  })

  it('is refused when no form of this system would have sent it', async () => {
    const draft = await quote({ documentDate: '2026-10-06' })

    const refused = await http()
      .post('/sync')
      .set('x-test-identity', office())
      .send({ deviceId: 'office-desktop', operations: [operation(draft, 500)] })
      .expect(400)

    expect((refused.body as { message: string }).message).toBe(outOfRange)
  })
})
