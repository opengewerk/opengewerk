import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { eq } from 'drizzle-orm'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { Database } from '../database/database.js'
import { newId } from '../database/identifier.js'
import { documentLines } from '../database/schema/index.js'
import {
  allowApplicationLogin,
  applicationDatabaseUrl,
  applyMigrations,
  checkViolation,
  connect,
  refusedBy,
  resetSchema,
} from '../database/test-database.js'

import { ApiModule } from './api.module.js'
import { as, testIdentities as identities } from './test-identity.js'
import { invoiceable, readyToInvoice } from './test-invoice.js'

/** The error code the triggers refuse an issued document with. */
const documentIsFixed = 'OG001'

/**
 * The positions of a document, through HTTP. What matters here is not that a
 * line can be written but that it stops being writable at exactly the same
 * moment the document does: a position that survives the issuing hollows out
 * the whole numbering.
 */

const north = { id: newId<'tenant'>(), name: 'Elektro Nord GmbH' }

let admin: Pool
let database: Database
let app: INestApplication
let customerId: string
let constructionCustomerId: string

const office = () => as(north.id, 'office')

function http() {
  return request(app.getHttpServer())
}

async function draft(over: Record<string, unknown> = {}) {
  const created = await http()
    .post('/documents')
    .set('x-test-identity', office())
    .send({ customerId, kind: 'final_invoice', documentDate: '2026-09-20', ...over })
    .expect(201)

  return created.body as { id: string; taxTreatment: string; status: string }
}

async function addLine(documentId: string, over: Record<string, unknown> = {}, expected = 201) {
  const created = await http()
    .post(`/documents/${documentId}/lines`)
    .set('x-test-identity', office())
    .send({
      designation: 'Montage Wallbox',
      quantityMilli: 2500,
      unit: 'hour',
      unitPriceCents: 5800,
      ...over,
    })
    .expect(expected)

  return created.body as { id: string; position: number; netCents: number }
}

async function totalsOf(documentId: string) {
  const answer = await http()
    .get(`/documents/${documentId}/totals`)
    .set('x-test-identity', office())
    .expect(200)

  return answer.body as {
    netCents: number
    taxCents: number
    grossCents: number
    byRate: { rate: string; basisPoints: number; taxCents: number }[]
    taxNote: string | null
  }
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
    .send({ kind: 'business', name: 'Bauherr Nord', ...invoiceable })
    .expect(201)
  customerId = customer.body.id

  const construction = await http()
    .post('/customers')
    .set('x-test-identity', office())
    .send({
      kind: 'business',
      name: 'Bauunternehmen Süd',
      isConstructionServiceRecipient: true,
    })
    .expect(201)
  constructionCustomerId = construction.body.id
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
})

describe('a position', () => {
  it('carries its order and its unit, and gets the next place when none is given', async () => {
    const document = await draft()

    const first = await addLine(document.id)
    const second = await addLine(document.id, { designation: 'Material', unit: 'piece' })

    expect(first.position).toBe(1)
    expect(second.position).toBe(2)

    const listed = await http()
      .get(`/documents/${document.id}/lines`)
      .set('x-test-identity', office())
      .expect(200)

    expect((listed.body as { designation: string }[]).map((line) => line.designation)).toEqual([
      'Montage Wallbox',
      'Material',
    ])
  })

  it('has its total worked out by the server, not taken from the request', async () => {
    const document = await draft()
    // 2.5 hours at 58.00 euros is 145.00 euros.
    const line = await addLine(document.id)

    expect(line.netCents).toBe(14500)
  })

  /**
   * The field is not on the writable list, so a value for it is dropped before
   * it reaches the database rather than refused. The point is the same: what
   * lands is the figure that follows from quantity and price, never the one
   * somebody sent.
   */
  it('ignores a total somebody sends along', async () => {
    const document = await draft()
    const line = await addLine(document.id, { netCents: 1 })

    expect(line.netCents).toBe(14500)
  })

  it('follows quantity and price when either is corrected', async () => {
    const document = await draft()
    const line = await addLine(document.id)

    const changed = await http()
      .patch(`/documents/${document.id}/lines/${line.id}`)
      .set('x-test-identity', office())
      .send({ quantityMilli: 4000 })
      .expect(200)

    expect((changed.body as { netCents: number }).netCents).toBe(23200)
  })

  it('is refused with a unit nothing knows', async () => {
    const document = await draft()

    await addLine(document.id, { unit: 'Stunden' }, 400)
  })
})

