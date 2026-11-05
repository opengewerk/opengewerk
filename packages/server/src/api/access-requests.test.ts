import { createHash } from 'node:crypto'
import { crc32 } from 'node:zlib'

import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { addMonths, berlinClock, type TenantId } from '@opengewerk/domain'
import {
  Database,
  type FileStorage,
  newId,
  type PrintJob,
  type Renderer,
  RendererUnavailableError,
} from '@opengewerk/platform-server'
import { sql } from 'drizzle-orm'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { applicationDatabaseUrl, connect, resetToMigrated } from '../database/test-database.js'
import { runDeadlinesOf } from '../deadlines/engine.js'
import { ApiModule } from './api.module.js'
import { binary } from './test-binary.js'
import { testIdentities as identities } from './test-identity.js'

/**
 * Requests for access (#318, Art. 15 and 20 DSGVO): recorded for a customer,
 * a contact, a lead or somebody of the staff, answered with one ZIP of a PDF,
 * a JSON file and the stored files, and marked answered. Only the owner, and
 * nothing out of another business or about another customer.
 */

const north = newId<'tenant'>() as TenantId
const south = newId<'tenant'>() as TenantId

let admin: Pool
let database: Database
let app: INestApplication

function person(userId: string, roles: string[], tenantId: TenantId = north) {
  return JSON.stringify({ userId, tenantId, roles })
}

const owner = person('lena', ['owner'])
const office = person('bruno', ['office'])
const southOwner = person('sven', ['owner'], south)

const today = berlinClock(new Date()).day

function http() {
  return request(app.getHttpServer())
}

function refusal(answer: { body: unknown }): string {
  return String((answer.body as { message?: string }).message)
}

/** The message of whatever a statement of the application threw, the database's included. */
async function refusedWith(work: Promise<unknown>): Promise<string> {
  try {
    await work
  } catch (error) {
    const cause = (error as { cause?: { message?: string } }).cause

    return String(cause?.message ?? (error as Error).message)
  }

  return 'went through'
}

const uuid = () => newId<'customer'>() as string

/** What the stand-in renderer was given, newest last. */
const printed: PrintJob[] = []
let rendererThere = true

const standIn: Renderer = (job) => {
  if (!rendererThere) {
    return Promise.reject(new RendererUnavailableError('Der Renderer antwortet nicht.'))
  }

  printed.push(job)

  return Promise.resolve(new TextEncoder().encode(`%PDF-1.7 Auskunft ${String(printed.length)}`))
}

/** A file store in memory; a test may put a file there or leave it out. */
const stored = new Map<string, Uint8Array>()
const store: FileStorage = {
  put: (bytes) => {
    const sha256 = createHash('sha256').update(bytes).digest('hex')

    stored.set(sha256, bytes)

    return Promise.resolve({ sha256, sizeBytes: bytes.length })
  },
  get: (sha256) => {
    const bytes = stored.get(sha256)

    return bytes === undefined ? Promise.reject(new Error('missing')) : Promise.resolve(bytes)
  },
}

/** The entries of a ZIP by name, each checked against its checksum. */
function unzip(bytes: Buffer): Map<string, Buffer> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const end = bytes.length - 22

  expect(view.getUint32(end, true)).toBe(0x06054b50)

  const count = view.getUint16(end + 10, true)
  let at = view.getUint32(end + 16, true)
  const entries = new Map<string, Buffer>()

  for (let index = 0; index < count; index += 1) {
    expect(view.getUint32(at, true)).toBe(0x02014b50)
    expect(view.getUint16(at + 8, true) & 0x0800).toBe(0x0800)

    const checksum = view.getUint32(at + 16, true)
    const size = view.getUint32(at + 24, true)
    const nameLength = view.getUint16(at + 28, true)
    const offset = view.getUint32(at + 42, true)
    const name = bytes.subarray(at + 46, at + 46 + nameLength).toString('utf8')
    const localName = view.getUint16(offset + 26, true)
    const data = bytes.subarray(offset + 30 + localName, offset + 30 + localName + size)

    expect(view.getUint32(offset, true)).toBe(0x04034b50)
    expect(crc32(data)).toBe(checksum)
    entries.set(name, data)
    at += 46 + nameLength
  }

  return entries
}

interface Customer {
  readonly family: string
  readonly customer: string
  readonly contact: string
  readonly job: string
  readonly photo: string
}

