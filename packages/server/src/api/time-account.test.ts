import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { Database, newId } from '@opengewerk/platform-server'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { applicationDatabaseUrl, connect, resetToMigrated } from '../database/test-database.js'
import { ApiModule } from './api.module.js'
import { as, testIdentities as identities } from './test-identity.js'

/**
 * The time account (#289): who reads whose, that the target comes from the
 * working time less the absences that were approved, that what was recorded
 * comes from the entries that count, and that one business never reaches the
 * time of another.
 *
 * Anna Weber joins on 01.10.2026 and leaves on 31.10.2026, so that her
 * account is closed and the numbers do not move with the day the test runs.
 */

const north = { id: newId<'tenant'>(), name: 'Elektro Kohm GmbH' }
const south = { id: newId<'tenant'>(), name: 'Elektro Süd GmbH' }

let admin: Pool
let database: Database
let app: INestApplication

const owner = as(north.id, 'owner')
const elsewhere = as(south.id, 'owner')

/** Somebody of the business by their own account, with a role. */
const signedIn = (userId: string, role: 'office' | 'technician') =>
  JSON.stringify({ userId, tenantId: north.id, roles: [role] })

const anna = signedIn('anna', 'technician')
const britta = signedIn('britta', 'office')
const jonas = signedIn('jonas', 'technician')

/** A role a business could give itself: it plans the jobs and reads nobody's time. */
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
  method: 'post' | 'put',
  path: string,
  body: Record<string, unknown>,
  who = owner,
  status = method === 'post' ? 201 : 200,
) {
  const answer = await http()[method](path).set('x-test-identity', who).send(body)

  expect([answer.status, path, answer.body]).toEqual([status, path, expect.anything()])

  return answer.body as Record<string, unknown> & { id: string }
}

interface Account {
  readonly hasFile: boolean
  readonly startsOn: string | null
  readonly countedUntil: string | null
  readonly balanceBeforeMinutes: number
  readonly balanceMinutes: number
  readonly days: readonly {
    readonly on: string
    readonly targetMinutes: number
    readonly workedMinutes: number
    readonly counted: boolean
  }[]
}

async function account(path: string, who: string, status = 200) {
  const answer = await http().get(path).set('x-test-identity', who).expect(status)

  return answer.body as Account
}

const day = (of: Account, on: string) => {
  const found = of.days.find((each) => each.on === on)

  return found === undefined ? null : [found.targetMinutes, found.workedMinutes, found.counted]
}

/** Time a person records on their device: a stretch, and what it corrects or withdraws. */
async function record(
  who: string,
  device: string,
  entries: readonly (Record<string, string | boolean> & { id?: string })[],
) {
  const answer = await http()
    .post('/sync')
    .set('x-test-identity', who)
    .send({
      deviceId: device,
      operations: entries.map(({ id, ...values }) => ({
        id: newId<'operation'>(),
        entity: 'time_entries',
        recordId: id ?? newId<'time-entry'>(),
        kind: 'create',
        baseVersion: null,
        patches: Object.entries(values).map(([field, to]) => ({ field, from: null, to })),
        recordedAt: new Date().toISOString(),
      })),
    })
    .expect(201)
  const refused = (
    answer.body as { receipts: { outcome: string; reason: string | null }[] }
  ).receipts.filter((receipt) => receipt.outcome !== 'applied')

  expect(refused).toEqual([])
}

