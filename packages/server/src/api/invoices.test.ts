import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import type { DeductionContent, DocumentContent } from '@opengewerk/domain'
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
import type { PrintJob, Renderer } from '../documents/renderer.js'
import { FileStore } from '../storage/file-store.js'
import { ApiModule } from './api.module.js'
import { binary } from './test-binary.js'
import { as, testIdentities as identities } from './test-identity.js'
import { invoiceable, readyToInvoice } from './test-invoice.js'

/**
 * The end of the chain, #74: the final invoice out of what the work was agreed
 * or recorded on, and the cumulative progress invoices before it.
 *
 * What is held here is the arithmetic of section 4.2 on real rows: every
 * progress invoice bills the total progress less what the ones before it in
 * the chain billed, the final invoice ends on the whole of the work, and the
 * figures deducted are the ones the earlier invoices froze, not ones worked
 * out again.
 */

const north = { id: newId<'tenant'>(), name: 'Elektro Nord GmbH' }

let admin: Pool
let database: Database
let app: INestApplication
let storageRoot: string
let customerId: string
let jobId: string

const jobs: PrintJob[] = []

const standIn: Renderer = (job) => {
  jobs.push(job)

  return Promise.resolve(new TextEncoder().encode('%PDF-1.7 Probedruck'))
}

const office = () => as(north.id, 'office')

interface DocumentRow {
  readonly id: string
  readonly kind: string
  readonly status: string
  readonly number: string | null
  readonly predecessorDocumentId: string | null
  readonly serviceFrom: string | null
  readonly serviceUntil: string | null
  readonly taxTreatment: string
}

interface LineRow {
  readonly id: string
  readonly designation: string
  readonly quantityMilli: number
  readonly unit: string
  readonly unitPriceCents: number
}

function http() {
  return request(app.getHttpServer())
}