/**
 * A customer with a site, a job, an offer, a photo, a contact, a call, a note
 * of Tom and a mail: Martina Seidel, the family name in each. Beside it in
 * the same business another customer, Gerd Nachbar, at whose job Tom wrote a
 * note as well, and in the business of the south a customer of the same name.
 */
async function seidel(): Promise<Customer> {
  const family = `Seidel${newId<'customer'>().slice(-6)}`
  const neighbour = `Nachbar${newId<'customer'>().slice(-6)}`
  const customer = uuid()
  const other = uuid()
  const site = uuid()
  const job = uuid()
  const otherJob = uuid()
  const contact = uuid()
  const attachment = uuid()
  const photoBytes = new TextEncoder().encode(`Foto vom Haus ${family}`)
  const photo = createHash('sha256').update(photoBytes).digest('hex')

  stored.set(photo, photoBytes)

  await admin.query(
    `begin;
     set local app.user_id = 'bruno';
     insert into customers (id, tenant_id, kind, name, email, street, house_number, postal_code, city)
       values ('${customer}', '${north}', 'private', 'Martina ${family}', 'martina@${family.toLowerCase()}.example',
               'Lindenweg', '4', '68535', 'Edingen'),
              ('${other}', '${north}', 'private', 'Gerd ${neighbour}', 'gerd@${neighbour.toLowerCase()}.example',
               'Ring', '3', '68526', 'Ladenburg');
     insert into customers (tenant_id, kind, name) values ('${south}', 'private', 'Martina ${family}');
     insert into sites (id, tenant_id, customer_id, designation, street, house_number, postal_code, city)
       values ('${site}', '${north}', '${customer}', 'Wohnhaus ${family}', 'Lindenweg', '4', '68535', 'Edingen');
     insert into jobs (id, tenant_id, customer_id, site_id, kind, status, designation)
       values ('${job}', '${north}', '${customer}', '${site}', 'project', 'active', 'Wallbox ${family}'),
              ('${otherJob}', '${north}', '${other}', null, 'project', 'active', 'Zähler ${neighbour}');
     insert into documents (tenant_id, customer_id, site_id, job_id, kind, document_date, subject)
       values ('${north}', '${customer}', '${site}', '${job}', 'quote', '2026-10-28', 'Angebot ${family}');
     insert into contacts (id, tenant_id, customer_id, given_name, family_name, email)
       values ('${contact}', '${north}', '${customer}', 'Paul', '${family}', 'paul@${family.toLowerCase()}.example');
     insert into communications (tenant_id, customer_id, kind, direction, counterpart, text, happened_at, created_by)
       values ('${north}', '${customer}', 'call', 'incoming', 'Paul ${family}', 'Rückruf zur Wallbox ${family}', '2026-11-02 10:00+01', 'bruno'),
              ('${north}', '${customer}', 'note', null, null, 'Zaun bei ${family} beachten', '2026-11-02 11:00+01', 'bruno');
     set local app.user_id = 'tom';
     insert into job_notes (tenant_id, job_id, text, written_at, created_by)
       values ('${north}', '${job}', 'Garage ${family} offen', '2026-11-03 08:00+01', 'tom'),
              ('${north}', '${otherJob}', 'Keller ${neighbour} feucht', '2026-11-03 09:00+01', 'tom');
     insert into files (tenant_id, sha256, size_bytes, media_type) values ('${north}', '${photo}', ${String(photoBytes.length)}, 'image/jpeg');
     insert into attachments (id, tenant_id, site_id, title) values ('${attachment}', '${north}', '${site}', 'Haus ${family}');
     insert into attachment_versions (tenant_id, attachment_id, sha256, file_name, media_type, size_bytes, created_by)
       values ('${north}', '${attachment}', '${photo}', 'haus-${family.toLowerCase()}.jpg', 'image/jpeg', ${String(photoBytes.length)}, 'tom');
     set local app.user_id = 'bruno';
     -- A task of the neighbour that names the job of the Seidels: hung on their job, his all the same.
     insert into tasks (tenant_id, title, due_on, assignee_user_id, customer_id, job_id)
       values ('${north}', 'Rückruf ${neighbour}', '2026-11-10', 'bruno', '${other}', '${job}');
     insert into mail_outbox (tenant_id, kind, cause, sender_name, recipient_address, recipient_name, subject, body, job_id)
       values ('${north}', 'job_received', 'job:${job}', 'Elektro Nord GmbH', 'martina@${family.toLowerCase()}.example',
               'Martina ${family}', 'Auftrag ${family}', 'Wir haben Ihren Auftrag', '${job}'),
              ('${north}', 'job_received', 'job:${otherJob}', 'Elektro Nord GmbH', 'gerd@${neighbour.toLowerCase()}.example',
               'Gerd ${neighbour}', 'Auftrag ${neighbour}', 'Wir haben Ihren Auftrag', '${otherJob}');
     commit;`,
  )

  return { family, customer, contact, job, photo }
}

