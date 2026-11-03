import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { berlinClock, instructionsSentence, type TenantId } from '@opengewerk/domain'
import {
  Database,
  FileStore,
  type MailTransport,
  newId,
  type OutgoingMail,
  type Renderer,
  UploadLimits,
} from '@opengewerk/platform-server'
import { aMailServer, testKey } from '@opengewerk/platform-server/testing'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { applicationDatabaseUrl, connect, resetToMigrated } from '../database/test-database.js'
import {
  documentAttachments,
  withAppointmentInvitation,
  withCallInstructions,
} from '../mail/attachments.js'
import { runMailCycle } from '../mail/worker.js'
import { ApiModule } from './api.module.js'
import { DocumentFiles } from './document-files.js'
import { as, testIdentities as identities } from './test-identity.js'
import { invoiceable, readyToInvoice } from './test-invoice.js'

/**
 * The confirmations to a customer (#315): an appointment of their job
 * arranged, moved and cancelled, each with its calendar file, and a service
 * call the office took, with the instructions for a consumer. Each switched
 * on by the business, each with the business's text for its occasion or the
 * shipped one.
 */

const north = { id: newId<'tenant'>() as TenantId, name: 'Elektro Nord GmbH' }

let admin: Pool
let database: Database
let app: INestApplication
let files: DocumentFiles
let storageRoot = ''

const standIn: Renderer = () => Promise.resolve(new TextEncoder().encode('%PDF-1.7'))
const office = () => as(north.id, 'office')
const owner = () => as(north.id, 'owner')

/** A Friday and the Monday after, far enough ahead to stay to come. */
const friday = { startsAt: '2031-11-07T06:00:00.000Z', endsAt: '2031-11-07T14:00:00.000Z' }
const monday = { startsAt: '2031-11-10T06:00:00.000Z', endsAt: '2031-11-10T14:00:00.000Z' }

function http() {
  return request(app.getHttpServer())
}