describe('the totals of a document', () => {
  it('are worked out from the lines, by the rules of the document date', async () => {
    const document = await draft({ documentDate: '2020-08-01' })
    await addLine(document.id, { quantityMilli: 1000, unitPriceCents: 10000 })

    const totals = await totalsOf(document.id)

    // Zweites Halbjahr 2020, also sechzehn Prozent.
    expect(totals.netCents).toBe(10000)
    expect(totals.taxCents).toBe(1600)
    expect(totals.grossCents).toBe(11600)
  })

  it('show one figure per rate when a document carries two', async () => {
    const document = await draft()
    await addLine(document.id, { quantityMilli: 1000, unitPriceCents: 10000 })
    await addLine(document.id, {
      designation: 'Ermäßigt',
      quantityMilli: 1000,
      unitPriceCents: 5000,
      vatRate: 'reduced',
    })

    const totals = await totalsOf(document.id)

    expect(totals.byRate).toHaveLength(2)
    expect(totals.taxCents).toBe(2250)
  })

  it('take the zero rate for photovoltaics as a group of its own, at nothing', async () => {
    // #127, section 12 (3) UStG since 2023. Stored in the database under the
    // value 0034 added to the enum, and worked out from the package `vat`.
    const document = await draft()
    await addLine(document.id, { quantityMilli: 1000, unitPriceCents: 10000 })
    await addLine(document.id, {
      designation: 'Solarmodule liefern und montieren',
      quantityMilli: 1000,
      unitPriceCents: 1_200_000,
      vatRate: 'zero',
    })

    const totals = await totalsOf(document.id)

    expect(totals.byRate.map((entry) => [entry.rate, entry.basisPoints, entry.taxCents])).toEqual([
      ['standard', 1900, 1900],
      ['zero', 0, 0],
    ])
    expect(totals.grossCents).toBe(1_211_900)
  })

  it('leave out a deleted line', async () => {
    const document = await draft()
    const keep = await addLine(document.id, { quantityMilli: 1000, unitPriceCents: 10000 })
    const drop = await addLine(document.id, { quantityMilli: 1000, unitPriceCents: 9900 })

    await http()
      .delete(`/documents/${document.id}/lines/${drop.id}`)
      .set('x-test-identity', office())
      .expect(200)

    const totals = await totalsOf(document.id)

    expect(totals.netCents).toBe(10000)
    expect(keep.netCents).toBe(10000)
  })
})

describe('a document without tax', () => {
  /**
   * The acceptance criterion from the issue: the sentence instead of a figure
   * of nothing. A line reading "0,00 EUR Umsatzsteuer" says something else and
   * wrong, and without the sentence the invoice is not a valid one.
   */
  it('carries the section 13b sentence for a construction customer', async () => {
    const document = await draft({ customerId: constructionCustomerId })
    await addLine(document.id, { quantityMilli: 1000, unitPriceCents: 10000 })

    expect(document.taxTreatment).toBe('reverse_charge')

    const totals = await totalsOf(document.id)

    expect(totals.taxCents).toBe(0)
    expect(totals.grossCents).toBe(10000)
    expect(totals.byRate).toEqual([])
    expect(totals.taxNote).toContain('§ 13b')
  })

  it('carries the section 19 sentence when the business claims it', async () => {
    await http()
      .post('/settings/parameters')
      .set('x-test-identity', as(north.id, 'owner'))
      .send({ key: 'small_business.claimed', from: '2026-01-01', value: 1 })
      .expect(201)

    const document = await draft()
    await addLine(document.id, { quantityMilli: 1000, unitPriceCents: 10000 })

    expect(document.taxTreatment).toBe('small_business')

    const totals = await totalsOf(document.id)

    expect(totals.taxCents).toBe(0)
    expect(totals.taxNote).toContain('§ 19')

    // And back again, so that the following tests see the ordinary case.
    await http()
      .post('/settings/parameters')
      .set('x-test-identity', as(north.id, 'owner'))
      .send({ key: 'small_business.claimed', from: '2026-09-21', value: 0 })
      .expect(201)
  })

  /**
   * Section 19 comes before section 13b, and not by preference: where no tax
   * is owed there is none to reverse. A small business invoicing a
   * construction firm writes the section 19 sentence.
   */
  it('prefers section 19 over section 13b, because there is nothing to reverse', async () => {
    // Forwards and not back: a parameter cannot be dated before its latest
    // state, and that is right. What applied last year applies to last year,
    // and a document from then reads the same as it did.
    await http()
      .post('/settings/parameters')
      .set('x-test-identity', as(north.id, 'owner'))
      .send({ key: 'small_business.claimed', from: '2026-10-01', value: 1 })
      .expect(201)

    const document = await draft({
      customerId: constructionCustomerId,
      documentDate: '2026-10-05',
    })

    expect(document.taxTreatment).toBe('small_business')
  })

  /**
   * The counter check to the sentence above: the same customer, a document
   * from the time before. The tax treatment follows the document date and not
   * today's state, otherwise every change to the master data would rewrite old
   * invoices.
   */
  it('reads the parameter as it stood on the document date', async () => {
    const earlier = await draft({
      customerId: constructionCustomerId,
      documentDate: '2026-09-25',
    })

    expect(earlier.taxTreatment).toBe('reverse_charge')
  })
})