/** Tom's file with his times, an absence, a push subscription and a calendar feed. */
/** The hash of the token of Tom's calendar feed, which no answer gives out. */
const calendarHash = createHash('sha256').update('kalender-tom').digest('hex')

async function tomsFile(): Promise<string> {
  const id = uuid()

  await admin.query(
    `begin;
     set local app.user_id = 'lena';
     insert into people (id, tenant_id, name, user_id, joined_on) values ('${id}', '${north}', 'Tom Technik', 'tom', '2024-01-01');
     set local app.user_id = 'tom';
     insert into time_entries (tenant_id, user_id, kind, started_at, ended_at, note, start_latitude_micro, start_longitude_micro)
       values ('${north}', 'tom', 'work', '2026-11-03 07:00+01', '2026-11-03 15:30+01', 'Werkstatt', 49450000, 8600000);
     set local app.user_id = 'lena';
     insert into absences (tenant_id, person_id, kind, state, first_day, last_day, note)
       values ('${north}', '${id}', 'vacation', 'approved', '2026-08-01', '2026-08-14', 'Ostsee');
     insert into push_subscriptions (tenant_id, user_id, session_id, entry, label, endpoint, p256dh, auth)
       values ('${north}', 'tom', 'session-tom', 'site', 'Telefon von Tom', 'https://push.example/geheim-tom', 'sealed-key-tom', 'auth-tom');
     insert into calendar_feeds (tenant_id, user_id, token_hash) values ('${north}', 'tom', '${calendarHash}');
     commit;`,
  )

  return id
}

function record(subject: string, subjectId: string, who = owner, receivedOn = today) {
  return http()
    .post('/privacy/access-requests')
    .set('x-test-identity', who)
    .send({ subject, subjectId, receivedOn, channel: 'email' })
}

function draw(id: string, who = owner) {
  return http()
    .post(`/privacy/access-requests/${id}/report`)
    .set('x-test-identity', who)
    .buffer(true)
    .parse(binary)
}

/** The answer to a request, unpacked: its entries, the JSON and what the PDF was made of. */
async function answerOf(id: string) {
  const answer = await draw(id).expect(201)

  expect(answer.headers['content-type']).toBe('application/zip')

  const entries = unzip(answer.body as Buffer)
  const json = JSON.parse((entries.get('daten.json') as Buffer).toString('utf8')) as {
    subject: { kind: string; name: string }
    tables: Record<string, Record<string, unknown>[]>
    actions: { table: string; column: string }[]
    accounts: { id: string; name: string | null }[]
    account?: { name: string; email: string } | null
  }
  const html = (printed.at(-1) as PrintJob).html

  return { entries, json, html, text: (entries.get('daten.json') as Buffer).toString('utf8') }
}

beforeAll(async () => {
  admin = await connect()
  await resetToMigrated()
  await admin.query('insert into tenants (id, name) values ($1, $2), ($3, $4)', [
    north,
    'Elektro Nord GmbH',
    south,
    'Elektro Süd GmbH',
  ])
  await admin.query(
    `insert into tenant_roles (tenant_id, key, label, rights, leads, second_factor) values
       ($1, 'owner', 'Inhaber', '{}', true, false), ($1, 'office', 'Büro', '{}', false, false),
       ($1, 'technician', 'Monteur', '{}', false, false), ($2, 'owner', 'Inhaber', '{}', true, false)`,
    [north, south],
  )
  await admin.query(
    `insert into auth_users (id, name, email) values
       ('lena', 'Lena Leitung', 'lena@example.de'), ('bruno', 'Bruno Büro', 'bruno@example.de'),
       ('tom', 'Tom Technik', 'tom@example.de'), ('sven', 'Sven Süd', 'sven@example.de')`,
  )
  await admin.query(
    `insert into memberships (tenant_id, user_id, roles) values
       ($1, 'lena', '{owner}'), ($1, 'bruno', '{office}'), ($1, 'tom', '{technician}'),
       ($2, 'sven', '{owner}')`,
    [north, south],
  )

  database = Database.connect(applicationDatabaseUrl())

  const built = await Test.createTestingModule({
    imports: [ApiModule.create(database, identities, { files: store, renderer: standIn })],
  }).compile()

  app = built.createNestApplication()
  await app.init()
})

