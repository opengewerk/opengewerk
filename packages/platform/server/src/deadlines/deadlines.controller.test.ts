import 'reflect-metadata'

import { type DynamicModule, type INestApplication, Module } from '@nestjs/common'
import { APP_FILTER, APP_GUARD } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import {
  type DeadlineKind,
  deadlineRegistry,
  type MemberIdentity,
  type TenantId,
} from '@opengewerk/platform-domain'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { AUTHORIZATION, AuthorizationGuard } from '../api/authorization.js'
import { databaseErrors } from '../api/database-errors.js'
import { TRUSTED_ORIGINS } from '../api/handed-in.js'
import { IDENTITY_SOURCE } from '../api/identity.js'
import { SameOriginGuard } from '../api/origin.js'
import { headerIdentities, testIdentityHeader } from '../api/test-identity.js'
import {
  probeAccess,
  probeAuthorization,
  type ProbeFoundation,
  probeFoundation,
  type ProbeRight,
} from '../authentication/probe-application.js'
import { Database } from '../database/database.js'
import { newId } from '../database/identifier.js'
import { type ProbeDeadlineColumns, probeDeadlines } from '../database/probe-schema.js'
import {
  type DeadlineEntry,
  type DeadlineKindEntry,
  deadlineParts,
  type DeadlineRules,
  type DeadlineRunEntry,
} from './deadlines.controller.js'

/**
 * The routes of the deadlines, on an application that is nobody's
 * (opengewerk-haustechnik#24): at the desk of the probe application a parcel
 * waits to be picked up, and the fire doors of a house are checked every six
 * months. What they hold: the list says what every deadline says and what the
 * application adds; a person changes only what a person decides; the settings
 * take an interval in the unit of the kind; and a pass of the engine that did
 * not happen is seen.
 */

const north = { id: newId<'tenant'>() as TenantId, name: 'Mandant Nord' }
const south = { id: newId<'tenant'>() as TenantId, name: 'Mandant Süd' }

const people = {
  lena: {
    tenant: north.id,
    roles: ['lead'],
    rights: ['members.read', 'notes.write', 'membership.write'],
  },
  mia: { tenant: north.id, roles: ['member'], rights: ['members.read', 'notes.write'] },
  gero: { tenant: north.id, roles: ['guest'], rights: ['members.read'] },
  sven: {
    tenant: south.id,
    roles: ['lead'],
    rights: ['members.read', 'notes.write', 'membership.write'],
  },
} as const

type Person = keyof typeof people

type ProbeKind = DeadlineKind<'parcel' | 'door', 'reminder' | 'note'>

const registry = deadlineRegistry<ProbeKind>(
  [
    {
      key: 'parcel.pickup',
      title: 'Abholung eines Pakets',
      about: 'Ein Paket am Empfang wird binnen einer Woche abgeholt.',
      source: 'parcel',
      intervalDays: 7,
      leadDays: 1,
      responsible: 'source',
      actions: ['reminder'],
    },
    {
      key: 'door.check',
      title: 'Prüfung der Brandschutztüren',
      about: 'Die Türen eines Hauses werden alle sechs Monate geprüft.',
      source: 'door',
      intervalDays: null,
      intervalMonths: 6,
      leadDays: 14,
      responsible: 'lead',
      actions: ['note'],
    },
  ],
  { sources: ['parcel', 'door'], actions: ['reminder', 'note'] },
)

/** What followed a change, by the application, in order. */
let followed: string[]

const rules: DeadlineRules<ProbeKind, ProbeDeadlineColumns> = {
  table: probeDeadlines,
  registry,
  describe: async (_tx, rows) => {
    followed.push(`describe ${String(rows.length)}`)

    return (row) => ({ parcelNumber: row.parcelNumber })
  },
  kindFields: (kind) => ({ countsIn: kind.intervalMonths ? 'months' : 'days' }),
  afterResponsible: async (_tx, _tenantId, row) => {
    followed.push(`responsible ${row.sourceLabel} ${String(row.responsibleUserId)}`)
  },
  afterDone: async (_tx, row) => {
    followed.push(`done ${row.sourceLabel}`)
  },
  afterReopen: async (_tx, row) => {
    followed.push(`reopen ${row.sourceLabel}`)
  },
  sentences: { notAColleague: 'Diese Person arbeitet nicht im Mandanten oder ist gesperrt.' },
}

let foundation: ProbeFoundation
let admin: Pool
let database: Database
let app: INestApplication

function as(person: Person): string {
  const { tenant, roles, rights } = people[person]
  const identity: MemberIdentity<ProbeRight> = {
    userId: person,
    tenantId: tenant,
    roles: [...roles],
    rights: [...rights],
  }

  return JSON.stringify(identity)
}

