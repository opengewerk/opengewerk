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
import { eq, ilike, sql } from 'drizzle-orm'
import { Client, type Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

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
import { tableFileOf } from '../tables/read.js'
import {
  type DeadlineEntry,
  type DeadlineKindEntry,
  type DeadlinePage,
  deadlineParts,
  type DeadlineRules,
  type DeadlineRunEntry,
} from './deadlines.controller.js'
import { deadlineRemindsOn } from './settings.js'

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
    rights: ['members.read', 'notes.write', 'membership.read', 'membership.write'],
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
  searchIn: (pattern) => ilike(probeDeadlines.parcelNumber, pattern),
  filters: {
    parcel: (value) => (/^P-\d+$/.test(value) ? eq(probeDeadlines.parcelNumber, value) : null),
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
  listAsTable: {
    name: 'Fristen',
    columns: ['Paket'],
    cells: async (_tx, identity, rows) => {
      followed.push(`table ${identity.userId} ${String(rows.length)}`)

      return (row) => ({
        subject: `Abholung: ${row.source.label}`,
        cells: [(row as unknown as { readonly parcelNumber: string | null }).parcelNumber],
      })
    },
    narrowedToAPerson:
      'Auf eine Person eingegrenzt gibt es die Fristen als Tabelle nur für die Leitung.',
  },
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

/** One page of the list, as the route answers the question in the address. */
async function page(person: Person, query = ''): Promise<DeadlinePage> {
  const answer = await http()
    .get(query === '' ? '/deadlines' : `/deadlines?${query}`)
    .set(testIdentityHeader, as(person))
    .expect(200)

  return answer.body as DeadlinePage
}

/** The deadlines of a state on the first page. */
async function list(person: Person, status?: string): Promise<readonly DeadlineEntry[]> {
  return (await page(person, status === undefined ? '' : `status=${status}`)).rows
}

/** What the source of each deadline on a page is called, and how many the list says there are. */
async function found(person: Person, query: string): Promise<[string[], number | null]> {
  const answer = await page(person, query)

  return [answer.rows.map((entry) => entry.source.label), answer.total]
}

/** Gives a deadline a person of its own. */
async function ownPerson(id: string, userId: string): Promise<void> {
  await admin.query('update deadlines set responsible_user_id = $1 where id = $2', [userId, id])
}

/** How many statements go to the database while something is done. */
async function statementsOf(work: () => Promise<unknown>): Promise<number> {
  const asked = vi.spyOn(Client.prototype, 'query')

  try {
    await work()

    return asked.mock.calls.length
  } finally {
    asked.mockRestore()
  }
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
  await foundation.empty()
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

  /**
   * Who answers for a deadline was asked one deadline at a time, up to four
   * times a row (opengewerk-haustechnik#31). The list of a tenant with a few
   * thousand deadlines went to the database a few thousand times.
   *
   * So the order is held here on every step of it, own person, the one of
   * the kind, the one of the source, whoever leads, with somebody blocked
   * and somebody who never worked here passed over, and then the list of six
   * is held against a list of one: both ask the database the same number of
   * times.
   */
  it('names who answers for each deadline by the order of the settings, in the queries of one', async () => {
    const own = async (id: string, userId: string) => {
      await admin.query('update deadlines set responsible_user_id = $1 where id = $2', [userId, id])
    }
    const named = async (person: Person | null) => {
      await admin.query(
        `insert into deadline_settings (tenant_id, kind, responsible_user_id)
         values ($1, 'parcel.pickup', $2)
         on conflict (tenant_id, kind) do update set responsible_user_id = excluded.responsible_user_id`,
        [north.id, person],
      )
    }
    const answering = async () =>
      Object.fromEntries(
        (await list('mia')).map((entry) => [entry.source.label, entry.responsible?.userId]),
      )

    await aDeadline({ label: 'A von der Quelle', dueOn: '2037-03-01' })
    await own(await aDeadline({ label: 'B eigene Person', dueOn: '2037-03-02' }), 'lena')
    await aDeadline({ label: 'C niemand', dueOn: '2037-03-03', natural: null })
    await aDeadline({ label: 'D nie hier gewesen', dueOn: '2037-03-04', natural: 'paul' })
    await own(await aDeadline({ label: 'E eigene gesperrt', dueOn: '2037-03-05' }), 'gero')
    await aDeadline({ kind: 'door.check', label: 'F Haus Ost', dueOn: '2037-03-06' })
    await aDeadline({ label: 'Erledigt', dueOn: '2037-02-01', status: 'done', natural: null })
    await admin.query(`update memberships set blocked_at = now() where user_id = 'gero'`)

    // The kind names somebody blocked: passed over, the source is next.
    await named('gero')
    expect(await answering()).toEqual({
      'A von der Quelle': 'mia',
      'B eigene Person': 'lena',
      'C niemand': 'lena',
      'D nie hier gewesen': 'lena',
      'E eigene gesperrt': 'mia',
      'F Haus Ost': 'lena',
    })

    // The kind names somebody who works here: before the source, after the
    // person a deadline has of its own, and not for a kind it was not set for.
    await named('mia')
    await admin.query(`update deadlines set natural_user_id = 'lena' where source_label like 'A %'`)
    expect(await answering()).toEqual({
      'A von der Quelle': 'mia',
      'B eigene Person': 'lena',
      'C niemand': 'mia',
      'D nie hier gewesen': 'mia',
      'E eigene gesperrt': 'mia',
      'F Haus Ost': 'lena',
    })

    // Six deadlines with every step of the order among them, and one that
    // gets as far as whoever leads: the same number of statements.
    await named('gero')
    expect(await list('mia')).toHaveLength(6)
    expect(await list('mia', 'done')).toHaveLength(1)

    const forSix = await statementsOf(() => list('mia'))
    const forOne = await statementsOf(() => list('mia', 'done'))

    expect(forSix).toBeGreaterThan(0)
    expect(forSix).toBe(forOne)
  })

  it('refuses a state it does not know', async () => {
    await http().get('/deadlines?status=late').set(testIdentityHeader, as('mia')).expect(400)
  })

  it('pages through them by their day, and says whether more follow and how many there are', async () => {
    for (const day of ['05', '01', '04', '02', '03']) {
      await aDeadline({ label: `Paket P-${day}`, dueOn: `2037-03-${day}` })
    }

    await aDeadline({ label: 'Paket erledigt', dueOn: '2037-02-01', status: 'done' })

    expect(await page('mia', 'limit=2')).toMatchObject({ total: 5, more: true })
    expect(await found('mia', 'limit=2')).toEqual([['Paket P-01', 'Paket P-02'], 5])
    expect(await found('mia', 'offset=2&limit=2')).toEqual([['Paket P-03', 'Paket P-04'], 5])
    expect(await page('mia', 'offset=4&limit=2')).toMatchObject({ total: 5, more: false })
    expect(await found('mia', 'offset=4&limit=2')).toEqual([['Paket P-05'], 5])
    expect(await found('mia', 'status=all&limit=1')).toEqual([['Paket erledigt'], 6])
  })

  it('narrows by kind, by the search and by the filters of the application, and counts what it finds', async () => {
    await aDeadline({ label: 'Paket am Tor', dueOn: '2037-03-01', parcel: 'P-7' })
    await aDeadline({ label: 'Paket am Empfang', dueOn: '2037-03-02', parcel: 'P-8' })
    await aDeadline({ kind: 'door.check', label: 'Haus Ost', dueOn: '2037-03-03', natural: null })
    await aDeadline({ kind: 'door.check', label: 'Haus 50%', dueOn: '2037-03-04', natural: null })

    expect(await found('mia', 'kind=door.check')).toEqual([['Haus Ost', 'Haus 50%'], 2])
    // The name of the source, in any case; the title of the kind; what the
    // application adds; and a sign of the pattern taken as it is written.
    expect(await found('mia', 'search=TOR')).toEqual([['Paket am Tor'], 1])
    expect(await found('mia', 'search=brandschutz')).toEqual([['Haus Ost', 'Haus 50%'], 2])
    expect(await found('mia', 'search=p-8')).toEqual([['Paket am Empfang'], 1])
    expect(await found('mia', 'search=%25')).toEqual([['Haus 50%'], 1])
    expect(await found('mia', 'parcel=P-7')).toEqual([['Paket am Tor'], 1])
    expect(await found('mia', 'parcel=P-7&search=empfang')).toEqual([[], 0])
  })

  it('narrows to the late ones, past their day by the calendar in Germany', async () => {
    await aDeadline({ label: 'Paket von gestern', dueOn: '2020-01-01' })
    await aDeadline({ label: 'Paket von morgen', dueOn: '2037-03-01' })
    await aDeadline({ label: 'Paket erledigt', dueOn: '2020-01-02', status: 'done' })

    expect(await found('mia', 'late=true')).toEqual([['Paket von gestern'], 1])
    expect(await found('mia', 'status=all&late=true')).toEqual([
      ['Paket von gestern', 'Paket erledigt'],
      2,
    ])
    await http().get('/deadlines?late=ja').set(testIdentityHeader, as('mia')).expect(400)
  })

  it('refuses what a filter of the application cannot read, a page it cannot read and a value given twice', async () => {
    for (const query of [
      'parcel=Tor',
      'limit=0',
      `limit=201`,
      'limit=zwei',
      'limit=1e1',
      'offset=-1',
      'offset=1.5',
      'kind=parcel.pickup&kind=door.check',
    ]) {
      await http()
        .get(`/deadlines?${query}`)
        .set(testIdentityHeader, as('mia'))
        .expect(400)
        .catch((error: unknown) => {
          throw new Error(`${query}: ${String(error)}`)
        })
    }
  })

  /**
   * Narrowed to a person the list names no number: not how many deadlines
   * somebody answers for, nor how many of them are late
   * (opengewerk-haustechnik#104). Who answers is worked out by the order of
   * the settings, so the person is found the same way the list names one.
   */
  it('narrowed to a person, pages through what that person answers for and names no number', async () => {
    await aDeadline({ label: 'A Mia', dueOn: '2037-03-01' })
    await ownPerson(await aDeadline({ label: 'B Lena von sich aus', dueOn: '2037-03-02' }), 'lena')
    await aDeadline({ kind: 'door.check', label: 'C Haus Ost', dueOn: '2037-03-03', natural: null })
    await aDeadline({ label: 'D Mia', dueOn: '2037-03-04' })
    await aDeadline({ label: 'E niemand', dueOn: '2037-03-05', natural: null })
    await aDeadline({ label: 'F Mia', dueOn: '2037-03-06' })

    expect(await page('lena', 'person=mia&limit=2')).toMatchObject({ total: null, more: true })
    expect(await found('lena', 'person=mia&limit=2')).toEqual([['A Mia', 'D Mia'], null])
    expect(await page('lena', 'person=mia&offset=2&limit=2')).toMatchObject({ more: false })
    expect(await found('lena', 'person=mia&offset=2&limit=2')).toEqual([['F Mia'], null])
    expect(await found('lena', 'person=lena')).toEqual([
      ['B Lena von sich aus', 'C Haus Ost', 'E niemand'],
      null,
    ])
    expect(await found('lena', 'person=mia&search=d')).toEqual([['D Mia'], null])
    expect(await found('lena', 'person=gero')).toEqual([[], null])
  })

  it('takes no filter of the application by a name the list has for itself', () => {
    expect(() =>
      deadlineParts({
        access: probeAccess,
        rights: {
          read: 'members.read',
          write: 'notes.write',
          settingsRead: 'members.read',
          settingsWrite: 'membership.write',
        },
        rules: { ...rules, filters: { kind: () => null } },
      }),
    ).toThrow('A filter of the application takes a name of the list: kind')
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

/**
 * The list as a table (opengewerk-haustechnik#236): what the question finds,
 * whole, under the columns every deadline has and those of the application,
 * and who answers for a deadline only for whoever may see the staff.
 */
describe('the list of deadlines as a table', () => {
  /** The table at the address as its rows, read back as an import reads it; the header first. */
  async function tableOf(person: Person | string, query = ''): Promise<string[][]> {
    const answer = await http()
      .get(`/deadlines/table?format=xlsx${query === '' ? '' : `&${query}`}`)
      .set(testIdentityHeader, person in people ? as(person as Person) : person)
      .buffer(true)
      .parse((response, done) => {
        const chunks: Buffer[] = []

        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.on('end', () => {
          done(null, Buffer.concat(chunks))
        })
      })
      .expect(200)

    return (
      tableFileOf(new Uint8Array(answer.body as Buffer), 'Fristen.xlsx').sheets[0]?.rows.map(
        (row) => [...row],
      ) ?? []
    )
  }

  it('holds every deadline the question finds, in the order of the list, also beyond its first page', async () => {
    for (let index = 0; index < 55; index += 1) {
      await aDeadline({
        label: `Paket ${String(index).padStart(2, '0')}`,
        dueOn: `2037-${String(1 + (index % 12)).padStart(2, '0')}-${String(1 + (index % 28)).padStart(2, '0')}`,
        parcel: `P-${String(index)}`,
      })
    }

    await aDeadline({ label: 'Paket erledigt', dueOn: '2037-01-01', status: 'done' })

    const first = await page('mia')
    const second = await page('mia', `offset=${String(first.rows.length)}`)
    const rows = await tableOf('mia')

    expect(first.more).toBe(true)
    expect(rows.slice(1).map((row) => row[2])).toEqual(
      [...first.rows, ...second.rows].map((entry) => `Abholung: ${entry.source.label}`),
    )
    expect(rows).toHaveLength(56)
    expect(followed).toContain('table mia 55')
  })

  it('names its columns and fills them as the list does: the day, late, the subject, the kind and what the application adds', async () => {
    await aDeadline({ label: 'Paket am Tor', dueOn: '2020-01-02', parcel: 'P-7' })
    await aDeadline({ kind: 'door.check', label: 'Haus Ost', dueOn: '2037-03-03', natural: null })

    expect(await tableOf('mia')).toEqual([
      ['Fällig am', 'Überfällig', 'Betrifft', 'Art', 'Paket', 'Erinnerung'],
      [
        '02.01.2020',
        'überfällig',
        'Abholung: Paket am Tor',
        'Abholung eines Pakets',
        'P-7',
        'am 01.01.2020',
      ],
      ['03.03.2037', '', 'Abholung: Haus Ost', 'Prüfung der Brandschutztüren', '', 'am 17.02.2037'],
    ])
  })

  it('narrows as the list does: by state, kind, the search and the filters of the application', async () => {
    await aDeadline({ label: 'Paket am Tor', dueOn: '2037-03-01', parcel: 'P-7' })
    await aDeadline({ label: 'Paket am Empfang', dueOn: '2037-03-02', parcel: 'P-8' })
    await aDeadline({ kind: 'door.check', label: 'Haus Ost', dueOn: '2037-03-03', natural: null })
    await aDeadline({ label: 'Paket erledigt', dueOn: '2037-03-04', status: 'done' })

    const subjects = async (query: string) =>
      (await tableOf('mia', query)).slice(1).map((row) => row[2])

    expect(await subjects('kind=door.check')).toEqual(['Abholung: Haus Ost'])
    expect(await subjects('search=empfang')).toEqual(['Abholung: Paket am Empfang'])
    expect(await subjects('parcel=P-7')).toEqual(['Abholung: Paket am Tor'])
    expect(await subjects('status=done')).toEqual(['Abholung: Paket erledigt'])
  })

  it('names who answers for each only for whoever may see the staff', async () => {
    await aDeadline({ label: 'Paket am Tor', dueOn: '2037-03-01' })

    const named = await tableOf('lena')
    const nameless = await tableOf('mia')

    expect(named[0]).toContain('Verantwortlich')
    expect(named[1]).toContain('Mia Probe')
    expect(nameless[0]).not.toContain('Verantwortlich')
    expect(nameless.flat().filter((cell) => cell.includes('Probe'))).toEqual([])
  })

  it('is narrowed to one person only by whoever may see the staff', async () => {
    await aDeadline({ label: 'A Mia', dueOn: '2037-03-01' })
    await ownPerson(await aDeadline({ label: 'B Lena', dueOn: '2037-03-02' }), 'lena')

    const refused = await http()
      .get('/deadlines/table?format=csv&person=mia')
      .set(testIdentityHeader, as('mia'))
      .expect(403)

    expect(refused.body.message).toBe(
      'Auf eine Person eingegrenzt gibt es die Fristen als Tabelle nur für die Leitung.',
    )
    expect((await tableOf('lena', 'person=mia')).slice(1).map((row) => row[2])).toEqual([
      'Abholung: A Mia',
    ])
  })

  it('is for whoever reads the list, of their own tenant alone', async () => {
    await aDeadline({ label: 'Paket im Norden', dueOn: '2037-03-01' })
    await aDeadline({
      tenant: south.id,
      label: 'Paket im Süden',
      dueOn: '2037-03-01',
      natural: 'sven',
    })

    expect((await tableOf('sven')).slice(1).map((row) => row[2])).toEqual([
      'Abholung: Paket im Süden',
    ])
    await http()
      .get('/deadlines/table?format=xlsx')
      .set(
        testIdentityHeader,
        JSON.stringify({ userId: 'gero', tenantId: north.id, roles: ['guest'], rights: [] }),
      )
      .expect(403)
    await http().get('/deadlines/table?format=pdf').set(testIdentityHeader, as('mia')).expect(400)
  })

  it('writes a value that begins like a formula so that no spreadsheet runs it', async () => {
    await aDeadline({ label: 'Paket am Tor', dueOn: '2037-03-01', parcel: '=1+1' })

    const answer = await http()
      .get('/deadlines/table?format=csv')
      .set(testIdentityHeader, as('mia'))
      .expect(200)

    expect(answer.text).toContain(";'=1+1;")
    expect((await tableOf('mia'))[1]?.[4]).toBe('=1+1')
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

  it('take how a kind that reminds does so, and refuse it for one that does not (opengewerk-haustechnik#269)', async () => {
    const put = (kind: string, body: object) =>
      http().put(`/settings/deadlines/${kind}`).set(testIdentityHeader, as('lena')).send(body)

    expect((await put('parcel.pickup', { reminder: 'email' }).expect(200)).body).toMatchObject({
      setting: { reminder: 'email' },
    })
    expect((await put('parcel.pickup', { reminder: 'none' }).expect(200)).body).toMatchObject({
      setting: { reminder: 'none' },
    })
    // Back to the way of the kind, by mail and by push.
    expect((await put('parcel.pickup', { reminder: null }).expect(200)).body).toMatchObject({
      setting: { reminder: null },
    })
    // Push alone is no way of reminding: it reaches only who switched it on.
    expect((await put('parcel.pickup', { reminder: 'push' }).expect(400)).body.message).toBe(
      'Die Erinnerung ist "E-Mail und Push", "Nur E-Mail" oder "Keine Nachricht".',
    )
    expect((await put('door.check', { reminder: 'none' }).expect(400)).body.message).toBe(
      'Diese Art erinnert nicht, eine Erinnerung lässt sich für sie nicht einstellen.',
    )
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

describe('whether a deadline reminds on a channel (opengewerk-haustechnik#269)', () => {
  it('leaves out the deadlines of a kind set to keep that channel quiet, in their tenant only', async () => {
    const here = await aDeadline({ label: 'Paket 1', dueOn: '2026-10-20' })
    const there = await aDeadline({ tenant: south.id, label: 'Paket 2', dueOn: '2026-10-20' })
    const reminding = (tenantId: TenantId, channel: 'mail' | 'push') =>
      database
        .forTenant({ tenantId, reason: 'notification' }, (tx) =>
          tx
            .select({ id: probeDeadlines.id })
            .from(probeDeadlines)
            .where(
              deadlineRemindsOn(
                channel,
                sql`${probeDeadlines.tenantId}`,
                sql`${probeDeadlines.kind}`,
              ),
            ),
        )
        .then((rows) => rows.map((row) => row.id))

    // Nothing set: by mail and by push.
    expect(await reminding(north.id, 'mail')).toEqual([here])
    expect(await reminding(north.id, 'push')).toEqual([here])

    await admin.query(
      `insert into deadline_settings (tenant_id, kind, reminder) values ($1, 'parcel.pickup', 'email')`,
      [north.id],
    )
    expect(await reminding(north.id, 'mail')).toEqual([here])
    expect(await reminding(north.id, 'push')).toEqual([])
    // The tenant next door has set nothing.
    expect(await reminding(south.id, 'push')).toEqual([there])

    await admin.query(`update deadline_settings set reminder = 'none' where tenant_id = $1`, [
      north.id,
    ])
    expect(await reminding(north.id, 'mail')).toEqual([])
    expect(await reminding(north.id, 'push')).toEqual([])

    // A way the database does not know is refused there, whoever writes it.
    await expect(
      admin.query(`update deadline_settings set reminder = 'push' where tenant_id = $1`, [
        north.id,
      ]),
    ).rejects.toThrow(/deadline_settings_reminder_known/)
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
