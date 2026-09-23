import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { documentContentVersion } from '@opengewerk/domain'
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
import { readyToInvoice } from './test-invoice.js'

/**
 * A quote from the first title to the order confirmation, the first two links
 * of the chain in section 1.4, which is what #72 builds.
 *
 * Three things are held here. A title is a line without an amount and adds
 * nothing to a total. An issued quote cannot be changed, and the refusal says
 * why instead of claiming the quote is not there. And an order confirmation
 * made out of a quote carries its positions and knows its predecessor, in one
 * step and only out of what was actually sent.
 */

const north = { id: newId<'tenant'>(), name: 'Elektro Nord GmbH' }
const south = { id: newId<'tenant'>(), name: 'Elektro Süd GmbH' }

let admin: Pool
let database: Database
let app: INestApplication
let customerId: string
let jobId: string

const office = () => as(north.id, 'office')
const neighbour = () => as(south.id, 'office')

interface LineRow {
  readonly id: string
  readonly kind: 'item' | 'title'
  readonly position: number
  readonly designation: string
  readonly description: string | null
  readonly quantityMilli: number
  readonly unitPriceCents: number
  readonly netCents: number
}

interface DocumentRow {
  readonly id: string
  readonly kind: string
  readonly status: string
  readonly number: string | null
  readonly customerId: string
  readonly jobId: string | null
  readonly predecessorDocumentId: string | null
  readonly subject: string | null
  readonly introText: string | null
  readonly closingText: string | null
  readonly taxTreatment: string
  readonly documentDate: string
}

function http() {
  return request(app.getHttpServer())
}

async function draft(kind = 'quote', fields: Record<string, unknown> = {}) {
  const created = await http()
    .post('/documents')
    .set('x-test-identity', office())
    .send({
      customerId,
      jobId,
      kind,
      documentDate: '2026-09-21',
      subject: 'Zählerschrank erneuern',
      ...fields,
    })
    .expect(201)

  return created.body as DocumentRow
}

async function add(documentId: string, body: Record<string, unknown>) {
  const created = await http()
    .post(`/documents/${documentId}/lines`)
    .set('x-test-identity', office())
    .send(body)
    .expect(201)

  return created.body as LineRow
}

const title = (designation: string) => ({ kind: 'title', designation })

const item = (designation: string, unitPriceCents: number, quantityMilli = 1000) => ({
  designation,
  quantityMilli,
  unit: 'piece',
  unitPriceCents,
})

async function linesOf(documentId: string) {
  const answer = await http()
    .get(`/documents/${documentId}/lines`)
    .set('x-test-identity', office())
    .expect(200)

  return answer.body as LineRow[]
}

async function totalsOf(documentId: string) {
  const answer = await http()
    .get(`/documents/${documentId}/totals`)
    .set('x-test-identity', office())
    .expect(200)

  return answer.body as { netCents: number; grossCents: number }
}

async function issue(documentId: string) {
  const answer = await http()
    .post(`/documents/${documentId}/issue`)
    .set('x-test-identity', office())
    .expect(201)

  return answer.body as DocumentRow
}

/** A quote with two titles and three positions, issued. */
async function issuedQuote(kind: 'quote' | 'cost_estimate' = 'quote') {
  const quote = await draft(kind, {
    introText: 'Vielen Dank für Ihre Anfrage.',
    closingText: 'Wir freuen uns auf Ihren Auftrag.',
  })

  await add(quote.id, title('Zählerschrank'))
  await add(quote.id, item('Zählerschrank setzen', 120000))
  await add(quote.id, { ...item('Überspannungsschutz', 15000, 2000), description: 'Typ 1+2' })
  await add(quote.id, title('Außenbeleuchtung'))
  await add(quote.id, item('Wandleuchte montieren', 4500, 4000))

  return issue(quote.id)
}

