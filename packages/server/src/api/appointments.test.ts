import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { Database, newId } from '@opengewerk/platform-server'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { applicationDatabaseUrl, connect, resetToMigrated } from '../database/test-database.js'
import { ApiModule } from './api.module.js'
import { as, testIdentities as identities } from './test-identity.js'

/**
 * The appointments of the planning board (#290): made in the office by
 * whoever plans, for people who work in the business, at a job of the
 * business; whoever gets one is put on the job and told by push; a change is
 * taken only for the version the board read, and a move asks for a new
 * confirmation. The board learns who is away and the public holidays.
 *
 * The appointments lie in November 2031, so that none of them is over on the
 * day the test runs and every one is still news.
 */

const north = { id: newId<'tenant'>(), name: 'Elektro Kohm GmbH' }
const south = { id: newId<'tenant'>(), name: 'Elektro Süd GmbH' }

let admin: Pool
let database: Database
let app: INestApplication

const owner = as(north.id, 'owner')
const elsewhere = as(south.id, 'owner')

const signedIn = (userId: string, role: 'office' | 'technician') =>
  JSON.stringify({ userId, tenantId: north.id, roles: [role] })

const britta = signedIn('britta', 'office')
const anna = signedIn('anna', 'technician')

/** A role a business could give itself: it plans the jobs and keeps no absences. */
const planner = JSON.stringify({
  userId: 'test',
  tenantId: north.id,
  roles: ['planner'],
  rights: ['job.write'],
})

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
    readonly revision: number
    readonly note: string | null
    readonly rrule: string | null
    readonly exdates: readonly string[]
    readonly startsAt: string
  }
  readonly people: readonly { readonly userId: string; readonly confirmedRevision: number | null }[]
}

const friday = { startsAt: '2031-11-07T06:00:00Z', endsAt: '2031-11-07T14:00:00Z' }
const monday = { startsAt: '2031-11-10T06:00:00Z', endsAt: '2031-11-10T14:00:00Z' }

let job: string

async function make(userIds: readonly string[], extra: Record<string, unknown> = {}) {
  return (await send('post', '/appointments', {
    jobId: job,
    ...friday,
    userIds,
    ...extra,
  })) as unknown as View
}

function changed(view: View, extra: Record<string, unknown>) {
  return {
    jobId: job,
    startsAt: view.appointment.startsAt,
    endsAt: new Date(new Date(view.appointment.startsAt).getTime() + 8 * 3_600_000).toISOString(),
    note: view.appointment.note,
    rrule: view.appointment.rrule,
    exdates: view.appointment.exdates,
    userIds: view.people.map((person) => person.userId),
    version: view.appointment.version,
    ...extra,
  }
}

/** The messages written for a person, oldest first, as title and body. */
async function told(userId: string) {
  const { rows } = await admin.query<{ title: string; body: string; url: string }>(
    `select o.title, o.body, o.url from push_outbox o
       join push_subscriptions s on s.id = o.subscription_id
      where s.user_id = $1 and o.kind = 'appointment' order by o.id`,
    [userId],
  )

  return rows.map((row) => `${row.title}: ${row.body}`)
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
  await admin.query(
    `insert into auth_users (id, name, email) values
       ('test', 'Moritz Kohm', 'info@example.de'),
       ('anna', 'Anna Weber', 'a.weber@example.de'),
       ('britta', 'Britta Kohm', 'britta@example.de'),
       ('jonas', 'Jonas Brandt', 'j.brandt@example.de'),
       ('gerd', 'Gerd Gesperrt', 'gerd@example.de')`,
  )
  await admin.query(
    `insert into memberships (tenant_id, user_id, roles, blocked_at) values
       ($1, 'test', '{owner}', null), ($1, 'anna', '{technician}', null),
       ($1, 'britta', '{office}', null), ($1, 'jonas', '{technician}', null),
       ($1, 'gerd', '{technician}', now()), ($2, 'test', '{owner}', null)`,
    [north.id, south.id],
  )
  // A device of each technician that takes push messages, on site.
  await admin.query(
    `insert into push_subscriptions (tenant_id, user_id, entry, label, endpoint, p256dh, auth) values
       ($1, 'anna', 'site', 'Telefon', 'https://push.example.com/anna', 'p', 'a'),
       ($1, 'jonas', 'site', 'Telefon', 'https://push.example.com/jonas', 'p', 'a')`,
    [north.id],
  )

  database = Database.connect(applicationDatabaseUrl())

  const built = await Test.createTestingModule({
    imports: [ApiModule.create(database, identities)],
  }).compile()

  app = built.createNestApplication()
  await app.init()

  const customer = await send('post', '/customers', { kind: 'private', name: 'Berg' })

  job = String(
    (
      await send('post', '/jobs', {
        customerId: customer['id'],
        kind: 'service',
        status: 'active',
        designation: 'Wallbox anschließen',
      })
    )['id'],
  )

  const file = await send(
    'post',
    '/people',
    { name: 'Anna Weber', userId: 'anna', joinedOn: '2026-10-01' },
    owner,
  )

  await send('put', '/holidays', { state: 'DE-BW', local: [] }, owner)
  await send(
    'post',
    '/absences',
    {
      personId: file['id'],
      kind: 'vacation',
      firstDay: '2031-11-10',
      lastDay: '2031-11-11',
      startsAtNoon: false,
      endsAtNoon: false,
    },
    owner,
  )
  // A request still open is on no board.
  await send(
    'post',
    '/absences/mine',
    { firstDay: '2031-11-20', lastDay: '2031-11-20', startsAtNoon: false, endsAtNoon: false },
    anna,
  )
})

