import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { PDFDocument } from '@cantoo/pdf-lib'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import type { DocumentContent, EInvoiceStatus } from '@opengewerk/domain'
import { XmlDocument } from 'libxml2-wasm'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

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
import { type Renderer, RendererUnavailableError } from '../documents/renderer.js'
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

/**
 * A PDF of one page, and a real one, because the ZUGFeRD PDF is built around
 * what the renderer returns. The renderer counts what it prints, so a test can
 * say that something was not printed a second time, and can be switched off.
 */
let page: Uint8Array
let prints = 0
let rendererRunning = true

const standIn: Renderer = () => {
  if (!rendererRunning) {
    return Promise.reject(new RendererUnavailableError('Der Renderer antwortet nicht.'))
  }

  prints += 1

  return Promise.resolve(page)
}

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

function zugferd(documentId: string, tenant = north) {
  return http()
    .get(`/documents/${documentId}/zugferd`)
    .set('x-test-identity', office(tenant))
    .buffer(true)
    .parse(binary)
}

function pdf(documentId: string, tenant = north) {
  return http()
    .get(`/documents/${documentId}/pdf`)
    .set('x-test-identity', office(tenant))
    .buffer(true)
    .parse(binary)
}

/** The purposes of the files a document keeps, with their media types. */
async function keptFiles(documentId: string): Promise<{ purpose: string; media_type: string }[]> {
  const { rows } = await admin.query<{ purpose: string; media_type: string }>(
    `select document_files.purpose, files.media_type from document_files
       join files on files.id = document_files.file_id where document_id = $1
       order by document_files.purpose`,
    [documentId],
  )

  return rows
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
  // Today stands still at a day in the first transition. Whether an invoice
  // of 2026 may still go out as a PDF depends on the day it is sent (#134),
  // and the server takes today for that; without this, every expectation
  // below about 2026 would turn on the first of January 2027. Only the clock
  // the application reads: timers, the pool and the database keep their own.
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-09-23T10:00:00+02:00') })

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

  const printed = await PDFDocument.create()

  printed.addPage().drawRectangle({ x: 50, y: 50, width: 200, height: 100 })
  page = await printed.save()

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
  vi.useRealTimers()
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
    expect(await keptFiles(id)).toEqual([{ purpose: 'xrechnung', media_type: 'application/xml' }])
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
    // Both are demands of XRechnung and not of the standard, so the ZUGFeRD
    // PDF lacks nothing.
    expect(before.zugferd.missing).toEqual([])
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

  it('answers a date the rules know nothing about with the sentence and not with an error', async () => {
    const created = await http()
      .post('/documents')
      .set('x-test-identity', office())
      .send({
        customerId: await customer(business),
        kind: 'final_invoice',
        documentDate: '2005-06-01',
      })
      .expect(201)
    const answer = await http()
      .get(`/documents/${(created.body as { id: string }).id}/e-invoice`)
      .set('x-test-identity', office())
      .expect(422)

    expect((answer.body as { message: string }).message).toContain('Zum 2005-06-01')
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

describe('the ZUGFeRD PDF', () => {
  it('is the PDF of the invoice with the e-invoice of the standard inside', async () => {
    const id = await draft(await customer(business))
    const invoice = await issued(id)
    const answer = await zugferd(id).expect(200)

    expect(answer.headers['content-type']).toBe('application/pdf')
    expect(answer.headers['content-disposition']).toContain(
      encodeURIComponent(`Schlussrechnung ${invoice.number ?? ''} ZUGFeRD.pdf`),
    )
    expect(answer.headers['cache-control']).toBe('no-store')

    const attachments = (await PDFDocument.load(answer.body as Buffer)).getAttachments()

    expect(attachments.map((attachment) => attachment.name)).toEqual(['factur-x.xml'])

    const xml = new TextDecoder().decode(attachments[0]?.data)

    expect(checkedCii(xml)).toBe(xml)
    expect(read(xml, '//ram:GuidelineSpecifiedDocumentContextParameter/ram:ID')).toEqual([
      'urn:cen.eu:en16931:2017',
    ])
    expect(read(xml, '//rsm:ExchangedDocument/ram:ID')).toEqual([invoice.number])

    // Printed for it, and kept as the PDF of the invoice as well.
    expect(await keptFiles(id)).toEqual([
      { purpose: 'pdf', media_type: 'application/pdf' },
      { purpose: 'zugferd', media_type: 'application/pdf' },
    ])
  })

  it('is built around the PDF the invoice keeps, and nothing is printed twice', async () => {
    const id = await draft(await customer(business))

    await issued(id)

    const kept = (await pdf(id).expect(200)).body as Buffer
    const printedBefore = prints
    const first = (await zugferd(id).expect(200)).body as Buffer
    const second = (await zugferd(id).expect(200)).body as Buffer

    expect(prints).toBe(printedBefore)
    expect(second.equals(first)).toBe(true)
    expect(((await pdf(id).expect(200)).body as Buffer).equals(kept)).toBe(true)
    expect(prints).toBe(printedBefore)
  })

  it('asks only what the standard asks, not what XRechnung adds to it', async () => {
    const id = await draft(await customer({ ...business, buyerReference: null, email: null }))

    await issued(id)
    await xrechnung(id).expect(422)
    await zugferd(id).expect(200)
  })

  it('refuses before anything is printed, and says why', async () => {
    const person = await draft(
      await customer({ kind: 'private', name: 'Familie Berg', ...invoiceable }),
    )
    const unissued = await draft(await customer(business))
    // South has a tax number and nothing that identifies it across borders,
    // which in 2026 does not stop the invoice and does stop its e-invoice.
    const lacking = await draft(await customer(business, south), {}, south)

    await issued(person)
    await issued(lacking, south)

    const printedBefore = prints
    const asPdf = await zugferd(person).expect(409)
    const asDraft = await zugferd(unissued).expect(409)
    const withGaps = await zugferd(lacking, south).expect(422)
    const gaps = JSON.parse((withGaps.body as Buffer).toString('utf8')) as {
      message: string
      missing: { detail: string }[]
    }

    expect(asPdf.body.toString()).toContain('kein Unternehmen')
    expect(asDraft.body.toString()).toContain('festgeschrieben')
    expect(gaps.message).toContain('Für das ZUGFeRD-PDF fehlen noch Angaben.')
    expect(gaps.missing.map((entry) => entry.detail)).toEqual(['issuer_identifier'])
    expect(prints).toBe(printedBefore)
  })

  it('says which service is missing when there is no renderer, and keeps nothing', async () => {
    const id = await draft(await customer(business))

    await issued(id)
    rendererRunning = false

    try {
      const answer = await zugferd(id).expect(503)

      expect(answer.body.toString()).toContain('Renderer')
    } finally {
      rendererRunning = true
    }

    expect(await keptFiles(id)).toEqual([])
  })

  it('belongs to the business that issued the invoice and to nobody else', async () => {
    const id = await draft(await customer(business))

    await issued(id)
    await zugferd(id, south).expect(404)
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
