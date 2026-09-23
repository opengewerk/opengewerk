import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { PDFDocument } from '@cantoo/pdf-lib'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { Database } from '../database/database.js'
import { newId } from '../database/identifier.js'
import {
  allowApplicationLogin,
  applicationDatabaseUrl,
  applyMigrations,
  connect,
  resetSchema,
} from '../database/test-database.js'
import { type Renderer, RendererUnavailableError } from '../documents/renderer.js'
import { documentAttachments } from '../mail/attachments.js'
import { aMailServer, testKey } from '../mail/test-mail-server.js'
import { type MailTransport, type OutgoingMail, smtpTransport } from '../mail/transport.js'
import { runMailCycle } from '../mail/worker.js'
import { FileStore } from '../storage/file-store.js'
import { ApiModule } from './api.module.js'
import { DocumentFiles } from './document-files.js'
import type { DocumentMail } from './document-mail.controller.js'
import { as, testIdentities as identities } from './test-identity.js'
import { invoiceable, readyToInvoice } from './test-invoice.js'

/**
 * A document sent to its customer, the second half of #81, on real rows.
 *
 * The route records the wish and answers at once; the job sends the message
 * with the file the document keeps. Which file that is follows from the
 * customer, the way the format of the invoice does: a business gets the
 * ZUGFeRD PDF, a person the PDF.
 */

const north = { id: newId<'tenant'>(), name: 'Elektro Nord GmbH' }
const south = { id: newId<'tenant'>(), name: 'Elektro Süd' }

let admin: Pool
let database: Database
let app: INestApplication
let storageRoot: string
let files: DocumentFiles

let page: Uint8Array
let rendererRunning = true

const standIn: Renderer = () =>
  rendererRunning
    ? Promise.resolve(page)
    : Promise.reject(new RendererUnavailableError('Der Renderer antwortet nicht.'))

const office = (tenant = north) => as(tenant.id, 'office')

function http() {
  return request(app.getHttpServer())
}

const business = {
  kind: 'business',
  name: 'Hausverwaltung Kramer GmbH',
  ...invoiceable,
  isBusiness: true,
  email: 'buchhaltung@kramer-hv.example',
  vatId: 'DE987654321',
  buyerReference: 'KST-4711',
}

const person = {
  kind: 'private',
  name: 'Familie Berg',
  ...invoiceable,
  email: 'berg@example.org',
}

async function customer(fields: Record<string, unknown>, tenant = north): Promise<string> {
  const created = await http()
    .post('/customers')
    .set('x-test-identity', office(tenant))
    .send(fields)
    .expect(201)

  return (created.body as { id: string }).id
}

/** A final invoice of 1.240 euros net, issued. Returns its id. */
async function issuedInvoice(
  customerId: string,
  tenant = north,
  dates = { documentDate: '2026-09-18', serviceFrom: '2026-09-01', serviceUntil: '2026-09-15' },
): Promise<string> {
  const created = await http()
    .post('/documents')
    .set('x-test-identity', office(tenant))
    .send({ customerId, kind: 'final_invoice', ...dates })
    .expect(201)
  const id = (created.body as { id: string }).id

  await http()
    .post(`/documents/${id}/lines`)
    .set('x-test-identity', office(tenant))
    .send({
      designation: 'Zählerschrank setzen',
      quantityMilli: 1000,
      unit: 'flat_rate',
      unitPriceCents: 124_000,
    })
    .expect(201)

  await http().post(`/documents/${id}/issue`).set('x-test-identity', office(tenant)).expect(201)

  return id
}

function sending(documentId: string, body: Record<string, unknown> = {}, identity = office()) {
  return http().post(`/documents/${documentId}/mail`).set('x-test-identity', identity).send(body)
}

async function messagesOf(documentId: string, identity = office()): Promise<DocumentMail[]> {
  const answer = await http()
    .get(`/documents/${documentId}/mail`)
    .set('x-test-identity', identity)
    .expect(200)

  return answer.body as DocumentMail[]
}

/** A transport that keeps what it was given. */
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
    attachments: documentAttachments(files),
    // A moment ahead, so that a message written by the test is due.
    now: () => new Date(Date.now() + 1_000),
  })
}