function successor(documentId: string, body: Record<string, unknown>, identity = office()) {
  return http()
    .post(`/documents/${documentId}/successors`)
    .set('x-test-identity', identity)
    .send(body)
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
    .send({
      kind: 'private',
      name: 'Familie Berg',
      street: 'Lindenweg',
      houseNumber: '3',
      postalCode: '22301',
      city: 'Hamburg',
    })
    .expect(201)

  customerId = (customer.body as { id: string }).id

  const job = await http()
    .post('/jobs')
    .set('x-test-identity', office())
    .send({ customerId, kind: 'project', designation: 'Zählerschrank Lindenweg' })
    .expect(201)

  jobId = (job.body as { id: string }).id
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
})

describe('a title among the lines', () => {
  it('needs no quantity and no price, and adds nothing to the total', async () => {
    const quote = await draft()

    const heading = await add(quote.id, title('Zählerschrank'))
    await add(quote.id, item('Zählerschrank setzen', 120000))

    expect(heading).toMatchObject({ kind: 'title', quantityMilli: 0, unitPriceCents: 0 })
    expect(heading.netCents).toBe(0)
    expect((await totalsOf(quote.id)).netCents).toBe(120000)
  })

  it('refuses an amount, because a heading nobody reads as a position must not add up', async () => {
    const quote = await draft()

    await http()
      .post(`/documents/${quote.id}/lines`)
      .set('x-test-identity', office())
      .send({ ...item('Zählerschrank', 5000), kind: 'title' })
      .expect(400)

    const position = await add(quote.id, item('Zählerschrank setzen', 120000))

    // Turning a position into a title with a price is the same mistake by
    // another way. Without one it is what it says: the line becomes a heading
    // and its amount goes, as it would for a new title.
    await http()
      .patch(`/documents/${quote.id}/lines/${position.id}`)
      .set('x-test-identity', office())
      .send({ kind: 'title', unitPriceCents: 5000 })
      .expect(400)

    const heading = await http()
      .patch(`/documents/${quote.id}/lines/${position.id}`)
      .set('x-test-identity', office())
      .send({ kind: 'title' })
      .expect(200)

    expect(heading.body).toMatchObject({ kind: 'title', netCents: 0 })
  })

  it('knows no other kinds than the two', async () => {
    const quote = await draft()

    await http()
      .post(`/documents/${quote.id}/lines`)
      .set('x-test-identity', office())
      .send({ ...item('Alternative', 1000), kind: 'alternative' })
      .expect(400)
  })

  it('keeps its place, so a quote lists its titles where they were put', async () => {
    const quote = await draft()

    await add(quote.id, title('Zählerschrank'))
    await add(quote.id, item('Zählerschrank setzen', 120000))
    await add(quote.id, title('Außenbeleuchtung'))

    expect((await linesOf(quote.id)).map((line) => [line.position, line.kind])).toEqual([
      [1, 'title'],
      [2, 'item'],
      [3, 'title'],
    ])
  })

  it('does not count as a position when an invoice is checked', async () => {
    const invoice = await draft('final_invoice', {
      serviceFrom: '2026-09-01',
      serviceUntil: '2026-09-15',
    })
    await add(invoice.id, title('Zählerschrank'))

    const refused = await http()
      .post(`/documents/${invoice.id}/issue`)
      .set('x-test-identity', office())
      .expect(422)

    expect(JSON.stringify(refused.body)).toContain('lines')
  })
})

describe('the texts above and below the lines', () => {
  it('are written with the draft and frozen with it', async () => {
    const quote = await draft()

    const changed = await http()
      .patch(`/documents/${quote.id}`)
      .set('x-test-identity', office())
      .send({ introText: 'Sehr geehrte Familie Berg,', closingText: 'Mit freundlichen Grüßen' })
      .expect(200)

    expect(changed.body).toMatchObject({
      introText: 'Sehr geehrte Familie Berg,',
      closingText: 'Mit freundlichen Grüßen',
    })

    await add(quote.id, item('Zählerschrank setzen', 120000))
    await issue(quote.id)

    const { rows } = await admin.query<{ content: { introText: string; closingText: string } }>(
      'select content from document_snapshots where document_id = $1',
      [quote.id],
    )

    // The number itself is held in `domain`, where the outline test pins it.
    expect(rows[0]?.content).toMatchObject({
      version: documentContentVersion,
      introText: 'Sehr geehrte Familie Berg,',
      closingText: 'Mit freundlichen Grüßen',
      signature: null,
    })
  })
})

