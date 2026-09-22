import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { signedContentFingerprint, type TenantId } from '@opengewerk/domain'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { Database } from '../database/database.js'
import { newId } from '../database/identifier.js'
import {
  allowApplicationLogin,
  applicationDatabaseUrl,
  applyMigrations,
  connect,
  resetSchema,
} from '../database/test-database.js'
import type { Renderer } from '../documents/renderer.js'
import { documentAttachments } from '../mail/attachments.js'
import { berlinClock } from '../notifications/notify.js'
import { aMailServer, testKey } from '../mail/test-mail-server.js'
import { type MailTransport, type OutgoingMail, smtpTransport } from '../mail/transport.js'
import { runMailCycle } from '../mail/worker.js'
import { FileStore } from '../storage/file-store.js'
import { ApiModule } from './api.module.js'
import { DocumentFiles } from './document-files.js'
import { as, testIdentities as identities } from './test-identity.js'
import { invoiceable, readyToInvoice } from './test-invoice.js'

/**
 * A report signed on site goes to the customer who signed it, where the
 * business wants that. Asked for by Moritz on 22.09.2026: the setting decides,
 * on the day of the signature, and the job sends the PDF of the signed report
 * a moment after it arrived.
 */

/** Wants signed reports sent, and has for a while. */
const north = { id: newId<'tenant'>() as TenantId, name: 'Elektro Nord GmbH' }
/** Has never switched it on. */
const south = { id: newId<'tenant'>() as TenantId, name: 'Elektro Süd' }
/** Switches it on tomorrow, after the reports here are signed. */
const west = { id: newId<'tenant'>() as TenantId, name: 'Elektro West' }

type Business = typeof north

/**
 * Signed five minutes ago and sent a moment later, on the real clock. A
 * message waits for its first attempt from the time the database wrote it,
 * so a clock of its own would have to agree with the database's anyway.
 */
const signedAt = new Date(Date.now() - 5 * 60_000)
const signedOn = berlinClock(signedAt).day
const tomorrow = new Date(`${signedOn}T12:00:00Z`)

tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)

function german(day: string): string {
  const [year, month, date] = day.split('-')

  return `${date ?? ''}.${month ?? ''}.${year ?? ''}`
}

function aMomentLater(): Date {
  return new Date(Date.now() + 1_000)
}

let admin: Pool
let database: Database
let app: INestApplication
let storageRoot: string
let files: DocumentFiles

const printed = new TextEncoder().encode('%PDF-1.7 unterschriebener Regiebericht')
const standIn: Renderer = () => Promise.resolve(printed)

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

async function customerAndJob(
  business: Business,
  email: string | null,
): Promise<{ customerId: string; jobId: string }> {
  const customer = await http()
    .post('/customers')
    .set('x-test-identity', as(business.id, 'office'))
    .send({ kind: 'private', name: 'Familie Berg', ...invoiceable, email })
    .expect(201)
  const customerId = (customer.body as { id: string }).id

  const job = await http()
    .post('/jobs')
    .set('x-test-identity', as(business.id, 'office'))
    .send({ customerId, kind: 'service', designation: 'Sicherungen Keller' })
    .expect(201)

  return { customerId, jobId: (job.body as { id: string }).id }
}

