import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import type { DocumentContent, EInvoiceStatus } from '@opengewerk/domain'
import { XmlDocument } from 'libxml2-wasm'
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
import { checkedCii } from '../documents/cii-schema.js'
import type { Renderer } from '../documents/renderer.js'
import { FileStore } from '../storage/file-store.js'
import { ApiModule } from './api.module.js'
import { binary } from './test-binary.js'
import { as, testIdentities as identities } from './test-identity.js'
import { invoiceable, readyToInvoice } from './test-invoice.js'

/**
 * The outgoing e-invoice of #75, on real rows.
 *
 * Which invoice goes out as one is decided by the customer's master data, and
 * the first tests hold that by changing the customer and nothing else. Then
 * the XRechnung itself: made from what the invoice froze, checked against the
 * schema, stored once. Then the duty, which turns a missing value from a
 * notice on the screen into a refusal at issuing, from the day the law says.
 */

/** A business with a letterhead that has everything an XRechnung asks for. */
const north = { id: newId<'tenant'>(), name: 'Elektro Nord GmbH' }
/** A business with a tax number and nothing else, the least section 14 asks. */
const south = { id: newId<'tenant'>(), name: 'Elektro Süd' }

let admin: Pool
let database: Database
let app: INestApplication
let storageRoot: string

const standIn: Renderer = () => Promise.resolve(new TextEncoder().encode('%PDF-1.7 Probedruck'))

const office = (tenant = north) => as(tenant.id, 'office')
const owner = (tenant = north) => as(tenant.id, 'owner')

interface DocumentRow {
  readonly id: string
  readonly status: string
  readonly number: string | null
}

function http() {
  return request(app.getHttpServer())
}

/** The fields of a customer who is a business in Germany and has given everything. */
const business = {
  kind: 'business',
  name: 'Hausverwaltung Kramer GmbH',
  ...invoiceable,
  isBusiness: true,
  email: 'buchhaltung@kramer-hv.example',
  vatId: 'DE987654321',
  buyerReference: 'KST-4711',
}

async function customer(fields: Record<string, unknown>, tenant = north): Promise<string> {
  const created = await http()
    .post('/customers')
    .set('x-test-identity', office(tenant))
    .send(fields)
    .expect(201)

  return (created.body as { id: string }).id
}

/** A final invoice of 1.240 euros net, dated and with its period, not yet issued. */
async function draft(
  customerId: string,
  fields: Record<string, unknown> = {},
  tenant = north,
): Promise<string> {
  const created = await http()
    .post('/documents')
    .set('x-test-identity', office(tenant))
    .send({
      customerId,
      kind: 'final_invoice',
      documentDate: '2026-09-18',
      serviceFrom: '2026-09-01',
      serviceUntil: '2026-09-15',
      ...fields,
    })
    .expect(201)
  const id = (created.body as { id: string }).id

  await http()
    .post(`/documents/${id}/lines`)
    .set('x-test-identity', office(tenant))
    .send({
      designation: 'Zählerschrank setzen',
      quantityMilli: 1000,
      unit: 'flat_rate',
      unitPriceCents: 124_000,
    })
    .expect(201)

  return id
}

function issuing(documentId: string, tenant = north) {
  return http().post(`/documents/${documentId}/issue`).set('x-test-identity', office(tenant))
}

async function issued(documentId: string, tenant = north): Promise<DocumentRow> {
  const answer = await issuing(documentId, tenant).expect(201)

  return answer.body as DocumentRow
}

async function statusOf(documentId: string, tenant = north): Promise<EInvoiceStatus> {
  const answer = await http()
    .get(`/documents/${documentId}/e-invoice`)
    .set('x-test-identity', office(tenant))
    .expect(200)

  return answer.body as EInvoiceStatus
}

function xrechnung(documentId: string, tenant = north) {
  return http()
    .get(`/documents/${documentId}/xrechnung`)
    .set('x-test-identity', office(tenant))
    .buffer(true)
    .parse(binary)
}

const namespaces = {
  rsm: 'urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100',
  ram: 'urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100',
}

function read(xml: string, xpath: string): string[] {
  const document = XmlDocument.fromString(xml)

  try {
    return document.find(xpath, namespaces).map((node) => node.content)
  } finally {
    document.dispose()
  }
}