const wrong = newId<'time-entry'>()
const misplaced = newId<'time-entry'>()
const mistaken = newId<'time-entry'>()

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
       ('jonas', 'Jonas Brandt', 'j.brandt@example.de')`,
  )
  await admin.query(
    `insert into memberships (tenant_id, user_id, roles) values
       ($1, 'test', '{owner}'), ($1, 'anna', '{technician}'), ($1, 'britta', '{office}'),
       ($1, 'jonas', '{technician}'), ($2, 'test', '{owner}')`,
    [north.id, south.id],
  )

  database = Database.connect(applicationDatabaseUrl())

  const built = await Test.createTestingModule({
    imports: [ApiModule.create(database, identities)],
  }).compile()

  app = built.createNestApplication()
  await app.init()

  const annasFile = (
    await send('post', '/people', {
      name: 'Anna Weber',
      userId: 'anna',
      joinedOn: '2026-10-01',
      leftOn: '2026-10-31',
      workingTime: {
        validFrom: '2026-10-01',
        mondayMinutes: 480,
        tuesdayMinutes: 480,
        wednesdayMinutes: 480,
        thursdayMinutes: 480,
        fridayMinutes: 480,
        saturdayMinutes: 0,
        sundayMinutes: 0,
      },
    })
  ).id

  await send('put', '/holidays', { state: 'DE-BW', local: [] })
  // Two days of leave, an afternoon sick, and a day only asked for.
  await send('post', '/absences', {
    personId: annasFile,
    kind: 'vacation',
    firstDay: '2026-10-12',
    lastDay: '2026-10-13',
    startsAtNoon: false,
    endsAtNoon: false,
  })
  await send('post', '/absences', {
    personId: annasFile,
    kind: 'sickness',
    firstDay: '2026-10-20',
    lastDay: '2026-10-20',
    startsAtNoon: true,
    endsAtNoon: false,
  })
  await send(
    'post',
    '/absences/mine',
    { firstDay: '2026-10-26', lastDay: '2026-10-26', startsAtNoon: false, endsAtNoon: false },
    anna,
  )

  await record(anna, 'handy-anna', [
    // A day of work with a break that does not count.
    { kind: 'work', startedAt: '2026-10-01T07:00:00+02:00', endedAt: '2026-10-01T15:30:00+02:00' },
    { kind: 'break', startedAt: '2026-10-01T12:00:00+02:00', endedAt: '2026-10-01T12:30:00+02:00' },
    // Travel counts like work.
    {
      kind: 'travel',
      startedAt: '2026-10-02T07:00:00+02:00',
      endedAt: '2026-10-02T07:30:00+02:00',
    },
    { kind: 'work', startedAt: '2026-10-02T07:30:00+02:00', endedAt: '2026-10-02T15:00:00+02:00' },
    // Twelve hours by mistake, and what they should have been.
    {
      id: wrong,
      kind: 'work',
      startedAt: '2026-10-05T07:00:00+02:00',
      endedAt: '2026-10-05T19:00:00+02:00',
    },
    // A day recorded on the wrong day, and one that should not have been recorded at all.
    {
      id: misplaced,
      kind: 'work',
      startedAt: '2026-10-06T07:00:00+02:00',
      endedAt: '2026-10-06T15:00:00+02:00',
    },
    {
      id: mistaken,
      kind: 'work',
      startedAt: '2026-10-08T07:00:00+02:00',
      endedAt: '2026-10-08T15:00:00+02:00',
    },
  ])
  await record(anna, 'handy-anna', [
    {
      kind: 'work',
      startedAt: '2026-10-05T07:00:00+02:00',
      endedAt: '2026-10-05T15:00:00+02:00',
      correctsEntryId: wrong,
      note: 'Ende vergessen',
    },
    {
      kind: 'work',
      startedAt: '2026-10-07T07:00:00+02:00',
      endedAt: '2026-10-07T16:00:00+02:00',
      correctsEntryId: misplaced,
      note: 'Am falschen Tag eingetragen',
    },
    {
      kind: 'work',
      startedAt: '2026-10-08T07:00:00+02:00',
      endedAt: '2026-10-08T15:00:00+02:00',
      correctsEntryId: mistaken,
      withdrawn: true,
      note: 'War nicht im Dienst',
    },
  ])
  // Somebody else's day, which is not Anna's.
  await record(britta, 'rechner-britta', [
    { kind: 'work', startedAt: '2026-10-01T08:00:00+02:00', endedAt: '2026-10-01T16:00:00+02:00' },
  ])
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
})

const october = 'from=2026-10-01&to=2026-10-31'

describe('whose time account', () => {
  it('everybody reads their own, and a technician nobody else’s', async () => {
    const own = await account(`/time-account/mine?${october}`, anna)

    expect([own.hasFile, own.startsOn, own.countedUntil]).toEqual([
      true,
      '2026-10-01',
      '2026-10-31',
    ])
    await account(`/time-account?userId=britta&${october}`, anna, 403)
    await account(`/time-account?userId=anna&${october}`, anna, 403)
  })

  it('the office reads for whoever records time, and a role that only plans for nobody', async () => {
    const read = await account(`/time-account?userId=anna&${october}`, britta)

    expect(read.balanceMinutes).toBe(-7350)
    await account(`/time-account?userId=anna&${october}`, planner, 403)
  })

  it('needs a file: without one nothing was agreed and nothing counts', async () => {
    const none = await account(`/time-account/mine?${october}`, jonas)

    expect([none.hasFile, none.startsOn, none.countedUntil, none.balanceMinutes]).toEqual([
      false,
      null,
      null,
      0,
    ])
    expect(none.days.every((each) => each.targetMinutes === 0 && !each.counted)).toBe(true)
  })

  it('is out of reach of another business', async () => {
    const other = await account(`/time-account?userId=anna&${october}`, elsewhere)

    expect([other.hasFile, other.balanceMinutes]).toEqual([false, 0])
    expect(other.days.every((each) => each.workedMinutes === 0)).toBe(true)
  })
})

describe('a time account', () => {
  it('takes the target from the working time, less approved leave and a sick afternoon', async () => {
    const own = await account(`/time-account/mine?${october}`, anna)

    expect([
      day(own, '2026-10-09'),
      day(own, '2026-10-10'),
      day(own, '2026-10-12'),
      day(own, '2026-10-20'),
      day(own, '2026-10-26'),
    ]).toEqual([
      [480, 0, true],
      [0, 0, true],
      [0, 0, true],
      [240, 0, true],
      [480, 0, true],
    ])
  })

  it('counts work and travel, not breaks, and a correction on the day its time lies', async () => {
    const own = await account(`/time-account/mine?${october}`, anna)

    expect([
      day(own, '2026-10-01'),
      day(own, '2026-10-02'),
      day(own, '2026-10-05'),
      day(own, '2026-10-06'),
      day(own, '2026-10-07'),
      day(own, '2026-10-08'),
    ]).toEqual([
      [480, 510, true],
      [480, 480, true],
      [480, 480, true],
      [480, 0, true],
      [480, 540, true],
      [480, 0, true],
    ])
  })

  it('stands at what came before a stretch and at the end, and counts nothing after leaving', async () => {
    const week = await account('/time-account/mine?from=2026-10-06&to=2026-10-09', anna)
    const after = await account('/time-account/mine?from=2026-11-02&to=2026-11-06', anna)

    // Before the 6th, a day eight hours short: 990 recorded against 960 and 480 against
    // 480. In all, 22 weekdays of 480 less two of leave and a sick afternoon, against 2010.
    expect([week.balanceBeforeMinutes, week.balanceMinutes]).toEqual([30, -7350])
    expect(after.days.map((each) => [each.targetMinutes, each.counted])).toEqual(
      Array.from({ length: 5 }, () => [0, false]),
    )
  })

  it('answers for days that are days, at most 400 at once', async () => {
    await account('/time-account/mine?from=2026-13-01&to=2026-13-02', anna, 400)
    await account('/time-account/mine?from=2026-10-31&to=2026-10-01', anna, 400)
    await account('/time-account/mine?from=2025-01-01&to=2026-12-31', anna, 400)
    await account('/time-account?from=2026-10-01&to=2026-10-31', owner, 400)
  })
})
