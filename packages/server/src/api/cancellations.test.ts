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
  refusedBy,
  resetSchema,
} from '../database/test-database.js'
import type { PrintJob, Renderer } from '../documents/renderer.js'
import { FileStore } from '../storage/file-store.js'
import { ApiModule } from './api.module.js'
import { binary } from './test-binary.js'
import { as, testIdentities as identities } from './test-identity.js'
import { invoiceable, readyToInvoice } from './test-invoice.js'

/**
 * The cancellation of #74: an issued invoice is never changed and never
 * deleted, it is cancelled by an invoice of its own that turns every figure
 * round, and both stay in the books.
 *
 * What is held here is the whole of that on real rows: the mirror and its
 * reference, the refusals and why, the order in a chain of cumulative
 * invoices, the deductions a cancellation gives back, and that a cancellation
 * cannot come about in any other way.
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
const technician = () => as(north.id, 'technician')

interface DocumentRow {
  readonly id: string
  readonly kind: string
  readonly status: string
  readonly number: string | null
  readonly predecessorDocumentId: string | null
  readonly documentDate: string
}

interface LineRow {
  readonly id: string
  readonly designation: string
  readonly quantityMilli: number
  readonly unitPriceCents: number
  readonly netCents: number
}

function http() {
  return request(app.getHttpServer())
}

async function draft(kind: string, fields: Record<string, unknown> = {}) {
  const created = await http()
    .post('/documents')
    .set('x-test-identity', office())
    .send({ customerId, jobId, kind, documentDate: '2026-09-18', ...fields })
    .expect(201)

  return created.body as DocumentRow
}

async function add(documentId: string, body: Record<string, unknown>) {
  await http()
    .post(`/documents/${documentId}/lines`)
    .set('x-test-identity', office())
    .send(body)
    .expect(201)
}

async function issue(documentId: string) {
  const answer = await http()
    .post(`/documents/${documentId}/issue`)
    .set('x-test-identity', office())
    .expect(201)

  return answer.body as DocumentRow
}

function cancel(documentId: string, identity = office()) {
  return http().post(`/documents/${documentId}/cancellation`).set('x-test-identity', identity)
}

async function successor(documentId: string, kind: string) {
  const answer = await http()
    .post(`/documents/${documentId}/successors`)
    .set('x-test-identity', office())
    .send({ kind, documentDate: '2026-09-18' })
    .expect(201)

  return answer.body as DocumentRow
}

async function linesOf(documentId: string) {
  const answer = await http()
    .get(`/documents/${documentId}/lines`)
    .set('x-test-identity', office())
    .expect(200)

  return answer.body as LineRow[]
}

async function documentRow(id: string) {
  const answer = await http().get('/documents').set('x-test-identity', office()).expect(200)
  const found = (answer.body as DocumentRow[]).find((document) => document.id === id)

  if (!found) {
    throw new Error(`The document ${id} is not in the list`)
  }

  return found
}

async function snapshotOf(documentId: string) {
  const { rows } = await admin.query<{ content: DocumentContent }>(
    'select content from document_snapshots where document_id = $1',
    [documentId],
  )

  return rows[0]?.content
}

const period = { serviceFrom: '2026-09-01', serviceUntil: '2026-09-15' }
const cabinet = {
  designation: 'Zählerschrank setzen',
  quantityMilli: 1000,
  unit: 'flat_rate',
  unitPriceCents: 124_000,
}
const hours = {
  designation: 'Arbeitszeit',
  quantityMilli: 6500,
  unit: 'hour',
  unitPriceCents: 7800,
}

/** A final invoice of two lines, issued. */
async function issuedInvoice() {
  const invoice = await draft('final_invoice', period)

  await add(invoice.id, cabinet)
  await add(invoice.id, hours)

  return issue(invoice.id)
}

/** A progress invoice, and a second one out of it that deducts the first. */
async function twoProgressInvoices() {
  const first = await draft('progress_invoice')

  await add(first.id, { ...hours, quantityMilli: 2000 })

  const firstIssued = await issue(first.id)
  const second = await successor(first.id, 'progress_invoice')
  const [line] = await linesOf(second.id)

  await http()
    .patch(`/documents/${second.id}/lines/${line?.id ?? ''}`)
    .set('x-test-identity', office())
    .send({ quantityMilli: 5000 })
    .expect(200)

  return { first: firstIssued, second: await issue(second.id) }
}

