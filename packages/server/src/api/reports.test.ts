import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import {
  type DocumentContent,
  documentContentVersion,
  longestDeviceInfo,
  longestSignerName,
  policyFor,
  roles,
  signedContentFingerprint,
} from '@opengewerk/domain'
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
import { permissionFor } from './sync.controller.js'
import { binary } from './test-binary.js'
import { as, testIdentities as identities } from './test-identity.js'
import { invoiceable, readyToInvoice } from './test-invoice.js'

/**
 * The report of #73, written where it is written: on a device, through the
 * outbox, and signed there by the customer.
 *
 * What is held here is the life of it on the server. It arrives with the tax
 * treatment the office would have proposed; the signature lands only on the
 * page the customer actually saw; from then on nothing about the report
 * changes, by any route, through the outbox or at a database prompt; and the
 * office issues it with the signature in what is kept.
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

  return Promise.resolve(new TextEncoder().encode(`%PDF-1.7 Probedruck ${String(jobs.length)}`))
}

const office = () => as(north.id, 'office')
const technician = () => as(north.id, 'technician')
const device = 'geraet-im-keller'

/** A path the pad could have drawn: two strokes inside the box. */
const scribble = 'M100,300L200,120L300,280L400,100M520,260L640,180L760,240'

function http() {
  return request(app.getHttpServer())
}

type Values = Record<string, string | number | boolean | null>

function creating(entity: string, recordId: string, values: Values) {
  return {
    id: newId<'operation'>(),
    entity,
    recordId,
    kind: 'create',
    baseVersion: null,
    patches: Object.entries(values).map(([field, to]) => ({ field, from: null, to })),
    recordedAt: new Date().toISOString(),
  }
}

function changing(entity: string, recordId: string, values: Values) {
  return {
    ...creating(entity, recordId, values),
    kind: 'update',
    baseVersion: 1,
  }
}

async function push(operations: unknown[], who = technician(), expected = 201) {
  const answer = await http()
    .post('/sync')
    .set('x-test-identity', who)
    .send({ deviceId: device, operations })
    .expect(expected)

  return answer.body as { receipts: { outcome: string; reason: string | null }[] }
}

interface WrittenReport {
  readonly id: string
  readonly lines: {
    id: string
    position: number
    designation: string
    quantityMilli: number
    unit: string
  }[]
  readonly introText: string
}

/** A report as the device writes it: the head, the hours, the material. */
async function writeReport(documentDate = '2026-09-21'): Promise<WrittenReport> {
  const id = newId<'document'>()
  const introText = 'Zwei Leitungsschutzschalter im Keller getauscht.'
  const lines = [
    {
      id: newId<'document-line'>(),
      position: 1,
      designation: 'Arbeitszeit',
      quantityMilli: 2500,
      unit: 'hour',
    },
    {
      id: newId<'document-line'>(),
      position: 2,
      designation: 'LS-Schalter B16',
      quantityMilli: 2000,
      unit: 'piece',
    },
  ]

  const { receipts } = await push([
    creating('documents', id, {
      customerId,
      jobId,
      kind: 'time_and_material_report',
      documentDate,
      introText,
    }),
    ...lines.map((line) =>
      creating('document_lines', line.id, {
        documentId: id,
        kind: 'item',
        position: line.position,
        designation: line.designation,
        quantityMilli: line.quantityMilli,
        unit: line.unit,
        unitPriceCents: 0,
      }),
    ),
  ])

  expect(receipts.map((receipt) => receipt.outcome)).toEqual(['applied', 'applied', 'applied'])

  return { id, lines, introText }
}

/** What the device worked out while the customer was looking at it. */
function fingerprintOf(report: WrittenReport): string {
  return signedContentFingerprint({
    introText: report.introText,
    lines: report.lines.map((line) => ({
      ...line,
      kind: 'item' as const,
      description: null,
      unit: line.unit as 'hour' | 'piece',
    })),
  })
}