beforeEach(async () => {
  rendererThere = true
  await admin.query(
    `begin; set local session_replication_role = replica;
     delete from access_requests; delete from deadlines; delete from tasks; delete from mail_outbox;
     delete from job_notes; delete from communications; delete from attachment_versions; delete from attachments;
     delete from files; delete from documents; delete from jobs; delete from contacts; delete from sites;
     delete from prospects; delete from customers; delete from time_entries; delete from absences;
     delete from push_subscriptions; delete from calendar_feeds; delete from people;
     commit;`,
  )
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
})

describe('a request for access', () => {
  it('is recorded with its answer due a month after it came in, and listed', async () => {
    const { family, customer } = await seidel()
    const recorded = await record('customer', customer).expect(201)

    expect(recorded.body).toMatchObject({
      name: `Martina ${family}`,
      detail: 'Kunde, Lindenweg 4, 68535 Edingen',
      request: {
        subject: 'customer',
        subjectId: customer,
        status: 'open',
        answerDueOn: addMonths(today, 1),
      },
    })

    const listed = await http()
      .get('/privacy/access-requests')
      .set('x-test-identity', owner)
      .expect(200)

    expect(listed.body.requests).toHaveLength(1)

    const { rows } = await admin.query<{ created_by: string }>(
      'select created_by from access_requests',
    )

    expect(rows).toEqual([{ created_by: 'lena' }])
  })

  it('runs once per person at a time', async () => {
    const { customer } = await seidel()

    await record('customer', customer).expect(201)

    expect(refusal(await record('customer', customer).expect(409))).toBe(
      'Für diese Person läuft schon eine Auskunftsanfrage.',
    )
  })

  it('is refused for nobody, a day to come or a person of another business', async () => {
    const { customer } = await seidel()
    const { rows } = await admin.query<{ id: string }>(
      'select id from customers where tenant_id = $1',
      [south],
    )

    expect(refusal(await record('nobody', customer).expect(422))).toBe(
      'Wer die Auskunft möchte, ist niemand aus der Liste.',
    )
    expect(
      refusal(await record('customer', customer, owner, addMonths(today, 1)).expect(422)),
    ).toBe('Eine Anfrage geht nicht in der Zukunft ein.')
    await record('customer', (rows[0] as { id: string }).id).expect(404)
  })

  it('is for whoever may give access, the owner, and for nobody else', async () => {
    const { customer } = await seidel()
    const recorded = await record('customer', customer).expect(201)
    const id = recorded.body.request.id as string

    await http().get('/privacy/access-requests').set('x-test-identity', office).expect(403)
    await http()
      .get('/privacy/access-requests/subjects?q=Sei')
      .set('x-test-identity', office)
      .expect(403)
    await record('customer', customer, office).expect(403)
    await draw(id, office).expect(403)
    await http()
      .post(`/privacy/access-requests/${id}/answer`)
      .set('x-test-identity', office)
      .expect(403)

    // Another business does not see it at all.
    await draw(id, southOwner).expect(404)
  })

  it('finds customers, contacts, leads and the staff by name, and nothing deleted', async () => {
    const { family } = await seidel()

    await tomsFile()
    await admin.query(
      `insert into prospects (tenant_id, name, source, last_contact_on) values ($1, $2, 'website', '2026-09-14')`,
      [north, `Sabine ${family}`],
    )
    await admin.query(
      `begin; set local session_replication_role = replica;
       insert into customers (tenant_id, kind, name, deleted_at) values ('${north}', 'private', 'Weg ${family}', now());
       commit;`,
    )

    const found = await http()
      .get(`/privacy/access-requests/subjects?q=${family}`)
      .set('x-test-identity', owner)
      .expect(200)

    expect(
      (found.body.hits as { subject: string; name: string; detail: string }[]).map(
        (hit) => `${hit.subject}: ${hit.name}, ${hit.detail}`,
      ),
    ).toEqual([
      `customer: Martina ${family}, Kunde, Lindenweg 4, 68535 Edingen`,
      `contact: Paul ${family}, Ansprechpartner bei Martina ${family}`,
      `prospect: Sabine ${family}, Lead, letzter Kontakt 14.09.2026`,
    ])

    const tom = await http()
      .get('/privacy/access-requests/subjects?q=Tom Tech')
      .set('x-test-identity', owner)
      .expect(200)

    expect(tom.body.hits).toMatchObject([
      { subject: 'person', name: 'Tom Technik', detail: 'Mitarbeiter' },
    ])
  })
})

