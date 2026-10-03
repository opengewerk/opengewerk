import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { Database, FileStore, newId, type Renderer } from '@opengewerk/platform-server'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  allowApplicationLogin,
  applicationDatabaseUrl,
  applyMigrations,
  connect,
  resetSchema,
} from '../database/test-database.js'
import { ApiModule } from './api.module.js'
import { as, testIdentities as identities } from './test-identity.js'
import { invoiceable, readyToInvoice } from './test-invoice.js'

/**
 * An article taken into a line (#296), the second part: the price of the
 * document's date, the article a line points at and nothing more, the
 * articles of the last 90 days on every device, and the price an invoice
 * gives a line of a report taken from an article.
 */

const north = { id: newId<'tenant'>(), name: 'Elektro Nord GmbH' }
const south = { id: newId<'tenant'>(), name: 'Elektro Süd GmbH' }

let admin: Pool
let database: Database
let app: INestApplication
let storageRoot: string
let customerId = ''
let cable = ''
let breaker = ''
let foreign = ''
let ties = ''

const office = as(north.id, 'office')
const technician = JSON.stringify({ userId: 'max', tenantId: north.id, roles: ['technician'] })
const standIn: Renderer = () => Promise.resolve(new TextEncoder().encode('%PDF-1.7 Probedruck'))

function http() {
  return request(app.getHttpServer())
}

async function post(path: string, body: Record<string, unknown>, who = office, status = 201) {
  const answer = await http().post(path).set('x-test-identity', who).send(body).expect(status)

  return answer.body as Record<string, unknown> & { id: string; message?: string }
}

interface Line {
  readonly kind: string
  readonly designation: string
  readonly quantityMilli: number
  readonly unitPriceCents: number
  readonly netCents: number
  readonly articleId: string | null
}

async function linesOf(documentId: string) {
  const answer = await http()
    .get(`/documents/${documentId}/lines`)
    .set('x-test-identity', office)
    .expect(200)

  return (answer.body as (Line & { position: number })[]).sort(
    (left, right) => left.position - right.position,
  )
}

async function narrowedArticles(): Promise<{ value: string; ids: string[] }> {
  const answer = await http().get('/sync?since=0').set('x-test-identity', technician).expect(200)
  const body = answer.body as {
    changes: { entity: string; rows: { id: string }[] }[]
    narrowed: Record<string, string>
  }

  return {
    value: body.narrowed['articles'] ?? '',
    ids: (body.changes.find((change) => change.entity === 'articles')?.rows ?? []).map(
      (row) => row.id,
    ),
  }
}

/** A report of a day with a line taken from the cable and one typed by hand, issued. */
async function report(day: string, jobId?: string) {
  const document = await post('/documents', {
    customerId,
    kind: 'time_and_material_report',
    documentDate: day,
    ...(jobId ? { jobId } : {}),
  })

  await post(`/documents/${document.id}/lines`, {
    designation: 'Mantelleitung NYM-J 3 × 1,5 mm²',
    quantityMilli: 12_500,
    unit: 'metre',
    unitPriceCents: 0,
    articleId: cable,
  })
  await post(`/documents/${document.id}/lines`, {
    designation: 'Kabelbinder',
    quantityMilli: 1000,
    unit: 'package',
    unitPriceCents: 0,
  })
  await post(`/documents/${document.id}/issue`, {})

  return document.id
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
  await admin.query("insert into auth_users (id, name, email) values ('max', 'Max', 'max@x.de')")
  await admin.query(
    "insert into memberships (tenant_id, user_id, roles) values ($1, 'max', '{technician}')",
    [north.id],
  )
  await readyToInvoice(admin, north.id)

  storageRoot = mkdtempSync(join(tmpdir(), 'opengewerk-artikel-'))
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

  customerId = (await post('/customers', { kind: 'private', name: 'Familie Berg', ...invoiceable }))
    .id
  cable = (
    await post('/articles', {
      number: '1042',
      designation: 'Mantelleitung NYM-J 3 × 1,5 mm²',
      unit: 'metre',
      price: { unitPriceCents: 89, validFrom: '2025-09-01' },
    })
  ).id
  await post(`/articles/${cable}/prices`, { unitPriceCents: 92, validFrom: '2026-03-01' })
  breaker = (
    await post('/articles', {
      number: '2101',
      designation: 'Leitungsschutzschalter B16, 1-polig',
      unit: 'piece',
      price: { unitPriceCents: 890, validFrom: '2026-01-01' },
    })
  ).id
  foreign = (
    await post(
      '/articles',
      { number: '9001', designation: 'Artikel des anderen Betriebs', unit: 'piece' },
      as(south.id, 'office'),
    )
  ).id
  // Priced the way a wholesaler prices it, per 100 (#456).
  ties = (
    await post('/articles', {
      number: '5010',
      designation: 'Kabelbinder 200 × 4,8 mm, schwarz',
      unit: 'piece',
      price: { unitPriceCents: 350, validFrom: '2026-01-01', priceBase: 100 },
    })
  ).id
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
  rmSync(storageRoot, { recursive: true, force: true })
})