async function draft(kind: string, fields: Record<string, unknown> = {}) {
  const created = await http()
    .post('/documents')
    .set('x-test-identity', office())
    .send({ customerId, jobId, kind, documentDate: '2026-09-21', ...fields })
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

async function change(documentId: string, lineId: string, body: Record<string, unknown>) {
  await http()
    .patch(`/documents/${documentId}/lines/${lineId}`)
    .set('x-test-identity', office())
    .send(body)
    .expect(200)
}

async function linesOf(documentId: string) {
  const answer = await http()
    .get(`/documents/${documentId}/lines`)
    .set('x-test-identity', office())
    .expect(200)

  return answer.body as LineRow[]
}

async function issue(documentId: string, expected = 201) {
  const answer = await http()
    .post(`/documents/${documentId}/issue`)
    .set('x-test-identity', office())
    .expect(expected)

  return answer.body as DocumentRow & { message?: string }
}

async function successor(documentId: string, kind: string, expected = 201) {
  const answer = await http()
    .post(`/documents/${documentId}/successors`)
    .set('x-test-identity', office())
    .send({ kind, documentDate: '2026-09-21' })
    .expect(expected)

  return answer.body as DocumentRow & { message?: string }
}

async function deductionsOf(documentId: string) {
  const answer = await http()
    .get(`/documents/${documentId}/deductions`)
    .set('x-test-identity', office())
    .expect(200)

  return answer.body as DeductionContent[]
}

async function snapshotOf(documentId: string) {
  const { rows } = await admin.query<{ content: DocumentContent }>(
    'select content from document_snapshots where document_id = $1',
    [documentId],
  )

  return rows[0]?.content
}

/** The line that carries a designation, found by it. */
async function lineCalled(documentId: string, designation: string) {
  const line = (await linesOf(documentId)).find((one) => one.designation === designation)

  if (!line) {
    throw new Error(`No line called ${designation}`)
  }

  return line
}

const cable = { designation: 'NYM-J 5x2,5 verlegen', unit: 'metre', unitPriceCents: 1200 }
const board = { designation: 'Unterverteilung setzen', unit: 'piece', unitPriceCents: 240000 }

/** A quote of 100 metres of cable and a distribution board, confirmed and issued. */
async function confirmedOrder() {
  const quote = await draft('quote', { subject: 'Unterverteilung Werkstatt' })

  await add(quote.id, { ...cable, quantityMilli: 100_000 })
  await add(quote.id, { ...board, quantityMilli: 1000 })
  await issue(quote.id)

  const confirmation = await successor(quote.id, 'order_confirmation')

  await issue(confirmation.id)

  return confirmation
}

beforeAll(async () => {
  admin = await connect()
  await resetSchema(admin)
  await applyMigrations()
  await allowApplicationLogin(admin)
  await admin.query('insert into tenants (id, name) values ($1, $2)', [north.id, north.name])
  await readyToInvoice(admin, north.id)

  storageRoot = mkdtempSync(join(tmpdir(), 'opengewerk-rechnung-'))
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

  const customer = await http()
    .post('/customers')
    .set('x-test-identity', office())
    .send({ kind: 'private', name: 'Familie Berg', ...invoiceable })
    .expect(201)

  customerId = (customer.body as { id: string }).id

  const job = await http()
    .post('/jobs')
    .set('x-test-identity', office())
    .send({ customerId, kind: 'project', designation: 'Werkstatt Lindenweg' })
    .expect(201)

  jobId = (job.body as { id: string }).id
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
  rmSync(storageRoot, { recursive: true, force: true })
})

describe('a final invoice out of a report', () => {
  async function issuedReport() {
    const report = await draft('time_and_material_report', { documentDate: '2026-09-15' })

    // No prices on a report; the column wants a figure all the same.
    await add(report.id, {
      designation: 'Arbeitszeit',
      quantityMilli: 2500,
      unit: 'hour',
      unitPriceCents: 0,
    })
    await add(report.id, {
      designation: 'LS-Schalter B16',
      quantityMilli: 2000,
      unit: 'piece',
      unitPriceCents: 0,
    })
    await issue(report.id)

    return report
  }

  it('knows its report, carries its lines and takes the day of the work from it', async () => {
    const report = await issuedReport()
    const invoice = await successor(report.id, 'final_invoice')

    expect(invoice).toMatchObject({
      kind: 'final_invoice',
      status: 'draft',
      predecessorDocumentId: report.id,
      // The report is written on the day of the work.
      serviceFrom: '2026-09-15',
      serviceUntil: null,
    })
    expect(
      (await linesOf(invoice.id)).map((line) => [line.designation, line.quantityMilli, line.unit]),
    ).toEqual([
      ['Arbeitszeit', 2500, 'hour'],
      ['LS-Schalter B16', 2000, 'piece'],
    ])

    // The report carried no prices; the invoice gets them in the office.
    await change(invoice.id, (await lineCalled(invoice.id, 'Arbeitszeit')).id, {
      unitPriceCents: 6800,
    })
    await change(invoice.id, (await lineCalled(invoice.id, 'LS-Schalter B16')).id, {
      unitPriceCents: 1450,
    })

    const issued = await issue(invoice.id)

    expect(issued.number).toMatch(/^RE-2026-\d{4}$/)

    const content = await snapshotOf(invoice.id)

    expect(content).toMatchObject({ version: 4, deductions: [] })
    expect(content?.billed.grossCents).toBe(content?.totals.grossCents)
    expect(content?.totals.netCents).toBe(2.5 * 6800 + 2 * 1450)
  })

  it('comes only out of an issued report', async () => {
    const report = await draft('time_and_material_report')

    await add(report.id, {
      designation: 'Arbeitszeit',
      quantityMilli: 1000,
      unit: 'hour',
      unitPriceCents: 0,
    })

    const refused = await successor(report.id, 'final_invoice', 409)

    expect(refused.message).toContain('festschreiben')
  })

  it('leads to no progress invoice, because a report records work that is done', async () => {
    const report = await issuedReport()

    await successor(report.id, 'progress_invoice', 400)
  })
})

describe('cumulative progress invoices', () => {
  /**
   * Forty metres, then all hundred, then the board as well. Each progress
   * invoice copies the one before it and raises the quantities to where the
   * work stands; the final invoice does the same once more.
   */
  async function chainToTheEnd() {
    const confirmation = await confirmedOrder()

    const first = await successor(confirmation.id, 'progress_invoice')

    await change(first.id, (await lineCalled(first.id, cable.designation)).id, {
      quantityMilli: 40_000,
    })
    await http()
      .delete(`/documents/${first.id}/lines/${(await lineCalled(first.id, board.designation)).id}`)
      .set('x-test-identity', office())
      .expect(200)

    const firstIssued = await issue(first.id)

    const second = await successor(first.id, 'progress_invoice')

    expect(second.predecessorDocumentId).toBe(first.id)

    await change(second.id, (await lineCalled(second.id, cable.designation)).id, {
      quantityMilli: 100_000,
    })

    const secondIssued = await issue(second.id)
    const final = await successor(second.id, 'final_invoice')

    await add(final.id, { ...board, quantityMilli: 1000 })

    return { confirmation, first: firstIssued, second: secondIssued, final }
  }

  it('each bill the progress less what the ones before them billed', async () => {
    const { first, second } = await chainToTheEnd()

    expect((await snapshotOf(first.id))?.billed).toMatchObject({
      netCents: 48_000,
      taxCents: 9_120,
      grossCents: 57_120,
    })

    const secondContent = await snapshotOf(second.id)

    expect(secondContent?.totals.netCents).toBe(120_000)
    expect(secondContent?.deductions.map((one) => one.number)).toEqual([first.number])
    expect(secondContent?.billed).toMatchObject({
      netCents: 72_000,
      taxCents: 13_680,
      grossCents: 85_680,
    })
  })

  it('end in a final invoice that settles the whole work, to the cent', async () => {
    const { first, second, final } = await chainToTheEnd()

    // While it is a draft, the office sees what it will take off.
    expect((await deductionsOf(final.id)).map((one) => one.number)).toEqual([
      first.number,
      second.number,
    ])

    // An order confirmation states no time of work, and a final invoice needs
    // one, section 14 (4) number 6 UStG.
    const refused = await issue(final.id, 422)

    expect(refused.message).toContain('Leistungszeitraum')

    await http()
      .patch(`/documents/${final.id}`)
      .set('x-test-identity', office())
      .send({ serviceFrom: '2026-09-01', serviceUntil: '2026-09-19' })
      .expect(200)

    await issue(final.id)

    const content = await snapshotOf(final.id)
    const billedBefore = [await snapshotOf(first.id), await snapshotOf(second.id)].map(
      (one) => one?.billed.grossCents ?? 0,
    )

    expect(content?.totals).toMatchObject({ netCents: 360_000, grossCents: 428_400 })
    expect(content?.deductions.map((one) => [one.number, one.billed.grossCents])).toEqual([
      [first.number, 57_120],
      [second.number, 85_680],
    ])
    expect(content?.billed).toMatchObject({
      netCents: 240_000,
      taxCents: 45_600,
      grossCents: 285_600,
    })

    // The three invoices together are exactly the whole of the work.
    expect(billedBefore.reduce((sum, one) => sum + one, content?.billed.grossCents ?? 0)).toBe(
      content?.totals.grossCents,
    )
  })

  it('print what they take off and what they ask for', async () => {
    const { first, second, final } = await chainToTheEnd()

    await http()
      .get(`/documents/${final.id}/pdf`)
      .set('x-test-identity', office())
      .buffer(true)
      .parse(binary)
      .expect(200)

    const html = jobs.at(-1)?.html ?? ''

    expect(html).toContain('Gesamtleistung')
    expect(html).toContain(`abzüglich Abschlagsrechnung ${first.number ?? ''} vom 21.09.2026`)
    expect(html).toContain(`abzüglich Abschlagsrechnung ${second.number ?? ''} vom 21.09.2026`)
    expect(html).toMatch(/Rechnungsbetrag<\/td><td class="figure">2\.856,00\s€/)
  })

  it('refuse to settle progress invoices taxed another way, and name the one that does not fit', async () => {
    const { first, final } = await chainToTheEnd()

    await http()
      .patch(`/documents/${final.id}`)
      .set('x-test-identity', office())
      .send({
        taxTreatment: 'small_business',
        serviceFrom: '2026-09-01',
        serviceUntil: '2026-09-19',
      })
      .expect(200)

    const refused = await issue(final.id, 422)

    expect(refused.message).toContain(first.number ?? 'missing number')
  })

  it('pass over a cancelled progress invoice, because its cancellation took it back', async () => {
    const { first, second, final } = await chainToTheEnd()

    // What a cancellation leaves behind on the invoice it cancels, until the
    // route for it exists: the status and nothing else.
    await admin.query("update documents set status = 'cancelled' where id = $1", [first.id])

    expect((await deductionsOf(final.id)).map((one) => one.number)).toEqual([second.number])
  })

  it('are nothing a quote takes off', async () => {
    const quote = await draft('quote')

    expect(await deductionsOf(quote.id)).toEqual([])
  })
})