describe('the answer to a customer', () => {
  it('holds everything that hangs on the customer, with the names of the staff', async () => {
    const { family, customer, photo } = await seidel()
    const id = (await record('customer', customer).expect(201)).body.request.id as string
    const { entries, json, html } = await answerOf(id)

    expect([...entries.keys()]).toEqual([
      'Auskunft.pdf',
      'daten.json',
      `dateien/haus-${family.toLowerCase()}.jpg`,
    ])
    expect(
      (entries.get(`dateien/haus-${family.toLowerCase()}.jpg`) as Buffer).toString('utf8'),
    ).toBe(`Foto vom Haus ${family}`)
    expect(
      createHash('sha256')
        .update(entries.get(`dateien/haus-${family.toLowerCase()}.jpg`) as Buffer)
        .digest('hex'),
    ).toBe(photo)
    expect(Object.keys(json.tables).sort()).toEqual(
      [
        'access_requests',
        'attachment_versions',
        'attachments',
        'communications',
        'customers',
        'documents',
        'job_notes',
        'jobs',
        'mail_outbox',
        'sites',
      ].sort(),
    )
    expect(json.subject).toEqual({ kind: 'customer', id: customer, name: `Martina ${family}` })
    expect(json.accounts).toEqual(
      expect.arrayContaining([
        { id: 'tom', name: 'Tom Technik' },
        { id: 'bruno', name: 'Bruno Büro' },
      ]),
    )
    expect(html).toContain(`Martina ${family}`)
    expect(html).toContain(`Garage ${family} offen`)
    expect(html).toContain('Tom Technik')
    expect(html).toContain('Zwecke und Rechtsgrundlagen')
    expect(html).toContain('Art. 6 Abs. 1 Buchst. b DSGVO')
  })

  it('holds nothing of another customer, and nothing of another business', async () => {
    const { customer } = await seidel()
    const id = (await record('customer', customer).expect(201)).body.request.id as string
    const { text, html } = await answerOf(id)
    const { rows } = await admin.query<{ id: string; name: string; tenant_id: string }>(
      `select id, name, tenant_id from customers where id <> $1`,
      [customer],
    )

    for (const row of rows) {
      expect(text).not.toContain(row.id)
      expect(html).not.toContain(row.id)
    }

    expect(text).not.toMatch(/Nachbar/)
    expect(html).not.toMatch(/Nachbar/)
    expect(text).not.toContain(south)
    // Its contact is a person of its own, with an answer of its own.
    expect(text).not.toContain('paul@')
  })

  it('stands in the change log with who drew it, and comes again on request', async () => {
    const { customer } = await seidel()
    const id = (await record('customer', customer).expect(201)).body.request.id as string

    await answerOf(id)

    const { rows } = await admin.query<{ produced_by: string; reason: string; user_id: string }>(
      `select r.produced_by, e.reason, e.user_id from access_requests r
         join audit_entries e on e.record_id = r.id and e.field = 'produced_at'
        where r.id = $1`,
      [id],
    )

    expect(rows).toEqual([
      { produced_by: 'lena', reason: 'privacy.access_report', user_id: 'lena' },
    ])
    await draw(id).expect(201)
  })

  it('leaves no trace when the PDF cannot be made', async () => {
    const { customer } = await seidel()
    const id = (await record('customer', customer).expect(201)).body.request.id as string

    rendererThere = false
    await draw(id).expect(503)

    const { rows } = await admin.query('select produced_at from access_requests where id = $1', [
      id,
    ])

    expect(rows).toEqual([{ produced_at: null }])
  })

  it('names a file the store lost instead of failing', async () => {
    const { family, customer, photo } = await seidel()

    stored.delete(photo)

    const id = (await record('customer', customer).expect(201)).body.request.id as string
    const { entries } = await answerOf(id)
    const missing = entries.get(`dateien/haus-${family.toLowerCase()}.jpg (fehlt).txt`)

    expect(missing?.toString('utf8')).toContain(photo)
  })
})

