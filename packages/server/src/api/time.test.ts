import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import {
  type Identity,
  type IsoDate,
  retentionEndsOn,
  type RoleKey,
  shippedRules,
} from '@opengewerk/domain'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { Database } from '../database/database.js'
import { newId } from '../database/identifier.js'
import {
  allowApplicationLogin,
  applicationDatabaseUrl,
  applyMigrations,
  connect,
  refusedBy,
  resetSchema,
} from '../database/test-database.js'
import { ApiModule } from './api.module.js'
import { testIdentities as identities } from './test-identity.js'

/**
 * Working time (#76): recorded by the person it belongs to, through the outbox
 * and without a network, never changed, corrected by a new entry, kept for as
 * long as § 17 MiLoG wants it, with a place only by consent, and read by the
 * others only where the right says so.
 */

const north = { id: newId<'tenant'>(), name: 'Elektro Nord GmbH' }

const people = {
  max: { tenant: north.id, roles: ['technician'] },
  jonas: { tenant: north.id, roles: ['technician'] },
  britta: { tenant: north.id, roles: ['office'] },
} as const

type Person = keyof typeof people

let admin: Pool
let database: Database
let app: INestApplication
let jobId: string

function http() {
  return request(app.getHttpServer())
}

function as(person: Person): string {
  const { tenant, roles } = people[person]

  return JSON.stringify({
    userId: person,
    tenantId: tenant,
    roles: [...roles] as RoleKey[],
  } satisfies Identity)
}

type Values = Record<string, string | number | boolean | null>

function creating(recordId: string, values: Values) {
  return {
    id: newId<'operation'>(),
    entity: 'time_entries',
    recordId,
    kind: 'create',
    baseVersion: null,
    patches: Object.entries(values).map(([field, to]) => ({ field, from: null, to })),
    recordedAt: new Date().toISOString(),
  }
}

async function push(operations: unknown[], who: Person = 'max', expected = 201) {
  const answer = await http()
    .post('/sync')
    .set('x-test-identity', as(who))
    .send({ deviceId: `handy-${who}`, operations })
    .expect(expected)

  return answer.body as {
    receipts: { outcome: string; reason: string | null; fields: string[] }[]
    message?: string
  }
}

/** A morning at the job, as a device records it when somebody presses stop. */
function aMorning(over: Values = {}): Values {
  return {
    kind: 'work',
    jobId,
    startedAt: '2026-09-21T07:00:00+02:00',
    endedAt: '2026-09-21T12:00:00+02:00',
    ...over,
  }
}

async function row(id: string) {
  const { rows } = await admin.query<Record<string, unknown>>(
    'select * from time_entries where id = $1',
    [id],
  )

  return rows[0]
}

beforeAll(async () => {
  admin = await connect()
  await resetSchema(admin)
  await applyMigrations()
  await allowApplicationLogin(admin)
  await admin.query('insert into tenants (id, name) values ($1, $2)', [north.id, north.name])

  database = Database.connect(applicationDatabaseUrl())

  const built = await Test.createTestingModule({
    imports: [ApiModule.create(database, identities)],
  }).compile()

  app = built.createNestApplication()
  await app.init()

  const customer = await http()
    .post('/customers')
    .set('x-test-identity', as('britta'))
    .send({ kind: 'private', name: 'Familie Berg' })
    .expect(201)
  const job = await http()
    .post('/jobs')
    .set('x-test-identity', as('britta'))
    .send({
      customerId: (customer.body as { id: string }).id,
      kind: 'service',
      designation: 'Zähler',
    })
    .expect(201)

  jobId = (job.body as { id: string }).id
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
})