beforeEach(async () => {
  await admin.query('delete from push_outbox')
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
})

describe('an appointment', () => {
  it('is made in the office at a job, puts whoever goes on the job and tells them by push', async () => {
    const view = await make(['anna'], { note: '  Schlüssel bei Nummer 10  ' })

    expect(view.appointment.revision).toBe(1)
    expect(view.appointment.note).toBe('Schlüssel bei Nummer 10')
    expect(view.people.map((person) => [person.userId, person.confirmedRevision])).toEqual([
      ['anna', null],
    ])

    const { rows } = await admin.query(
      'select user_id from job_assignments where job_id = $1 and deleted_at is null',
      [job],
    )

    expect(rows).toEqual([{ user_id: 'anna' }])
    expect(await told('anna')).toEqual(['Neuer Termin: Fr., 07.11.2031, 07:00 Uhr'])
    expect(await told('jonas')).toEqual([])

    const { rows: links } = await admin.query<{ url: string }>(
      "select url from push_outbox where kind = 'appointment'",
    )

    expect(links).toEqual([{ url: '/m/termine' }])
  })

  it('is made only by whoever plans, for somebody who works here, at a job of this business', async () => {
    await send('post', '/appointments', { jobId: job, ...friday, userIds: ['anna'] }, anna, 403)

    const blocked = await send(
      'post',
      '/appointments',
      { jobId: job, ...friday, userIds: ['gerd'] },
      britta,
      422,
    )

    expect(blocked['message']).toBe(
      'Einen Termin bekommt nur, wer in diesem Betrieb arbeitet und nicht gesperrt ist.',
    )

    const foreign = await send(
      'post',
      '/appointments',
      { jobId: job, ...friday, userIds: ['test'] },
      elsewhere,
      422,
    )

    expect(foreign['message']).toBe('Einen Termin gibt es nur an einem Auftrag dieses Betriebs.')

    const nobody = await send(
      'post',
      '/appointments',
      { jobId: job, ...friday, userIds: [] },
      britta,
      422,
    )

    expect(nobody['message']).toBe('Ein Termin braucht mindestens eine Person.')
  })

  it('is changed only in the version the board read, and a move asks for a new confirmation', async () => {
    const view = await make(['anna'])

    await send('post', `/appointments/${view.appointment.id}/confirm`, { revision: 1 }, anna, 201)

    const stale = await send(
      'put',
      `/appointments/${view.appointment.id}`,
      changed(view, { ...monday, version: view.appointment.version + 5 }),
      britta,
      409,
    )

    expect(stale['message']).toBe('Den Termin hat inzwischen jemand anders geändert.')

    await admin.query('delete from push_outbox')

    const moved = (await send(
      'put',
      `/appointments/${view.appointment.id}`,
      changed(view, { ...monday, userIds: ['anna', 'jonas'] }),
    )) as unknown as View

    expect(moved.appointment.revision).toBe(2)
    expect(moved.appointment.version).toBeGreaterThan(view.appointment.version)
    expect(moved.people.map((person) => [person.userId, person.confirmedRevision])).toEqual([
      ['anna', 1],
      ['jonas', null],
    ])
    expect(await told('anna')).toEqual(['Termin geändert: Jetzt Mo., 10.11.2031, 07:00 Uhr'])
    expect(await told('jonas')).toEqual(['Neuer Termin: Mo., 10.11.2031, 07:00 Uhr'])

    // A confirmation of the version before is no confirmation of this one.
    await send('post', `/appointments/${view.appointment.id}/confirm`, { revision: 1 }, anna, 409)

    const confirmed = await send(
      'post',
      `/appointments/${view.appointment.id}/confirm`,
      { revision: 2 },
      anna,
      201,
    )

    expect(confirmed['confirmedRevision']).toBe(2)

    // Only the people change: the same revision, a new version, news to whom it concerns.
    await admin.query('delete from push_outbox')

    const handed = (await send(
      'put',
      `/appointments/${view.appointment.id}`,
      changed(moved, { userIds: ['jonas'] }),
    )) as unknown as View

    expect(handed.appointment.revision).toBe(2)
    expect(handed.appointment.version).toBeGreaterThan(moved.appointment.version)
    expect(handed.people.map((person) => person.userId)).toEqual(['jonas'])
    expect(await told('anna')).toEqual(['Termin entfällt: Mo., 10.11.2031, 07:00 Uhr'])
    expect(await told('jonas')).toEqual([])

    // Taken off the appointment, still on the job: yesterday's report hangs on it.
    const { rows } = await admin.query(
      "select 1 from job_assignments where job_id = $1 and user_id = 'anna' and deleted_at is null",
      [job],
    )

    expect(rows).toHaveLength(1)

    const otherJob = await send('post', '/jobs', {
      customerId: (
        await admin.query<{ customer_id: string }>('select customer_id from jobs where id = $1', [
          job,
        ])
      ).rows[0]?.customer_id,
      kind: 'service',
      status: 'active',
      designation: 'Zählerplatz',
    })
    const elsewhereJob = await send(
      'put',
      `/appointments/${view.appointment.id}`,
      changed(handed, { jobId: otherJob['id'] }),
      britta,
      422,
    )

    expect(elsewhereJob['message']).toBe('Ein Termin bleibt an seinem Auftrag.')
  })

  it('is confirmed by the people on it, each for themselves and in their own business', async () => {
    const view = await make(['anna'])
    const path = `/appointments/${view.appointment.id}/confirm`

    await send('post', path, { revision: 1 }, britta, 404)
    await send('post', path, { revision: 1 }, elsewhere, 404)
    await send('post', path, { revision: 0 }, anna, 400)

    const { rows } = await admin.query(
      'select user_id, confirmed_revision from appointment_people where appointment_id = $1',
      [view.appointment.id],
    )

    expect(rows).toEqual([{ user_id: 'anna', confirmed_revision: null }])
  })

  it('keeps a series as its rule, with only the days it has taken out', async () => {
    const view = await make(['jonas'], {
      startsAt: '2031-11-03T06:00:00Z',
      endsAt: '2031-11-03T07:00:00Z',
      rrule: 'FREQ=WEEKLY;UNTIL=20311222',
      exdates: ['2031-11-18', '2031-11-17', '2031-11-17'],
    })

    expect(view.appointment.rrule).toBe('FREQ=WEEKLY;UNTIL=20311222T225959Z')
    expect(view.appointment.exdates).toEqual(['2031-11-17'])

    const refused = await send(
      'post',
      '/appointments',
      { jobId: job, ...friday, rrule: 'FREQ=HOURLY', userIds: ['jonas'] },
      britta,
      422,
    )

    expect(refused['message']).toBe('Diese Wiederholung versteht OpenGewerk nicht.')
  })

  it('is taken back for the version the board read, and tells the people on it', async () => {
    const view = await make(['jonas'])
    const path = `/appointments/${view.appointment.id}`

    await admin.query('delete from push_outbox')
    await send('delete', `${path}?version=${String(view.appointment.version + 1)}`, {}, britta, 409)
    await send('delete', `${path}?version=${String(view.appointment.version)}`, {}, anna, 403)
    await http()
      .delete(`${path}?version=${String(view.appointment.version)}`)
      .set('x-test-identity', britta)
      .expect(204)

    const { rows } = await admin.query(
      `select a.deleted_at is not null as gone, p.deleted_at is not null as off
         from appointments a join appointment_people p on p.appointment_id = a.id where a.id = $1`,
      [view.appointment.id],
    )

    expect(rows).toEqual([{ gone: true, off: true }])
    expect(await told('jonas')).toEqual(['Termin entfällt: Fr., 07.11.2031, 07:00 Uhr'])
    await http()
      .delete(`${path}?version=${String(view.appointment.version + 1)}`)
      .set('x-test-identity', britta)
      .expect(404)
  })
})

