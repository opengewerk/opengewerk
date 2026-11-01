import { createHash } from 'node:crypto'

import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { Database, newId } from '@opengewerk/platform-server'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { applicationDatabaseUrl, connect, resetToMigrated } from '../database/test-database.js'
import { ApiModule } from './api.module.js'
import { testIdentities as identities } from './test-identity.js'

/**
 * The own appointments in the own calendar (#291): every person makes the
 * address of their calendar themselves and sees it once; the calendar under it
 * answers without a session and holds the appointments that person goes to,
 * with job, customer and address. A new address ends the one before, an ended
 * one and the one of somebody who left answer with an empty calendar, and an
 * address nobody made is not there.
 *
 * The appointments lie in November 2031, so that none of them is over on the
 * day the test runs.
 */

const origin = 'https://opengewerk.example.de'
const north = { id: newId<'tenant'>(), name: 'Elektro Kohm GmbH' }

let admin: Pool
let database: Database
let app: INestApplication

const signedIn = (userId: string, role: 'office' | 'technician') =>
  JSON.stringify({ userId, tenantId: north.id, roles: [role] })

const britta = signedIn('britta', 'office')
const anna = signedIn('anna', 'technician')
const jonas = signedIn('jonas', 'technician')

function http() {
  return request(app.getHttpServer())
}

async function send(
  method: 'post' | 'put' | 'delete',
  path: string,
  body: Record<string, unknown>,
  who = britta,
  status = method === 'post' ? 201 : method === 'delete' ? 204 : 200,
) {
  const answer = await http()[method](path).set('x-test-identity', who).send(body)

  expect([answer.status, path, answer.body]).toEqual([status, path, expect.anything()])

  return answer.body as Record<string, unknown>
}

interface View {
  readonly appointment: {
    readonly id: string
    readonly version: number
    readonly startsAt: string
    readonly endsAt: string
  }
}

const friday = { startsAt: '2031-11-07T06:00:00Z', endsAt: '2031-11-07T14:00:00Z' }

let job: string

async function make(userIds: readonly string[], extra: Record<string, unknown> = {}) {
  return (await send('post', '/appointments', {
    jobId: job,
    ...friday,
    userIds,
    ...extra,
  })) as unknown as View
}

/** A new address for a person, and the path under the instance it names. */
async function newAddress(who: string) {
  const made = await send('post', '/calendar/feed', {}, who)
  const address = String(made['address'])

  expect(address.startsWith(`${origin}/calendar/`)).toBe(true)

  return { address, path: address.slice(origin.length), token: address.slice(-47, -4) }
}

/** The calendar under a path, fetched as a calendar does: without a session. */
async function fetched(path: string) {
  const answer = await http().get(path)

  expect([answer.status, answer.headers['content-type']]).toEqual([
    200,
    'text/calendar; charset=utf-8',
  ])

  return (Buffer.isBuffer(answer.body) ? answer.body.toString('utf8') : answer.text).replace(
    /\r\n /g,
    '',
  )
}

function uidsIn(calendar: string): string[] {
  return [...calendar.matchAll(/^UID:(.+)@opengewerk$/gm)].map((match) => match[1] ?? '')
}

beforeAll(async () => {
  admin = await connect()
  await resetToMigrated()
  await admin.query('insert into tenants (id, name) values ($1, $2)', [north.id, north.name])
  await admin.query(
    `insert into auth_users (id, name, email) values
       ('test', 'Moritz Kohm', 'info@example.de'),
       ('anna', 'Anna Weber', 'a.weber@example.de'),
       ('britta', 'Britta Kohm', 'britta@example.de'),
       ('jonas', 'Jonas Brandt', 'j.brandt@example.de')`,
  )
  await admin.query(
    `insert into memberships (tenant_id, user_id, roles) values
       ($1, 'test', '{owner}'), ($1, 'anna', '{technician}'),
       ($1, 'britta', '{office}'), ($1, 'jonas', '{technician}')`,
    [north.id],
  )

  database = Database.connect(applicationDatabaseUrl())

  const built = await Test.createTestingModule({
    imports: [ApiModule.create(database, identities, { trustedOrigins: [origin] })],
  }).compile()

  app = built.createNestApplication()
  await app.init()

  const customer = await send('post', '/customers', {
    kind: 'private',
    name: 'Familie Weber',
    street: 'Hauptstraße',
    houseNumber: '1',
    postalCode: '68535',
    city: 'Edingen-Neckarhausen',
  })
  const site = await send('post', '/sites', {
    customerId: customer['id'],
    designation: 'Garage',
    street: 'Am Wingertsberg',
    houseNumber: '8',
    postalCode: '69214',
    city: 'Eppelheim',
  })

  job = String(
    (
      await send('post', '/jobs', {
        customerId: customer['id'],
        siteId: site['id'],
        kind: 'service',
        status: 'active',
        designation: 'Wallbox anschließen',
      })
    )['id'],
  )
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
})