describe('a time entry', () => {
  it('is recorded through the outbox, and the database says whose it is', async () => {
    // Whose time it is, a device does not say. Sent along, it is refused as a
    // field the server keeps, like the author of a task.
    const claimed = await push([creating(newId<'time-entry'>(), aMorning({ userId: 'britta' }))])

    expect(claimed.receipts[0]).toMatchObject({
      outcome: 'conflict',
      reason: 'set_by_server',
      fields: ['userId'],
    })

    const id = newId<'time-entry'>()
    const { receipts } = await push([creating(id, aMorning())])

    expect(receipts.map((receipt) => receipt.outcome)).toEqual(['applied'])
    expect(await row(id)).toMatchObject({ user_id: 'max', kind: 'work', withdrawn: false })
  })

  it('is refused for the transmission when it runs backwards or longer than a day', async () => {
    const backwards = await push(
      [creating(newId<'time-entry'>(), aMorning({ endedAt: '2026-09-21T06:00:00+02:00' }))],
      'max',
      400,
    )
    const tooLong = await push(
      [creating(newId<'time-entry'>(), aMorning({ endedAt: '2026-09-22T08:00:00+02:00' }))],
      'max',
      400,
    )

    expect(backwards.message).toMatch(/nicht nach dem Beginn/)
    expect(tooLong.message).toMatch(/höchstens 24 Stunden/)
  })

  it('is never changed, not even past the application, and is corrected by a new entry', async () => {
    const id = newId<'time-entry'>()

    await push([creating(id, aMorning())])

    // The superuser, for whom row level security does not hold and triggers do.
    expect(
      (
        await refusedBy(
          admin.query("update time_entries set note = 'geändert' where id = $1", [id]),
        )
      ).code,
    ).toBe('OG001')
    expect(
      (await refusedBy(admin.query('delete from time_entries where id = $1', [id]))).code,
    ).toBe('OG001')

    const correction = newId<'time-entry'>()
    const { receipts } = await push([
      creating(
        correction,
        aMorning({
          endedAt: '2026-09-21T12:30:00+02:00',
          correctsEntryId: id,
          note: 'Ende vergessen',
        }),
      ),
    ])

    expect(receipts.map((receipt) => receipt.outcome)).toEqual(['applied'])
    expect(await row(id)).toMatchObject({ ended_at: new Date('2026-09-21T10:00:00Z') })

    // Corrected once: a second correction of the same entry is somebody else
    // having got there first.
    const again = await push([
      creating(newId<'time-entry'>(), aMorning({ correctsEntryId: id, note: 'doch anders' })),
    ])

    expect(again.receipts[0]).toMatchObject({
      outcome: 'conflict',
      reason: 'changed_elsewhere',
      fields: ['correctsEntryId'],
    })

    const withoutReason = await push(
      [creating(newId<'time-entry'>(), aMorning({ correctsEntryId: correction }))],
      'max',
      400,
    )

    expect(withoutReason.message).toMatch(/Grund/)
  })

  it('of a colleague is not there to be corrected', async () => {
    const theirs = newId<'time-entry'>()

    await push([creating(theirs, aMorning())], 'jonas')

    const { receipts } = await push(
      [creating(newId<'time-entry'>(), aMorning({ correctsEntryId: theirs, note: 'falsch' }))],
      'max',
    )

    expect(receipts[0]).toMatchObject({
      outcome: 'conflict',
      reason: 'record_missing',
      fields: ['correctsEntryId'],
    })
  })

  it('is kept two years from the seventh day after the work, and may go the day after', async () => {
    const plant = async (day: string) => {
      const { rows } = await admin.query<{ id: string }>(
        `insert into time_entries (tenant_id, user_id, kind, started_at, ended_at)
           select $1, 'max', 'work', $2::date + time '08:00', $2::date + time '12:00'
             from (select set_config('app.user_id', 'max', false)) as acting
         returning id`,
        [north.id, day],
      )

      return rows[0]?.id ?? ''
    }
    const { rows } = await admin.query<{ gone: string; kept: string; today: string }>(
      `select to_char(current_date - interval '2 years' - interval '8 days', 'YYYY-MM-DD') as gone,
              to_char(current_date - interval '2 years' - interval '6 days', 'YYYY-MM-DD') as kept,
              to_char(current_date, 'YYYY-MM-DD') as today`,
    )
    const { gone, kept, today } = rows[0] as { gone: string; kept: string; today: string }

    // The same boundary in `domain` and in the database.
    expect(retentionEndsOn(gone as IsoDate, shippedRules) <= today).toBe(true)
    expect(retentionEndsOn(kept as IsoDate, shippedRules) > today).toBe(true)

    const old = await plant(gone)
    const recent = await plant(kept)

    await admin.query('delete from time_entries where id = $1', [old])
    expect(await row(old)).toBeUndefined()
    expect(
      (await refusedBy(admin.query('delete from time_entries where id = $1', [recent]))).code,
    ).toBe('OG001')
  })
})