describe('the answer to the others', () => {
  it('gives somebody of the staff their own rows, only that and when of the records of others, and no key', async () => {
    const { family } = await seidel()
    const file = await tomsFile()
    const id = (await record('person', file).expect(201)).body.request.id as string
    const { json, text, html } = await answerOf(id)

    expect(Object.keys(json.tables).sort()).toEqual(
      [
        'absences',
        'access_requests',
        'calendar_feeds',
        'memberships',
        'people',
        'push_subscriptions',
        'time_entries',
      ].sort(),
    )
    expect(json.tables['time_entries']).toMatchObject([
      { note: 'Werkstatt', start_latitude_micro: 49450000, start_longitude_micro: 8600000 },
    ])
    // The change log of earlier tests stays, as it does in operation; these are this one's.
    const created = (table: string) =>
      json.actions.filter((action) => action.table === table && action.column === 'created_by')

    expect(created('job_notes')).toHaveLength(2)
    expect(created('attachment_versions')).toHaveLength(1)
    expect(json.account).toEqual({ name: 'Tom Technik', email: 'tom@example.de' })

    // What Tom wrote at the jobs of customers is theirs.
    expect(text).not.toContain(family)
    expect(html).not.toContain(family)
    expect(text).not.toMatch(/Nachbar/)

    // The keys of his phone and his calendar stay where they are.
    for (const secret of [
      'geheim-tom',
      'sealed-key-tom',
      'auth-tom',
      'session-tom',
      calendarHash,
    ]) {
      expect(text).not.toContain(secret)
      expect(html).not.toContain(secret)
    }
  })

  it('gives a contact its row, the mails to it and the calls that name it', async () => {
    const { family, contact } = await seidel()

    await admin.query(
      `insert into mail_outbox (tenant_id, kind, cause, sender_name, recipient_address, subject, body)
         values ($1, 'customer_reminder', 'reminder', 'Elektro Nord GmbH', $2, 'Wartung', 'Text')`,
      [north, `Paul@${family.toLowerCase()}.example`],
    )

    const id = (await record('contact', contact).expect(201)).body.request.id as string
    const { json } = await answerOf(id)

    expect(Object.keys(json.tables).sort()).toEqual(
      ['access_requests', 'communications', 'contacts', 'mail_outbox'].sort(),
    )
    expect(json.tables['communications']).toMatchObject([{ counterpart: `Paul ${family}` }])
    expect(json.tables['mail_outbox']).toHaveLength(1)
  })

  it('gives a lead its row, and keeps the request without a name once the lead is deleted', async () => {
    const { family } = await seidel()
    const { rows } = await admin.query<{ id: string }>(
      `insert into prospects (tenant_id, name, email, source, last_contact_on)
         values ($1, $2, $3, 'website', '2026-09-14') returning id`,
      [north, `Sabine ${family}`, `sabine@${family.toLowerCase()}.example`],
    )
    const lead = (rows[0] as { id: string }).id
    const id = (await record('prospect', lead).expect(201)).body.request.id as string
    const { json } = await answerOf(id)

    expect(Object.keys(json.tables).sort()).toEqual(['access_requests', 'prospects'])

    await http()
      .post(`/privacy/access-requests/${id}/answer`)
      .set('x-test-identity', owner)
      .expect(201)
    await admin.query(
      `begin; set local session_replication_role = origin; delete from prospects where id = '${lead}'; commit;`,
    )

    const listed = await http()
      .get('/privacy/access-requests')
      .set('x-test-identity', owner)
      .expect(200)

    expect(listed.body.requests).toMatchObject([
      {
        name: null,
        detail: 'Gelöscht nach dem Löschkonzept',
        request: { subject: 'prospect', subjectId: null, status: 'answered' },
      },
    ])
    expect(
      refusal(
        await http()
          .post(`/privacy/access-requests/${id}/report`)
          .set('x-test-identity', owner)
          .expect(409),
      ),
    ).toBe('Die Person ist nach dem Löschkonzept gelöscht; zu ihr gibt es keine Daten mehr.')
  })
})