describe('the choice of an article', () => {
  it('shows the selling price of the day it is asked for', async () => {
    const before = await http()
      .get('/articles?search=1042&on=2026-01-15')
      .set('x-test-identity', office)
      .expect(200)
    const after = await http()
      .get('/articles?search=1042&on=2026-09-28')
      .set('x-test-identity', office)
      .expect(200)

    expect((before.body as { rows: { priceCents: number }[] }).rows[0]?.priceCents).toBe(89)
    expect((after.body as { rows: { priceCents: number }[] }).rows[0]?.priceCents).toBe(92)
  })

  it('names the price unit of the price of the day (#456)', async () => {
    const answer = await http()
      .get('/articles?search=5010&on=2026-09-28')
      .set('x-test-identity', office)
      .expect(200)

    expect((answer.body as { rows: unknown[] }).rows[0]).toMatchObject({
      priceCents: 350,
      priceBase: 100,
    })
  })

  it('is refused for a day that is not in the calendar', async () => {
    const answer = await http()
      .get('/articles?search=1042&on=2026-02-30')
      .set('x-test-identity', office)
      .expect(400)

    expect((answer.body as { message: string }).message).toContain('Datum im Kalender')
  })
})

describe('a line taken from an article', () => {
  it('keeps the article, and refuses one of another business', async () => {
    const quote = await post('/documents', {
      customerId,
      kind: 'quote',
      documentDate: '2026-09-28',
    })
    const line = await post(`/documents/${quote.id}/lines`, {
      designation: 'Mantelleitung NYM-J 3 × 1,5 mm²',
      quantityMilli: 1000,
      unit: 'metre',
      unitPriceCents: 92,
      articleId: cable,
    })

    expect(line['articleId']).toBe(cable)

    const refused = await post(
      `/documents/${quote.id}/lines`,
      {
        designation: 'Fremd',
        quantityMilli: 1000,
        unit: 'piece',
        unitPriceCents: 100,
        articleId: foreign,
      },
      office,
      422,
    )

    expect(refused.message).toContain('Artikel')
  })

  it('brings its article onto every device for 90 days, and not longer', async () => {
    const before = await narrowedArticles()

    expect(before.ids).not.toContain(breaker)

    const quote = await post('/documents', {
      customerId,
      kind: 'quote',
      documentDate: '2026-09-28',
    })
    const line = await post(`/documents/${quote.id}/lines`, {
      designation: 'Leitungsschutzschalter B16, 1-polig',
      quantityMilli: 3000,
      unit: 'piece',
      unitPriceCents: 890,
      articleId: breaker,
    })
    const used = await narrowedArticles()

    expect(used.ids).toContain(breaker)
    expect(used.value).not.toBe(before.value)

    // Written 91 days ago, the line no longer brings it.
    await admin.query(
      "update document_lines set created_at = now() - interval '91 days' where id = $1",
      [line.id],
    )

    expect((await narrowedArticles()).ids).not.toContain(breaker)
  })
})