beforeAll(async () => {
  admin = await connect()
  await resetSchema(admin)
  await applyMigrations()
  await allowApplicationLogin(admin)

  for (const tenant of [north, south]) {
    await admin.query('insert into tenants (id, name) values ($1, $2)', [tenant.id, tenant.name])
  }

  await admin.query(
    `insert into letterheads (tenant_id, street, house_number, postal_code, city, phone, email,
       tax_number, vat_id, iban)
     values ($1, 'Hafenstraße', '12', '20457', 'Hamburg', '040 1234567',
       'rechnung@elektro-nord.example', '22/815/08154', 'DE123456789', 'DE02120300000000202051')`,
    [north.id],
  )
  await readyToInvoice(admin, south.id)
  await aMailServer(admin, north.id, { from: 'rechnung@nord.example.de' })
  await aMailServer(admin, south.id, { from: 'buero@sued.example.de' })

  // The name the screen shows for whoever asked, in the two tables it is read from.
  await admin.query(
    "insert into auth_users (id, name, email) values ('test', 'Britta Büro', 'britta@example.de')",
  )
  await admin.query(
    "insert into memberships (tenant_id, user_id, roles) values ($1, 'test', '{office}')",
    [north.id],
  )

  const printed = await PDFDocument.create()

  printed.addPage().drawRectangle({ x: 50, y: 50, width: 200, height: 100 })
  page = await printed.save()

  storageRoot = mkdtempSync(join(tmpdir(), 'opengewerk-mail-'))
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
})

beforeEach(async () => {
  rendererRunning = true
  // Each test sends its own document and looks at what one pass did. A
  // message another test left waiting would go out in that pass as well.
  // Cleared as the superuser, past the rule that keeps a message forever.
  await admin.query('delete from mail_outbox')
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
  rmSync(storageRoot, { recursive: true, force: true })
})

describe('an issued invoice', () => {
  it('goes to a private customer with its PDF, from the business', async () => {
    const id = await issuedInvoice(await customer(person))
    const asked = await sending(id).expect(202)

    expect(asked.body).toMatchObject({
      to: 'berg@example.org',
      attachment: 'pdf',
      status: 'pending',
      requestedBy: 'Britta Büro',
    })

    const post = recording()

    expect(await cycle(post.transport)).toMatchObject({ sent: 1 })

    const [mail] = post.sent

    expect(mail?.to).toEqual({ name: 'Familie Berg', address: 'berg@example.org' })
    expect(mail?.from.name).toBe('Elektro Nord GmbH')
    expect(mail?.replyTo).toBe('rechnung@elektro-nord.example')
    expect(mail?.subject).toMatch(/^Schlussrechnung .+ von Elektro Nord GmbH$/)
    expect(mail?.text).toContain('im Anhang erhalten Sie die Schlussrechnung')
    expect(mail?.text).toContain('1.475,60')
    expect(mail?.attachments.map((file) => [file.filename, file.contentType])).toEqual([
      [expect.stringMatching(/^Schlussrechnung .+\.pdf$/) as unknown, 'application/pdf'],
    ])
    expect(Buffer.from(mail?.attachments[0]?.content ?? []).equals(Buffer.from(page))).toBe(true)

    const [message] = await messagesOf(id)

    expect(message?.status).toBe('sent')
    expect(message?.sentAt).not.toBeNull()
  })

  it('goes to a business as its ZUGFeRD PDF, which the document keeps from then on', async () => {
    const id = await issuedInvoice(await customer(business))

    expect((await sending(id).expect(202)).body).toMatchObject({ attachment: 'zugferd' })

    const post = recording()

    await cycle(post.transport)

    const [mail] = post.sent

    expect(mail?.text).toContain('E-Rechnung im Format ZUGFeRD')

    const attached = await PDFDocument.load(mail?.attachments[0]?.content ?? new Uint8Array())

    expect(attached.getPageCount()).toBe(1)

    const { rows } = await admin.query<{ purpose: string }>(
      'select purpose from document_files where document_id = $1 order by purpose',
      [id],
    )

    expect(rows.map((row) => row.purpose)).toEqual(['pdf', 'zugferd'])
  })

  it('goes to an address given for this one message', async () => {
    const id = await issuedInvoice(await customer({ ...person, email: null }))

    const refused = await sending(id).expect(422)

    expect((refused.body as { message: string }).message).toContain('keine E-Mail-Adresse')

    await sending(id, { to: 'kein-at-zeichen' }).expect(422)
    expect((await sending(id, { to: 'kasse@example.org' }).expect(202)).body).toMatchObject({
      to: 'kasse@example.org',
    })
  })

  it('is not sent twice while the first message waits, and again once it went out', async () => {
    const id = await issuedInvoice(await customer(person))

    await sending(id).expect(202)

    const twice = await sending(id).expect(409)

    expect((twice.body as { message: string }).message).toContain('wartet schon')

    await cycle(recording().transport)
    await sending(id).expect(202)

    expect((await messagesOf(id)).map((message) => message.status)).toEqual(['pending', 'sent'])
  })

  it('waits while the renderer is down, and goes once it is back', async () => {
    const id = await issuedInvoice(await customer(person))

    await sending(id).expect(202)
    rendererRunning = false

    const post = recording()

    expect(await cycle(post.transport)).toMatchObject({ sent: 0, retried: 1 })
    expect((await messagesOf(id))[0]?.lastError).toContain('Renderer')

    rendererRunning = true
    await admin.query('update mail_outbox set next_attempt_at = now() where document_id = $1', [id])

    expect(await cycle(post.transport)).toMatchObject({ sent: 1 })
    expect(post.sent).toHaveLength(1)
  })
})