async function send(
  method: 'post' | 'put' | 'delete' | 'get',
  path: string,
  body: Record<string, unknown> | null = null,
  who = office(),
  status = method === 'post' ? 201 : method === 'delete' ? 204 : 200,
) {
  const call = http()[method](path).set('x-test-identity', who)
  const answer = await (body ? call.send(body) : call).expect(status)

  return answer.body as Record<string, unknown>
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

async function cycle() {
  const { sent, transport } = recording()

  await runMailCycle({
    database,
    connect: () => transport,
    key: testKey,
    origin: 'https://opengewerk.example.de',
    attachments: withAppointmentInvitation(
      database,
      withCallInstructions(files, database, documentAttachments(files)),
    ),
    now: () => new Date(Date.now() + 1_000),
  })

  return sent
}

function calendarOf(mail: OutgoingMail | undefined) {
  const file = mail?.attachments?.find((attachment) => attachment.filename === 'Termin.ics')

  return file ? new TextDecoder().decode(file.content).replaceAll('\r\n ', '') : null
}

async function switchOn(key: string) {
  await send(
    'post',
    '/settings/parameters',
    { key, from: berlinClock(new Date()).day, value: 1 },
    owner(),
  )
}

async function aCustomer(fields: Record<string, unknown> = {}) {
  return String(
    (
      await send('post', '/customers', {
        kind: 'private',
        name: 'Familie Arslan',
        email: 'arslan@example.de',
        ...invoiceable,
        ...fields,
      })
    )['id'],
  )
}

async function aJob(customerId: string, kind = 'project') {
  return String(
    (await send('post', '/jobs', { customerId, kind, designation: 'Heizung ohne Strom' }))['id'],
  )
}

async function anAppointment(jobId: string) {
  const view = await send('post', '/appointments', {
    jobId,
    ...friday,
    note: null,
    rrule: null,
    exdates: [],
    userIds: ['jonas'],
  })

  return (view['appointment'] as { id: string; version: number }) ?? { id: '', version: 0 }
}

beforeAll(async () => {
  admin = await connect()
  await resetToMigrated()
  await admin.query('insert into tenants (id, name) values ($1, $2)', [north.id, north.name])
  await readyToInvoice(admin, north.id)
  await aMailServer(admin, north.id, { from: 'info@nord.example.de' })
  // Whoever goes to the appointments.
  await admin.query(
    "insert into auth_users (id, name, email) values ('jonas', 'Jonas Brandt', 'jonas@nord.example.de')",
  )
  await admin.query(
    "insert into memberships (tenant_id, user_id, roles) values ($1, 'jonas', '{technician}')",
    [north.id],
  )

  storageRoot = mkdtempSync(join(tmpdir(), 'opengewerk-confirmations-'))
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
  // deleted: the rows tell the job what was confirmed already.
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

describe('the confirmations while switched off', () => {
  it('send nothing, about an appointment nor about a service call', async () => {
    const customer = await aCustomer()
    const made = [await aJob(customer), await aJob(customer, 'service')]

    await anAppointment(made[0] ?? '')

    expect(await cycle()).toEqual([])

    // A switch holds from a day on: switched on today, it would confirm these
    // too, which the tests below do not count on.
    for (const job of made) {
      await send('delete', `/jobs/${job}`, null, office(), 200)
    }
  })
})

describe('a confirmation of an appointment (#315)', () => {
  beforeAll(async () => {
    await switchOn('appointment.mail_to_customer')
  })

  it('goes out when arranged, moved and cancelled, each with its calendar file', async () => {
    const job = await aJob(await aCustomer())
    const made = await anAppointment(job)
    const arranged = await cycle()

    expect(arranged.map((mail) => [mail.to, mail.subject])).toEqual([
      [
        { name: 'Familie Arslan', address: 'arslan@example.de' },
        'Ihr Termin am Freitag, 07.11.2031, 07:00 bis 15:00 Uhr',
      ],
    ])
    expect(calendarOf(arranged[0])).toContain('METHOD:REQUEST\r\n')
    expect(calendarOf(arranged[0])).toContain('SEQUENCE:0\r\n')
    expect(calendarOf(arranged[0])).toContain(`UID:${made.id}@opengewerk\r\n`)

    const moved = (await send('put', `/appointments/${made.id}`, {
      jobId: job,
      ...monday,
      note: null,
      rrule: null,
      exdates: [],
      userIds: ['jonas'],
      version: made.version,
    })) as { appointment: { version: number } }
    const afterMove = await cycle()

    expect(afterMove.map((mail) => mail.subject)).toEqual([
      'Ihr Termin ist verschoben: Montag, 10.11.2031, 07:00 bis 15:00 Uhr',
    ])
    expect(calendarOf(afterMove[0])).toContain('SEQUENCE:1\r\n')

    await send('delete', `/appointments/${made.id}?version=${String(moved.appointment.version)}`)

    const afterCancel = await cycle()

    expect(afterCancel.map((mail) => mail.subject)).toEqual([
      'Ihr Termin am Montag, 10.11.2031, 07:00 bis 15:00 Uhr entfällt',
    ])
    expect(calendarOf(afterCancel[0])).toContain('METHOD:CANCEL\r\n')
    expect(calendarOf(afterCancel[0])).toContain('STATUS:CANCELLED\r\n')
    // A version after the move, so that the calendar takes the cancellation.
    expect(calendarOf(afterCancel[0])).toContain('SEQUENCE:2\r\n')
    // And nothing twice.
    expect(await cycle()).toEqual([])
  })

  it('goes to nobody for a customer without an address, and not about one that is over', async () => {
    await anAppointment(await aJob(await aCustomer({ email: null })))

    // Nor a cancellation of an appointment the customer never heard of.
    const untold = await anAppointment(await aJob(await aCustomer()))

    await send('delete', `/appointments/${untold.id}?version=${String(untold.version)}`)

    const job = await aJob(await aCustomer())

    await send('post', '/appointments', {
      jobId: job,
      startsAt: '2026-01-05T06:00:00.000Z',
      endsAt: '2026-01-05T08:00:00.000Z',
      note: null,
      rrule: null,
      exdates: [],
      userIds: ['jonas'],
    })

    expect(await cycle()).toEqual([])
  })

  it('says what the business wrote for the occasion, with its placeholders filled in', async () => {
    await send('post', '/documents/text-snippets', {
      purpose: 'mail',
      mailOccasion: 'appointment_arranged',
      title: 'Termin für {kunde}',
      text: 'Hallo {kunde},\n{auftrag} am {termin}.\n{benutzer}',
    })

    await anAppointment(await aJob(await aCustomer({ name: 'Familie Berg' })))

    const [mail] = await cycle()

    expect(mail?.subject).toBe('Termin für Familie Berg')
    expect(mail?.text.split('\n\n-- \n')[0]).toMatch(
      /^Hallo Familie Berg,\nAU-\d{4}-\d{4} Heizung ohne Strom am Freitag, 07\.11\.2031, 07:00 bis 15:00 Uhr\.$/,
    )
  })
})

describe('a confirmation of a service call (#315)', () => {
  beforeAll(async () => {
    await switchOn('service_call.mail_on_receipt')
  })

  it('goes out once, with the instructions for a consumer', async () => {
    const job = await aJob(await aCustomer(), 'service')
    const [mail, ...more] = await cycle()

    expect(more).toEqual([])
    expect(mail?.subject).toMatch(/^Ihr Auftrag AU-\d{4}-\d{4} Heizung ohne Strom$/)
    expect(mail?.text).toContain(instructionsSentence)
    expect(mail?.attachments?.map((attachment) => attachment.filename)).toEqual(['Belehrungen.pdf'])
    expect(await cycle()).toEqual([])

    // The card of the instructions at the job lists it.
    const view = await send('get', `/jobs/${job}/instructions`)

    expect((view['mails'] as unknown[]).length).toBe(1)
  })

  it('goes without them to a business, and a project gets none', async () => {
    await aJob(
      await aCustomer({ kind: 'business', isBusiness: true, name: 'Bäckerei Lutz' }),
      'service',
    )
    await aJob(await aCustomer(), 'project')

    const sent = await cycle()

    expect(sent).toHaveLength(1)
    expect(sent[0]?.text).not.toContain(instructionsSentence)
    expect(sent[0]?.attachments ?? []).toEqual([])
  })

  it('leaves the card of the instructions to them: a confirmation of an appointment is none', async () => {
    const job = await aJob(await aCustomer(), 'service')

    await anAppointment(job)
    expect(await cycle()).toHaveLength(2)

    const view = await send('get', `/jobs/${job}/instructions`)

    expect((view['mails'] as unknown[]).length).toBe(1)
  })
})

describe('a snippet for mails', () => {
  it('names its occasion, and there is one for each', async () => {
    const without = await send(
      'post',
      '/documents/text-snippets',
      { purpose: 'mail', title: 'Ihr Auftrag', text: 'Danke.' },
      office(),
      400,
    )

    expect(without['message']).toBe('Ein Textbaustein für E-Mails braucht seinen Anlass.')

    await send('post', '/documents/text-snippets', {
      purpose: 'mail',
      mailOccasion: 'job_received',
      title: 'Ihr Auftrag {auftrag}',
      text: 'Danke.',
    })

    const second = await send(
      'post',
      '/documents/text-snippets',
      { purpose: 'mail', mailOccasion: 'job_received', title: 'Noch einer', text: 'Danke.' },
      office(),
      409,
    )

    expect(second['message']).toBe(
      'Für „Auftragseingang“ gibt es schon einen Text. Den bestehenden bearbeiten oder entfernen.',
    )
  })
})