beforeAll(async () => {
  admin = await connect()
  await resetSchema(admin)
  await applyMigrations()
  await allowApplicationLogin(admin)

  for (const tenant of [north, south]) {
    await admin.query('insert into tenants (id, name) values ($1, $2)', [tenant.id, tenant.name])
  }

  await admin.query(
    `insert into letterheads (tenant_id, street, house_number, postal_code, city, phone, email,
       tax_number, vat_id, iban)
     values ($1, 'Hafenstraße', '12', '20457', 'Hamburg', '040 1234567',
       'rechnung@elektro-nord.example', '22/815/08154', 'DE123456789', 'DE02120300000000202051')`,
    [north.id],
  )
  await readyToInvoice(admin, south.id)

  storageRoot = mkdtempSync(join(tmpdir(), 'opengewerk-e-invoice-'))
  database = Database.connect(applicationDatabaseUrl())

  const built = await Test.createTestingModule({
    imports: [
      ApiModule.create(database, identities, {
        files: new FileStore(storageRoot),
        renderer: standIn,
      }),
    ],
  }).compile()

  app = built.createNestApplication()
  await app.init()
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
  rmSync(storageRoot, { recursive: true, force: true })
})

describe('the format of an invoice', () => {
  it('comes from the customer: the same invoice goes to a business as an e-invoice and to a person as a PDF', async () => {
    const company = await draft(await customer(business))
    const person = await draft(
      await customer({
        kind: 'private',
        name: 'Familie Berg',
        ...invoiceable,
        email: 'berg@example.org',
      }),
    )

    expect(await statusOf(company)).toMatchObject({ format: 'e_invoice', issued: false })
    expect(await statusOf(person)).toMatchObject({
      format: 'pdf',
      duty: null,
      reason: expect.stringContaining('kein Unternehmen') as unknown,
    })

    await issued(company)
    await issued(person)

    await xrechnung(company).expect(200)

    const refused = await xrechnung(person).expect(409)

    expect(JSON.parse((refused.body as Buffer).toString('utf8'))).toMatchObject({
      message: expect.stringContaining('kein Unternehmen') as unknown,
    })
  })

  it('has no switch on the document, only the one on the customer', async () => {
    const customerId = await customer(business)
    const id = await draft(customerId)

    // The document takes no such field; the request has nothing left to change.
    await http()
      .patch(`/documents/${id}`)
      .set('x-test-identity', office())
      .send({ format: 'pdf', eInvoice: false })
      .expect(400)
    expect((await statusOf(id)).format).toBe('e_invoice')

    // Changing the customer is what changes it, for a draft.
    await http()
      .patch(`/customers/${customerId}`)
      .set('x-test-identity', office())
      .send({ isBusiness: false })
      .expect(200)
    expect((await statusOf(id)).format).toBe('pdf')
  })

  it('stays what it was when the invoice was issued, whatever the customer becomes', async () => {
    const customerId = await customer(business)
    const id = await draft(customerId)

    await issued(id)
    await http()
      .patch(`/customers/${customerId}`)
      .set('x-test-identity', office())
      .send({ isBusiness: false, email: null })
      .expect(200)

    expect((await statusOf(id)).format).toBe('e_invoice')
    await xrechnung(id).expect(200)
  })
})

