import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { Database, newId } from '@opengewerk/platform-server'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  applicationDatabaseUrl,
  connect,
  resetToMigrated,
  shipRoles,
} from '../database/test-database.js'
import { notifyPush } from '../notifications/occasions.js'
import { ApiModule } from './api.module.js'
import { as, testIdentities as identities } from './test-identity.js'

/**
 * Push on leave (#806): a request reaches everybody in the business who keeps
 * absences, and nobody else, not whoever asked, not somebody blocked, not a
 * person of another business; the decision reaches whoever asked. Both name
 * the days and how it stands, nothing of the person or the answer.
 *
 * Who keeps absences is read from the roles of the business, which is why
 * they are written here as a business starts with them.
 */

const north = { id: newId<'tenant'>(), name: 'Elektro Kohm GmbH' }
const south = { id: newId<'tenant'>(), name: 'Elektro Süd GmbH' }

let admin: Pool
let database: Database
let app: INestApplication

const owner = as(north.id, 'owner')

const signedIn = (userId: string, role: 'owner' | 'office' | 'technician') =>
  JSON.stringify({ userId, tenantId: north.id, roles: [role] })

const anna = signedIn('anna', 'technician')
const britta = signedIn('britta', 'office')

function http() {
  return request(app.getHttpServer())
}

async function send(
  method: 'post' | 'delete',
  path: string,
  body: Record<string, unknown> = {},
  who = owner,
  status = method === 'post' ? 201 : 204,
) {
  const answer = await http()[method](path).set('x-test-identity', who).send(body)

  expect([answer.status, path, answer.body]).toEqual([status, path, expect.anything()])

  return answer.body as Record<string, unknown> & { id: string }
}

const days = (firstDay: string, lastDay: string, more: Record<string, unknown> = {}) => ({
  firstDay,
  lastDay,
  startsAtNoon: false,
  endsAtNoon: false,
  ...more,
})

/** The messages of an occasion written for a person, oldest first, as title and body. */
async function told(userId: string, kind: 'leave_request' | 'leave_decision') {
  const { rows } = await admin.query<{ title: string; body: string }>(
    `select o.title, o.body from push_outbox o
       join push_subscriptions s on s.id = o.subscription_id
      where s.user_id = $1 and o.kind = $2 order by o.id`,
    [userId, kind],
  )

  return rows.map((row) => `${row.title}: ${row.body}`)
}

const workingWeek = {
  validFrom: '2023-03-01',
  mondayMinutes: 480,
  tuesdayMinutes: 480,
  wednesdayMinutes: 480,
  thursdayMinutes: 480,
  fridayMinutes: 480,
  saturdayMinutes: 0,
  sundayMinutes: 0,
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
  await shipRoles(admin, north.id, south.id)
  await admin.query(
    `insert into auth_users (id, name, email) values
       ('test', 'Moritz Kohm', 'info@example.de'),
       ('anna', 'Anna Weber', 'a.weber@example.de'),
       ('britta', 'Britta Kohm', 'britta@example.de'),
       ('jonas', 'Jonas Brandt', 'j.brandt@example.de'),
       ('gerd', 'Gerd Gesperrt', 'gerd@example.de'),
       ('ute', 'Ute Süd', 'ute@example.de')`,
  )
  await admin.query(
    `insert into memberships (tenant_id, user_id, roles, blocked_at) values
       ($1, 'test', '{owner}', null), ($1, 'anna', '{technician}', null),
       ($1, 'britta', '{office}', null), ($1, 'jonas', '{technician}', null),
       ($1, 'gerd', '{office}', now()),
       ($2, 'ute', '{office}', null), ($2, 'test', '{owner}', null)`,
    [north.id, south.id],
  )
  // A device of each that takes push messages; the owner has one in both businesses.
  await admin.query(
    `insert into push_subscriptions (tenant_id, user_id, entry, label, endpoint, p256dh, auth) values
       ($1, 'test', 'office', 'Rechner', 'https://push.example.com/test', 'p', 'a'),
       ($1, 'anna', 'site', 'Telefon', 'https://push.example.com/anna', 'p', 'a'),
       ($1, 'britta', 'office', 'Rechner', 'https://push.example.com/britta', 'p', 'a'),
       ($1, 'jonas', 'site', 'Telefon', 'https://push.example.com/jonas', 'p', 'a'),
       ($1, 'gerd', 'office', 'Rechner', 'https://push.example.com/gerd', 'p', 'a'),
       ($2, 'ute', 'office', 'Rechner', 'https://push.example.com/ute', 'p', 'a'),
       ($2, 'test', 'office', 'Rechner', 'https://push.example.com/test-sued', 'p', 'a')`,
    [north.id, south.id],
  )

  database = Database.connect(applicationDatabaseUrl())

  const built = await Test.createTestingModule({
    imports: [ApiModule.create(database, identities)],
  }).compile()

  app = built.createNestApplication()
  await app.init()

  for (const [name, userId] of [
    ['Anna Weber', 'anna'],
    ['Moritz Kohm', 'test'],
  ] as const) {
    await send('post', '/people', {
      name,
      userId,
      joinedOn: '2023-03-01',
      workingTime: workingWeek,
    })
  }
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
})