function http() {
  return request(app.getHttpServer())
}

/** The module of an application, as far as its deadlines go. */
@Module({})
class ProbeDeadlineModule {
  static create(on: Database): DynamicModule {
    const parts = deadlineParts({
      access: probeAccess,
      rights: {
        read: 'members.read',
        write: 'notes.write',
        settingsRead: 'members.read',
        settingsWrite: 'membership.write',
      },
      rules,
    })

    return {
      module: ProbeDeadlineModule,
      controllers: parts.controllers,
      providers: [
        { provide: Database, useValue: on },
        ...parts.providers,
        { provide: IDENTITY_SOURCE, useValue: headerIdentities<MemberIdentity<ProbeRight>>() },
        { provide: AUTHORIZATION, useValue: probeAuthorization },
        { provide: TRUSTED_ORIGINS, useValue: [] },
        { provide: APP_GUARD, useClass: SameOriginGuard },
        { provide: APP_GUARD, useClass: AuthorizationGuard },
        { provide: APP_FILTER, useClass: databaseErrors().DatabaseExceptionFilter },
      ],
    }
  }
}

/** A deadline as the engine would have written it. */
async function aDeadline(over: {
  tenant?: TenantId
  kind?: string
  label: string
  dueOn: string
  natural?: string | null
  status?: 'open' | 'done' | 'dropped'
  parcel?: string | null
}): Promise<string> {
  const id = newId<'deadline'>()
  const closed = over.status !== undefined && over.status !== 'open'

  await admin.query(
    `insert into deadlines (id, tenant_id, kind, source_id, source_label, anchor_on, due_on,
                            natural_user_id, status, closed_at, parcel_number)
     values ($1, $2, $3, $4, $5, $6::date - 7, $6, $7, $8, $9, $10)`,
    [
      id,
      over.tenant ?? north.id,
      over.kind ?? 'parcel.pickup',
      newId(),
      over.label,
      over.dueOn,
      over.natural === undefined ? 'mia' : over.natural,
      over.status ?? 'open',
      closed ? new Date() : null,
      over.parcel ?? null,
    ],
  )

  return id
}

async function list(person: Person, status?: string): Promise<DeadlineEntry[]> {
  const answer = await http()
    .get(status === undefined ? '/deadlines' : `/deadlines?status=${status}`)
    .set(testIdentityHeader, as(person))
    .expect(200)

  return answer.body as DeadlineEntry[]
}

async function run(person: Person = 'lena'): Promise<DeadlineRunEntry> {
  const answer = await http().get('/deadlines/run').set(testIdentityHeader, as(person)).expect(200)

  return answer.body as DeadlineRunEntry
}

beforeAll(async () => {
  foundation = await probeFoundation()
  admin = await foundation.kit.connect()
  database = Database.connect(foundation.kit.applicationDatabaseUrl())
  app = (
    await Test.createTestingModule({ imports: [ProbeDeadlineModule.create(database)] }).compile()
  ).createNestApplication()
  await app.init()
}, 60_000)

beforeEach(async () => {
  await foundation.empty(admin)
  await foundation.tenants(admin, [north, south])

  for (const [userId, person] of Object.entries(people)) {
    await admin.query('insert into auth_users (id, name, email) values ($1, $2, $3)', [
      userId,
      `${userId[0]?.toUpperCase() ?? ''}${userId.slice(1)} Probe`,
      `${userId}@example.de`,
    ])
    await admin.query(
      'insert into memberships (tenant_id, user_id, roles, created_at) values ($1, $2, $3, $4)',
      [person.tenant, userId, [...person.roles], userId === 'lena' ? '2030-01-01' : '2031-01-01'],
    )
  }

  followed = []
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
  foundation.remove()
})