describe('the place of a time entry', () => {
  const placed: Values = {
    startLatitudeMicro: 49_487_459,
    startLongitudeMicro: 8_466_039,
    endLatitudeMicro: 49_487_500,
    endLongitudeMicro: 8_466_100,
  }

  it('is dropped without consent, kept with it, and dropped again once it is withdrawn', async () => {
    const without = newId<'time-entry'>()

    await push([creating(without, aMorning(placed))], 'jonas')
    expect(await row(without)).toMatchObject({
      start_latitude_micro: null,
      end_longitude_micro: null,
    })

    const given = await http()
      .put('/time/consent')
      .set('x-test-identity', as('jonas'))
      .send({ given: true })
      .expect(200)

    expect(given.body).toMatchObject({ given: true })

    const withConsent = newId<'time-entry'>()

    await push([creating(withConsent, aMorning(placed))], 'jonas')
    expect(await row(withConsent)).toMatchObject({
      start_latitude_micro: 49_487_459,
      end_longitude_micro: 8_466_100,
    })

    await http()
      .put('/time/consent')
      .set('x-test-identity', as('jonas'))
      .send({ given: false })
      .expect(200)

    const withdrawn = newId<'time-entry'>()

    await push([creating(withdrawn, aMorning(placed))], 'jonas')
    expect(await row(withdrawn)).toMatchObject({ start_latitude_micro: null })

    // Every answer stays on record, and one person's answer is nobody else's.
    const { rows } = await admin.query<{ given: boolean }>(
      "select given from location_consents where user_id = 'jonas' order by id",
    )

    expect(rows.map((answer) => answer.given)).toEqual([true, false])
    expect(
      (await http().get('/time/consent').set('x-test-identity', as('max')).expect(200)).body,
    ).toEqual({ given: false, since: null })
  })

  it('is answered yes or no and nothing else', async () => {
    await http()
      .put('/time/consent')
      .set('x-test-identity', as('max'))
      .send({ given: 'ja' })
      .expect(400)
  })
})

describe('the time of the others', () => {
  it('reaches the device of whoever may read it, and not that of a colleague', async () => {
    await push([creating(newId<'time-entry'>(), aMorning())], 'jonas')

    const users = async (who: Person) => {
      const answer = await http().get('/sync?since=0').set('x-test-identity', as(who)).expect(200)
      const changes = (answer.body as { changes: { entity: string; rows: { userId: string }[] }[] })
        .changes

      return [
        ...new Set(
          changes.find((change) => change.entity === 'time_entries')?.rows.map((r) => r.userId) ??
            [],
        ),
      ].sort()
    }

    expect(await users('max')).toEqual(['max'])
    expect(await users('britta')).toEqual(['jonas', 'max'])
  })

  it('says what it narrowed to, so that a shared device knows when to let go', async () => {
    const narrowed = async (who: Person) =>
      (
        (await http().get('/sync?since=0').set('x-test-identity', as(who)).expect(200)).body as {
          narrowed: Record<string, string>
        }
      ).narrowed

    expect(await narrowed('max')).toEqual({ time_entries: 'user:max' })
    expect(await narrowed('britta')).toEqual({ time_entries: 'all' })
  })

  it('is shown with names to whoever may read it, and to nobody else', async () => {
    await http().get('/time/people').set('x-test-identity', as('max')).expect(403)
    await http().get('/time/people').set('x-test-identity', as('britta')).expect(200)
  })
})