/**
 * #134. The transition of section 27 (38) UStG lets a PDF go to a business
 * only if the invoice is sent by the end of the period, and the day it is sent
 * is the day the office asks for the message. Both invoices here are written
 * and issued in December for work of December; the e-invoice of each lacks
 * something, a VAT identification number without its country.
 */
describe('an invoice to a business after the transition has ended', () => {
  const lacking = { ...business, vatId: '987654321' }
  const december = {
    documentDate: '2026-12-30',
    serviceFrom: '2026-12-01',
    serviceUntil: '2026-12-15',
  }

  afterEach(() => {
    vi.useRealTimers()
  })

  it('goes as a PDF on the last day of it, and is refused the first day after', async () => {
    // Only the clock the application reads for today: timers, the pool and
    // the database keep their own.
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-12-31T10:00:00+01:00') })

    const early = await issuedInvoice(await customer(lacking), north, december)
    const late = await issuedInvoice(await customer(lacking), north, december)

    const sent = await sending(early).expect(202)

    expect((sent.body as DocumentMail).attachment).toBe('pdf')

    vi.setSystemTime(new Date('2027-01-04T09:00:00+01:00'))

    const refused = await sending(late).expect(422)
    const body = refused.body as { message: string; missing: { detail: string }[] }

    expect(body.message).toContain('Pflicht ab jetzt')
    expect(body.message).toContain('31.12.2026')
    expect(body.missing.map((gap) => gap.detail)).toEqual(['recipient_vat_id_format'])
    expect(await messagesOf(late)).toEqual([])
  })
})

describe('what cannot be sent', () => {
  it('is a draft, which has no number yet', async () => {
    const created = await http()
      .post('/documents')
      .set('x-test-identity', office())
      .send({ customerId: await customer(person), kind: 'quote', documentDate: '2026-09-18' })
      .expect(201)

    const refused = await sending((created.body as { id: string }).id).expect(409)

    expect((refused.body as { message: string }).message).toContain('festgeschriebener Beleg')
  })

  it('is anything, by a technician: the office sends what goes to a customer', async () => {
    const id = await issuedInvoice(await customer(person))

    await sending(id, {}, as(north.id, 'technician')).expect(403)
    await messagesOf(id, as(north.id, 'technician'))
  })

  it('is a document of the business next door', async () => {
    const id = await issuedInvoice(await customer(person))

    await sending(id).expect(202)
    await sending(id, {}, office(south)).expect(404)
    expect(await messagesOf(id, office(south))).toEqual([])
  })

  it('is anything at all on an instance without a mail server', async () => {
    const built = await Test.createTestingModule({
      imports: [ApiModule.create(database, identities, { renderer: standIn })],
    }).compile()
    const silent = built.createNestApplication()

    await silent.init()

    try {
      const id = await issuedInvoice(await customer(person))
      const refused = await request(silent.getHttpServer())
        .post(`/documents/${id}/mail`)
        .set('x-test-identity', office())
        .send({})
        .expect(503)

      expect((refused.body as { message: string }).message).toContain('verschickt keine E-Mails')
    } finally {
      await silent.close()
    }
  })

  it('is refused for a business that has set up no mail server, before anything is written', async () => {
    const id = await issuedInvoice(await customer(person, south), south)

    await admin.query('delete from mail_settings where tenant_id = $1', [south.id])

    try {
      const refused = await sending(id, {}, office(south)).expect(409)

      expect((refused.body as { message: string }).message).toContain(
        'kein Mailserver eingerichtet',
      )
      expect(await messagesOf(id, office(south))).toEqual([])
    } finally {
      await aMailServer(admin, south.id, { from: 'buero@sued.example.de' })
    }
  })
})