describe('an issued document', () => {
  /**
   * The test the issue asks for, and the one the whole table hangs on. Four
   * ways in, all refused, and the last of them past the controller entirely.
   */
  it('freezes its positions with it', async () => {
    const document = await draft()
    const line = await addLine(document.id)

    await http()
      .post(`/documents/${document.id}/issue`)
      .set('x-test-identity', office())
      .expect(201)

    // Keine neue Zeile.
    await addLine(document.id, {}, 409)

    // Keine Änderung an einer vorhandenen.
    await http()
      .patch(`/documents/${document.id}/lines/${line.id}`)
      .set('x-test-identity', office())
      .send({ unitPriceCents: 1 })
      .expect(409)

    // Kein Entfernen.
    await http()
      .delete(`/documents/${document.id}/lines/${line.id}`)
      .set('x-test-identity', office())
      .expect(409)

    const after = await totalsOf(document.id)
    expect(after.netCents).toBe(14500)
  })

  /**
   * The counter check the issue asks for by name: take the controller out of
   * the way and write straight to the table. A guard that only lives in the
   * controller is a guard anything that talks to the database walks around,
   * and `Database.forTenant` is exactly such a path.
   */
  it('is held by the database and not only by the controller', async () => {
    const document = await draft()
    const line = await addLine(document.id)

    await http()
      .post(`/documents/${document.id}/issue`)
      .set('x-test-identity', office())
      .expect(201)

    const refused = await refusedBy(
      database.forTenant({ tenantId: north.id }, (tx) =>
        tx
          .update(documentLines)
          .set({ unitPriceCents: 1, netCents: 2 })
          .where(eq(documentLines.id, line.id as never)),
      ),
    )

    expect(refused.code).toBe(documentIsFixed)

    const [unchanged] = await database.forTenant({ tenantId: north.id }, (tx) =>
      tx
        .select()
        .from(documentLines)
        .where(eq(documentLines.id, line.id as never)),
    )
    expect(unchanged?.netCents).toBe(14500)
  })

  it('refuses a new line written straight to the table as well', async () => {
    const document = await draft()
    // An invoice without a line is refused at issuing since #71, so it gets
    // one before. What is tested is the line that comes after.
    await addLine(document.id)
    await http()
      .post(`/documents/${document.id}/issue`)
      .set('x-test-identity', office())
      .expect(201)

    const refused = await refusedBy(
      database.forTenant({ tenantId: north.id }, (tx) =>
        tx.insert(documentLines).values({
          tenantId: north.id,
          documentId: document.id as never,
          position: 9,
          designation: 'Nachträglich',
          quantityMilli: 1000,
          unit: 'piece',
          unitPriceCents: 100,
          netCents: 100,
        }),
      ),
    )

    expect(refused.code).toBe(documentIsFixed)
  })
})

describe('the stored line total', () => {
  /**
   * The check constraint, asked directly. It is the other half of working the
   * figure out in the application: the application puts the right one in, and
   * this refuses a wrong one whatever path it came down.
   */
  it('cannot be written as something other than quantity times price', async () => {
    const document = await draft()

    const refused = await refusedBy(
      database.forTenant({ tenantId: north.id }, (tx) =>
        tx.insert(documentLines).values({
          tenantId: north.id,
          documentId: document.id as never,
          position: 1,
          designation: 'Erfunden',
          quantityMilli: 1000,
          unit: 'piece',
          unitPriceCents: 10000,
          // Richtig wären 10000.
          netCents: 9999,
        }),
      ),
    )

    expect(refused).toEqual({
      code: checkViolation,
      constraint: 'document_lines_net_matches_quantity',
    })
  })

  /**
   * The rounding of the database and the rounding of the domain have to be the
   * same rounding, or the constraint refuses rows the application considers
   * correct. Half a cent is where the two would part company: PostgreSQL
   * rounds a numeric half away from zero and a double precision half to even.
   */
  it('agrees with the domain on half a cent', async () => {
    const document = await draft()

    // 0.005 times 1.00 euro is exactly half a cent, commercially rounded one.
    const line = await addLine(document.id, {
      designation: 'Halber Cent',
      quantityMilli: 5,
      unitPriceCents: 100,
    })

    expect(line.netCents).toBe(1)
  })
})