function signing(report: WrittenReport, over: Values = {}) {
  return creating('document_signatures', newId<'document-signature'>(), {
    documentId: report.id,
    signerName: 'Erika Berg',
    signedAt: '2026-09-21T12:32:00.000Z',
    deviceInfo: 'Mozilla/5.0 (Linux; Android 15) Chrome/140 Mobile',
    path: scribble,
    contentFingerprint: fingerprintOf(report),
    ...over,
  })
}

async function documentRow(id: string) {
  const answer = await http().get('/documents').set('x-test-identity', office()).expect(200)
  const found = (
    answer.body as { id: string; status: string; taxTreatment: string; number: string | null }[]
  ).find((document) => document.id === id)

  if (!found) {
    throw new Error(`The document ${id} is not in the list`)
  }

  return found
}

beforeAll(async () => {
  admin = await connect()
  await resetSchema(admin)
  await applyMigrations()
  await allowApplicationLogin(admin)
  await admin.query('insert into tenants (id, name) values ($1, $2)', [north.id, north.name])
  await readyToInvoice(admin, north.id)

  storageRoot = mkdtempSync(join(tmpdir(), 'opengewerk-bericht-'))
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
    .send({ customerId, kind: 'service', designation: 'Sicherungen fliegen raus' })
    .expect(201)

  jobId = (job.body as { id: string }).id
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
  rmSync(storageRoot, { recursive: true, force: true })
})

describe('a report written on a device', () => {
  /**
   * The parameter is set from December on and only this report is dated
   * there. A parameter moves forwards only, so setting it back afterwards
   * would leave every later report in this file on section 19 as well; the
   * date keeps the other tests on the ordinary case without a clean-up.
   */
  it('arrives with the tax treatment the office would have proposed for it', async () => {
    await http()
      .post('/settings/parameters')
      .set('x-test-identity', as(north.id, 'owner'))
      .send({ key: 'small_business.claimed', from: '2026-12-01', value: 1 })
      .expect(201)

    const report = await writeReport('2026-12-15')

    expect(await documentRow(report.id)).toMatchObject({
      status: 'draft',
      taxTreatment: 'small_business',
    })

    // Chosen on the device, it is kept: a proposal is not an override.
    const chosen = newId<'document'>()

    await push([
      creating('documents', chosen, {
        customerId,
        jobId,
        kind: 'time_and_material_report',
        documentDate: '2026-12-15',
        taxTreatment: 'standard',
      }),
    ])

    expect((await documentRow(chosen)).taxTreatment).toBe('standard')

    // And before December nothing is claimed, which is what every other
    // report in this file relies on.
    expect((await documentRow((await writeReport()).id)).taxTreatment).toBe('standard')
  })
})

describe('a report from a device', () => {
  /**
   * The device assumes a status for a document it made, because its gates
   * need one before the server has answered. It has to be the one the table
   * gives, or the device works on a draft the server does not have.
   */
  it('starts in the state the policy tells the device it will', async () => {
    const report = await writeReport()

    expect((await documentRow(report.id)).status).toBe(
      policyFor('documents')?.createdAs?.['status'],
    )
  })

  /**
   * How it really arrives: written in a cellar and signed there, then sent in
   * one go when the network comes back. The signature finds the lines it was
   * given for, although they reach the database in the same transaction.
   */
  it('arrives written and signed in a single transmission', async () => {
    const id = newId<'document'>()
    const report: WrittenReport = {
      id,
      introText: 'Zählerschrank geprüft, alles in Ordnung.',
      lines: [
        {
          id: newId<'document-line'>(),
          position: 1,
          designation: 'Arbeitszeit',
          quantityMilli: 1000,
          unit: 'hour',
        },
      ],
    }

    const { receipts } = await push([
      creating('documents', id, {
        customerId,
        jobId,
        kind: 'time_and_material_report',
        documentDate: '2026-09-21',
        introText: report.introText,
      }),
      ...report.lines.map((line) =>
        creating('document_lines', line.id, {
          documentId: id,
          position: line.position,
          designation: line.designation,
          quantityMilli: line.quantityMilli,
          unit: line.unit,
          unitPriceCents: 0,
        }),
      ),
      signing(report),
    ])

    expect(receipts.map((receipt) => receipt.outcome)).toEqual(['applied', 'applied', 'applied'])
    expect((await documentRow(id)).status).toBe('signed')
  })
})

