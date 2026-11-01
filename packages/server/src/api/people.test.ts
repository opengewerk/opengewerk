import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { addDays, berlinClock } from '@opengewerk/domain'
import { Database, newId } from '@opengewerk/platform-server'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { applicationDatabaseUrl, connect, resetToMigrated } from '../database/test-database.js'
import { qualificationsRunningOut } from '../deadlines/sources.js'
import { ApiModule } from './api.module.js'
import { as, testIdentities as identities } from './test-identity.js'

/**
 * The files of the people who work for the business (#287, ADR 0016): only
 * the owner reads and keeps them, everybody reads their own, a file without
 * an account, one file to an account, a working time from its day with the
 * earlier one kept for the time before, qualifications of a kind of the
 * catalogue or the business's own, the deadline of one that runs out, and
 * the files of one business out of reach of another.
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

const today = berlinClock(new Date()).day

const week = (minutes: readonly number[]) => ({
  mondayMinutes: minutes[0] ?? 0,
  tuesdayMinutes: minutes[1] ?? 0,
  wednesdayMinutes: minutes[2] ?? 0,
  thursdayMinutes: minutes[3] ?? 0,
  fridayMinutes: minutes[4] ?? 0,
  saturdayMinutes: minutes[5] ?? 0,
  sundayMinutes: minutes[6] ?? 0,
})

let annasFile = ''
let helper = ''

function http() {
  return request(app.getHttpServer())
}

async function send(
  method: 'post' | 'patch' | 'delete',
  path: string,
  body: Record<string, unknown> = {},
  who = owner,
  status = method === 'post' ? 201 : 200,
) {
  const answer = await http()[method](path).set('x-test-identity', who).send(body)

  expect([answer.status, path, answer.body]).toEqual([status, path, expect.anything()])

  return answer.body as Record<string, unknown> & { id: string; message?: string }
}

async function get(path: string, who = owner, status = 200) {
  const answer = await http().get(path).set('x-test-identity', who).expect(status)

  return answer.body as Record<string, unknown>
}

interface File {
  readonly name: string
  readonly account: { readonly email: string } | null
  readonly workingTimes: readonly {
    readonly id: string
    readonly validFrom: string
    readonly weekMinutes: number
    readonly holdsToday: boolean
  }[]
  readonly qualifications: readonly {
    readonly kindLabel: string
    readonly validUntil: string | null
    readonly standing: string
  }[]
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
       ('sven', 'Sven Süd', 'sven@example.de')`,
  )
  await admin.query(
    `insert into memberships (tenant_id, user_id, roles) values
       ($1, 'test', '{owner}'), ($1, 'anna', '{technician}'), ($1, 'britta', '{office}'),
       ($2, 'test', '{owner}'), ($2, 'sven', '{technician}')`,
    [north.id, south.id],
  )

  database = Database.connect(applicationDatabaseUrl())

  const built = await Test.createTestingModule({
    imports: [ApiModule.create(database, identities)],
  }).compile()

  app = built.createNestApplication()
  await app.init()

  annasFile = (
    await send('post', '/people', { name: 'Anna Weber', userId: 'anna', joinedOn: '2023-03-01' })
  ).id
  helper = (
    await send('post', '/people', {
      name: 'Tim Schäfer',
      joinedOn: today,
      workingTime: { validFrom: today, ...week([300, 300, 300, 300, 300]) },
    })
  ).id
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
})

describe('who reads and keeps the files', () => {
  it('is the owner alone: the office and a technician read no file and keep none', async () => {
    expect(await get('/people')).toHaveLength(2)

    for (const who of [office, technician]) {
      await get('/people', who, 403)
      await get(`/people/${annasFile}`, who, 403)
      await get('/qualification-kinds', who, 403)
      await send('post', '/people', { name: 'Jemand' }, who, 403)
      await send('patch', `/people/${annasFile}`, { leftOn: today }, who, 403)
      await send(
        'post',
        `/people/${annasFile}/qualifications`,
        { kindKey: 'core.driving_licence' },
        who,
        403,
      )
    }
  })

  it('lets everybody read their own file and nobody else, without a right of the files', async () => {
    const own = (await get('/people/mine', anna)) as unknown as File

    expect(own.name).toBe('Anna Weber')
    expect(own.account?.email).toBe('a.weber@example.de')

    // The office has no file of its own here, and reads nobody else's.
    const none = await http().get('/people/mine').set('x-test-identity', britta).expect(200)

    expect(none.text).toBe('')
  })
})

describe('a file', () => {
  it('needs no account, and holds the first working time of the form', async () => {
    const file = (await get(`/people/${helper}`)) as unknown as File

    expect(file.account).toBeNull()
    expect(
      file.workingTimes.map((time) => [time.validFrom, time.weekMinutes, time.holdsToday]),
    ).toEqual([[today, 1500, true]])
  })

  it('takes an account of this business that belongs to no other file', async () => {
    const free = (await get('/people/accounts')) as unknown as { userId: string }[]

    expect(free.map((account) => account.userId).sort()).toEqual(['britta', 'test'])

    const answer = await send('post', '/people', { name: 'Anna W.', userId: 'anna' }, owner, 409)

    expect(answer.message).toBe('Dieser Zugang gehört schon zu einer Akte.')
    // Somebody who works for another business is no account here.
    await send('post', '/people', { name: 'Sven Süd', userId: 'sven' }, owner, 400)
  })

  it('does not let anybody leave before they joined', async () => {
    const answer = await send('patch', `/people/${annasFile}`, { leftOn: '2023-02-28' }, owner, 400)

    expect(answer.message).toBe('Der Austritt liegt nicht vor dem Eintritt.')
  })
})

describe('the working time agreed with a person', () => {
  it('holds from its day, and the earlier one stays for the time before', async () => {
    // A working time from years ago, as a file brought over would have it.
    await admin.query(
      `insert into working_times (tenant_id, person_id, valid_from, monday_minutes, tuesday_minutes,
         wednesday_minutes, thursday_minutes, friday_minutes)
       values ($1, $2, '2023-03-01', 480, 480, 480, 480, 480)`,
      [north.id, annasFile],
    )

    const later = addDays(today, 61)

    await send('post', `/people/${annasFile}/working-times`, {
      validFrom: later,
      ...week([450, 450, 450, 450]),
    })

    const file = (await get(`/people/${annasFile}`)) as unknown as File

    expect(
      file.workingTimes.map((time) => [time.validFrom, time.weekMinutes, time.holdsToday]),
    ).toEqual([
      [later, 1800, false],
      ['2023-03-01', 2400, true],
    ])
  })

  it('starts today at the earliest, and once its day has begun it stays as it is', async () => {
    const before = await send(
      'post',
      `/people/${annasFile}/working-times`,
      { validFrom: addDays(today, -1), ...week([480]) },
      owner,
      400,
    )

    expect(before.message).toBe('Eine Arbeitszeit gilt ab heute oder später.')

    const file = (await get(`/people/${annasFile}`)) as unknown as File
    const [coming, holding] = file.workingTimes

    const begun = await send(
      'patch',
      `/people/${annasFile}/working-times/${holding?.id ?? ''}`,
      { mondayMinutes: 0 },
      owner,
      409,
    )

    expect(begun.message).toMatch(/^Diese Arbeitszeit gilt schon/)
    await send('delete', `/people/${annasFile}/working-times/${holding?.id ?? ''}`, {}, owner, 409)

    // One still to come is changed, and taken out again.
    await send('patch', `/people/${annasFile}/working-times/${coming?.id ?? ''}`, {
      fridayMinutes: 120,
    })
    await send('delete', `/people/${annasFile}/working-times/${coming?.id ?? ''}`)

    const after = (await get(`/people/${annasFile}`)) as unknown as File

    expect(after.workingTimes.map((time) => time.validFrom)).toEqual(['2023-03-01'])
  })

  it('is one from a day for a person', async () => {
    const answer = await send(
      'post',
      `/people/${helper}/working-times`,
      { validFrom: today, ...week([240]) },
      owner,
      409,
    )

    expect(answer.message).toBe('Ab diesem Tag gibt es schon eine Arbeitszeit.')
  })
})

describe('the qualifications of a person', () => {
  it('are of a kind of the catalogue or of the business, exactly one, with the label and how they stand', async () => {
    const firstAid = (
      await send('post', '/qualification-kinds', {
        label: 'Ersthelfer',
        level: 'instructed_person',
      })
    ).id

    await send('post', `/people/${annasFile}/qualifications`, {
      kindKey: 'core.work_at_height',
      validUntil: addDays(today, 29),
      note: 'Unterweisung PSA gegen Absturz',
    })
    await send('post', `/people/${annasFile}/qualifications`, {
      ownKindId: firstAid,
      validUntil: addDays(today, -1),
    })
    await send('post', `/people/${annasFile}/qualifications`, { kindKey: 'elektro.skilled_person' })

    const unknown = await send(
      'post',
      `/people/${annasFile}/qualifications`,
      { kindKey: 'core.diving' },
      owner,
      400,
    )

    expect(unknown.message).toBe('Diese Art gibt es nicht oder nicht mehr.')
    await send(
      'post',
      `/people/${annasFile}/qualifications`,
      { kindKey: 'core.driving_licence', ownKindId: firstAid },
      owner,
      400,
    )

    const file = (await get(`/people/${annasFile}`)) as unknown as File

    expect(file.qualifications.map((each) => [each.kindLabel, each.standing]).sort()).toEqual([
      ['Elektrofachkraft', 'valid'],
      ['Ersthelfer', 'expired'],
      ['Höhenarbeit', 'expiring'],
    ])

    // An own kind somebody holds is not taken out.
    const held = await send('delete', `/qualification-kinds/${firstAid}`, {}, owner, 409)

    expect(held.message).toBe('Diese Art hält noch jemand. Erst die Qualifikationen ändern.')
  })

  it('make a deadline when they run out, named by kind and person, until the person has left', async () => {
    const running = async () =>
      database.forTenant({ tenantId: north.id }, (tx) => qualificationsRunningOut(tx))

    const named = (await running()).map((source) => [
      source.sourceLabel,
      source.namedDueOn,
      source.naturalUserId,
    ])

    expect(named.sort()).toEqual([
      ['Ersthelfer von Anna Weber', addDays(today, -1), 'anna'],
      ['Höhenarbeit von Anna Weber', addDays(today, 29), 'anna'],
    ])

    await send('patch', `/people/${annasFile}`, { leftOn: addDays(today, -1) })
    expect(await running()).toEqual([])
    await send('patch', `/people/${annasFile}`, { leftOn: null })
  })
})

describe('the files of one business', () => {
  it('are out of reach of another', async () => {
    expect(await get('/people', elsewhere)).toEqual([])
    await get(`/people/${annasFile}`, elsewhere, 404)
    await send('patch', `/people/${annasFile}`, { name: 'Anders' }, elsewhere, 404)
    await send(
      'post',
      `/people/${annasFile}/qualifications`,
      { kindKey: 'core.driving_licence' },
      elsewhere,
      404,
    )

    const sven = JSON.stringify({ userId: 'sven', tenantId: south.id, roles: ['technician'] })
    const none = await http().get('/people/mine').set('x-test-identity', sven).expect(200)

    expect(none.text).toBe('')
  })
})
