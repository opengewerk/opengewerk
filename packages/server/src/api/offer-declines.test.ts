import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { berlinClock, type DocumentId, type TenantId } from '@opengewerk/domain'
import { Database, newId } from '@opengewerk/platform-server'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { applicationDatabaseUrl, connect, resetToMigrated } from '../database/test-database.js'
import { ApiModule } from './api.module.js'
import { as, testIdentities as identities } from './test-identity.js'

/**
 * An offer the customer turned down (#841): the office marks an issued quote
 * nothing follows yet, and takes the mark back. A declined quote gets no
 * successor and no maintenance contract, and a decline belongs to the
 * business it was made in.
 */

const north = newId<'tenant'>() as TenantId
const south = newId<'tenant'>() as TenantId
const today = berlinClock(new Date()).day

let admin: Pool
let database: Database
let app: INestApplication
const customers: Record<string, string> = {}

const office = (tenant: TenantId = north) => as(tenant, 'office')

function http() {
  return request(app.getHttpServer())
}

function refusal(answer: { body: unknown }): string {
  return String((answer.body as { message?: string }).message)
}

async function offer(
  over: {
    tenant?: TenantId
    status?: 'issued' | 'draft'
    kind?: string
    documentDate?: string
  } = {},
): Promise<DocumentId> {
  const id = newId<'document'>() as DocumentId
  const tenant = over.tenant ?? north
  const status = over.status ?? 'issued'

  await admin.query(
    `insert into documents (id, tenant_id, customer_id, kind, status, number, document_date, issued_at, issued_by, subject)
     values ($1, $2, $3, $4, $5, $6, $7, $8, 'britta', 'Wallbox in der Garage')`,
    [
      id,
      tenant,
      customers[tenant],
      over.kind ?? 'quote',
      status,
      status === 'issued' ? `AN-${id.slice(-6)}` : null,
      over.documentDate ?? '2026-10-21',
      status === 'issued' ? new Date('2026-10-21T09:00:00Z') : null,
    ],
  )

  return id
}

async function decline(id: string, body: Record<string, unknown> = {}, expected = 200) {
  return http()
    .put(`/offer-declines/${id}`)
    .set('x-test-identity', office())
    .send(body)
    .expect(expected)
}

beforeAll(async () => {
  admin = await connect()
  await resetToMigrated()
  await admin.query('insert into tenants (id, name) values ($1, $2), ($3, $4)', [
    north,
    'Elektro Nord GmbH',
    south,
    'Elektro Süd GmbH',
  ])

  for (const tenant of [north, south]) {
    const id = newId<'customer'>()

    await admin.query(
      "insert into customers (id, tenant_id, kind, name) values ($1, $2, 'private', 'Kern, Ingrid')",
      [id, tenant],
    )
    customers[tenant] = id
  }

  database = Database.connect(applicationDatabaseUrl())

  const built = await Test.createTestingModule({
    imports: [ApiModule.create(database, identities)],
  }).compile()

  app = built.createNestApplication()
  await app.init()
})

beforeEach(async () => {
  await admin.query('delete from offer_declines')
  await admin.query('delete from maintenance_contracts')
  await admin.query(
    'begin; set local session_replication_role = replica; delete from documents; commit;',
  )
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
})

