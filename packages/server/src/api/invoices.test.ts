import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import type { DeductionContent, DocumentContent } from '@opengewerk/domain'
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

async function issue(documentId: string, expected = 201, body: Record<string, unknown> = {}) {
  const answer = await http()
    .post(`/documents/${documentId}/issue`)
    .set('x-test-identity', office())
    .send(body)
    .expect(expected)

  return answer.body as DocumentRow & { message?: string; unconfirmed?: string[] }
}

/** A payment recorded on an issued invoice, #189. */
async function pay(documentId: string, amountCents: number, receivedOn = '2026-09-10') {
  const answer = await http()
    .post(`/documents/${documentId}/payments`)
    .set('x-test-identity', office())
    .send({ amountCents, receivedOn })
    .expect(201)

  return answer.body as { id: string }
}

/**
 * What the office confirms before a final invoice is issued: what came in on
 * each progress invoice, as the screen shows it, keyed by number.
 */
async function confirmed(documentId: string) {
  return {
    received: Object.fromEntries(
      (await deductionsOf(documentId)).map((one) => [one.number, one.received?.grossCents ?? 0]),
    ),
  }
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

    expect(content).toMatchObject({ version: documentContentVersion, deductions: [] })
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

describe('cumulative progress invoices', () => {
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

    // Both progress invoices were paid in full, so what came in is what they
    // billed, and the three invoices end on the whole of the work.
    await pay(first.id, 57_120)
    await pay(second.id, 85_680, '2026-09-18')
    await issue(final.id, 201, await confirmed(final.id))

    const content = await snapshotOf(final.id)
    const billedBefore = [await snapshotOf(first.id), await snapshotOf(second.id)].map(
      (one) => one?.billed.grossCents ?? 0,
    )

    expect(content?.totals).toMatchObject({ netCents: 360_000, grossCents: 428_400 })
    expect(
      content?.deductions.map((one) => [
        one.number,
        one.billed.grossCents,
        one.received?.grossCents,
        one.receivedOn,
      ]),
    ).toEqual([
      [first.number, 57_120, 57_120, '2026-09-10'],
      [second.number, 85_680, 85_680, '2026-09-18'],
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

    await pay(first.id, 57_120)
    await pay(second.id, 85_680, '2026-09-18')
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
    expect(html).toContain('eingegangen bis 18.09.2026')
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

/**
 * #189: a final invoice takes off what came in on each progress invoice,
 * section 14 (5) UStG, and not what they billed. The office records the
 * payments on the progress invoices and confirms them before the final
 * invoice gets its number.
 */
describe('a final invoice after progress invoices', () => {
  /** The chain to the end, with the time of the work the final invoice needs. */
  async function readyChain() {
    const chain = await chainToTheEnd()

    await http()
      .patch(`/documents/${chain.final.id}`)
      .set('x-test-identity', office())
      .send({ serviceFrom: '2026-09-01', serviceUntil: '2026-09-19' })
      .expect(200)

    return chain
  }

  it('is not issued before the office confirmed what came in on each of them', async () => {
    const { first, second, final } = await readyChain()

    const unconfirmed = await issue(final.id, 409)

    expect(unconfirmed.unconfirmed).toEqual([first.number, second.number])
    expect(unconfirmed.message).toContain(`${first.number ?? ''} und ${second.number ?? ''}`)

    // One confirmed, the other not: the refusal names the one that is missing.
    const half = await issue(final.id, 409, { received: { [first.number ?? '']: 0 } })

    expect(half.unconfirmed).toEqual([second.number])

    // The screen showed nothing received, and somebody recorded a payment in
    // between: what would go out is not what was checked.
    const seen = await confirmed(final.id)

    await pay(second.id, 20_000)

    expect((await issue(final.id, 409, seen)).unconfirmed).toEqual([second.number])

    await issue(final.id, 201, await confirmed(final.id))
  })

  it('takes off a part payment, split by the rates of the progress invoice', async () => {
    const { first, second, final } = await readyChain()

    await pay(first.id, 57_120)
    await pay(second.id, 30_000, '2026-09-12')
    await pay(second.id, 20_000, '2026-09-18')

    // A draft shows it already, out of the payments as they stand.
    expect(
      (await deductionsOf(final.id)).map((one) => [one.number, one.received?.grossCents]),
    ).toEqual([
      [first.number, 57_120],
      [second.number, 50_000],
    ])

    await issue(final.id, 201, await confirmed(final.id))

    const content = await snapshotOf(final.id)

    expect(content?.deductions[1]).toMatchObject({
      number: second.number,
      billed: { netCents: 72_000, taxCents: 13_680, grossCents: 85_680 },
      received: { netCents: 42_017, taxCents: 7_983, grossCents: 50_000 },
      receivedOn: '2026-09-18',
    })
    expect(content?.billed).toMatchObject({
      netCents: 360_000 - 48_000 - 42_017,
      taxCents: 68_400 - 9_120 - 7_983,
      grossCents: 428_400 - 57_120 - 50_000,
    })

    await http()
      .get(`/documents/${final.id}/pdf`)
      .set('x-test-identity', office())
      .buffer(true)
      .parse(binary)
      .expect(200)

    const html = jobs.at(-1)?.html ?? ''

    expect(html).toMatch(/gestellt 856,80\s€, eingegangen bis 18\.09\.2026/)
    expect(html).toMatch(/Rechnungsbetrag<\/td><td class="figure">3\.212,80\s€/)
  })

  it('takes off nothing for a progress invoice nothing came in on', async () => {
    const { first, final } = await readyChain()

    await issue(final.id, 201, await confirmed(final.id))

    const content = await snapshotOf(final.id)

    expect(content?.deductions[0]).toMatchObject({
      number: first.number,
      received: { grossCents: 0 },
      receivedOn: null,
    })
    expect(content?.billed.grossCents).toBe(428_400)

    await http()
      .get(`/documents/${final.id}/pdf`)
      .set('x-test-identity', office())
      .buffer(true)
      .parse(binary)
      .expect(200)

    expect(jobs.at(-1)?.html ?? '').toMatch(/gestellt 571,20\s€, nichts eingegangen/)
  })

  it('keeps what it took off when a payment is removed afterwards', async () => {
    const { first, final } = await readyChain()
    const payment = await pay(first.id, 57_120)

    await issue(final.id, 201, await confirmed(final.id))
    await http()
      .delete(`/documents/${first.id}/payments/${payment.id}`)
      .set('x-test-identity', office())
      .expect(204)

    expect((await deductionsOf(final.id))[0]?.received?.grossCents).toBe(57_120)
    expect((await snapshotOf(final.id))?.deductions[0]?.received?.grossCents).toBe(57_120)
  })

  it('leaves a progress invoice taking off what the ones before it billed', async () => {
    const confirmation = await confirmedOrder()
    const first = await successor(confirmation.id, 'progress_invoice')

    await change(first.id, (await lineCalled(first.id, cable.designation)).id, {
      quantityMilli: 40_000,
    })

    const firstIssued = await issue(first.id)

    // Only part of it came in; the cumulative invoice deducts what it billed
    // all the same, section 4.2 of the concept.
    await pay(first.id, 10_000)

    const second = await successor(first.id, 'progress_invoice')
    const [deduction] = await deductionsOf(second.id)

    expect(deduction).toMatchObject({ number: firstIssued.number, received: null })

    await issue(second.id)

    expect((await snapshotOf(second.id))?.deductions[0]?.received).toBeNull()
  })
})

describe('payments on an invoice', () => {
  /** An issued final invoice of its own, which takes off nothing. */
  async function issuedInvoice() {
    const invoice = await draft('final_invoice', {
      serviceFrom: '2026-09-01',
      serviceUntil: '2026-09-19',
    })

    await add(invoice.id, { ...cable, quantityMilli: 10_000 })

    return issue(invoice.id)
  }

  async function record(documentId: string, body: Record<string, unknown>, expected: number) {
    const answer = await http()
      .post(`/documents/${documentId}/payments`)
      .set('x-test-identity', office())
      .send(body)
      .expect(expected)

    return answer.body as { message?: string }
  }

  it('are listed oldest first, with what the invoice asks for and what came in', async () => {
    const invoice = await issuedInvoice()

    await pay(invoice.id, 4_000, '2026-09-15')
    await pay(invoice.id, 6_000, '2026-09-12')

    const answer = await http()
      .get(`/documents/${invoice.id}/payments`)
      .set('x-test-identity', office())
      .expect(200)
    const listed = answer.body as {
      payments: { amountCents: number; receivedOn: string }[]
      billedCents: number
      receivedCents: number
    }

    expect(listed.payments.map((one) => [one.receivedOn, one.amountCents])).toEqual([
      ['2026-09-12', 6_000],
      ['2026-09-15', 4_000],
    ])
    expect(listed).toMatchObject({ billedCents: 14_280, receivedCents: 10_000 })
  })

  it('are refused above what the invoice asks for, naming what is still open', async () => {
    const invoice = await issuedInvoice()

    await pay(invoice.id, 14_000)

    const refused = await record(invoice.id, { amountCents: 281, receivedOn: '2026-09-20' }, 422)

    expect(refused.message).toMatch(/So viel fordert die Rechnung nicht\. Offen ist noch 2,80\s€\./)

    await pay(invoice.id, 280)
  })

  it('are checked as the form checks them', async () => {
    const invoice = await issuedInvoice()

    for (const [body, message] of [
      [{ amountCents: 0, receivedOn: '2026-09-20' }, 'Der Betrag ist ein Betrag'],
      [{ amountCents: 12.5, receivedOn: '2026-09-20' }, 'Der Betrag ist ein Betrag'],
      [{ amountCents: 100, receivedOn: '2026-02-30' }, 'Der Tag des Eingangs ist kein Datum.'],
      [{ amountCents: 100, receivedOn: '2999-12-31' }, 'Ein Eingang liegt nicht in der Zukunft.'],
    ] as const) {
      expect((await record(invoice.id, body, 422)).message).toContain(message)
    }
  })

  it('are only for an issued invoice that asks for money', async () => {
    const drafted = await draft('final_invoice')
    const confirmation = await confirmedOrder()

    expect(
      (await record(drafted.id, { amountCents: 100, receivedOn: '2026-09-20' }, 422)).message,
    ).toBe('Ein Eingang wird erst zu einer festgeschriebenen Rechnung erfasst.')
    expect(
      (await record(confirmation.id, { amountCents: 100, receivedOn: '2026-09-20' }, 422)).message,
    ).toBe('Ein Eingang wird nur zu einer Rechnung erfasst, die etwas fordert.')

    await http()
      .get(`/documents/${drafted.id}/payments`)
      .set('x-test-identity', office())
      .expect(404)
  })

  it('are removed one by one, and a removed one is gone', async () => {
    const invoice = await issuedInvoice()
    const payment = await pay(invoice.id, 1_000)

    await http()
      .delete(`/documents/${invoice.id}/payments/${payment.id}`)
      .set('x-test-identity', office())
      .expect(204)
    await http()
      .delete(`/documents/${invoice.id}/payments/${payment.id}`)
      .set('x-test-identity', office())
      .expect(404)
  })

  it('belong to the office: a technician neither reads nor records them', async () => {
    const invoice = await issuedInvoice()

    await http()
      .get(`/documents/${invoice.id}/payments`)
      .set('x-test-identity', as(north.id, 'technician'))
      .expect(403)
    await http()
      .post(`/documents/${invoice.id}/payments`)
      .set('x-test-identity', as(north.id, 'technician'))
      .send({ amountCents: 100, receivedOn: '2026-09-20' })
      .expect(403)
  })

  it('keep an invoice from being cancelled until they are moved', async () => {
    const invoice = await issuedInvoice()
    const payment = await pay(invoice.id, 1_000)

    const refused = await http()
      .post(`/documents/${invoice.id}/cancellation`)
      .set('x-test-identity', office())
      .expect(409)

    expect((refused.body as { message: string }).message).toContain('Zahlungseingänge')

    await http()
      .delete(`/documents/${invoice.id}/payments/${payment.id}`)
      .set('x-test-identity', office())
      .expect(204)
    await http()
      .post(`/documents/${invoice.id}/cancellation`)
      .set('x-test-identity', office())
      .expect(201)

    // A cancelled invoice takes no more.
    expect(
      (await record(invoice.id, { amountCents: 100, receivedOn: '2026-09-20' }, 422)).message,
    ).toBe('Die Rechnung ist storniert, auf sie geht nichts mehr ein.')
  })
})

/**
 * #129: the next successor comes out of the last link and nowhere else. Until
 * then a final invoice could be made out of the confirmation next to the
 * progress invoice made out of it, deduct nothing of it, because the
 * deductions follow a document's own chain upwards, and bill the whole work a
 * second time.
 */
describe('a chain that does not branch', () => {
  it('refuses a second successor next to one that counts, and names it', async () => {
    const confirmation = await confirmedOrder()
    const progress = await successor(confirmation.id, 'progress_invoice')

    expect((await successor(confirmation.id, 'final_invoice', 409)).message).toContain(
      'schon eine Abschlagsrechnung entstanden, noch als Entwurf',
    )
    expect((await successor(confirmation.id, 'progress_invoice', 409)).message).toContain(
      'noch als Entwurf',
    )

    const issued = await issue(progress.id)

    expect((await successor(confirmation.id, 'final_invoice', 409)).message).toContain(
      `schon die Abschlagsrechnung ${String(issued.number)} entstanden`,
    )

    // The way on is at the last link.
    expect(await successor(progress.id, 'final_invoice')).toMatchObject({
      predecessorDocumentId: progress.id,
    })
  })

  it('frees the predecessor once its successor is cancelled, or deleted as a draft', async () => {
    const confirmation = await confirmedOrder()
    const progress = await successor(confirmation.id, 'progress_invoice')

    await issue(progress.id)
    await http()
      .post(`/documents/${progress.id}/cancellation`)
      .set('x-test-identity', office())
      .expect(201)

    // The cancellation names the invoice it cancels and is no link after the
    // confirmation, so the replacement comes out of the confirmation again.
    const replacement = await successor(confirmation.id, 'progress_invoice')

    await http().delete(`/documents/${replacement.id}`).set('x-test-identity', office()).expect(200)

    expect(await successor(confirmation.id, 'final_invoice')).toMatchObject({
      predecessorDocumentId: confirmation.id,
    })
  })

  it('lets one of two successors made at the same moment through, and not both', async () => {
    const confirmation = await confirmedOrder()
    const answers = await Promise.all(
      ['progress_invoice', 'final_invoice'].map((kind) =>
        http()
          .post(`/documents/${confirmation.id}/successors`)
          .set('x-test-identity', office())
          .send({ kind, documentDate: '2026-09-21' }),
      ),
    )

    expect(answers.map((answer) => answer.status).sort()).toEqual([201, 409])
  })

  it('takes no predecessor through the general routes, only through its own', async () => {
    const confirmation = await confirmedOrder()
    const other = await draft('final_invoice', { predecessorDocumentId: confirmation.id })

    expect(other.predecessorDocumentId).toBeNull()

    const changed = await http()
      .patch(`/documents/${other.id}`)
      .set('x-test-identity', office())
      .send({ predecessorDocumentId: confirmation.id, subject: 'Werkstatt, Rest' })
      .expect(200)

    expect(changed.body).toMatchObject({ subject: 'Werkstatt, Rest', predecessorDocumentId: null })
  })

  it('is held by the database as well, for every other way in', async () => {
    const confirmation = await confirmedOrder()

    await successor(confirmation.id, 'progress_invoice')

    const refusal: unknown = await admin
      .query(
        `insert into documents (tenant_id, customer_id, kind, document_date, predecessor_document_id)
           values ($1, $2, 'final_invoice', '2026-09-21', $3)`,
        [north.id, customerId, confirmation.id],
      )
      .catch((error: unknown) => error)

    expect(refusal).toMatchObject({ code: '23505', constraint: 'documents_one_successor' })
  })
})