describe('the signature', () => {
  it('lands on the page the customer saw and turns the report into a signed one', async () => {
    const report = await writeReport()
    const { receipts } = await push([signing(report)])

    expect(receipts[0]?.outcome).toBe('applied')
    expect((await documentRow(report.id)).status).toBe('signed')

    const { rows } = await admin.query<{ signer_name: string; device_id: string }>(
      'select signer_name, device_id from document_signatures where document_id = $1',
      [report.id],
    )

    // The device is written down by the sync layer, from the transmission.
    expect(rows).toEqual([{ signer_name: 'Erika Berg', device_id: device }])
  })

  it('is refused when the report changed while the customer was signing', async () => {
    const report = await writeReport()

    // The office adds a line in the meantime, which the customer never saw.
    await http()
      .post(`/documents/${report.id}/lines`)
      .set('x-test-identity', office())
      .send({ designation: 'Anfahrt', quantityMilli: 1000, unit: 'flat_rate', unitPriceCents: 0 })
      .expect(201)

    const { receipts } = await push([signing(report)])

    expect(receipts[0]).toMatchObject({ outcome: 'conflict', reason: 'changed_elsewhere' })
    expect((await documentRow(report.id)).status).toBe('draft')
  })

  it('is refused as a mistake of the client when its path is not one this system draws', async () => {
    const report = await writeReport()

    await push([signing(report, { path: 'M100,300L2000,120' })], technician(), 400)
    expect((await documentRow(report.id)).status).toBe('draft')
  })

  it('is refused the same way for a name or device information longer than the table keeps', async () => {
    // Left to the database, either took the signature and everything behind
    // it in the outbox along with a sentence nobody on site could act on
    // (#118). The form keeps both within bounds before the signature is
    // queued, so only a client that does not ever sends one.
    const report = await writeReport()

    const named = await http()
      .post('/sync')
      .set('x-test-identity', technician())
      .send({
        deviceId: device,
        operations: [signing(report, { signerName: 'E'.repeat(longestSignerName + 1) })],
      })
      .expect(400)
    expect(named.body.message).toBe(
      'Der Name dessen, der unterschreibt, hat höchstens 200 Zeichen.',
    )

    const described = await http()
      .post('/sync')
      .set('x-test-identity', technician())
      .send({
        deviceId: device,
        operations: [signing(report, { deviceInfo: 'x'.repeat(longestDeviceInfo + 1) })],
      })
      .expect(400)
    expect(described.body.message).toBe('Die Angabe zum Gerät hat höchstens 500 Zeichen.')

    expect((await documentRow(report.id)).status).toBe('draft')
  })

  /**
   * The right to write a document, not the right to issue one. The customer
   * signs on the technician's device, and a technician may write and not
   * issue: a signature asking for more would never be given on site.
   */
  it('asks for the right a technician on site has', () => {
    expect(permissionFor('document_signatures', 'create')).toBe('document.write')
    expect(roles.technician.permissions).toContain('document.write')
    expect(roles.technician.permissions).not.toContain('document.issue')
  })
})

