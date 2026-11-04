import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import type { TenantId } from '@opengewerk/domain'
import { Database, newId } from '@opengewerk/platform-server'
import { sql } from 'drizzle-orm'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { applicationDatabaseUrl, connect, resetToMigrated } from '../database/test-database.js'
import { ApiModule } from './api.module.js'
import { as, testIdentities as identities } from './test-identity.js'

/**
 * The history at a customer and at a site (#313): notes and calls written
 * once, by whoever keeps customers; beside them the mails that went to the
 * customer and the appointments of its jobs. It belongs to the business it
 * was written in.
 */

const north = newId<'tenant'>() as TenantId
const south = newId<'tenant'>() as TenantId

let admin: Pool
let database: Database
let app: INestApplication

const office = (tenant: TenantId = north) => as(tenant, 'office')

let customer = ''
let site = ''
let otherSite = ''
let otherCustomer = ''
let southCustomer = ''
let job = ''

function http() {
  return request(app.getHttpServer())
}

function refusal(answer: { body: unknown }): string {
  return String((answer.body as { message?: string }).message)
}

const call = {
  kind: 'call',
  direction: 'incoming',
  counterpart: 'Sabine Keller',
  text: 'Das Treppenhauslicht flackert wieder.',
}

async function write(values: Record<string, unknown>, expected = 201, who = office()) {
  return http().post('/communications').set('x-test-identity', who).send(values).expect(expected)
}

async function historyOf(query: string, who = office()) {
  const answer = await http()
    .get(`/communications?${query}`)
    .set('x-test-identity', who)
    .expect(200)

  return answer.body as { type: string; [key: string]: unknown }[]
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

  customer = newId<'customer'>()
  otherCustomer = newId<'customer'>()
  southCustomer = newId<'customer'>()
  site = newId<'site'>()
  otherSite = newId<'site'>()
  job = newId<'job'>()
  await admin.query(
    `insert into customers (id, tenant_id, kind, name) values
       ($1, $4, 'property_management', 'Hausverwaltung Süd GmbH'),
       ($2, $4, 'private', 'Familie Weber'),
       ($3, $5, 'private', 'Familie Süd')`,
    [customer, otherCustomer, southCustomer, north, south],
  )
  await admin.query(
    `insert into sites (id, tenant_id, customer_id, designation) values
       ($1, $3, $4, 'Rheinstraße 12'), ($2, $3, $5, 'Birkenweg 7')`,
    [site, otherSite, north, customer, otherCustomer],
  )
  await admin.query(
    `insert into jobs (id, tenant_id, customer_id, site_id, kind, status, designation)
     values ($1, $2, $3, $4, 'service', 'active', 'Störung Treppenhauslicht')`,
    [job, north, customer, site],
  )

  // Who goes to an appointment works in the business.
  await admin.query(
    "insert into auth_users (id, name, email) values ('jonas', 'Jonas Weber', 'jonas@example.de')",
  )
  await admin.query(
    "insert into memberships (tenant_id, user_id, roles) values ($1, 'jonas', '{technician}')",
    [north],
  )

  database = Database.connect(applicationDatabaseUrl())

  const built = await Test.createTestingModule({
    imports: [ApiModule.create(database, identities)],
  }).compile()

  app = built.createNestApplication()
  await app.init()
})

beforeEach(async () => {
  await admin.query(
    'begin; set local session_replication_role = replica; delete from communications; commit;',
  )
  await admin.query('delete from mail_outbox')
  await admin.query('delete from appointment_people')
  await admin.query('delete from appointments')
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
})