describe('an invoice made from a report', () => {
  it('gives a line taken from an article the price of its own date', async () => {
    const reportId = await report('2026-02-10')
    const invoice = await post(`/documents/${reportId}/successors`, {
      kind: 'final_invoice',
      documentDate: '2026-09-28',
    })
    const [taken, typed] = await linesOf(invoice.id)

    // 12,5 m at 0,92 €, the price of the invoice's date and not of the report's.
    expect(taken).toMatchObject({ articleId: cable, unitPriceCents: 92, netCents: 1150 })
    expect(typed).toMatchObject({ articleId: null, unitPriceCents: 0, netCents: 0 })
  })

  it('takes the price unit with the price of the article (#456)', async () => {
    const document = await post('/documents', {
      customerId,
      kind: 'time_and_material_report',
      documentDate: '2026-09-20',
    })

    await post(`/documents/${document.id}/lines`, {
      designation: 'Kabelbinder 200 × 4,8 mm, schwarz',
      quantityMilli: 300_000,
      unit: 'piece',
      unitPriceCents: 0,
      articleId: ties,
    })
    await post(`/documents/${document.id}/issue`, {})

    const invoice = await post(`/documents/${document.id}/successors`, {
      kind: 'final_invoice',
      documentDate: '2026-09-28',
    })

    // 300 cable ties at 3,50 € per 100 are 10,50 €, not 1.050,00 €.
    expect(await linesOf(invoice.id)).toMatchObject([
      { articleId: ties, unitPriceCents: 350, priceBase: 100, netCents: 1050 },
    ])
  })

  it('leaves a line to be priced by hand once it is counted in another unit (#456)', async () => {
    const document = await post('/documents', {
      customerId,
      kind: 'time_and_material_report',
      documentDate: '2026-09-20',
    })

    // Taken from the cable, which is priced per metre, and then counted in
    // pieces: the price of a metre says nothing about a piece.
    await post(`/documents/${document.id}/lines`, {
      designation: 'Mantelleitung, Reste',
      quantityMilli: 2000,
      unit: 'piece',
      unitPriceCents: 0,
      articleId: cable,
    })
    await post(`/documents/${document.id}/issue`, {})

    const invoice = await post(`/documents/${document.id}/successors`, {
      kind: 'final_invoice',
      documentDate: '2026-09-28',
    })

    expect(await linesOf(invoice.id)).toMatchObject([
      { articleId: cable, unit: 'piece', unitPriceCents: 0, priceBase: 1, netCents: 0 },
    ])
  })

  it('does the same when it collects the reports of a job', async () => {
    const job = await post('/jobs', {
      customerId,
      kind: 'service',
      status: 'active',
      designation: 'Altbau Lindenweg',
    })

    await report('2026-09-20', job.id)

    const invoice = await post(`/jobs/${job.id}/collective-invoice`, { documentDate: '2026-01-20' })
    const taken = (await linesOf(invoice.id)).find((line) => line.articleId === cable)

    // On the 20th of January 2026 the cable cost 0,89 €.
    expect(taken).toMatchObject({ unitPriceCents: 89, netCents: 1113 })
  })

  it('keeps the prices of a quote in the order confirmation after it', async () => {
    const quote = await post('/documents', {
      customerId,
      kind: 'quote',
      documentDate: '2026-02-01',
    })

    await post(`/documents/${quote.id}/lines`, {
      designation: 'Mantelleitung NYM-J 3 × 1,5 mm²',
      quantityMilli: 1000,
      unit: 'metre',
      unitPriceCents: 150,
      articleId: cable,
    })
    await post(`/documents/${quote.id}/issue`, {})

    const confirmation = await post(`/documents/${quote.id}/successors`, {
      kind: 'order_confirmation',
      documentDate: '2026-09-28',
    })

    expect(await linesOf(confirmation.id)).toMatchObject([
      { articleId: cable, unitPriceCents: 150, netCents: 150 },
    ])
  })
})
