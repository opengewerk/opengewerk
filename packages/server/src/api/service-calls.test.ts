import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import {
  instructionSheetsFingerprint,
  type InstructionSheet,
  signedContentFingerprint,
  type TenantId,
} from '@opengewerk/domain'
import {
  Database,
  FileStore,
  type MailTransport,
  newId,
  type OutgoingMail,
  type PrintJob,
  type Renderer,
  UploadLimits,
} from '@opengewerk/platform-server'
import { aMailServer, testKey } from '@opengewerk/platform-server/testing'
import { sql } from 'drizzle-orm'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { applicationDatabaseUrl, connect, resetToMigrated } from '../database/test-database.js'
import { documentAttachments, withCallInstructions } from '../mail/attachments.js'
import { runMailCycle } from '../mail/worker.js'
import { ApiModule } from './api.module.js'
import { DocumentFiles } from './document-files.js'
import { as, testIdentities as identities } from './test-identity.js'
import { invoiceable, readyToInvoice } from './test-invoice.js'
import { changed, created, push } from './test-structure.js'

/**
 * Service calls (#292): the instructions a consumer gets without a quote, the
 * request for an early start signed at the door and what it was signed under,
 * the instructions by mail, by themselves after a signature and from the
 * office for a call on the phone, the invoice made on site out of a signed
 * report, and the mark of an urgent repair.
 */

const north = { id: newId<'tenant'>() as TenantId, name: 'Elektro Nord GmbH' }
const south = { id: newId<'tenant'>() as TenantId, name: 'Elektro Süd GmbH' }

let admin: Pool
let database: Database
let app: INestApplication
let storageRoot = ''
let files: DocumentFiles

const printed: PrintJob[] = []
const standIn: Renderer = (job) => {
  printed.push(job)

  return Promise.resolve(new TextEncoder().encode('%PDF-1.7 Belehrungen'))
}

const office = (tenant: TenantId = north.id) => as(tenant, 'office')
const technician = (tenant: TenantId = north.id) => as(tenant, 'technician')
const scribble = 'M100,300L200,120L300,280L400,100'

function http() {
  return request(app.getHttpServer())
}

async function post(path: string, body: Record<string, unknown>, who = office()) {
  const answer = await http().post(path).set('x-test-identity', who).send(body).expect(201)

  return String((answer.body as { id: string }).id)
}

interface View {
  readonly refusal: string | null
  readonly urgentRepair: boolean
  readonly email: string | null
  readonly sheets: readonly InstructionSheet[]
  readonly request: string | null
  readonly gaps: readonly string[]
  readonly fingerprint: string
  readonly signed: readonly { id: string; signerName: string }[]
  readonly mails: readonly { to: string; status: string; withRequest: boolean }[]
}

async function instructions(jobId: string, who = technician()): Promise<View> {
  const answer = await http()
    .get(`/jobs/${jobId}/instructions`)
    .set('x-test-identity', who)
    .expect(200)

  return answer.body as View
}

/** A call: a customer, a job, a consumer and a service call unless said otherwise. */
async function aCall(
  options: {
    kind?: 'service' | 'project'
    isBusiness?: boolean
    email?: string | null
    tenant?: TenantId
    urgentRepair?: boolean
  } = {},
) {
  const who = office(options.tenant)
  const customer = await post(
    '/customers',
    {
      kind: options.isBusiness ? 'business' : 'private',
      name: options.isBusiness ? 'Schreinerei Lutz' : 'Klaus Lehmann',
      isBusiness: options.isBusiness ?? false,
      email: options.email === undefined ? 'klaus.lehmann@example.com' : options.email,
      ...invoiceable,
    },
    who,
  )
  const job = await post(
    '/jobs',
    {
      customerId: customer,
      kind: options.kind ?? 'service',
      designation: 'Sicherung Küche löst aus',
      urgentRepair: options.urgentRepair ?? false,
    },
    who,
  )

  return { customer, job }
}

function aRequest(jobId: string, fingerprint: string, fields: Record<string, unknown> = {}) {
  const id = newId<'early-start-request'>()

  return {
    id,
    operation: created('early_start_requests', id, {
      jobId,
      signerName: 'Klaus Lehmann',
      signedAt: new Date().toISOString(),
      deviceInfo: 'Firefox auf Android',
      path: scribble,
      contentFingerprint: fingerprint,
      ...fields,
    }),
  }
}