describe('the XRechnung', () => {
  it('is made from what the invoice froze, passes the schema, and says XRechnung', async () => {
    const id = await draft(await customer(business))
    const invoice = await issued(id)
    const answer = await xrechnung(id).expect(200)
    const xml = (answer.body as Buffer).toString('utf8')

    expect(answer.headers['content-type']).toMatch(/^application\/xml/)
    expect(answer.headers['content-disposition']).toContain(
      encodeURIComponent(`XRechnung ${invoice.number ?? ''}.xml`),
    )
    expect(answer.headers['cache-control']).toBe('no-store')
    expect(checkedCii(xml)).toBe(xml)
    expect(read(xml, '//ram:GuidelineSpecifiedDocumentContextParameter/ram:ID')).toEqual([
      'urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0',
    ])
    expect(read(xml, '//rsm:ExchangedDocument/ram:ID')).toEqual([invoice.number])
    expect(read(xml, '//ram:ApplicableHeaderTradeAgreement/ram:BuyerReference')).toEqual([
      'KST-4711',
    ])
    expect(read(xml, '//ram:DuePayableAmount')).toEqual(['1475.60'])

    // The customer's side of it is part of the snapshot from version 6 on.
    const { rows } = await admin.query<{ content: DocumentContent }>(
      'select content from document_snapshots where document_id = $1',
      [id],
    )

    expect(rows[0]?.content.recipient).toMatchObject({
      email: 'buchhaltung@kramer-hv.example',
      vatId: 'DE987654321',
      buyerReference: 'KST-4711',
    })
  })

  it('is stored the first time and handed out unchanged every time after', async () => {
    const id = await draft(await customer(business))

    await issued(id)

    const first = (await xrechnung(id).expect(200)).body as Buffer
    const second = (await xrechnung(id).expect(200)).body as Buffer

    expect(second.equals(first)).toBe(true)

    const { rows } = await admin.query<{ purpose: string; media_type: string }>(
      `select document_files.purpose, files.media_type from document_files
         join files on files.id = document_files.file_id where document_id = $1`,
      [id],
    )

    expect(rows).toEqual([{ purpose: 'xrechnung', media_type: 'application/xml' }])
  })

  it('is not there for a draft, which has no number to be booked under', async () => {
    const id = await draft(await customer(business))
    const answer = await xrechnung(id).expect(409)

    expect(answer.body.toString()).toContain('festgeschrieben')
  })

  it('says before issuing what it will lack, and refuses afterwards with the list', async () => {
    const id = await draft(await customer({ ...business, buyerReference: null, email: null }))
    const before = await statusOf(id)

    expect(before.xrechnung.missing.map((gap) => gap.detail)).toEqual([
      'buyer_reference',
      'recipient_email',
    ])
    // Not required yet in 2026, so it does not stand in the way of the invoice.
    expect(before.duty).toMatchObject({ required: false })

    await issued(id)

    const refused = await xrechnung(id).expect(422)
    const body = JSON.parse((refused.body as Buffer).toString('utf8')) as {
      missing: { detail: string }[]
    }

    expect(body.missing.map((entry) => entry.detail)).toEqual([
      'buyer_reference',
      'recipient_email',
    ])
  })

  it('belongs to the business that issued the invoice and to nobody else', async () => {
    const id = await draft(await customer(business))

    await issued(id)
    await xrechnung(id, south).expect(404)
  })

  it('comes with a cancellation too, as a correction of the invoice it names', async () => {
    const id = await draft(await customer(business))
    const invoice = await issued(id)
    const cancellation = await http()
      .post(`/documents/${id}/cancellation`)
      .set('x-test-identity', office())
      .expect(201)
    const answer = await xrechnung((cancellation.body as DocumentRow).id).expect(200)
    const xml = (answer.body as Buffer).toString('utf8')

    expect(read(xml, '//rsm:ExchangedDocument/ram:TypeCode')).toEqual(['384'])
    expect(read(xml, '//ram:InvoiceReferencedDocument/ram:IssuerAssignedID')).toEqual([
      invoice.number,
    ])
    expect(read(xml, '//ram:DuePayableAmount')).toEqual(['-1475.60'])
  })
})

describe('the duty', () => {
  it('waits in 2026, so an invoice is issued even if its e-invoice would lack something', async () => {
    const id = await draft(await customer(business, south), {}, south)
    const status = await statusOf(id, south)

    expect(status.duty).toMatchObject({ required: false })
    expect(status.duty?.reason).toContain('31.12.2026')
    await issued(id, south)
  })

  it('refuses from 2028 on to issue an invoice whose e-invoice would lack something', async () => {
    const id = await draft(
      await customer(business, south),
      { documentDate: '2028-02-01', serviceFrom: '2028-01-10', serviceUntil: '2028-01-20' },
      south,
    )

    expect((await statusOf(id, south)).duty).toMatchObject({ required: true })

    const refused = await issuing(id, south).expect(422)
    const body = refused.body as { message: string; missing: { detail: string }[] }

    // South has a tax number and nothing that identifies it across borders.
    expect(body.missing.map((entry) => entry.detail)).toEqual(['issuer_identifier'])
    expect(body.message).toContain('BR-CO-26')
  })

  it('waits in 2027 only for a business that claims the turnover limit', async () => {
    const work = {
      documentDate: '2027-03-15',
      serviceFrom: '2027-03-01',
      serviceUntil: '2027-03-10',
    }
    const unclaimed = await draft(await customer(business, south), work, south)

    await issuing(unclaimed, south).expect(422)

    await http()
      .post('/settings/parameters')
      .set('x-test-identity', owner(south))
      .send({ key: 'e_invoice.transition_claimed', from: '2027-01-01', value: 1 })
      .expect(201)

    const claimed = await draft(await customer(business, south), work, south)
    const status = await statusOf(claimed, south)

    expect(status.duty).toMatchObject({ required: false })
    expect(status.duty?.reason).toContain('800.000 Euro')
    await issued(claimed, south)
  })

  it('never stands in the way of an invoice that goes out as a PDF', async () => {
    const person = await customer({ kind: 'private', name: 'Familie Berg', ...invoiceable }, south)
    const id = await draft(
      person,
      { documentDate: '2028-02-01', serviceFrom: '2028-01-10', serviceUntil: '2028-01-20' },
      south,
    )

    await issued(id, south)
  })
})