describe('an issued quote', () => {
  it('cannot be changed, and the refusal says why rather than that it is missing', async () => {
    const quote = await issuedQuote()

    const refused = await http()
      .patch(`/documents/${quote.id}`)
      .set('x-test-identity', office())
      .send({ subject: 'Doch etwas anderes' })
      .expect(409)

    expect((refused.body as { message: string }).message).toContain('festgeschrieben')
    expect((refused.body as { message: string }).message).toContain('neuer Beleg')
  })

  it('takes no new line and changes none, with the same sentence', async () => {
    const quote = await issuedQuote()
    const [first] = await linesOf(quote.id)

    const added = await http()
      .post(`/documents/${quote.id}/lines`)
      .set('x-test-identity', office())
      .send(item('Nachtrag', 1000))
      .expect(409)

    const changed = await http()
      .patch(`/documents/${quote.id}/lines/${first?.id ?? ''}`)
      .set('x-test-identity', office())
      .send({ designation: 'Etwas anderes' })
      .expect(409)

    for (const answer of [added, changed]) {
      expect((answer.body as { message: string }).message).toContain('neuer Beleg')
    }
  })

  it('is still not found for another business, which learns nothing from the answer', async () => {
    const quote = await issuedQuote()

    await http()
      .patch(`/documents/${quote.id}`)
      .set('x-test-identity', neighbour())
      .send({ subject: 'Fremd' })
      .expect(404)
  })

  it('points an invoice to a cancellation instead', async () => {
    const invoice = await draft('final_invoice', {
      serviceFrom: '2026-09-01',
      serviceUntil: '2026-09-15',
    })
    await add(invoice.id, item('Zählerschrank setzen', 120000))
    await issue(invoice.id)

    const refused = await http()
      .patch(`/documents/${invoice.id}`)
      .set('x-test-identity', office())
      .send({ subject: 'Geändert' })
      .expect(409)

    expect((refused.body as { message: string }).message).toContain('Stornorechnung')
  })
})