function recording() {
  const sent: OutgoingMail[] = []
  const transport: MailTransport = {
    send: (mail) => {
      sent.push(mail)

      return Promise.resolve()
    },
    verify: () => Promise.resolve(),
    close: () => undefined,
  }

  return { sent, transport }
}

function cycle(transport: MailTransport) {
  return runMailCycle({
    database,
    connect: () => transport,
    key: testKey,
    origin: 'https://opengewerk.example.de',
    attachments: withCallInstructions(files, database, documentAttachments(files)),
    now: () => new Date(Date.now() + 1_000),
  })
}

/** A report written on a device and signed there by the customer, the way #73 has it arrive. */
async function aSignedReport(customerId: string, jobId: string) {
  const report = await post(
    '/documents',
    { customerId, jobId, kind: 'time_and_material_report', documentDate: '2026-11-03' },
    technician(),
  )

  await post(
    `/documents/${report}/lines`,
    { designation: 'Arbeitszeit', quantityMilli: 1500, unit: 'hour', unitPriceCents: 0 },
    technician(),
  )

  const { rows } = await admin.query<{
    id: string
    position: number
    kind: 'item'
    designation: string
    description: string | null
    quantity_milli: string
    unit: 'hour'
  }>(
    'select id, position, kind, designation, description, quantity_milli, unit from document_lines where document_id = $1',
    [report],
  )
  const fingerprint = signedContentFingerprint({
    introText: null,
    lines: rows.map((row) => ({
      id: row.id,
      position: row.position,
      kind: row.kind,
      designation: row.designation,
      description: row.description,
      quantityMilli: Number(row.quantity_milli),
      unit: row.unit,
    })),
  })
  const sent = await push(app, technician(), [
    created('document_signatures', newId<'document-signature'>(), {
      documentId: report,
      signerName: 'Klaus Lehmann',
      signedAt: new Date().toISOString(),
      deviceInfo: null,
      path: scribble,
      contentFingerprint: fingerprint,
    }),
  ])

  expect(sent.receipts.map((receipt) => receipt.outcome)).toEqual(['applied'])

  return report
}

async function statusOf(documentId: string) {
  const { rows } = await admin.query<{ status: string; number: string | null }>(
    'select status, number from documents where id = $1',
    [documentId],
  )

  return rows[0]
}

beforeAll(async () => {
  admin = await connect()
  await resetToMigrated()
  await admin.query('insert into tenants (id, name) values ($1, $2), ($3, $4)', [
    north.id,
    north.name,
    south.id,
    south.name,
  ])
  // North has a letterhead and a mail server, south has neither.
  await readyToInvoice(admin, north.id)
  await aMailServer(admin, north.id, { from: 'info@nord.example.de' })

  storageRoot = mkdtempSync(join(tmpdir(), 'opengewerk-service-calls-'))
  database = Database.connect(applicationDatabaseUrl())

  const store = new FileStore(storageRoot)

  files = new DocumentFiles(database, store, standIn, new UploadLimits(store))

  const built = await Test.createTestingModule({
    imports: [
      ApiModule.create(database, identities, {
        files: store,
        renderer: standIn,
        mail: {
          origin: 'https://opengewerk.example.de',
          key: testKey,
          connect: () => recording().transport,
        },
      }),
    ],
  }).compile()

  app = built.createNestApplication()
  await app.init()
})

beforeEach(async () => {
  // What earlier tests left waiting is taken off the queue, marked and not
  // deleted: the rows tell the job a request was told already.
  await admin.query(
    "update mail_outbox set status = 'sent', sent_at = now() where status = 'pending'",
  )
  printed.length = 0
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
  rmSync(storageRoot, { recursive: true, force: true })
})

