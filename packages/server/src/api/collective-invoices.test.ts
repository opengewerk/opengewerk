import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
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
import type { Renderer } from '../documents/renderer.js'
import { FileStore } from '../storage/file-store.js'
import { ApiModule } from './api.module.js'
import { as, testIdentities as identities } from './test-identity.js'
import { invoiceable, readyToInvoice } from './test-invoice.js'
import { created, push } from './test-structure.js'

/**
 * The collective invoice of #135: one invoice over every open report of a
 * job, one report for each day of work, and each report has that invoice as
 * its one successor, section 1.4.
 *
 * What is held here is the chain around it: which reports it takes and which
 * it leaves, that a collected report gets no second successor, that a
 * cancelled or deleted invoice gives its reports back, and that the database
 * keeps the same rules for every other way in.
 */

const north = { id: newId<'tenant'>(), name: 'Elektro Nord GmbH' }

let admin: Pool
let database: Database
let app: INestApplication
let storageRoot: string
let customerId: string

const standIn: Renderer = () => Promise.resolve(new TextEncoder().encode('%PDF-1.7 Probedruck'))

const office = () => as(north.id, 'office')

interface DocumentRow {
  readonly id: string
  readonly kind: string
  readonly status: string
  readonly number: string | null
  readonly predecessorDocumentId: string | null
  readonly serviceFrom: string | null
  readonly serviceUntil: string | null
  readonly subject: string | null
  readonly jobId: string | null
}

interface LineRow {
  readonly kind: string
  readonly position: number
  readonly designation: string
  readonly quantityMilli: number
}

function http() {
  return request(app.getHttpServer())
}

async function job(designation = 'Altbau Lindenweg') {
  const answer = await http()
    .post('/jobs')
    .set('x-test-identity', office())
    .send({ customerId, kind: 'service', status: 'active', designation })
    .expect(201)

  return String((answer.body as { id: string }).id)
}

/** A report of one day of work, issued, with the lines named. */
async function report(jobId: string, day: string, lines: readonly string[], treatment?: string) {
  const answer = await http()
    .post('/documents')
    .set('x-test-identity', office())
    .send({ customerId, jobId, kind: 'time_and_material_report', documentDate: day })
    .expect(201)
  const id = String((answer.body as { id: string }).id)

  if (treatment) {
    await http()
      .patch(`/documents/${id}`)
      .set('x-test-identity', office())
      .send({ taxTreatment: treatment })
      .expect(200)
  }

  for (const designation of lines) {
    await http()
      .post(`/documents/${id}/lines`)
      .set('x-test-identity', office())
      .send({ designation, quantityMilli: 1500, unit: 'hour', unitPriceCents: 0 })
      .expect(201)
  }

  const issued = await http()
    .post(`/documents/${id}/issue`)
    .set('x-test-identity', office())
    .expect(201)

  return issued.body as DocumentRow
}

async function collect(jobId: string, expected = 201) {
  const answer = await http()
    .post(`/jobs/${jobId}/collective-invoice`)
    .set('x-test-identity', office())
    .send({ documentDate: '2026-09-21' })
    .expect(expected)

  return answer.body as DocumentRow & { message?: string }
}

async function linesOf(documentId: string) {
  const answer = await http()
    .get(`/documents/${documentId}/lines`)
    .set('x-test-identity', office())
    .expect(200)

  return (answer.body as LineRow[]).sort((left, right) => left.position - right.position)
}

async function sourcesOf(documentId: string) {
  const { rows } = await admin.query<{
    source_document_id: string
    position: number
    released_at: Date | null
  }>(
    'select source_document_id, position, released_at from document_sources where document_id = $1 order by position',
    [documentId],
  )

  return rows
}

beforeAll(async () => {
  admin = await connect()
  await resetSchema(admin)
  await applyMigrations()
  await allowApplicationLogin(admin)
  await admin.query('insert into tenants (id, name) values ($1, $2)', [north.id, north.name])
  await readyToInvoice(admin, north.id)

  storageRoot = mkdtempSync(join(tmpdir(), 'opengewerk-sammelrechnung-'))
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
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
  rmSync(storageRoot, { recursive: true, force: true })
})