describe('the list of deadlines', () => {
  it('shows the open ones by their day, with what every deadline says and what the application adds', async () => {
    await aDeadline({ label: 'Paket P-2', dueOn: '2037-03-12', parcel: 'P-2' })
    await aDeadline({ label: 'Paket P-1', dueOn: '2037-03-09', parcel: 'P-1' })
    await aDeadline({ label: 'Paket P-0', dueOn: '2037-03-01', status: 'done', parcel: 'P-0' })

    const entries = await list('mia')

    expect(entries.map((entry) => entry.source.label)).toEqual(['Paket P-1', 'Paket P-2'])
    expect(entries[0]).toMatchObject({
      kind: 'parcel.pickup',
      kindTitle: 'Abholung eines Pakets',
      status: 'open',
      dueOn: '2037-03-09',
      remindOn: '2037-03-08',
      leadDays: 1,
      ownLeadDays: null,
      responsible: { userId: 'mia', name: 'Mia Probe' },
      parcelNumber: 'P-1',
    })
    expect(followed).toEqual(['describe 2'])
    expect(await list('mia', 'all')).toHaveLength(3)
    expect(await list('mia', 'done')).toHaveLength(1)
  })

  it('names whoever leads for a kind that names nobody, and stays in its tenant', async () => {
    await aDeadline({ kind: 'door.check', label: 'Haus Ost', dueOn: '2037-04-01', natural: null })
    await aDeadline({ tenant: south.id, label: 'Paket S-1', dueOn: '2037-03-09', natural: 'sven' })

    expect(
      (await list('mia')).map((entry) => [entry.source.label, entry.responsible?.userId]),
    ).toEqual([['Haus Ost', 'lena']])
    expect((await list('sven')).map((entry) => entry.source.label)).toEqual(['Paket S-1'])
  })

  it('refuses a state it does not know', async () => {
    await http().get('/deadlines?status=late').set(testIdentityHeader, as('mia')).expect(400)
  })

  it('names the kinds with what the tenant has set and what the application adds', async () => {
    const answer = await http()
      .get('/deadlines/kinds')
      .set(testIdentityHeader, as('gero'))
      .expect(200)
    const kinds = answer.body as (DeadlineKindEntry & { countsIn: string })[]

    expect(
      kinds.map((kind) => [kind.key, kind.intervalDays, kind.intervalMonths, kind.countsIn]),
    ).toEqual([
      ['parcel.pickup', 7, null, 'days'],
      ['door.check', null, 6, 'months'],
    ])
  })
})

describe('what a person decides about a deadline', () => {
  it('is a lead and a person of its own, and the application says what follows a new person', async () => {
    const id = await aDeadline({ label: 'Paket P-1', dueOn: '2037-03-09' })

    await http()
      .patch(`/deadlines/${id}`)
      .set(testIdentityHeader, as('mia'))
      .send({ leadDays: 3, responsibleUserId: 'lena' })
      .expect(200)

    expect((await list('mia'))[0]).toMatchObject({
      ownLeadDays: 3,
      leadDays: 3,
      remindOn: '2037-03-06',
      ownResponsibleUserId: 'lena',
      responsible: { userId: 'lena' },
    })
    expect(followed).toContain('responsible Paket P-1 lena')
  })

  it('refuses a lead out of bounds, a person who does not work here, and nothing to change', async () => {
    const id = await aDeadline({ label: 'Paket P-1', dueOn: '2037-03-09' })
    const patch = (body: object) =>
      http().patch(`/deadlines/${id}`).set(testIdentityHeader, as('mia')).send(body)

    expect((await patch({ leadDays: 400 }).expect(400)).body.message).toContain('365')
    expect((await patch({ responsibleUserId: 'sven' }).expect(422)).body.message).toBe(
      'Diese Person arbeitet nicht im Mandanten oder ist gesperrt.',
    )
    await patch({}).expect(400)
    await http()
      .patch(`/deadlines/${newId()}`)
      .set(testIdentityHeader, as('mia'))
      .send({ leadDays: 2 })
      .expect(404)
  })

  it('is done by whoever says so, once, and opens again when that was a mistake', async () => {
    const id = await aDeadline({ label: 'Paket P-1', dueOn: '2037-03-09' })

    await http().post(`/deadlines/${id}/done`).set(testIdentityHeader, as('mia')).expect(201)
    await http().post(`/deadlines/${id}/done`).set(testIdentityHeader, as('mia')).expect(409)

    expect((await list('mia', 'done'))[0]).toMatchObject({
      status: 'done',
      closedBy: { userId: 'mia', name: 'Mia Probe' },
    })

    await http().post(`/deadlines/${id}/reopen`).set(testIdentityHeader, as('mia')).expect(201)
    await http().post(`/deadlines/${id}/reopen`).set(testIdentityHeader, as('mia')).expect(409)

    expect((await list('mia'))[0]).toMatchObject({ status: 'open', closedAt: null })
    expect(followed.filter((line) => !line.startsWith('describe'))).toEqual([
      'done Paket P-1',
      'reopen Paket P-1',
    ])
  })

  it('does not reopen a deadline that dropped out, which comes back by itself', async () => {
    const id = await aDeadline({ label: 'Paket P-1', dueOn: '2037-03-09', status: 'dropped' })

    const answer = await http()
      .post(`/deadlines/${id}/reopen`)
      .set(testIdentityHeader, as('mia'))
      .expect(409)

    expect(answer.body.message).toContain('entfallene')
  })

  it('is not decided by somebody without the right, nor in another tenant', async () => {
    const id = await aDeadline({ label: 'Paket P-1', dueOn: '2037-03-09' })

    await http().post(`/deadlines/${id}/done`).set(testIdentityHeader, as('gero')).expect(403)
    await http().post(`/deadlines/${id}/done`).set(testIdentityHeader, as('sven')).expect(404)
  })
})