describe('the instructions of a service call (#292)', () => {
  it('are the four shipped ones in the business wording, filled in, with the request to sign on a device', async () => {
    const { job } = await aCall()
    const view = await instructions(job)

    expect(view.refusal).toBeNull()
    expect(view.sheets.map((sheet) => sheet.template)).toEqual([
      'withdrawal',
      'withdrawal_notes',
      'withdrawal_form',
      'early_start',
    ])
    expect(view.sheets[0]?.text).toContain('Elektro Nord GmbH')
    expect(view.sheets[0]?.text).toContain('040 123456')
    expect(view.request).toMatch(
      /^Ich verlange ausdrücklich, dass Elektro Nord GmbH mit der Ausführung/,
    )
    expect(view.request).not.toContain('___')
    expect(view.fingerprint).toBe(instructionSheetsFingerprint(view.sheets, view.request))
    expect(view.gaps).toEqual([])
    expect(view.email).toBe('klaus.lehmann@example.com')
  })

  it('are none for a project, which has its quote, or for a business, which has no right of withdrawal', async () => {
    const project = await aCall({ kind: 'project' })
    const business = await aCall({ isBusiness: true })

    expect((await instructions(project.job)).refusal).toContain('für einen Serviceeinsatz')
    expect((await instructions(project.job)).sheets).toEqual([])
    expect((await instructions(business.job)).refusal).toContain('kein Widerrufsrecht')
  })

  it('say what the letterhead lacks before they can go out', async () => {
    const { job } = await aCall({ tenant: south.id })
    const view = await instructions(job, technician(south.id))

    expect(view.gaps.join(' ')).toContain('Briefkopf')
  })

  it('show the mark of an urgent repair, which the office sets and a technician does not', async () => {
    const { job } = await aCall({ urgentRepair: true })

    expect((await instructions(job)).urgentRepair).toBe(true)

    const refused = await push(
      app,
      technician(),
      [changed('jobs', job, { urgentRepair: { from: true, to: false } })],
      400,
    )

    expect(refused.message).toContain('darf dieser Zugang nicht')

    const { rows } = await admin.query('select urgent_repair from jobs where id = $1', [job])

    expect(rows).toEqual([{ urgent_repair: true }])
  })
})

describe('a request for an early start signed at the door', () => {
  it('lands from the technician with what it was signed under, on whose device', async () => {
    const { job } = await aCall()
    const { fingerprint } = await instructions(job)
    const signed = aRequest(job, fingerprint)
    const sent = await push(app, technician(), [signed.operation])

    expect(sent.receipts.map((receipt) => receipt.outcome)).toEqual(['applied'])

    const { rows } = await admin.query(
      'select job_id, signer_name, created_by from early_start_requests where id = $1',
      [signed.id],
    )

    expect(rows).toEqual([{ job_id: job, signer_name: 'Klaus Lehmann', created_by: 'test' }])
    expect((await instructions(job)).signed.map((row) => row.signerName)).toEqual(['Klaus Lehmann'])
  })

  it('is refused as a conflict when the wording changed while the customer read it', async () => {
    const { job } = await aCall()
    const sent = await push(app, technician(), [aRequest(job, 'fnv1a32:00000000:0').operation])

    expect(
      sent.receipts.map((receipt) => [receipt.outcome, receipt.reason, receipt.fields]),
    ).toEqual([['conflict', 'changed_elsewhere', ['contentFingerprint']]])
  })

  it('is refused as a conflict for a job that is no service call for a consumer', async () => {
    const consumer = await aCall()
    const { fingerprint } = await instructions(consumer.job)
    const project = await aCall({ kind: 'project' })
    const sent = await push(app, technician(), [aRequest(project.job, fingerprint).operation])

    expect(
      sent.receipts.map((receipt) => [receipt.outcome, receipt.reason, receipt.fields]),
    ).toEqual([['conflict', 'changed_elsewhere', ['jobId']]])
  })

  it('is refused by the database for a project, whichever way it comes in', async () => {
    const project = await aCall({ kind: 'project' })
    const inserting = database.forTenant({ tenantId: north.id }, (tx) =>
      tx.execute(sql`insert into early_start_requests
          (tenant_id, job_id, signer_name, signed_at, path, content_fingerprint)
          values (${north.id}, ${project.job}, 'Klaus Lehmann', now(), ${scribble}, 'x')`),
    )

    const refused = await inserting.then(
      () => null,
      (error: unknown) => (error as { cause?: { message?: string; code?: string } }).cause,
    )

    expect(refused).toMatchObject({
      code: 'OG014',
      message: expect.stringContaining('nur bei einem Serviceeinsatz für einen Verbraucher'),
    })
  })

  it('needs a name and a signature', async () => {
    const { job } = await aCall()
    const { fingerprint } = await instructions(job)
    const nameless = await push(
      app,
      technician(),
      [aRequest(job, fingerprint, { signerName: ' ' }).operation],
      400,
    )

    expect(nameless.message).toContain('Name')

    const unsigned = await push(
      app,
      technician(),
      [aRequest(job, fingerprint, { path: 'kritzel' }).operation],
      400,
    )

    expect(unsigned.message).toContain('Unterschrift')
  })

  it('is never changed afterwards', async () => {
    const { job } = await aCall()
    const { fingerprint } = await instructions(job)
    const signed = aRequest(job, fingerprint)

    await push(app, technician(), [signed.operation])

    const later = await push(app, office(), [
      changed('early_start_requests', signed.id, {
        signerName: { from: 'Klaus Lehmann', to: 'Jemand anderes' },
      }),
    ])

    expect(later.receipts.map((receipt) => [receipt.outcome, receipt.reason])).toEqual([
      ['conflict', 'online_only'],
    ])
  })
})

