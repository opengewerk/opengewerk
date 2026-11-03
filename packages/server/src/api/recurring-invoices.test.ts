import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { addDays, addMonths, berlinClock, type DocumentId, type TenantId } from '@opengewerk/domain'
import { Database, newId } from '@opengewerk/platform-server'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { applicationDatabaseUrl, connect, resetToMigrated } from '../database/test-database.js'
import { runDeadlinesOf } from '../deadlines/engine.js'
import { contractInvoicesToSend } from '../notifications/contract-invoices.js'
import { ApiModule } from './api.module.js'
import { as, testIdentities as identities } from './test-identity.js'
import { invoiceable, readyToInvoice } from './test-invoice.js'

/**
 * The recurring invoices of maintenance contracts paid per period (#295): one
 * per period and never two, dated on the first day of the period and taxed by
 * its rate, the first of a contract a draft and the next issued by nobody
 * where the contract wants it, and those sent to the customer once.
 */

const north = newId<'tenant'>() as TenantId
const today = berlinClock(new Date()).day

let admin: Pool
let database: Database
let app: INestApplication
let customer = ''
let silent = ''
let site = ''

const office = () => as(north, 'office')

async function quote(customerId: string): Promise<DocumentId> {
  const id = newId<'document'>() as DocumentId

  await admin.query(
    `insert into documents (id, tenant_id, customer_id, site_id, kind, status, number, document_date, issued_at, issued_by, subject)
     values ($1, $2, $3, $4, 'quote', 'issued', $5, $6, now(), 'britta', 'Wartung')`,
    [id, north, customerId, customerId === customer ? site : null, `AN-${id.slice(-6)}`, today],
  )

  return id
}

/** A contract paid by the month, entered the day before it began, so that its periods since are its own. */
async function contract(
  startsOn: string,
  overrides: Record<string, unknown> = {},
  customerId = customer,
) {
  const answer = await request(app.getHttpServer())
    .post('/maintenance-contracts')
    .set('x-test-identity', office())
    .send({
      quoteId: await quote(customerId),
      designation: 'Wartung Elektroanlage Rheinstraße 12',
      installationIds: [],
      startsOn,
      firstVisitOn: addMonths(startsOn as never, 60),
      intervalMonths: 12,
      termMonths: 120,
      renewal: 'none',
      noticeMonths: 0,
      priceKind: 'flat',
      flatCents: 3_900,
      paymentRhythm: 'monthly',
      issueByItself: true,
      ...overrides,
    })
    .expect(201)
  const id = String((answer.body as { id: string }).id)

  await admin.query('update maintenance_contracts set created_at = $2 where id = $1', [
    id,
    `${addDays(startsOn as never, -1)}T12:00:00Z`,
  ])

  return id
}

async function invoicesOf(contractId: string) {
  const { rows } = await admin.query<{
    id: string
    status: string
    number: string | null
    issued_by: string | null
    document_date: string
    service_from: string
    service_until: string
  }>(
    `select id, status, number, issued_by, to_char(document_date, 'YYYY-MM-DD') as document_date,
            to_char(service_from, 'YYYY-MM-DD') as service_from, to_char(service_until, 'YYYY-MM-DD') as service_until
       from documents where maintenance_contract_id = $1 order by service_from`,
    [contractId],
  )

  return rows
}

async function run(times: number) {
  for (let pass = 0; pass < times; pass += 1) {
    await runDeadlinesOf({ database }, north, new Date())
  }
}

beforeAll(async () => {
  admin = await connect()
  await resetToMigrated()
  await admin.query('insert into tenants (id, name) values ($1, $2)', [north, 'Elektro Nord GmbH'])
  await readyToInvoice(admin, north)

  customer = newId<'customer'>()
  silent = newId<'customer'>()
  site = newId<'site'>()
  await admin.query(
    `insert into customers (id, tenant_id, kind, name, is_business, email, street, house_number, postal_code, city)
     values ($1, $3, 'business', 'Hausverwaltung Süd GmbH', true, 'buchhaltung@hv-sued.example', $4, $5, $6, $7),
            ($2, $3, 'business', 'Metzgerei Lang GmbH', true, null, $4, $5, $6, $7)`,
    [
      customer,
      silent,
      north,
      invoiceable.street,
      invoiceable.houseNumber,
      invoiceable.postalCode,
      invoiceable.city,
    ],
  )
  await admin.query(
    `insert into sites (id, tenant_id, customer_id, designation) values ($1, $2, $3, 'Rheinstraße 12')`,
    [site, north, customer],
  )

  database = Database.connect(applicationDatabaseUrl())

  const built = await Test.createTestingModule({
    imports: [ApiModule.create(database, identities)],
  }).compile()

  app = built.createNestApplication()
  await app.init()
})