describe('the board', () => {
  interface Board {
    readonly absences: readonly Record<string, unknown>[]
    readonly holidays: readonly { readonly on: string; readonly name: string }[]
  }

  async function board(who: string, from = '2031-11-01', to = '2031-11-30', status = 200) {
    const answer = await http()
      .get(`/appointments/board?from=${from}&to=${to}`)
      .set('x-test-identity', who)
      .expect(status)

    return answer.body as Board
  }

  it('shows who is away, the kind only to whoever keeps absences, and the public holidays', async () => {
    const seen = await board(owner)

    expect(seen.absences).toEqual([
      {
        userId: 'anna',
        kind: 'vacation',
        firstDay: '2031-11-10',
        lastDay: '2031-11-11',
        startsAtNoon: false,
        endsAtNoon: false,
      },
    ])
    expect(seen.holidays.map((holiday) => [holiday.on, holiday.name])).toEqual([
      ['2031-11-01', 'Allerheiligen'],
    ])
    expect((await board(planner)).absences.map((absence) => absence['kind'])).toEqual(['absent'])
  })

  it('is read by whoever plans, a stretch at a time, of their own business', async () => {
    await board(anna, '2031-11-01', '2031-11-30', 403)
    await board(owner, '2031-11-01', '2032-01-03', 400)
    await board(owner, '2031-11-30', '2031-11-01', 400)
    expect(await board(elsewhere)).toEqual({ absences: [], holidays: [] })
  })
})