describe('a collective invoice', () => {
  it('bills every open report of a job, a title for each, over the days of the work', async () => {
    const jobId = await job('Altbau Lindenweg')
    const monday = await report(jobId, '2026-09-14', ['Leitungen verlegt', 'Dosen gesetzt'])
    const tuesday = await report(jobId, '2026-09-15', ['Verteiler verdrahtet'])

    const invoice = await collect(jobId)

    expect(invoice).toMatchObject({
      kind: 'final_invoice',
      status: 'draft',
      predecessorDocumentId: null,
      jobId,
      subject: 'Altbau Lindenweg',
      serviceFrom: '2026-09-14',
      serviceUntil: '2026-09-15',
    })
    expect(
      (await linesOf(invoice.id)).map((line) => [line.position, line.kind, line.designation]),
    ).toEqual([
      [1, 'title', `Regiebericht ${monday.number ?? ''} vom 14.09.2026`],
      [2, 'item', 'Leitungen verlegt'],
      [3, 'item', 'Dosen gesetzt'],
      [4, 'title', `Regiebericht ${tuesday.number ?? ''} vom 15.09.2026`],
      [5, 'item', 'Verteiler verdrahtet'],
    ])
    expect(
      (await sourcesOf(invoice.id)).map((row) => [row.source_document_id, row.position]),
    ).toEqual([
      [monday.id, 1],
      [tuesday.id, 2],
    ])
  })

  it('takes one day as the day of the work, not a period', async () => {
    const jobId = await job()

    await report(jobId, '2026-09-16', ['Steckdose getauscht'])

    expect(await collect(jobId)).toMatchObject({
      serviceFrom: '2026-09-16',
      serviceUntil: null,
    })
  })

  it('leaves out a report billed already, and is refused when none is open', async () => {
    const jobId = await job()
    const billed = await report(jobId, '2026-09-14', ['Zähler gesetzt'])
    const open = await report(jobId, '2026-09-15', ['Zähler geprüft'])

    await http()
      .post(`/documents/${billed.id}/successors`)
      .set('x-test-identity', office())
      .send({ kind: 'final_invoice' })
      .expect(201)

    const invoice = await collect(jobId)

    expect((await sourcesOf(invoice.id)).map((row) => row.source_document_id)).toEqual([open.id])

    const refused = await collect(jobId, 409)

    expect(refused.message).toContain('Kein Regiebericht dieses Auftrags ist offen.')
  })

  it('gives a collected report no second successor', async () => {
    const jobId = await job()
    const day = await report(jobId, '2026-09-14', ['Leuchten montiert'])

    await collect(jobId)

    const refused = await http()
      .post(`/documents/${day.id}/successors`)
      .set('x-test-identity', office())
      .send({ kind: 'final_invoice' })
      .expect(409)

    expect((refused.body as { message: string }).message).toContain(
      'Aus diesem Beleg ist schon eine Rechnung entstanden, noch als Entwurf.',
    )
  })

  it('gives its reports back when its draft is deleted', async () => {
    const jobId = await job()
    const day = await report(jobId, '2026-09-14', ['Kabel eingezogen'])
    const first = await collect(jobId)

    await http().delete(`/documents/${first.id}`).set('x-test-identity', office()).expect(200)

    expect((await sourcesOf(first.id))[0]?.released_at).toBeInstanceOf(Date)

    const second = await collect(jobId)

    expect((await sourcesOf(second.id)).map((row) => row.source_document_id)).toEqual([day.id])
  })

  it('gives its reports back when it is cancelled', async () => {
    const jobId = await job()

    await report(jobId, '2026-09-14', ['Fehlerstromschutzschalter getauscht'])

    const invoice = await collect(jobId)

    await http().post(`/documents/${invoice.id}/issue`).set('x-test-identity', office()).expect(201)
    await http()
      .post(`/documents/${invoice.id}/cancellation`)
      .set('x-test-identity', office())
      .expect(201)

    expect((await sourcesOf(invoice.id))[0]?.released_at).toBeInstanceOf(Date)

    await collect(jobId)
  })

  it('is refused over reports taxed differently', async () => {
    const jobId = await job()

    await report(jobId, '2026-09-14', ['Beleuchtung'])
    await report(jobId, '2026-09-15', ['Beleuchtung'], 'small_business')

    expect((await collect(jobId, 409)).message).toContain('unterschiedlich besteuert')
  })

  it('is refused for a job that is not there', async () => {
    await collect(newId<'job'>(), 404)
  })
})

describe('the sources of a collective invoice', () => {
  it('reach a device and are made by none', async () => {
    const jobId = await job()

    await report(jobId, '2026-09-14', ['Hausanschluss geprüft'])

    const invoice = await collect(jobId)
    const pulled = await http().get('/sync?since=0').set('x-test-identity', office()).expect(200)
    const changes = (
      pulled.body as { changes: { entity: string; rows: { documentId: string }[] }[] }
    ).changes

    expect(
      changes
        .find((change) => change.entity === 'document_sources')
        ?.rows.some((row) => row.documentId === invoice.id),
    ).toBe(true)

    const { receipts } = await push(app, office(), [
      created('document_sources', newId<'document-source'>(), {
        documentId: invoice.id,
        sourceDocumentId: invoice.id,
        position: 9,
      }),
    ])

    expect(receipts[0]).toMatchObject({ outcome: 'conflict', reason: 'online_only' })
  })
})

/**
 * Straight at the database as the superuser, past every check of the route:
 * row-level security does not apply to it, the triggers do.
 */
describe('the database behind it', () => {
  it('takes no report that a successor continues, and no report of another job', async () => {
    const jobId = await job()
    const billed = await report(jobId, '2026-09-14', ['Zählerplatz'])
    const other = await report(await job('Neubau'), '2026-09-15', ['Zählerplatz'])
    const made = await http()
      .post(`/documents/${billed.id}/successors`)
      .set('x-test-identity', office())
      .send({ kind: 'final_invoice' })
      .expect(201)
    const successor = made.body as DocumentRow

    for (const source of [billed.id, other.id]) {
      const refusal = await refusedBy(
        admin.query(
          `insert into document_sources (tenant_id, document_id, source_document_id, position)
             values ($1, $2, $3, 1)`,
          [north.id, successor.id, source],
        ),
      )

      expect(refusal.code).toBe('23514')
    }
  })

  it('gives a collected report no successor, whoever writes it', async () => {
    const jobId = await job()
    const day = await report(jobId, '2026-09-14', ['Zählerplatz'])

    await collect(jobId)

    const refusal = await refusedBy(
      admin.query(
        `insert into documents (tenant_id, customer_id, job_id, kind, document_date, predecessor_document_id)
           values ($1, $2, $3, 'final_invoice', '2026-09-21', $4)`,
        [north.id, customerId, jobId, day.id],
      ),
    )

    expect(refusal.code).toBe('23514')
  })
})