describe('the calendar of a person', () => {
  it('has an address its person makes and sees once, under which the calendar names job, customer and address', async () => {
    expect((await http().get('/calendar/feed').set('x-test-identity', anna)).body).toEqual({
      since: null,
    })

    const appointment = await make(['anna'], { note: 'Garage ist offen, Schlüssel bei Nummer 10.' })
    const { path, token } = await newAddress(anna)

    const own = await http().get('/calendar/feed').set('x-test-identity', anna)

    expect(Object.keys(own.body as object)).toEqual(['since'])
    expect((own.body as { since: string | null }).since).not.toBeNull()

    const calendar = await fetched(path)

    expect(uidsIn(calendar)).toEqual([appointment.appointment.id])
    expect(calendar).toContain('SUMMARY:Wallbox anschließen\\, Familie Weber')
    expect(calendar).toContain('LOCATION:Am Wingertsberg 8\\, 69214 Eppelheim')
    expect(calendar).toMatch(
      /^DESCRIPTION:(Auftrag .+\\n)?Familie Weber\\nGarage ist offen\\, Schlüssel bei Nummer 10\.$/m,
    )
    expect(calendar).toContain('DTSTART;TZID=Europe/Berlin:20311107T070000')
    expect(calendar).toContain(`URL:${origin}/m/auftraege/${job}`)
    expect(calendar).toContain('X-WR-CALNAME:Termine bei Elektro Kohm GmbH')

    // What stays behind is the hash of the token, and the token itself nowhere.
    const { rows } = await admin.query<{ token_hash: string }>(
      `select token_hash from calendar_feeds where user_id = 'anna'`,
    )

    expect(rows).toEqual([{ token_hash: createHash('sha256').update(token).digest('hex') }])

    const logged = await admin.query(
      `select 1 from audit_entries entry where entry::text like '%' || $1 || '%'`,
      [token],
    )

    expect(logged.rows).toEqual([])
  })

  it('holds the appointments its person goes to, not the ones they were taken off or that were removed', async () => {
    const theirs = await make(['jonas'])
    const removed = await make(['jonas'])
    const takenOff = await make(['jonas', 'anna'])
    const series = await make(['jonas'], {
      startsAt: '2031-11-10T06:00:00Z',
      endsAt: '2031-11-10T08:00:00Z',
      rrule: 'FREQ=WEEKLY;BYDAY=MO;COUNT=6',
      exdates: ['2031-11-24'],
    })

    await send(
      'delete',
      `/appointments/${removed.appointment.id}?version=${removed.appointment.version}`,
      {},
    )
    await send('put', `/appointments/${takenOff.appointment.id}`, {
      jobId: job,
      ...friday,
      userIds: ['anna'],
      version: takenOff.appointment.version,
    })

    const { path } = await newAddress(jonas)
    const calendar = await fetched(path)

    expect(uidsIn(calendar).sort()).toEqual([theirs.appointment.id, series.appointment.id].sort())
    expect(calendar).toContain('RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=6')
    expect(calendar).toContain('EXDATE;TZID=Europe/Berlin:20311124T070000')
  })

  it('ends the address before when a new one is made, whose calendar is then empty', async () => {
    const first = await newAddress(anna)
    const second = await newAddress(anna)

    expect(uidsIn(await fetched(first.path))).toEqual([])
    expect(uidsIn(await fetched(second.path)).length).toBeGreaterThan(0)

    const open = await admin.query(
      `select 1 from calendar_feeds where user_id = 'anna' and ended_at is null`,
    )

    expect(open.rows).toHaveLength(1)
  })

  it('is empty once its person ends it, and for somebody who no longer works here', async () => {
    const own = await newAddress(anna)

    await send('delete', '/calendar/feed', {}, anna)

    expect((await http().get('/calendar/feed').set('x-test-identity', anna)).body).toEqual({
      since: null,
    })
    expect(uidsIn(await fetched(own.path))).toEqual([])

    const left = await newAddress(jonas)

    expect(uidsIn(await fetched(left.path)).length).toBeGreaterThan(0)

    await admin.query(`update memberships set blocked_at = now() where user_id = 'jonas'`)

    try {
      expect(uidsIn(await fetched(left.path))).toEqual([])
    } finally {
      await admin.query(`update memberships set blocked_at = null where user_id = 'jonas'`)
    }
  })

  it('ends only the address of whoever asks', async () => {
    const theirs = await newAddress(jonas)

    await newAddress(anna)
    await send('delete', '/calendar/feed', {}, anna)

    expect(uidsIn(await fetched(theirs.path)).length).toBeGreaterThan(0)
  })

  it('is not there under an address nobody made, nor under one of another shape', async () => {
    const unknown = 'A'.repeat(43)

    for (const path of [`/calendar/${unknown}.ics`, '/calendar/abc.ics', `/calendar/${unknown}`]) {
      expect([path, (await http().get(path)).status]).toEqual([path, 404])
    }
  })

  it('is made and seen only by somebody signed in to the business', async () => {
    expect((await http().post('/calendar/feed').send({})).status).toBe(401)
    expect((await http().get('/calendar/feed')).status).toBe(401)
    expect((await http().delete('/calendar/feed')).status).toBe(401)
  })
})