describe('marking an offer as declined (#841)', () => {
  it('keeps the day, today unless the office says otherwise, and a reason it may leave out', async () => {
    const quote = await offer()
    const marked = await decline(quote, { reason: '  Preis zu hoch  ' })

    expect(marked.body).toMatchObject({
      documentId: quote,
      declinedOn: today,
      reason: 'Preis zu hoch',
    })

    const changed = await decline(quote, { declinedOn: '2026-10-30', reason: '' })

    expect(changed.body).toMatchObject({ declinedOn: '2026-10-30', reason: null })

    const listed = await http().get('/offer-declines').set('x-test-identity', office()).expect(200)

    expect(listed.body).toEqual([
      expect.objectContaining({ documentId: quote, declinedOn: '2026-10-30' }),
    ])
  })

  it('takes a cost estimate too, and refuses a draft, an invoice and a day out of bounds', async () => {
    await decline(await offer({ kind: 'cost_estimate' }))
    expect(refusal(await decline(await offer({ status: 'draft' }), {}, 409))).toContain(
      'festgeschriebenes',
    )
    expect(refusal(await decline(await offer({ kind: 'final_invoice' }), {}, 409))).toContain(
      'nur ein Angebot',
    )
    expect(refusal(await decline(await offer(), { declinedOn: '2999-01-01' }, 422))).toBe(
      'Der Tag der Ablehnung liegt nicht in der Zukunft.',
    )
    expect(refusal(await decline(await offer(), { declinedOn: '2026-10-20' }, 422))).toBe(
      'Abgelehnt wird ein Angebot nicht vor seinem Datum.',
    )
  })

  it('refuses an offer that a document or a maintenance contract follows', async () => {
    const followed = await offer()

    await admin.query(
      `insert into documents (tenant_id, customer_id, kind, status, document_date, predecessor_document_id)
       values ($1, $2, 'order_confirmation', 'draft', '2026-10-25', $3)`,
      [north, customers[north], followed],
    )
    expect(refusal(await decline(followed, {}, 409))).toContain('schon ein Beleg')

    const contracted = await offer()

    await admin.query(
      `insert into maintenance_contracts (tenant_id, number, designation, customer_id, quote_id, starts_on,
         first_visit_on, interval_months, term_months, renewal, notice_months, price_kind)
       values ($1, 'WV-2026-0001', 'Wartung', $2, $3, '2026-11-01', '2026-12-01', 12, 12, 'none', 0, 'effort')`,
      [north, customers[north], contracted],
    )
    expect(refusal(await decline(contracted, {}, 409))).toContain('Wartungsvertrag')
  })

  it('gives a declined quote no successor and no contract until the mark is taken back', async () => {
    const quote = await offer()

    await decline(quote)

    const successor = await http()
      .post(`/documents/${quote}/successors`)
      .set('x-test-identity', office())
      .send({ kind: 'order_confirmation' })
      .expect(409)

    expect(refusal(successor)).toContain('als abgelehnt markiert')

    const contract = await http()
      .post('/maintenance-contracts')
      .set('x-test-identity', office())
      .send({
        quoteId: quote,
        designation: 'Wartung',
        startsOn: today,
        firstVisitOn: today,
        intervalMonths: 12,
        termMonths: 12,
        renewal: 'none',
        noticeMonths: 0,
        priceKind: 'effort',
      })
      .expect(409)

    expect(refusal(contract)).toContain('als abgelehnt markiert')

    await http().delete(`/offer-declines/${quote}`).set('x-test-identity', office()).expect(200)
    await http()
      .post(`/documents/${quote}/successors`)
      .set('x-test-identity', office())
      .send({ kind: 'order_confirmation' })
      .expect(201)
    await http().delete(`/offer-declines/${quote}`).set('x-test-identity', office()).expect(404)
  })

  it('is set by whoever issues documents, and read by whoever reads them', async () => {
    const quote = await offer()

    await http()
      .put(`/offer-declines/${quote}`)
      .set('x-test-identity', as(north, 'technician'))
      .send({})
      .expect(403)
    await http().get('/offer-declines').set('x-test-identity', as(north, 'technician')).expect(200)
  })

  it('belongs to the business it was made in', async () => {
    const theirs = await offer({ tenant: south })

    await http()
      .put(`/offer-declines/${theirs}`)
      .set('x-test-identity', office(south))
      .send({})
      .expect(200)
    await http()
      .put(`/offer-declines/${theirs}`)
      .set('x-test-identity', office())
      .send({})
      .expect(404)
    await http().delete(`/offer-declines/${theirs}`).set('x-test-identity', office()).expect(404)

    const listed = await http().get('/offer-declines').set('x-test-identity', office()).expect(200)

    expect(listed.body).toEqual([])
    expect((await admin.query('select count(*)::int as count from offer_declines')).rows).toEqual([
      { count: 1 },
    ])
  })
})