describe('answering', () => {
  it('needs the answer drawn first, happens once, and lets the deadline drop', async () => {
    const { customer } = await seidel()
    const id = (await record('customer', customer).expect(201)).body.request.id as string
    const answer = () =>
      http().post(`/privacy/access-requests/${id}/answer`).set('x-test-identity', owner)

    await runDeadlinesOf({ database }, north, new Date())

    const { rows: open } = await admin.query<{
      source_label: string
      due_on: string
      customer_id: string | null
    }>(
      `select source_label, due_on::text, customer_id from deadlines where kind = 'privacy.access_request' and status = 'open'`,
    )

    expect(open).toEqual([
      {
        source_label: `Auskunftsanfrage vom ${today.slice(8, 10)}.${today.slice(5, 7)}.${today.slice(0, 4)}`,
        due_on: addMonths(today, 1),
        customer_id: null,
      },
    ])
    expect(refusal(await answer().expect(409))).toBe(
      'Beantwortet ist eine Anfrage erst, wenn die Auskunft erstellt ist.',
    )

    await draw(id).expect(201)
    expect((await answer().expect(201)).body.request).toMatchObject({ status: 'answered' })
    expect(refusal(await answer().expect(409))).toBe(
      'Diese Auskunftsanfrage ist schon beantwortet.',
    )

    await runDeadlinesOf({ database }, north, new Date())

    const { rows: after } = await admin.query(
      `select 1 from deadlines where kind = 'privacy.access_request' and status = 'open'`,
    )

    expect(after).toEqual([])
  })

  it('shows its deadline only to whoever may give access', async () => {
    const { customer } = await seidel()

    await record('customer', customer).expect(201)
    await runDeadlinesOf({ database }, north, new Date())

    const kinds = async (who: string) =>
      (
        (await http().get('/deadlines?status=all').set('x-test-identity', who).expect(200))
          .body as {
          rows: { kind: string }[]
        }
      ).rows.map((row) => row.kind)

    expect(await kinds(owner)).toContain('privacy.access_request')
    expect(await kinds(office)).not.toContain('privacy.access_request')
  })
})

describe('the table', () => {
  it('takes a contact only of its own business', async () => {
    const { contact } = await seidel()

    expect(
      await refusedWith(
        admin.query(
          `insert into access_requests (tenant_id, subject, contact_id, received_on, channel, answer_due_on, created_by)
           values ('${south}', 'contact', '${contact}', '2026-11-02', 'email', '2026-12-02', 'sven')`,
        ),
      ),
    ).toBe('Der Ansprechpartner gehört nicht zu diesem Betrieb.')
  })

  it('changes a request only in when its answer was drawn and answered, and who drew it follows from drawing', async () => {
    const { customer } = await seidel()
    const id = (await record('customer', customer).expect(201)).body.request.id as string
    const as = (statement: string) =>
      database.forTenant({ tenantId: north, userId: 'lena' }, (tx) =>
        tx.execute(sql.raw(statement)),
      )

    expect(
      await refusedWith(as(`update access_requests set produced_by = 'tom' where id = '${id}'`)),
    ).toBe('Wer eine Auskunft erstellt hat, folgt aus dem Erstellen.')
    expect(
      await refusedWith(
        as(
          `update access_requests set status = 'answered', answered_at = now() where id = '${id}'`,
        ),
      ),
    ).toMatch(/access_requests_stand/)
    await as(`update access_requests set produced_at = now() where id = '${id}'`)
    await as(
      `update access_requests set status = 'answered', answered_at = now() where id = '${id}'`,
    )
    expect(
      await refusedWith(
        as(`update access_requests set status = 'open', answered_at = null where id = '${id}'`),
      ),
    ).toBe('Eine beantwortete Auskunftsanfrage bleibt beantwortet.')
    expect(
      await refusedWith(as(`update access_requests set produced_at = null where id = '${id}'`)),
    ).toBe('Dass eine Auskunft erstellt wurde, bleibt stehen.')
    expect(await refusedWith(as(`delete from access_requests where id = '${id}'`))).toMatch(
      /permission denied/,
    )

    const { rows } = await admin.query('select produced_by from access_requests where id = $1', [
      id,
    ])

    expect(rows).toEqual([{ produced_by: 'lena' }])
  })
})