describe('an entry in the history (#313)', () => {
  it('writes a call at the customer, with who wrote it from the request and now unless said otherwise', async () => {
    const before = Date.now()
    const written = await write({ ...call, customerId: customer })
    const body = written.body as { createdBy: string; happenedAt: string; siteId: string | null }

    expect(body).toMatchObject({
      kind: 'call',
      direction: 'incoming',
      counterpart: 'Sabine Keller',
      siteId: null,
    })
    expect(body.createdBy).toBe('test')
    expect(Date.parse(body.happenedAt)).toBeGreaterThanOrEqual(before - 1000)

    const note = await write({
      customerId: customer,
      siteId: site,
      kind: 'note',
      text: 'Schlüssel beim Hausmeister.',
      happenedAt: '2026-10-27T13:05:00.000Z',
    })

    expect(note.body).toMatchObject({
      kind: 'note',
      direction: null,
      siteId: site,
      happenedAt: '2026-10-27T13:05:00.000Z',
    })
  })

  it('refuses a site of another customer, a note with a direction, no content and a moment to come', async () => {
    expect(refusal(await write({ ...call, customerId: customer, siteId: otherSite }, 422))).toBe(
      'Das Objekt gehört nicht zu diesem Kunden.',
    )
    expect(refusal(await write({ ...call, kind: 'note', customerId: customer }, 422))).toBe(
      'Nur ein Anruf hat eine Richtung.',
    )
    expect(refusal(await write({ ...call, text: ' ', customerId: customer }, 422))).toBe(
      'Ein Eintrag braucht einen Inhalt.',
    )
    expect(
      refusal(
        await write({ ...call, customerId: customer, happenedAt: '2999-01-01T00:00:00Z' }, 422),
      ),
    ).toBe('Ein Eintrag hält fest, was war, nicht was kommt.')
  })

  it('stays as it was written: the application may neither change nor delete it', async () => {
    const written = await write({ ...call, customerId: customer })
    const id = (written.body as { id: string }).id

    await expect(
      database.forTenant({ tenantId: north }, (tx) =>
        tx.execute(sql`update communications set text = 'anders' where id = ${id}`),
      ),
    ).rejects.toThrow()
    await expect(
      database.forTenant({ tenantId: north }, (tx) =>
        tx.execute(sql`delete from communications where id = ${id}`),
      ),
    ).rejects.toThrow()
    expect((await admin.query('select text from communications where id = $1', [id])).rows).toEqual(
      [{ text: 'Das Treppenhauslicht flackert wieder.' }],
    )
  })

  it('is written by whoever keeps customers, and read by whoever reads them', async () => {
    await write({ ...call, customerId: customer }, 403, as(north, 'technician'))
    await historyOf(`customerId=${customer}`, as(north, 'technician'))
  })

  it('belongs to the business it was written in', async () => {
    await write({ ...call, customerId: southCustomer }, 201, office(south))
    await write({ ...call, customerId: southCustomer }, 404)
    await http()
      .get(`/communications?customerId=${southCustomer}`)
      .set('x-test-identity', office())
      .expect(404)
    expect(await historyOf(`customerId=${customer}`)).toEqual([])
  })
})

describe('the history (#313)', () => {
  it('shows at the customer its entries, those of its sites, the mails it got and the appointments of its jobs', async () => {
    await write({ ...call, customerId: customer })
    await write({
      customerId: customer,
      siteId: site,
      kind: 'note',
      text: 'Schlüssel beim Hausmeister.',
    })
    await write({ customerId: otherCustomer, kind: 'note', text: 'Nicht von hier.' })

    const document = newId<'document'>()

    await admin.query(
      `insert into documents (id, tenant_id, customer_id, site_id, kind, status, number, document_date, issued_at)
       values ($1, $2, $3, $4, 'quote', 'issued', 'AN-2026-0436', '2026-10-23', now())`,
      [document, north, customer, site],
    )

    const appointment = newId<'appointment'>()

    await admin.query(
      `insert into appointments (id, tenant_id, job_id, starts_at, ends_at)
       values ($1, $2, $3, '2026-11-09T07:00:00Z', '2026-11-09T09:00:00Z')`,
      [appointment, north, job],
    )
    await admin.query(
      `insert into appointment_people (tenant_id, appointment_id, user_id) values ($1, $2, 'jonas')`,
      [north, appointment],
    )

    const mail = (kind: string, subject: string, column: string, value: string) =>
      admin.query(
        `insert into mail_outbox (tenant_id, kind, cause, sender_name, recipient_address, subject, body, status, sent_at, ${column})
         values ($1, $2, $3, 'Elektro Nord GmbH', 'buchhaltung@hv-sued.de', $4, 'Text', 'sent', now(), $5)`,
        [north, kind, `${kind}:${subject}`, subject, value],
      )

    await mail('document', 'Angebot AN-2026-0436', 'document_id', document)
    await mail(
      'appointment_confirmation',
      'Ihr Termin: Montag, 09.11.2026',
      'appointment_id',
      appointment,
    )
    await mail('job_received', 'Ihr Auftrag Störung Treppenhauslicht', 'job_id', job)
    // A reminder of a task goes to somebody of the business, not to the customer.
    await mail('task_due', 'Aufgabe fällig', 'job_id', job)

    const history = await historyOf(`customerId=${customer}`)

    expect(history.filter((item) => item.type === 'entry')).toHaveLength(2)
    expect(
      history
        .filter((item) => item.type === 'mail')
        .map((item) => item['subject'])
        .sort(),
    ).toEqual([
      'Angebot AN-2026-0436',
      'Ihr Auftrag Störung Treppenhauslicht',
      'Ihr Termin: Montag, 09.11.2026',
    ])
    expect(history.find((item) => item.type === 'appointment')).toMatchObject({
      id: appointment,
      jobId: job,
      jobDesignation: 'Störung Treppenhauslicht',
      userIds: ['jonas'],
      series: false,
      endsAt: '2026-11-09T09:00:00.000Z',
    })

    // At the site only what is about the site.
    const atSite = await historyOf(`siteId=${site}`)

    expect(
      atSite
        .filter((item) => item.type === 'entry')
        .map((item) => (item['entry'] as { text: string }).text),
    ).toEqual(['Schlüssel beim Hausmeister.'])
    expect(atSite.filter((item) => item.type === 'mail')).toHaveLength(3)
    expect(await historyOf(`siteId=${otherSite}`)).toEqual([])
  })

  it('is asked for a customer or for a site, and not for both', async () => {
    await http()
      .get(`/communications?customerId=${customer}&siteId=${site}`)
      .set('x-test-identity', office())
      .expect(400)
  })
})