describe('the instructions by mail', () => {
  it('go to the customer by themselves after a request was signed at the door, with it', async () => {
    // The requests of the tests above go out first, so that this pass is about this one.
    await cycle(recording().transport)

    const { job } = await aCall()
    const { fingerprint } = await instructions(job)
    const signed = aRequest(job, fingerprint)

    await push(app, technician(), [signed.operation])

    const { sent, transport } = recording()

    await cycle(transport)

    const ours = sent.filter((mail) => mail.subject.startsWith('Belehrungen zu Ihrem Auftrag'))

    expect(ours).toHaveLength(1)
    expect(ours[0]?.to).toEqual({ name: 'Klaus Lehmann', address: 'klaus.lehmann@example.com' })
    expect(ours[0]?.text).toContain('auf unserem Gerät unterschrieben hat')
    expect(ours[0]?.attachments?.map((attachment) => attachment.filename)).toEqual([
      'Belehrungen.pdf',
    ])

    const html = printed.map((job) => job.html).join('\n')

    expect(html).toContain('Widerrufsbelehrung')
    expect(html).toContain('Ich verlange ausdrücklich')
    expect(html).toContain(scribble)
    expect((await instructions(job)).mails).toMatchObject([{ withRequest: true, status: 'sent' }])

    // Once per request: the next pass finds it told.
    const again = recording()

    await cycle(again.transport)
    expect(again.sent.filter((mail) => mail.subject.startsWith('Belehrungen'))).toEqual([])
  })

  it('go nowhere for a customer without an address, and the office sees that', async () => {
    const { job } = await aCall({ email: null })
    const { fingerprint } = await instructions(job)

    await push(app, technician(), [aRequest(job, fingerprint).operation])

    const { sent, transport } = recording()

    await cycle(transport)

    expect(sent.filter((mail) => mail.subject.startsWith('Belehrungen'))).toEqual([])
    expect((await instructions(job, office())).mails).toEqual([])
  })

  it('are sent from the office for a call taken on the phone, once at a time', async () => {
    const { job } = await aCall()
    const answer = await http()
      .post(`/jobs/${job}/instructions/mail`)
      .set('x-test-identity', office())
      .send({})
      .expect(202)

    expect(answer.body).toMatchObject({ to: 'klaus.lehmann@example.com', withRequest: false })

    await http()
      .post(`/jobs/${job}/instructions/mail`)
      .set('x-test-identity', office())
      .send({})
      .expect(409)

    const { sent, transport } = recording()

    await cycle(transport)

    const ours = sent.filter((mail) => mail.subject.startsWith('Belehrungen zu Ihrem Auftrag'))

    expect(ours).toHaveLength(1)
    expect(ours[0]?.text).toContain('Vordruck für das Verlangen')
  })

  it('are not sent by a technician, nor without an address, nor for a project', async () => {
    const { job } = await aCall()

    await http()
      .post(`/jobs/${job}/instructions/mail`)
      .set('x-test-identity', technician())
      .send({})
      .expect(403)

    const addressless = await aCall({ email: null })
    const refused = await http()
      .post(`/jobs/${addressless.job}/instructions/mail`)
      .set('x-test-identity', office())
      .send({})
      .expect(422)

    expect((refused.body as { message: string }).message).toContain(
      'Für diesen Kunden ist keine E-Mail-Adresse hinterlegt',
    )

    const project = await aCall({ kind: 'project' })

    await http()
      .post(`/jobs/${project.job}/instructions/mail`)
      .set('x-test-identity', office())
      .send({})
      .expect(422)
  })
})