describe('a signed report', () => {
  let report: WrittenReport

  beforeAll(async () => {
    report = await writeReport()
    await push([signing(report)])
  })

  it('takes no change through the outbox, not to itself, its lines or a second signature', async () => {
    const { receipts } = await push([
      changing('documents', report.id, { introText: 'Doch etwas anderes' }),
      creating('document_lines', newId<'document-line'>(), {
        documentId: report.id,
        kind: 'item',
        position: 3,
        designation: 'Nachtrag',
        quantityMilli: 1000,
        unit: 'piece',
        unitPriceCents: 0,
      }),
      signing(report, { signerName: 'Jemand anderes' }),
    ])

    expect(receipts.map((receipt) => [receipt.outcome, receipt.reason])).toEqual([
      ['conflict', 'record_is_fixed'],
      ['conflict', 'record_is_fixed'],
      ['conflict', 'record_is_fixed'],
    ])
  })

  it('takes no change through the routes either, and each refusal says why', async () => {
    const answers = [
      await http()
        .patch(`/documents/${report.id}`)
        .set('x-test-identity', office())
        .send({ subject: 'Geändert' })
        .expect(409),
      await http()
        .post(`/documents/${report.id}/lines`)
        .set('x-test-identity', office())
        .send({ designation: 'Nachtrag', quantityMilli: 1000, unit: 'piece', unitPriceCents: 0 })
        .expect(409),
      await http().delete(`/documents/${report.id}`).set('x-test-identity', office()).expect(409),
    ]

    for (const answer of answers) {
      expect((answer.body as { message: string }).message).toContain('unterschrieben')
    }
  })

  it('holds at the database as well, for the report and for the signature itself', async () => {
    const report = await writeReport()
    await push([signing(report)])

    // As the superuser, for whom no policy applies and every trigger does.
    const changed = await refusedBy(
      admin.query("update documents set subject = 'Nachträglich' where id = $1", [report.id]),
    )
    const resigned = await refusedBy(
      admin.query("update document_signatures set signer_name = 'Jemand' where document_id = $1", [
        report.id,
      ]),
    )
    const removed = await refusedBy(
      admin.query('delete from document_signatures where document_id = $1', [report.id]),
    )

    expect([changed.code, resigned.code, removed.code]).toEqual(['OG001', 'OG001', 'OG001'])
  })

  it('reaches other devices together with its new state', async () => {
    const answer = await http().get('/sync?since=0').set('x-test-identity', office()).expect(200)
    const changes = (
      answer.body as { changes: { entity: string; rows: Record<string, unknown>[] }[] }
    ).changes
    const signatures = changes.find((change) => change.entity === 'document_signatures')?.rows ?? []
    const documents = changes.find((change) => change.entity === 'documents')?.rows ?? []

    expect(signatures.some((row) => row['documentId'] === report.id)).toBe(true)
    expect(documents.find((row) => row['id'] === report.id)?.['status']).toBe('signed')
  })

  it('prints with the signature, without prices, and not as a draft', async () => {
    const answer = await http()
      .get(`/documents/${report.id}/pdf`)
      .set('x-test-identity', office())
      .buffer(true)
      .parse(binary)
      .expect(200)

    const html = jobs.at(-1)?.html ?? ''

    expect(answer.headers['content-disposition']).toContain(
      encodeURIComponent('Regiebericht unterschrieben.pdf'),
    )
    expect(html).toContain(`<path d="${scribble}"`)
    expect(html).toContain('Erika Berg')
    expect(html).not.toContain('Einzelpreis')
    expect(html).not.toContain('class="draft"')
  })

  it('is issued by the office and not by the technician, with the signature in what is kept', async () => {
    await http()
      .post(`/documents/${report.id}/issue`)
      .set('x-test-identity', technician())
      .expect(403)

    const issued = await http()
      .post(`/documents/${report.id}/issue`)
      .set('x-test-identity', office())
      .expect(201)

    // Who issued it comes with the number, a step the trigger on a signed
    // report lets through and nothing else (#249).
    expect(issued.body).toMatchObject({ status: 'issued', issuedBy: 'test' })
    expect((issued.body as { number: string | null }).number).not.toBeNull()

    const { rows } = await admin.query<{ content: DocumentContent }>(
      'select content from document_snapshots where document_id = $1',
      [report.id],
    )

    // The number itself is held in `domain`, where the outline test pins it.
    expect(rows[0]?.content).toMatchObject({
      version: documentContentVersion,
      signature: { signerName: 'Erika Berg', path: scribble },
    })
  })
})