describe('an order confirmation out of a quote', () => {
  it('carries the positions and the titles of its predecessor, and knows it', async () => {
    const quote = await issuedQuote()

    const created = await successor(quote.id, { kind: 'order_confirmation' }).expect(201)
    const confirmation = created.body as DocumentRow

    expect(confirmation).toMatchObject({
      kind: 'order_confirmation',
      status: 'draft',
      number: null,
      predecessorDocumentId: quote.id,
      customerId,
      jobId,
      subject: 'Zählerschrank erneuern',
      taxTreatment: quote.taxTreatment,
    })

    const copied = (await linesOf(confirmation.id)).map((line) => ({
      kind: line.kind,
      position: line.position,
      designation: line.designation,
      description: line.description,
      quantityMilli: line.quantityMilli,
      unitPriceCents: line.unitPriceCents,
      netCents: line.netCents,
    }))

    expect(copied).toEqual(
      (await linesOf(quote.id)).map((line) => ({
        kind: line.kind,
        position: line.position,
        designation: line.designation,
        description: line.description,
        quantityMilli: line.quantityMilli,
        unitPriceCents: line.unitPriceCents,
        netCents: line.netCents,
      })),
    )
    expect(copied.map((line) => line.kind)).toEqual(['title', 'item', 'item', 'title', 'item'])
    expect(await totalsOf(confirmation.id)).toEqual(await totalsOf(quote.id))
  })

  it('does not take the texts of the quote, which were written for a different letter', async () => {
    const quote = await issuedQuote()

    const created = await successor(quote.id, { kind: 'order_confirmation' }).expect(201)

    expect(created.body).toMatchObject({ introText: null, closingText: null })
  })

  it('is a document of its own: changing it leaves the quote as it was sent', async () => {
    const quote = await issuedQuote()
    const confirmation = (await successor(quote.id, { kind: 'order_confirmation' }).expect(201))
      .body as DocumentRow

    const [, firstItem] = await linesOf(confirmation.id)

    await http()
      .delete(`/documents/${confirmation.id}/lines/${firstItem?.id ?? ''}`)
      .set('x-test-identity', office())
      .expect(200)

    expect(await linesOf(confirmation.id)).toHaveLength(4)
    expect(await linesOf(quote.id)).toHaveLength(5)

    const issued = await issue(confirmation.id)

    expect(issued.number).not.toBeNull()
    expect(issued.number).not.toBe(quote.number)
  })

  it('is made out of an estimate just the same', async () => {
    const estimate = await issuedQuote('cost_estimate')

    const created = await successor(estimate.id, { kind: 'order_confirmation' }).expect(201)

    expect(created.body).toMatchObject({ predecessorDocumentId: estimate.id })
  })

  it('is dated today unless a date is given', async () => {
    const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(new Date())

    // Two quotes, because one quote has one confirmation: a chain does not
    // branch (#129).
    const dated = await successor((await issuedQuote()).id, {
      kind: 'order_confirmation',
      documentDate: '2026-10-01',
    }).expect(201)
    const undated = await successor((await issuedQuote()).id, {
      kind: 'order_confirmation',
    }).expect(201)

    expect((dated.body as DocumentRow).documentDate).toBe('2026-10-01')
    expect((undated.body as DocumentRow).documentDate).toBe(today)
  })

  it('comes only out of an issued quote, and says so', async () => {
    const quote = await draft()
    await add(quote.id, item('Zählerschrank setzen', 120000))

    const refused = await successor(quote.id, { kind: 'order_confirmation' }).expect(409)

    expect((refused.body as { message: string }).message).toContain('festschreiben')
  })

  it('follows only the kinds the chain allows', async () => {
    const quote = await issuedQuote()

    // A cancellation is made out of an invoice by a route of its own, never
    // written out of the chain.
    await successor(quote.id, { kind: 'cancellation_invoice' }).expect(400)
    await successor(quote.id, { kind: 'invoice' }).expect(400)
    await successor(quote.id, {}).expect(400)

    const confirmation = (await successor(quote.id, { kind: 'order_confirmation' }).expect(201))
      .body as DocumentRow
    await add(confirmation.id, item('Nachtrag', 1000))
    await issue(confirmation.id)

    // An order confirmation confirms one quote; a second one out of it would
    // confirm the confirmation.
    await successor(confirmation.id, { kind: 'order_confirmation' }).expect(400)
  })

  it('cannot be made out of the quote of another business', async () => {
    const quote = await issuedQuote()

    await successor(quote.id, { kind: 'order_confirmation' }, neighbour()).expect(404)
  })

  it('needs the right to write documents', async () => {
    const quote = await issuedQuote()

    await successor(quote.id, { kind: 'order_confirmation' }, as(north.id)).expect(403)
  })
})

describe('the totals of a quote with titles', () => {
  it('open no tax group for a title when every position is taxed at another rate', async () => {
    const quote = await draft()

    await add(quote.id, title('Fachliteratur'))
    await add(quote.id, { ...item('Normensammlung', 5000), vatRate: 'reduced' })

    const answer = await http()
      .get(`/documents/${quote.id}/totals`)
      .set('x-test-identity', office())
      .expect(200)
    const totals = answer.body as { byRate: { rate: string }[]; grossCents: number }

    expect(totals.byRate.map((entry) => entry.rate)).toEqual(['reduced'])
    expect(totals.grossCents).toBe(5350)
  })
})
