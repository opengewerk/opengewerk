import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import {
  type CustomerId,
  type DeadlineKind,
  deadlineRegistry,
  type InstallationId,
  type IsoDate,
  type SiteId,
  type TenantId,
} from '@opengewerk/domain'
import { Database, type ExpectedDeadline, newId } from '@opengewerk/platform-server'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { ApiModule } from '../api/api.module.js'
import { as, testIdentities as identities } from '../api/test-identity.js'
import { readyToInvoice } from '../api/test-invoice.js'
import {
  applicationDatabaseUrl,
  connect,
  resetToMigrated,
  shipRoles,
} from '../database/test-database.js'
import { type DeadlineJob, runDeadlinesOf } from '../deadlines/engine.js'
import { deadlineKinds } from '../deadlines/registry.js'
import type { DeadlineValues } from '../deadlines/sources.js'
import { callNotes } from './customer-reminder.js'

/**
 * The reminders of a due inspection to the customer (#316, decided on
 * 27.09.2026): by mail where the customer has an address, as a task to call
 * where they have none and a call is allowed, once per due day; with a
 * contract always, without one only with a consent or for a customer of the
 * business under § 7 Abs. 3 UWG, who is never called; never to a customer
 * who stopped them; and nothing before the business switches them on.
 *
 * The sources are the test's own, so that the deadlines are exactly the ones
 * each test names; the kinds and the action are the real ones.
 */

const north = newId<'tenant'>() as TenantId
const now = new Date('2037-09-24T07:00:00Z')
const dueOn = '2037-10-24' as IsoDate

let admin: Pool
let database: Database
let app: INestApplication
let site = ''
let workshop = ''
const customers: Record<string, string> = {}
const installations: Record<string, string> = {}

const inspection = deadlineKinds.kind('elektro.recurring_inspection') as DeadlineKind
const appliances = deadlineKinds.kind('elektro.appliance_inspection') as DeadlineKind

/** The deadlines each source has right now, set by each test. */
let due: {
  inspection: ExpectedDeadline<DeadlineValues>[]
  appliances: ExpectedDeadline<DeadlineValues>[]
}

function engine(): DeadlineJob {
  return {
    database,
    registry: deadlineRegistry([inspection, appliances]),
    sources: {
      inspection: () => Promise.resolve(due.inspection),
      appliance_inspection: () => Promise.resolve(due.appliances),
    },
  }
}

function inspectionOf(who: string, label = `Elektroinstallation von ${who}`) {
  return {
    sourceId: installations[who] ?? '',
    sourceLabel: `${label} am Objekt Rheinstraße 12`,
    anchorOn: '2033-10-24' as IsoDate,
    namedDueOn: dueOn,
    naturalUserId: 'max',
    values: {
      documentId: null,
      installationId: (installations[who] ?? null) as InstallationId | null,
      customerId: (customers[who] ?? null) as CustomerId | null,
      siteId: site as SiteId,
      jobId: null,
    },
  }
}

function applianceOf(who: string, number: string) {
  return {
    sourceId: newIdFor(number),
    sourceLabel: `${number} Kaffeemaschine am Objekt Werkstatt`,
    anchorOn: '2036-10-24' as IsoDate,
    namedDueOn: dueOn,
    naturalUserId: 'max',
    values: {
      documentId: null,
      installationId: null,
      customerId: (customers[who] ?? null) as CustomerId | null,
      siteId: workshop as SiteId,
      jobId: null,
    },
  }
}

const applianceIds = new Map<string, string>()

function newIdFor(number: string): string {
  const known = applianceIds.get(number) ?? newId<'appliance'>()

  applianceIds.set(number, known)

  return known
}

async function switchOn() {
  await admin.query(
    `insert into tenant_parameters (tenant_id, key, valid_from, unit, value)
       values ($1, 'customer_reminder.mail', '2037-01-01', 'flag', 1)`,
    [north],
  )
}

async function mails() {
  const { rows } = await admin.query<{
    recipient_address: string
    subject: string
    body: string
    cause: string
  }>(
    `select recipient_address, subject, body, cause from mail_outbox where kind = 'customer_reminder' order by recipient_address`,
  )

  return rows
}

async function calls() {
  const { rows } = await admin.query<{
    title: string
    assignee_user_id: string
    due_on: string
    customer_id: string
  }>(
    `select title, assignee_user_id, to_char(due_on, 'YYYY-MM-DD') as due_on, customer_id
       from tasks where notes = $1 order by title`,
    [callNotes],
  )

  return rows
}

