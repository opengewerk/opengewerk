import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import type { DocumentContent } from '@opengewerk/domain'
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
  refusedBy,
  resetSchema,
} from '../database/test-database.js'
import { ApiModule } from './api.module.js'
import { as, testIdentities as identities } from './test-identity.js'
import { finalInvoice, invoiceable, oneLine } from './test-invoice.js'

/**
 * Issuing, since #71: the mandatory details before the number, and the
 * snapshot after it.
 *
 * The first half is the check section 4.2 asks for. What is tested here is
 * that it is the gate and not a warning: an invoice missing a detail does not
 * get a number, the counter does not move, and the answer says what to fix.
 * The rules themselves, which detail under which list, are tested in
 * `domain`, where they live.
 *
 * The second half is what makes a PDF printed next year say what the invoice
 * said: the content is written down at the moment of issuing, and neither a
 * changed customer nor anybody at a database prompt changes it afterwards.
 */

const north = { id: newId<'tenant'>(), name: 'Elektro Nord GmbH' }

let admin: Pool
let database: Database
let app: INestApplication

const office = () => as(north.id, 'office')
const boss = () => as(north.id, 'owner')

function http() {
  return request(app.getHttpServer())
}

async function customer(fields: Record<string, unknown> = {}) {
  const created = await http()
    .post('/customers')
    .set('x-test-identity', office())
    .send({ kind: 'private', name: 'Familie Berg', ...fields })
    .expect(201)

  return (created.body as { id: string }).id
}

async function draft(customerId: string, fields: Record<string, unknown> = {}, line = true) {
  const created = await http()
    .post('/documents')
    .set('x-test-identity', office())
    .send({ customerId, ...finalInvoice, ...fields })
    .expect(201)

  const id = (created.body as { id: string }).id

  if (line) {
    await http()
      .post(`/documents/${id}/lines`)
      .set('x-test-identity', office())
      .send(oneLine)
      .expect(201)
  }

  return id
}

function issue(documentId: string) {
  return http().post(`/documents/${documentId}/issue`).set('x-test-identity', office())
}

async function nextNumber() {
  const answer = await http()
    .get('/documents/next-number/final_invoice')
    .set('x-test-identity', office())
    .expect(200)

  return (answer.body as { preview: string }).preview
}

async function snapshotOf(documentId: string) {
  const { rows } = await admin.query<{ content: DocumentContent }>(
    'select content from document_snapshots where document_id = $1',
    [documentId],
  )

  return rows[0]?.content
}

const letterhead = {
  companyName: 'Elektro Nord GmbH',
  street: 'Hafenstraße',
  houseNumber: '12',
  postalCode: '20457',
  city: 'Hamburg',
  // Not for section 14: a quote to a consumer carries the instruction on
  // withdrawal since #109, and its model names both.
  phone: '040 123456',
  email: 'info@nord.example.de',
  taxNumber: '22/815/08154',
}

beforeAll(async () => {
  admin = await connect()
  await resetSchema(admin)
  await applyMigrations()
  await allowApplicationLogin(admin)
  await admin.query('insert into tenants (id, name) values ($1, $2)', [north.id, north.name])

  database = Database.connect(applicationDatabaseUrl())

  const built = await Test.createTestingModule({
    imports: [ApiModule.create(database, identities)],
  }).compile()

  app = built.createNestApplication()
  await app.init()
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
})