beforeAll(async () => {
  admin = await connect()
  await resetSchema(admin)
  await applyMigrations()
  await allowApplicationLogin(admin)
  await admin.query('insert into tenants (id, name) values ($1, $2)', [north.id, north.name])
  await readyToInvoice(admin, north.id)

  storageRoot = mkdtempSync(join(tmpdir(), 'opengewerk-storno-'))
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
    .send({ customerId, kind: 'project', designation: 'Zählerschrank Lindenweg' })
    .expect(201)

  jobId = (job.body as { id: string }).id
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
  rmSync(storageRoot, { recursive: true, force: true })
})

describe('cancelling an invoice', () => {
  it('makes a cancellation that mirrors it and names it, and leaves both in the books', async () => {
    const invoice = await issuedInvoice()
    const answer = await cancel(invoice.id).expect(201)
    const storno = answer.body as DocumentRow

    expect(storno).toMatchObject({
      kind: 'cancellation_invoice',
      status: 'issued',
      predecessorDocumentId: invoice.id,
      // Issued in the same step, by whoever cancels (#249).
      issuedBy: 'test',
    })
    // The same sequence as the invoices, section 14 UStG wants no second one.
    expect(storno.number).toMatch(/^RE-2026-\d{4}$/)
    expect(storno.number).not.toBe(invoice.number)

    expect((await documentRow(invoice.id)).status).toBe('cancelled')
    expect((await documentRow(storno.id)).status).toBe('issued')

    expect(
      (await linesOf(storno.id)).map((line) => [
        line.designation,
        line.quantityMilli,
        line.netCents,
      ]),
    ).toEqual([
      ['Zählerschrank setzen', -1000, -124_000],
      ['Arbeitszeit', -6500, -50_700],
    ])

    const original = await snapshotOf(invoice.id)
    const mirror = await snapshotOf(storno.id)

    expect(mirror).toMatchObject({
      version: documentContentVersion,
      kind: 'cancellation_invoice',
      corrects: { kind: 'final_invoice', number: invoice.number, documentDate: '2026-09-18' },
      serviceFrom: '2026-09-01',
    })
    expect(mirror?.billed.grossCents).toBe(-(original?.billed.grossCents ?? 0))
    expect((original?.billed.taxCents ?? 0) + (mirror?.billed.taxCents ?? 0)).toBe(0)
  })

  it('says why it refuses what it cannot cancel', async () => {
    const unissued = await draft('final_invoice', period)
    const quote = await draft('quote')

    await add(quote.id, cabinet)
    await issue(quote.id)

    const invoice = await issuedInvoice()
    const storno = (await cancel(invoice.id).expect(201)).body as DocumentRow

    const answers = [
      await cancel(unissued.id).expect(409),
      await cancel(quote.id).expect(400),
      await cancel(invoice.id).expect(409),
      await cancel(storno.id).expect(400),
    ]

    expect(answers.map((answer) => (answer.body as { message: string }).message)).toEqual([
      expect.stringContaining('Entwurf'),
      expect.stringContaining('nur eine Rechnung'),
      expect.stringContaining('schon storniert'),
      expect.stringContaining('Stornorechnung wird nicht storniert'),
    ])
  })

  it('takes the later invoice of a chain first', async () => {
    const { first, second } = await twoProgressInvoices()

    const refused = await cancel(first.id).expect(409)

    expect((refused.body as { message: string }).message).toContain(second.number ?? 'missing')

    await cancel(second.id).expect(201)
    await cancel(first.id).expect(201)
  })

  it('leaves a cancelled progress invoice out of what later invoices take off', async () => {
    const first = await draft('progress_invoice')

    await add(first.id, { ...hours, quantityMilli: 2000 })
    await issue(first.id)

    // A draft that builds on it does not hold the cancellation up: it is in
    // nobody's books yet, and it can still be changed or thrown away.
    const next = await successor(first.id, 'final_invoice')
    const before = await http()
      .get(`/documents/${next.id}/deductions`)
      .set('x-test-identity', office())
      .expect(200)

    expect(before.body).toHaveLength(1)

    await cancel(first.id).expect(201)

    const after = await http()
      .get(`/documents/${next.id}/deductions`)
      .set('x-test-identity', office())
      .expect(200)

    expect(after.body).toEqual([])
  })

  it('gives back what a cumulative invoice deducted, so that the two come to nothing', async () => {
    const { first, second } = await twoProgressInvoices()
    const storno = (await cancel(second.id).expect(201)).body as DocumentRow

    const original = await snapshotOf(second.id)
    const mirror = await snapshotOf(storno.id)

    expect(original?.deductions.map((one) => one.number)).toEqual([first.number])
    expect(mirror?.deductions.map((one) => [one.number, one.billed.grossCents])).toEqual([
      [first.number, -(original?.deductions[0]?.billed.grossCents ?? 0)],
    ])
    expect((original?.billed.grossCents ?? 0) + (mirror?.billed.grossCents ?? 0)).toBe(0)

    // The office sees the same, read from what the cancellation froze.
    const shown = await http()
      .get(`/documents/${storno.id}/deductions`)
      .set('x-test-identity', office())
      .expect(200)

    expect((shown.body as DeductionContent[]).map((one) => one.billed.grossCents)).toEqual([
      mirror?.deductions[0]?.billed.grossCents,
    ])
  })

  it('prints which invoice it takes back, and that it takes all of it back', async () => {
    const invoice = await issuedInvoice()
    const storno = (await cancel(invoice.id).expect(201)).body as DocumentRow

    await http()
      .get(`/documents/${storno.id}/pdf`)
      .set('x-test-identity', office())
      .buffer(true)
      .parse(binary)
      .expect(200)

    const html = jobs.at(-1)?.html ?? ''

    expect(html).toContain(`<h1>Stornorechnung ${storno.number ?? ''}</h1>`)
    expect(html).toContain(
      `Hiermit stornieren wir die Rechnung ${invoice.number ?? ''} vom 18.09.2026 in voller Höhe.`,
    )
    expect(html).toContain(`<th>Zur Rechnung</th><td>${invoice.number ?? ''} vom 18.09.2026</td>`)
    // 1.240,00 € and 6,5 hours at 78,00 € come to 1.747,00 € net, 2.078,93 €
    // with 19 %, and the cancellation takes all of it back.
    expect(html).toMatch(/Gesamtbetrag<\/td><td class="figure">-2\.078,93\s€/)
  })

  it('prints the deductions it gives back as given back, in the words of its invoice', async () => {
    const { first, second } = await twoProgressInvoices()
    const storno = (await cancel(second.id).expect(201)).body as DocumentRow

    await http()
      .get(`/documents/${storno.id}/pdf`)
      .set('x-test-identity', office())
      .buffer(true)
      .parse(binary)
      .expect(200)

    const html = jobs.at(-1)?.html ?? ''

    expect(html).toContain(
      `zurückgenommener Abzug der Abschlagsrechnung ${first.number ?? ''} vom 18.09.2026`,
    )
    expect(html).not.toContain('abzüglich Abschlagsrechnung')
    // What a progress invoice calls the work so far, its cancellation calls
    // the same.
    expect(html).toContain('<td>Leistungsstand gesamt</td>')
  })

  it('is the office’s to do and not the technician’s', async () => {
    const invoice = await issuedInvoice()

    await cancel(invoice.id, technician()).expect(403)
    expect((await documentRow(invoice.id)).status).toBe('issued')
  })
})