beforeAll(async () => {
  admin = await connect()
  await resetToMigrated()
  await admin.query('insert into tenants (id, name) values ($1, $2)', [north, 'Elektro Nord GmbH'])
  await shipRoles(admin, north)
  await readyToInvoice(admin, north)

  for (const [userId, name, roles] of [
    ['olga', 'Olga Inhaberin', ['owner']],
    ['max', 'Max Monteur', ['technician']],
  ] as const) {
    await admin.query('insert into auth_users (id, name, email) values ($1, $2, $3)', [
      userId,
      name,
      `${userId}@example.de`,
    ])
    await admin.query('insert into memberships (tenant_id, user_id, roles) values ($1, $2, $3)', [
      north,
      userId,
      [...roles],
    ])
  }

  // Who may be reminded, and how they can be reached.
  const people: [string, string | null, string | null, string | null][] = [
    ['lehmann', 'klaus.lehmann@example.com', 'existing_customer', '2024-03-12'],
    ['ohne', 'ohne@example.com', null, null],
    ['becker', null, 'consent', '2025-05-02'],
    ['baeckerei', null, 'existing_customer', '2024-03-12'],
    ['abbestellt', 'abbestellt@example.com', 'objected', '2026-11-02'],
    ['vertrag', 'vertrag@example.com', null, null],
    ['vertragstelefon', null, null, null],
    ['einwilligung', 'einwilligung@example.com', 'consent', '2025-05-02'],
    ['vertragende', 'vertragende@example.com', null, null],
  ]

  for (const [who, email, ground, since] of people) {
    customers[who] = newId<'customer'>()
    await admin.query(
      `insert into customers (id, tenant_id, kind, name, email, reminder_ground, reminder_ground_on)
       values ($1, $2, 'private', $3, $4, $5, $6)`,
      [customers[who], north, `Kunde ${who}`, email, ground, since],
    )
  }

  site = newId<'site'>()
  workshop = newId<'site'>()
  await admin.query(
    `insert into sites (id, tenant_id, customer_id, designation) values ($1, $3, $4, 'Rheinstraße 12'), ($2, $3, $4, 'Werkstatt')`,
    [site, workshop, north, customers['becker']],
  )

  for (const who of Object.keys(customers)) {
    installations[who] = newId<'installation'>()
    await admin.query(
      `insert into installations (id, tenant_id, site_id, kind, designation) values ($1, $2, $3, 'meter_cabinet', $4)`,
      [installations[who], north, site, `Elektroinstallation von ${who}`],
    )
  }

  // The contracts: one that covers the installation and runs past the due
  // day, one of a customer who stopped all reminders.
  for (const who of ['vertrag', 'vertragstelefon', 'abbestellt', 'vertragende']) {
    const quote = newId<'document'>()

    await admin.query(
      `insert into documents (id, tenant_id, customer_id, kind, status, number, document_date, issued_at, issued_by, subject)
       values ($1, $2, $3, 'quote', 'issued', $4, '2036-12-01', now(), 'olga', 'Wartung')`,
      [quote, north, customers[who], `AN-${who}`],
    )
    await admin.query(
      `insert into maintenance_contracts
         (tenant_id, customer_id, site_id, quote_id, number, designation, installation_ids, starts_on, first_visit_on,
          interval_months, term_months, renewal, notice_months, price_kind, flat_cents)
       values ($1, $2, $3, $4, $5, 'Wartung', array[$6]::uuid[], '2037-01-01', '2037-06-01', 12, 24, 'none', 0, 'flat', 3900)`,
      [north, customers[who], site, quote, `WV-2037-${who}`, installations[who]],
    )
  }
  // Cancelled to the end of September, a month before the inspection is due.
  await admin.query(
    `update maintenance_contracts set cancelled_on = '2037-06-01', ends_on = '2037-09-30' where number = 'WV-2037-vertragende'`,
  )

  database = Database.connect(applicationDatabaseUrl())

  const built = await Test.createTestingModule({
    imports: [ApiModule.create(database, identities)],
  }).compile()

  app = built.createNestApplication()
  await app.init()
})

beforeEach(async () => {
  await admin.query('delete from mail_outbox')
  await admin.query('delete from deadlines')
  await admin.query('delete from tasks')
  await admin.query('delete from tenant_parameters')
  due = { inspection: [], appliances: [] }
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
})