describe('an invoice missing mandatory details', () => {
  it('is not issued, and the answer lists what is missing and why', async () => {
    // No letterhead yet, a customer without an address, no period of work.
    const document = await draft(await customer(), { serviceFrom: null, serviceUntil: null })

    const refused = await issue(document).expect(422)
    const body = refused.body as {
      message: string
      missing: { detail: string; message: string }[]
    }

    expect(body.missing.map((entry) => entry.detail)).toEqual([
      'issuer_address',
      'issuer_tax_number',
      'recipient_address',
      'service_date',
    ])
    expect(body.message).toContain('es fehlen Pflichtangaben')
    expect(body.message).toContain('§ 14 Abs. 4 Nr. 6 UStG')
  })

  it('leaves the counter where it was, so the next invoice has no gap before it', async () => {
    const before = await nextNumber()
    const document = await draft(await customer())

    await issue(document).expect(422)

    expect(await nextNumber()).toBe(before)
  })

  it('goes through once the details are there, from wherever they had to be entered', async () => {
    const customerId = await customer()
    const document = await draft(customerId, { serviceFrom: null, serviceUntil: null })

    await issue(document).expect(422)

    // Three different places, which is why the message names them: the
    // letterhead, the customer and the document itself.
    await http()
      .put('/settings/letterhead')
      .set('x-test-identity', boss())
      .send(letterhead)
      .expect(200)
    await http()
      .patch(`/customers/${customerId}`)
      .set('x-test-identity', office())
      .send(invoiceable)
      .expect(200)
    await http()
      .patch(`/documents/${document}`)
      .set('x-test-identity', office())
      .send({ serviceFrom: '2026-09-01' })
      .expect(200)

    const issued = await issue(document).expect(201)

    expect((issued.body as { status: string }).status).toBe('issued')
  })

  it('says so when its date lies before any rule the packages hold', async () => {
    // No VAT rate and no limit for a small amount exists for 2005, and the
    // engine refuses rather than guesses. The person issuing can fix the date.
    const document = await draft(await customer(invoiceable), { documentDate: '2005-06-01' }, false)

    const refused = await issue(document).expect(422)

    expect((refused.body as { message: string }).message).toContain('2005-06-01')
  })
})

describe('what is not an invoice', () => {
  it('is issued without the details of section 14', async () => {
    const quote = await draft(await customer(), {
      kind: 'quote',
      serviceFrom: null,
      serviceUntil: null,
    })

    await issue(quote).expect(201)
  })
})

describe('an invoice of a small amount', () => {
  it('needs no customer address, as section 33 UStDV has it', async () => {
    const document = await draft(await customer(), { serviceFrom: null, serviceUntil: null }, false)

    await http()
      .post(`/documents/${document}/lines`)
      .set('x-test-identity', office())
      .send({ ...oneLine, unitPriceCents: 15000 })
      .expect(201)

    await issue(document).expect(201)
  })
})

describe('the snapshot written at issuing', () => {
  it('holds the number and what the document said at that moment', async () => {
    const document = await draft(await customer(invoiceable))
    const issued = await issue(document).expect(201)
    const snapshot = await snapshotOf(document)

    expect(snapshot?.number).toBe((issued.body as { number: string }).number)
    expect(snapshot?.recipient).toMatchObject({ name: 'Familie Berg', street: 'Lindenweg' })
    expect(snapshot?.issuer).toMatchObject({ name: 'Elektro Nord GmbH', taxNumber: '22/815/08154' })
    expect(snapshot?.lines).toHaveLength(1)
    expect(snapshot?.totals.grossCents).toBe(119000)
  })

  it('does not follow the customer when the customer moves', async () => {
    const customerId = await customer(invoiceable)
    const document = await draft(customerId)
    await issue(document).expect(201)

    await http()
      .patch(`/customers/${customerId}`)
      .set('x-test-identity', office())
      .send({ street: 'Neue Straße', postalCode: '10115', city: 'Berlin' })
      .expect(200)

    expect((await snapshotOf(document))?.recipient.city).toBe('Hamburg')
  })

  it('cannot be changed or deleted, not even by a superuser', async () => {
    const document = await draft(await customer(invoiceable))
    await issue(document).expect(201)

    // The application has no grant for either. A superuser has every right,
    // and row level security does not even apply to it, and it still meets
    // the trigger, which is the point of having one.
    const changed = await refusedBy(
      admin.query(
        `update document_snapshots set content = jsonb_set(content, '{number}', '"X"')
          where document_id = $1`,
        [document],
      ),
    )
    const deleted = await refusedBy(
      admin.query('delete from document_snapshots where document_id = $1', [document]),
    )

    expect(changed.code).toBe('OG001')
    expect(deleted.code).toBe('OG001')
  })

  it('is written once, and a second issuing is refused before it gets there', async () => {
    const document = await draft(await customer(invoiceable))
    await issue(document).expect(201)
    await issue(document).expect(409)

    const { rows } = await admin.query<{ count: string }>(
      'select count(*) from document_snapshots where document_id = $1',
      [document],
    )

    expect(Number(rows[0]?.count)).toBe(1)
  })
})
