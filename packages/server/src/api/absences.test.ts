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
 * Leave and sickness (#288): who keeps them, that whoever only plans reads
 * "absent" and never the kind, that everybody asks for their own leave and
 * sees their own absences, how a year counts with the working time and the
 * holidays of the state, and that one business never reaches the absences of
 * another.
 */

const north = { id: newId<'tenant'>(), name: 'Elektro Kohm GmbH' }
const south = { id: newId<'tenant'>(), name: 'Elektro Süd GmbH' }

let admin: Pool
let database: Database
let app: INestApplication

const owner = as(north.id, 'owner')
const office = as(north.id, 'office')
const technician = as(north.id, 'technician')
const elsewhere = as(south.id, 'owner')

/** Somebody of the business by their own account, with a role. */
const signedIn = (userId: string, role: 'office' | 'technician') =>
  JSON.stringify({ userId, tenantId: north.id, roles: [role] })

const anna = signedIn('anna', 'technician')
const britta = signedIn('britta', 'office')

/** A role a business could give itself: it plans the jobs and keeps no absences. */
const planner = JSON.stringify({
  userId: 'test',
  tenantId: north.id,
  roles: ['planner'],
  rights: ['job.write'],
})

let annasFile = ''

function http() {
  return request(app.getHttpServer())
}

async function send(
  method: 'post' | 'patch' | 'put' | 'delete',
  path: string,
  body: Record<string, unknown> = {},
  who = owner,
  status = method === 'post' ? 201 : method === 'delete' ? 204 : 200,
) {
  const answer = await http()[method](path).set('x-test-identity', who).send(body)

  expect([answer.status, path, answer.body]).toEqual([status, path, expect.anything()])

  return answer.body as Record<string, unknown> & { id: string; message?: string }
}

async function get(path: string, who = owner, status = 200) {
  const answer = await http().get(path).set('x-test-identity', who).expect(status)

  return answer.body as Record<string, unknown>
}

const days = (firstDay: string, lastDay: string, more: Record<string, unknown> = {}) => ({
  firstDay,
  lastDay,
  startsAtNoon: false,
  endsAtNoon: false,
  ...more,
})

interface Year {
  readonly leave: Record<string, number>
  readonly absences: readonly Record<string, unknown>[]
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
       ('britta', 'Britta Kohm', 'britta@example.de')`,
  )
  await admin.query(
    `insert into memberships (tenant_id, user_id, roles) values
       ($1, 'test', '{owner}'), ($1, 'anna', '{technician}'), ($1, 'britta', '{office}'),
       ($2, 'test', '{owner}')`,
    [north.id, south.id],
  )

  database = Database.connect(applicationDatabaseUrl())

  const built = await Test.createTestingModule({
    imports: [ApiModule.create(database, identities)],
  }).compile()

  app = built.createNestApplication()
  await app.init()

  annasFile = (
    await send('post', '/people', {
      name: 'Anna Weber',
      userId: 'anna',
      joinedOn: '2023-03-01',
      workingTime: {
        validFrom: '2023-03-01',
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
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
})

describe('who keeps the absences', () => {
  it('is the owner and the office; a technician keeps none and reads nobody else’s', async () => {
    await get('/absences?year=2026', owner)
    await get('/absences?year=2026', office)
    await get('/absences?year=2026', technician, 403)
    await get(`/absences/people/${annasFile}?year=2026`, technician, 403)
    await send(
      'post',
      '/absences',
      { personId: annasFile, kind: 'sickness', ...days('2026-03-02', '2026-03-03') },
      technician,
      403,
    )
    await send(
      'put',
      `/absences/people/${annasFile}/entitlements/2026`,
      { entitledHalfDays: 60, carriedHalfDays: 0 },
      technician,
      403,
    )
  })

  it('lets the office enter a sickness and keep the days of a year', async () => {
    const sick = await send(
      'post',
      '/absences',
      { personId: annasFile, kind: 'sickness', ...days('2026-05-18', '2026-05-20') },
      office,
    )

    expect(sick['state']).toBe('approved')
    await send(
      'put',
      `/absences/people/${annasFile}/entitlements/2026`,
      { entitledHalfDays: 60, carriedHalfDays: 6 },
      office,
    )
  })
})

describe('the kind of an absence', () => {
  it('is read as "absent" by whoever only plans, and as itself by whoever keeps absences', async () => {
    const asPlanner = (await get(
      '/absences/planning?from=2026-05-01&to=2026-05-31',
      planner,
    )) as unknown as Record<string, unknown>[]
    const asOwner = (await get(
      '/absences/planning?from=2026-05-01&to=2026-05-31',
      owner,
    )) as unknown as Record<string, unknown>[]

    expect(asPlanner.map((entry) => [entry['name'], entry['kind'], entry['firstDay']])).toEqual([
      ['Anna Weber', 'absent', '2026-05-18'],
    ])
    expect(asOwner.map((entry) => entry['kind'])).toEqual(['sickness'])
  })

  it('is not planned by whoever plans nothing', async () => {
    await get('/absences/planning?from=2026-05-01&to=2026-05-31', technician, 403)
  })
})

describe('one’s own leave', () => {
  it('is asked for by the person, and the office decides', async () => {
    const asked = await send(
      'post',
      '/absences/mine',
      { ...days('2026-12-02', '2026-12-04'), note: 'Hochzeit' },
      anna,
    )

    expect([asked['state'], asked['kind']]).toEqual(['requested', 'vacation'])

    const overview = await get('/absences?year=2026', office)

    expect(
      (overview['requests'] as Record<string, unknown>[]).map((request) => request['name']),
    ).toEqual(['Anna Weber'])

    await send('post', `/absences/${asked.id}/approve`, {}, office)
    await send('post', `/absences/${asked.id}/approve`, {}, office, 400)
  })

  it('is always leave: a person cannot report themself sick or ask with a note on a sickness', async () => {
    const asked = await send(
      'post',
      '/absences/mine',
      { kind: 'sickness', ...days('2026-12-14', '2026-12-14') },
      anna,
    )

    expect(asked['kind']).toBe('vacation')
    await send('delete', `/absences/mine/${asked.id}`, {}, anna)
  })

  it('shows the person their own absences with the kind and the answer of the office', async () => {
    const asked = await send('post', '/absences/mine', days('2026-07-13', '2026-07-17'), anna)

    await send(
      'post',
      `/absences/${asked.id}/reject`,
      { answer: 'In der Woche ist die PV-Anlage dran.' },
      office,
    )

    const own = (await get('/absences/mine?year=2026', anna)) as unknown as Year

    expect(
      own.absences.map((absence) => [absence['kind'], absence['state'], absence['answer']]),
    ).toEqual([
      ['sickness', 'approved', null],
      ['vacation', 'rejected', 'In der Woche ist die PV-Anlage dran.'],
      ['vacation', 'approved', null],
    ])
    // A decided request is the office's to take back.
    await send('delete', `/absences/mine/${asked.id}`, {}, anna, 400)
  })

  it('needs a file of their own', async () => {
    expect((await get('/absences/mine?year=2026', britta))['person']).toBeUndefined()
    const refused = await send(
      'post',
      '/absences/mine',
      days('2026-12-02', '2026-12-02'),
      britta,
      400,
    )

    expect(refused.message).toContain('keine Akte')
  })
})

describe('a year of leave', () => {
  it('counts working days without holidays, and not a day the person was sick', async () => {
    // Good Friday and Easter Monday in Baden-Württemberg: eight working days of ten.
    await send(
      'post',
      '/absences',
      { personId: annasFile, kind: 'vacation', ...days('2026-03-30', '2026-04-10') },
      office,
    )
    // Ten working days in August, two of them sick.
    await send(
      'post',
      '/absences',
      { personId: annasFile, kind: 'vacation', ...days('2026-08-10', '2026-08-21') },
      office,
    )
    await send(
      'post',
      '/absences',
      { personId: annasFile, kind: 'sickness', ...days('2026-08-13', '2026-08-14') },
      office,
    )

    const year = (await get(`/absences/people/${annasFile}?year=2026`, office)) as unknown as Year

    expect(year.leave).toEqual({
      year: 2026,
      entitledHalfDays: 60,
      carriedHalfDays: 6,
      approvedHalfDays: 6 + 16 + 16,
      requestedHalfDays: 0,
      restHalfDays: 66 - 38,
      sickHalfDays: 6 + 4,
    })
  })

  it('refuses leave on days that already have some, and a sickness with a note', async () => {
    const overlap = await send(
      'post',
      '/absences',
      { personId: annasFile, kind: 'vacation', ...days('2026-04-09', '2026-04-14') },
      office,
      409,
    )

    expect(overlap.message).toContain('schon Urlaub')
    await send(
      'post',
      '/absences',
      {
        personId: annasFile,
        kind: 'sickness',
        note: 'Grippe',
        ...days('2026-10-05', '2026-10-05'),
      },
      office,
      400,
    )
    // The afternoon after a morning off is no overlap.
    await send(
      'post',
      '/absences',
      {
        personId: annasFile,
        kind: 'vacation',
        ...days('2026-10-06', '2026-10-06', { endsAtNoon: true }),
      },
      office,
    )
    await send(
      'post',
      '/absences',
      {
        personId: annasFile,
        kind: 'vacation',
        ...days('2026-10-06', '2026-10-07', { startsAtNoon: true }),
      },
      office,
    )
  })

  it('counts a span before it is saved, with what is left after it', async () => {
    const count = await get(
      `/absences/people/${annasFile}/days?firstDay=2026-12-28&lastDay=2026-12-31&endsAtNoon=true&kind=vacation`,
      office,
    )

    expect([count['workingHalfDays'], count['leaveHalfDays']]).toEqual([7, 7])
  })
})

describe('the absences of one business', () => {
  it('are out of reach of another', async () => {
    await get(`/absences/people/${annasFile}?year=2026`, elsewhere, 404)
    expect((await get('/absences?year=2026', elsewhere))['people']).toEqual([])
    expect(await get('/absences/planning?from=2026-01-01&to=2026-12-31', elsewhere)).toEqual([])
    await send(
      'put',
      `/absences/people/${annasFile}/entitlements/2026`,
      { entitledHalfDays: 60, carriedHalfDays: 0 },
      elsewhere,
      404,
    )
  })
})

describe('the public holidays of the business', () => {
  it('are read by the office and set only by whoever sets the settings', async () => {
    const read = await get('/holidays?year=2026', office)

    expect([read['state'], (read['holidays'] as unknown[]).length]).toEqual(['DE-BW', 12])
    await send('put', '/holidays', { state: 'DE-BY', local: [] }, office, 403)
  })

  it('take only the local holidays of their own state', async () => {
    await send(
      'put',
      '/holidays',
      { state: 'DE-BY', local: ['local_holiday.corpus_christi'] },
      owner,
      400,
    )
    await send(
      'put',
      '/holidays',
      { state: 'DE-BY', local: ['local_holiday.assumption_day'] },
      owner,
    )

    const read = await get('/holidays?year=2026', owner)

    expect((read['holidays'] as { key: string }[]).map((holiday) => holiday.key)).toContain(
      'local_holiday.assumption_day',
    )
    await send('put', '/holidays', { state: 'DE-BW', local: [] }, owner)
  })
})