describe('the settings of a kind', () => {
  it('take an interval in the unit the kind counts in', async () => {
    const put = (kind: string, body: object) =>
      http().put(`/settings/deadlines/${kind}`).set(testIdentityHeader, as('lena')).send(body)

    expect(
      (await put('parcel.pickup', { intervalDays: 10, leadDays: 2 }).expect(200)).body,
    ).toMatchObject({
      key: 'parcel.pickup',
      setting: { intervalDays: 10, intervalMonths: null, leadDays: 2 },
    })
    expect((await put('door.check', { intervalMonths: 3 }).expect(200)).body).toMatchObject({
      setting: { intervalDays: null, intervalMonths: 3 },
    })
    // A second time is a change of the row that is there, and back to the
    // kind's own value is a row of nulls.
    expect((await put('door.check', { intervalMonths: 4 }).expect(200)).body).toMatchObject({
      setting: { intervalMonths: 4 },
    })
    expect((await put('door.check', { intervalMonths: null }).expect(200)).body).toMatchObject({
      setting: { intervalMonths: null },
    })
    expect((await put('parcel.pickup', { intervalMonths: 1 }).expect(400)).body.message).toBe(
      'Diese Art zählt ihre Frist in Tagen.',
    )
    expect((await put('door.check', { intervalDays: 30 }).expect(400)).body.message).toBe(
      'Diese Art zählt ihre Frist in Monaten.',
    )
    expect((await put('door.check', { intervalMonths: 601 }).expect(400)).body.message).toContain(
      '600',
    )
    await put('parcel.lost', { leadDays: 1 }).expect(404)
    await put('parcel.pickup', { responsibleUserId: 'sven' }).expect(422)
  })

  it('are changed only with the right to change them', async () => {
    await http()
      .put('/settings/deadlines/parcel.pickup')
      .set(testIdentityHeader, as('mia'))
      .send({ leadDays: 2 })
      .expect(403)
    await http().get('/settings/deadlines').set(testIdentityHeader, as('mia')).expect(200)
  })
})

describe('how the engine last went through the deadlines', () => {
  it('is nothing to worry about for a tenant that just came into being', async () => {
    expect(await run()).toEqual({ succeededAt: null, failedAt: null, behind: false })
  })

  it('is behind when no pass went through since the tenant came into being long ago', async () => {
    await admin.query(`update tenants set created_at = now() - interval '2 hours' where id = $1`, [
      north.id,
    ])

    expect(await run()).toMatchObject({ succeededAt: null, behind: true })
  })

  it('is behind when the last pass that went through is too long ago, and not when it is recent', async () => {
    await admin.query(
      `insert into deadline_runs (tenant_id, succeeded_at) values ($1, now() - interval '20 minutes')`,
      [north.id],
    )
    expect((await run()).behind).toBe(true)

    await admin.query(`update deadline_runs set succeeded_at = now() - interval '1 minute'`)
    expect((await run()).behind).toBe(false)
  })

  it('is behind when the last pass failed, until one goes through again', async () => {
    await admin.query(
      `insert into deadline_runs (tenant_id, succeeded_at, failed_at)
         values ($1, now() - interval '2 minutes', now() - interval '1 minute')`,
      [north.id],
    )
    expect((await run()).behind).toBe(true)

    await admin.query(`update deadline_runs set succeeded_at = now()`)
    expect((await run()).behind).toBe(false)
  })

  it('is read by whoever reads the deadlines, of their own tenant alone', async () => {
    await admin.query(`insert into deadline_runs (tenant_id, failed_at) values ($1, now())`, [
      south.id,
    ])

    expect((await run('gero')).failedAt).toBeNull()
    expect((await run('sven')).failedAt).not.toBeNull()
  })
})

describe('the parts of the deadlines', () => {
  it('refuse a catalogue without one of their rights', () => {
    expect(() =>
      deadlineParts({
        access: probeAccess,
        rights: {
          read: 'members.read',
          write: 'notes.write',
          settingsRead: 'members.read',
          settingsWrite: 'deadlines.write' as ProbeRight,
        },
        rules,
      }),
    ).toThrow('The catalogue lacks a right of the deadlines: deadlines.write')
  })
})