describe('a cancellation invoice', () => {
  it('is never written by hand, by any route', async () => {
    const created = await http()
      .post('/documents')
      .set('x-test-identity', office())
      .send({ customerId, kind: 'cancellation_invoice', documentDate: '2026-09-18' })
      .expect(409)

    expect((created.body as { message: string }).message).toContain('nie von Hand')

    const invoice = await draft('final_invoice', period)

    await http()
      .patch(`/documents/${invoice.id}`)
      .set('x-test-identity', office())
      .send({ kind: 'cancellation_invoice' })
      .expect(409)

    const pushed = await http()
      .post('/sync')
      .set('x-test-identity', office())
      .send({
        deviceId: 'office-desk',
        operations: [
          {
            id: newId<'operation'>(),
            entity: 'documents',
            recordId: newId<'document'>(),
            kind: 'create',
            baseVersion: null,
            patches: Object.entries({
              customerId,
              kind: 'cancellation_invoice',
              documentDate: '2026-09-18',
            }).map(([field, to]) => ({ field, from: null, to })),
            recordedAt: new Date().toISOString(),
          },
        ],
      })
      .expect(201)

    expect((pushed.body as { receipts: { outcome: string; reason: string }[] }).receipts).toEqual([
      expect.objectContaining({ outcome: 'conflict', reason: 'set_by_server' }),
    ])
  })

  it('is refused at the database as well, for whoever connects there', async () => {
    // As the superuser, for whom no policy applies and every trigger does.
    const refused = await refusedBy(
      admin.query(
        `insert into documents (tenant_id, customer_id, kind, document_date)
         values ($1, $2, 'cancellation_invoice', '2026-09-18')`,
        [north.id, customerId],
      ),
    )

    expect(refused.code).toBe('OG001')
  })
})