describe('a reminder of a due inspection to the customer', () => {
  it('goes out once, by mail, to a customer of the business, naming the right to object', async () => {
    await switchOn()
    due.inspection = [inspectionOf('lehmann')]

    await runDeadlinesOf(engine(), north, now)
    await runDeadlinesOf(engine(), north, now)

    const sent = await mails()

    expect(sent).toHaveLength(1)
    expect(sent[0]?.recipient_address).toBe('klaus.lehmann@example.com')
    expect(sent[0]?.subject).toBe(
      'Fällig am 24.10.2037: Wiederholungsprüfung der Anlage Elektroinstallation von lehmann am Objekt Rheinstraße 12',
    )
    expect(sent[0]?.body).toContain('Guten Tag Kunde lehmann,')
    expect(sent[0]?.body).toContain('jederzeit widersprechen')
    expect(sent[0]?.body).toContain('Basistarifen')
  })

  it('needs the switch of the business', async () => {
    due.inspection = [inspectionOf('lehmann'), inspectionOf('becker')]

    await runDeadlinesOf(engine(), north, now)

    expect(await mails()).toEqual([])
    expect(await calls()).toEqual([])
  })

  it('goes to nobody without a contract and without a ground', async () => {
    await switchOn()
    due.inspection = [inspectionOf('ohne')]

    await runDeadlinesOf(engine(), north, now)

    expect(await mails()).toEqual([])
    expect(await calls()).toEqual([])
  })

  it('is a task to call where there is no address and a consent, due today, for the person of the deadline', async () => {
    await switchOn()
    due.inspection = [inspectionOf('becker')]

    await runDeadlinesOf(engine(), north, now)
    await runDeadlinesOf(engine(), north, now)

    expect(await mails()).toEqual([])
    expect(await calls()).toEqual([
      {
        title:
          'Kunden anrufen: Wiederholungsprüfung der Anlage Elektroinstallation von becker am Objekt Rheinstraße 12, fällig am 24.10.2037',
        assignee_user_id: 'max',
        due_on: '2037-09-24',
        customer_id: customers['becker'],
      },
    ])
  })

  it('calls a customer of the business under § 7 Abs. 3 UWG never, since it covers mail alone', async () => {
    await switchOn()
    due.inspection = [inspectionOf('baeckerei')]

    await runDeadlinesOf(engine(), north, now)

    expect(await mails()).toEqual([])
    expect(await calls()).toEqual([])
  })

  it('belongs to a contract that covers the installation, by mail or by a call', async () => {
    await switchOn()
    due.inspection = [inspectionOf('vertrag'), inspectionOf('vertragstelefon')]

    await runDeadlinesOf(engine(), north, now)

    const sent = await mails()

    expect(sent.map((mail) => mail.recipient_address)).toEqual(['vertrag@example.com'])
    expect(sent[0]?.body).toContain(
      'Diese Erinnerung gehört zu Ihrem Wartungsvertrag WV-2037-vertrag.',
    )
    expect((await calls()).map((call) => call.customer_id)).toEqual([customers['vertragstelefon']])
  })

  it('belongs to no contract that ends before the inspection is due', async () => {
    await switchOn()
    due.inspection = [inspectionOf('vertragende')]

    await runDeadlinesOf(engine(), north, now)

    expect(await mails()).toEqual([])
  })

  it('stops for a customer who stopped them, a contract and all', async () => {
    await switchOn()
    due.inspection = [inspectionOf('abbestellt')]

    await runDeadlinesOf(engine(), north, now)

    expect(await mails()).toEqual([])
    expect(await calls()).toEqual([])
  })

  it('names the withdrawal of a consent', async () => {
    await switchOn()
    due.inspection = [inspectionOf('einwilligung')]

    await runDeadlinesOf(engine(), north, now)

    expect((await mails())[0]?.body).toContain('Einwilligung jederzeit widerrufen')
  })

  it('is one for the appliances of a site due the same day, by mail and by a call', async () => {
    await switchOn()
    due.appliances = [
      applianceOf('einwilligung', '001'),
      applianceOf('einwilligung', '002'),
      applianceOf('becker', '003'),
      applianceOf('becker', '004'),
    ]

    await runDeadlinesOf(engine(), north, now)

    const sent = await mails()

    expect(sent).toHaveLength(1)
    expect(sent[0]?.subject).toBe(
      'Fällig am 24.10.2037: Prüfung der Geräte nach DGUV Vorschrift 3 am Objekt Werkstatt',
    )
    expect(await calls()).toHaveLength(1)
  })
})

describe('the ground of a customer at its route', () => {
  const send = (method: 'post' | 'patch', path: string, body: object) =>
    request(app.getHttpServer())
      [method](path)
      .set('x-test-identity', as(north, 'office'))
      .send(body)

  it('comes with its day, or not at all', async () => {
    const refused = await send('post', '/customers', {
      kind: 'private',
      name: 'Familie Gruber',
      reminderGround: 'consent',
    }).expect(422)

    expect((refused.body as { message: string }).message).toBe(
      'Zur Grundlage für Erinnerungen gehört der Tag, seit dem sie gilt.',
    )

    const made = await send('post', '/customers', {
      kind: 'private',
      name: 'Familie Gruber',
      reminderGround: 'consent',
      reminderGroundOn: '2025-05-02',
    }).expect(201)
    const id = String((made.body as { id: string }).id)

    await send('patch', `/customers/${id}`, { reminderGroundOn: '2025-06-01' }).expect(422)
    await send('patch', `/customers/${id}`, {
      reminderGround: 'newsletter',
      reminderGroundOn: '2025-06-01',
    }).expect(422)
    await send('patch', `/customers/${id}`, {
      reminderGround: 'objected',
      reminderGroundOn: '2026-11-02',
    }).expect(200)

    const { rows } = await admin.query<{ reminder_ground: string; on: string }>(
      `select reminder_ground, to_char(reminder_ground_on, 'YYYY-MM-DD') as on from customers where id = $1`,
      [id],
    )

    expect(rows[0]).toEqual({ reminder_ground: 'objected', on: '2026-11-02' })
  })
})