/** A report written and signed on a device, the way #73 has it arrive. */
async function signedReport(business: Business, email: string | null = 'berg@example.org') {
  const { customerId, jobId } = await customerAndJob(business, email)
  const id = newId<'document'>()
  const introText = 'Zwei Leitungsschutzschalter im Keller getauscht.'
  const line = {
    id: newId<'document-line'>(),
    position: 1,
    designation: 'Arbeitszeit',
    quantityMilli: 2500,
    unit: 'hour',
  }

  const pushed = await http()
    .post('/sync')
    .set('x-test-identity', as(business.id, 'technician'))
    .send({
      deviceId: 'handy-im-keller',
      operations: [
        creating('documents', id, {
          customerId,
          jobId,
          kind: 'time_and_material_report',
          documentDate: signedOn,
          introText,
        }),
        creating('document_lines', line.id, {
          documentId: id,
          kind: 'item',
          position: line.position,
          designation: line.designation,
          quantityMilli: line.quantityMilli,
          unit: line.unit,
          unitPriceCents: 0,
        }),
        creating('document_signatures', newId<'document-signature'>(), {
          documentId: id,
          signerName: 'Erika Berg',
          signedAt: signedAt.toISOString(),
          deviceInfo: 'Mozilla/5.0 (Linux; Android 15) Chrome/140 Mobile',
          path: scribble,
          contentFingerprint: signedContentFingerprint({
            introText,
            lines: [{ ...line, kind: 'item', description: null, unit: 'hour' }],
          }),
        }),
      ],
    })
    .expect(201)

  expect(
    (pushed.body as { receipts: { outcome: string }[] }).receipts.map((receipt) => receipt.outcome),
  ).toEqual(['applied', 'applied', 'applied'])

  return id
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

function cycle(transport: MailTransport, now: Date = aMomentLater()) {
  return runMailCycle({
    database,
    connect: () => transport,
    key: testKey,
    origin: 'https://opengewerk.example.de',
    attachments: documentAttachments(files),
    now: () => now,
  })
}

async function switchedOn(business: Business, from: string) {
  await http()
    .post('/settings/parameters')
    .set('x-test-identity', as(business.id, 'owner'))
    .send({ key: 'report.mail_on_signature', from, value: 1, note: null })
    .expect(201)
}

beforeAll(async () => {
  admin = await connect()
  await resetSchema(admin)
  await applyMigrations()
  await allowApplicationLogin(admin)

  for (const business of [north, south, west]) {
    await admin.query('insert into tenants (id, name) values ($1, $2)', [
      business.id,
      business.name,
    ])
  }

  await readyToInvoice(admin, north.id, south.id, west.id)

  storageRoot = mkdtempSync(join(tmpdir(), 'opengewerk-report-mail-'))
  for (const [tenant, from] of [
    [north, 'rechnung@nord.example.de'],
    [south, 'buero@sued.example.de'],
    [west, 'buero@west.example.de'],
  ] as const) {
    await aMailServer(admin, tenant.id, { from })
  }

  database = Database.connect(applicationDatabaseUrl())

  const store = new FileStore(storageRoot)

  files = new DocumentFiles(database, store, standIn)

  const built = await Test.createTestingModule({
    imports: [
      ApiModule.create(database, identities, {
        files: store,
        renderer: standIn,
        mail: { origin: 'https://opengewerk.example.de', key: testKey, connect: smtpTransport },
      }),
    ],
  }).compile()

  app = built.createNestApplication()
  await app.init()

  await switchedOn(north, '2026-01-01')
  await switchedOn(west, tomorrow.toISOString().slice(0, 10))
})

beforeEach(async () => {
  // What earlier tests left waiting is taken off the queue, so that what one
  // pass did belongs to the test looking at it. Marked rather than deleted:
  // the rows are what tells the job a report was already told, and without
  // them it would find every earlier report again.
  await admin.query(
    "update mail_outbox set status = 'sent', sent_at = now() where status = 'pending'",
  )
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
  rmSync(storageRoot, { recursive: true, force: true })
})

describe('a report signed on site', () => {
  it('goes to the customer who signed it, with its PDF, a moment after it arrived', async () => {
    await signedReport(north)
    const post = recording()

    expect(await cycle(post.transport)).toMatchObject({ written: 1, sent: 1 })

    const [mail] = post.sent

    expect(mail?.to).toEqual({ name: 'Familie Berg', address: 'berg@example.org' })
    expect(mail?.subject).toBe(`Regiebericht vom ${german(signedOn)} von Elektro Nord GmbH`)
    expect(mail?.text).toContain(
      `im Anhang erhalten Sie den Regiebericht vom ${german(signedOn)}, den Sie am ` +
        `${german(signedOn)} unterschrieben haben.`,
    )
    expect(mail?.attachments.map((file) => file.filename)).toEqual([
      'Regiebericht unterschrieben.pdf',
    ])
    expect(Buffer.from(mail?.attachments[0]?.content ?? []).equals(Buffer.from(printed))).toBe(true)
  })

  it('goes once', async () => {
    await signedReport(north)
    const post = recording()

    await cycle(post.transport)

    expect(await cycle(post.transport, new Date(Date.now() + 60_000))).toMatchObject({
      written: 0,
      sent: 0,
    })
    expect(post.sent).toHaveLength(1)
  })

  it('stays with the office where the business has not switched it on', async () => {
    await signedReport(south)

    expect(await cycle(recording().transport)).toMatchObject({ written: 0 })
  })

  it('is not sent for a signature from before the day it is switched on', async () => {
    await signedReport(west)

    expect(await cycle(recording().transport)).toMatchObject({ written: 0 })
  })

  it('waits for an address, and the office can send it by hand once there is one', async () => {
    const id = await signedReport(north, null)
    const post = recording()

    expect(await cycle(post.transport)).toMatchObject({ written: 0 })

    await http()
      .post(`/documents/${id}/mail`)
      .set('x-test-identity', as(north.id, 'office'))
      .send({ to: 'erika.berg@example.org' })
      .expect(202)

    expect(await cycle(post.transport)).toMatchObject({ sent: 1 })
    expect(post.sent[0]?.to.address).toBe('erika.berg@example.org')
    expect(post.sent[0]?.attachments[0]?.filename).toBe('Regiebericht unterschrieben.pdf')
  })
})

describe('the mail settings of the instance', () => {
  it('say whether a mail server is set up, and from which address', async () => {
    const answer = await http()
      .get('/settings/mail')
      .set('x-test-identity', as(north.id, 'office'))
      .expect(200)

    expect(answer.body).toEqual({ configured: true, from: 'rechnung@nord.example.de' })
  })

  it('say so when none is', async () => {
    const built = await Test.createTestingModule({
      imports: [ApiModule.create(database, identities, { renderer: standIn })],
    }).compile()
    const silent = built.createNestApplication()

    await silent.init()

    try {
      const answer = await request(silent.getHttpServer())
        .get('/settings/mail')
        .set('x-test-identity', as(north.id, 'office'))
        .expect(200)

      expect(answer.body).toEqual({ configured: false, from: null })
    } finally {
      await silent.close()
    }
  })
})