describe('a request for leave', () => {
  it('reaches everybody in the business who keeps absences, and nobody else', async () => {
    await send('post', '/absences/mine', days('2031-11-10', '2031-11-14'), anna)

    expect(await told('britta', 'leave_request')).toEqual(['Urlaubsantrag: 10.11. bis 14.11.2031'])
    expect(await told('test', 'leave_request')).toEqual(['Urlaubsantrag: 10.11. bis 14.11.2031'])
    // A technician keeps no absences, somebody blocked hears nothing, and the
    // other business is another business.
    expect(await told('jonas', 'leave_request')).toEqual([])
    expect(await told('gerd', 'leave_request')).toEqual([])
    expect(await told('ute', 'leave_request')).toEqual([])
    expect(await told('anna', 'leave_request')).toEqual([])

    const { rows } = await admin.query<{ tenant_id: string }>(
      `select distinct tenant_id from push_outbox where kind = 'leave_request'`,
    )

    expect(rows).toEqual([{ tenant_id: north.id }])
  })

  it('does not reach whoever asked, even where they keep absences', async () => {
    const before = await told('britta', 'leave_request')

    await send('post', '/absences/mine', days('2031-12-22', '2031-12-23'), owner)

    expect(await told('test', 'leave_request')).toEqual(['Urlaubsantrag: 10.11. bis 14.11.2031'])
    expect(await told('britta', 'leave_request')).toEqual([
      ...before,
      'Urlaubsantrag: 22.12. bis 23.12.2031',
    ])
  })

  it('is no news once it is no request any more', async () => {
    const files = await admin.query<{ id: string }>(`select id from people where user_id = 'anna'`)
    const entered = await send('post', '/absences', {
      personId: files.rows[0]?.id,
      kind: 'vacation',
      ...days('2031-10-06', '2031-10-07'),
    })

    expect(
      await notifyPush(
        database,
        north.id,
        { kind: 'leave_request', absenceId: entered.id },
        { now: new Date() },
      ),
    ).toEqual([])
  })
})

describe('the decision about a request', () => {
  it('reaches whoever asked and says how it went, without the answer', async () => {
    const approved = await send('post', '/absences/mine', days('2031-09-01', '2031-09-05'), anna)
    const rejected = await send(
      'post',
      '/absences/mine',
      days('2031-11-03', '2031-11-03', { startsAtNoon: true }),
      anna,
    )

    await send('post', `/absences/${approved.id}/approve`, {}, britta)
    await send(
      'post',
      `/absences/${rejected.id}/reject`,
      { answer: 'Da ist die Messe, bitte eine Woche später.' },
      britta,
    )

    expect(await told('anna', 'leave_decision')).toEqual([
      'Urlaub freigegeben: 01.09. bis 05.09.2031',
      'Urlaub abgelehnt: 03.11.2031, ab Mittag',
    ])
    expect(await told('britta', 'leave_decision')).toEqual([])
    expect(await told('test', 'leave_decision')).toEqual([])
  })

  it('is not told before it is taken, nor the other way than it was taken', async () => {
    const waiting = await send('post', '/absences/mine', days('2031-08-04', '2031-08-04'), anna)

    for (const decision of ['approved', 'rejected'] as const) {
      expect(
        await notifyPush(
          database,
          north.id,
          { kind: 'leave_decision', absenceId: waiting.id, decision },
          { now: new Date() },
        ),
      ).toEqual([])
    }

    await send('post', `/absences/${waiting.id}/approve`, {}, britta)

    expect(
      await notifyPush(
        database,
        north.id,
        { kind: 'leave_decision', absenceId: waiting.id, decision: 'rejected' },
        { now: new Date() },
      ),
    ).toEqual([])
  })
})