describe('the instructions as a PDF', () => {
  it('print the sheets, and with a request named the request with its signature', async () => {
    const { job } = await aCall()
    const { fingerprint } = await instructions(job)
    const signed = aRequest(job, fingerprint)

    await push(app, technician(), [signed.operation])

    const sheets = await http()
      .get(`/jobs/${job}/instructions/pdf`)
      .set('x-test-identity', office())
      .expect(200)

    expect(sheets.headers['content-type']).toBe('application/pdf')
    expect(printed.at(-1)?.html).toContain('Muster-Widerrufsformular')
    expect(printed.at(-1)?.html).not.toContain(scribble)

    await http()
      .get(`/jobs/${job}/instructions/pdf?request=${signed.id}`)
      .set('x-test-identity', office())
      .expect(200)

    expect(printed.at(-1)?.html).toContain(scribble)
    expect(printed.at(-1)?.html).toContain('Klaus Lehmann')
  })

  it('do not print a request of another job', async () => {
    const one = await aCall()
    const other = await aCall()
    const { fingerprint } = await instructions(one.job)
    const signed = aRequest(one.job, fingerprint)

    await push(app, technician(), [signed.operation])

    await http()
      .get(`/jobs/${other.job}/instructions/pdf?request=${signed.id}`)
      .set('x-test-identity', office())
      .expect(422)
  })
})

describe('the invoice made on site out of a signed report', () => {
  it('is made by the technician as a draft, and the report stays signed', async () => {
    const { customer, job } = await aCall()
    const report = await aSignedReport(customer, job)
    const invoice = await post(
      `/documents/${report}/successors`,
      { kind: 'final_invoice' },
      technician(),
    )

    expect(await statusOf(invoice)).toEqual({ status: 'draft', number: null })
    expect(await statusOf(report)).toEqual({ status: 'signed', number: null })

    const { rows } = await admin.query(
      'select predecessor_document_id, kind from documents where id = $1',
      [invoice],
    )

    expect(rows).toEqual([{ predecessor_document_id: report, kind: 'final_invoice' }])
  })

  it('is not made out of a report nobody signed, nor as anything but the final invoice', async () => {
    const { customer, job } = await aCall()
    const draft = await post(
      '/documents',
      {
        customerId: customer,
        jobId: job,
        kind: 'time_and_material_report',
        documentDate: '2026-11-03',
      },
      technician(),
    )

    await http()
      .post(`/documents/${draft}/successors`)
      .set('x-test-identity', technician())
      .send({ kind: 'final_invoice' })
      .expect(409)

    const signed = await aSignedReport(customer, job)

    await http()
      .post(`/documents/${signed}/successors`)
      .set('x-test-identity', technician())
      .send({ kind: 'progress_invoice' })
      .expect(400)
  })

  it('is issued in the office, which issues the report first, and not by the technician', async () => {
    const { customer, job } = await aCall()
    const report = await aSignedReport(customer, job)
    const invoice = await post(
      `/documents/${report}/successors`,
      { kind: 'final_invoice' },
      technician(),
    )

    await admin.query(
      'update document_lines set unit_price_cents = 6800, net_cents = 10200 where document_id = $1',
      [invoice],
    )

    await http()
      .post(`/documents/${invoice}/issue`)
      .set('x-test-identity', technician())
      .send({})
      .expect(403)

    await http()
      .post(`/documents/${invoice}/issue`)
      .set('x-test-identity', office())
      .send({})
      .expect(201)

    const fixedReport = await statusOf(report)
    const fixedInvoice = await statusOf(invoice)

    expect(fixedReport?.status).toBe('issued')
    expect(fixedReport?.number).not.toBeNull()
    expect(fixedInvoice?.status).toBe('issued')

    const { rows } = await admin.query<{ count: string }>(
      'select count(*) from document_snapshots where document_id = $1',
      [report],
    )

    expect(rows[0]?.count).toBe('1')
  })
})