beforeEach(async () => {
  await admin.query('delete from deadlines')
  await admin.query('delete from tasks')
  await admin.query(
    'begin; set local session_replication_role = replica; delete from mail_outbox; delete from document_snapshots; delete from document_lines; delete from documents; delete from maintenance_contracts; commit;',
  )
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
})

describe('the recurring invoices of a contract (#295)', () => {
  it('come one per period, the first a draft and the next issued by nobody, and none twice', async () => {
    const startsOn = addMonths(today, -2)
    const made = await contract(startsOn)

    await run(5)

    const invoices = await invoicesOf(made)

    expect(invoices.map((invoice) => [invoice.service_from, invoice.status])).toEqual([
      [startsOn, 'draft'],
      [addMonths(startsOn, 1), 'issued'],
      [addMonths(startsOn, 2), 'issued'],
    ])
    expect(invoices[0]?.service_until).toBe(addDays(addMonths(startsOn, 1), -1))
    expect(invoices.every((invoice) => invoice.document_date === invoice.service_from)).toBe(true)
    expect(
      invoices.slice(1).every((invoice) => invoice.number !== null && invoice.issued_by === null),
    ).toBe(true)

    const { rows } = await admin.query<{ due_on: string }>(
      `select to_char(due_on, 'YYYY-MM-DD') as due_on from deadlines where kind = 'maintenance.invoice' and source_id = $1`,
      [made],
    )

    expect(rows).toEqual([{ due_on: addMonths(startsOn, 3) }])

    // Billed once, the contract stays and is given notice instead.
    await request(app.getHttpServer())
      .delete(`/maintenance-contracts/${made}`)
      .set('x-test-identity', office())
      .expect(409)
  })

  it('stay drafts without the wish of the contract, and so does a period cut short by its end', async () => {
    const startsOn = addMonths(today, -1)
    const waiting = await contract(startsOn, { issueByItself: false })
    // Four months paid by the quarter: the second quarter ends with the contract.
    const quarters = addMonths(today, -3)
    const ending = await contract(quarters, { termMonths: 4, paymentRhythm: 'quarterly' })

    await run(4)

    expect((await invoicesOf(waiting)).map((invoice) => invoice.status)).toEqual(['draft', 'draft'])
    expect(
      (await invoicesOf(ending)).map((invoice) => [invoice.service_until, invoice.status]),
    ).toEqual([
      [addDays(addMonths(quarters, 3), -1), 'draft'],
      [addDays(addMonths(quarters, 4), -1), 'draft'],
    ])
  })

  it('tax a period by the rate of the period', async () => {
    const made = await contract('2020-06-01', { termMonths: 2 })

    await run(3)

    const { rows } = await admin.query<{ service_from: string; content: unknown }>(
      `select to_char(d.service_from, 'YYYY-MM-DD') as service_from, s.content
         from documents d join document_snapshots s on s.document_id = d.id
        where d.maintenance_contract_id = $1`,
      [made],
    )

    expect(rows.map((row) => row.service_from)).toEqual(['2020-07-01'])
    // The reduced standard rate of the second half of 2020, 16 instead of 19 per cent.
    expect(JSON.stringify(rows[0]?.content)).toContain('"basisPoints":1600')
  })

  it('go to the customer once those were issued by nobody, and to nobody without an address', async () => {
    const startsOn = addMonths(today, -1)
    const made = await contract(startsOn)
    const quiet = await contract(startsOn, {}, silent)

    await run(3)

    const wanted = await contractInvoicesToSend(database, north, new Date())
    const issued = (await invoicesOf(made)).filter((invoice) => invoice.status === 'issued')

    expect(wanted).toEqual([
      expect.objectContaining({
        kind: 'document',
        documentId: issued[0]?.id,
        request: 'contract',
        to: { address: 'buchhaltung@hv-sued.example', name: 'Hausverwaltung Süd GmbH' },
        requestedBy: null,
      }),
    ])
    expect((await invoicesOf(quiet)).filter((invoice) => invoice.status === 'issued')).toHaveLength(
      1,
    )

    await admin.query(
      `insert into mail_outbox (tenant_id, kind, cause, document_id, attachment, sender_name, recipient_address, subject, body)
       values ($1, 'document', $2, $3, 'pdf', 'Elektro Nord GmbH', 'buchhaltung@hv-sued.example', 'Rechnung', 'Rechnung')`,
      [north, `document:${String(issued[0]?.id)}:contract`, issued[0]?.id],
    )

    expect(await contractInvoicesToSend(database, north, new Date())).toEqual([])
  })
})
