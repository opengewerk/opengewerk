import 'reflect-metadata'
import type { INestApplication } from '@nestjs/common'
import { APP_FILTER, APP_GUARD } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import {
  type AuditChainReport,
  type AuditPage,
  auditPageSize,
  type AuditPerson,
  auditRights,
  type MemberIdentity,
  rightsCatalogue,
  type TenantId,
} from '@opengewerk/platform-domain'
import { probeAuditVocabulary } from '@opengewerk/platform-domain/testing'
import { eq } from 'drizzle-orm'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { type Authorization, AUTHORIZATION, AuthorizationGuard } from '../api/authorization.js'
import { databaseErrors } from '../api/database-errors.js'
import { TRUSTED_ORIGINS } from '../api/handed-in.js'
import { IDENTITY_SOURCE } from '../api/identity.js'
import { SameOriginGuard } from '../api/origin.js'
import { headerIdentities, testIdentityHeader } from '../api/test-identity.js'
import {
  probeAuthorization,
  probeCatalogue,
  type ProbeFoundation,
  probeFoundation,
} from '../authentication/probe-application.js'
import { Database } from '../database/database.js'
import { newId } from '../database/identifier.js'
import type { TenantTransaction } from '../database/database.js'
import { memberships } from '../database/schema/memberships.js'
import { invitations } from '../schema.js'
import { letterLines, letters, notes, probeSyncMade, shelves } from '../sync/probe-sync.js'
import { checkAuditChain } from './chain.js'
import { auditLogParts } from './controller.js'

/**
 * The change log of a tenant, for an application that is nobody's (ADR 0010):
 * the probe application with its shelves and notes, its letters and their
 * lines, tables no application of the organisation has. What the routes hold:
 * only whoever has the right reads it, never another tenant's, a page cuts
 * between changes and not through one, the log of a record takes in its parts
 * and nothing else, a part named after its record brings that record's name,
 * and the check of the chain finds an entry changed behind the application's
 * back as well as entries taken from its end.
 */

/** The rights of the probe application, with the one of the log. */
const catalogue = rightsCatalogue([...probeCatalogue.rights, auditRights.read])

type Right = (typeof catalogue.rights)[number]

const words: Authorization<Right> = probeAuthorization

const north = { id: newId<'tenant'>() as TenantId, name: 'Mandant Nord' }
const south = { id: newId<'tenant'>() as TenantId, name: 'Mandant Süd' }
/** A tenant of its own for the damaged chain, so no other test sees the damage. */
const west = { id: newId<'tenant'>() as TenantId, name: 'Mandant West' }

const people = {
  lea: { name: 'Lea Leitung', tenant: north.id, rights: [auditRights.read] },
  mia: { name: 'Mia Mitglied', tenant: north.id, rights: ['notes.write'] },
  gero: { name: 'Gero Gast', tenant: north.id, rights: ['members.read'] },
  susi: { name: 'Susi Süd', tenant: south.id, rights: [auditRights.read] },
  wanda: { name: 'Wanda West', tenant: west.id, rights: [auditRights.read] },
} as const satisfies Record<string, { name: string; tenant: TenantId; rights: readonly Right[] }>

type Person = keyof typeof people

let foundation: ProbeFoundation
let admin: Pool
let database: Database
let app: INestApplication

function get(person: Person, path: string) {
  const { tenant, rights } = people[person]
  const identity: MemberIdentity<Right> = {
    userId: person,
    tenantId: tenant,
    roles: [],
    rights: [...rights],
  }

  return request(app.getHttpServer()).get(path).set(testIdentityHeader, JSON.stringify(identity))
}

async function page(person: Person, query = ''): Promise<AuditPage> {
  const answer = await get(person, `/audit/changes${query}`).expect(200)

  return answer.body as AuditPage
}

/** A shelf written the way the application writes one, by a person, maybe on a device. */
async function shelf(
  tenantId: TenantId,
  userId: string,
  label: string,
  deviceId?: string,
): Promise<string> {
  const [row] = await database.forTenant(
    { tenantId, userId, reason: 'shelves.write', ...(deviceId ? { deviceId } : {}) },
    (tx) =>
      tx
        .insert(shelves)
        .values({ tenantId, label, ...(deviceId ? { deviceId } : {}) })
        .returning({ id: shelves.id }),
  )

  if (!row) {
    throw new Error('No shelf')
  }

  return row.id
}

const northShelves: Record<string, string> = {}
let noteId = ''
let letterId = ''
let lineId = ''

beforeAll(async () => {
  foundation = await probeFoundation(probeSyncMade)
  admin = await foundation.kit.connect()
  await foundation.empty()
  await foundation.tenants(admin, [north, south, west])
  database = Database.connect(foundation.kit.applicationDatabaseUrl())

  for (const [userId, person] of Object.entries(people)) {
    await admin.query('insert into auth_users (id, name, email) values ($1, $2, $3)', [
      userId,
      person.name,
      `${userId}@example.de`,
    ])
    // Through the application, so that the membership is in the tenant's log
    // the way every real one is.
    await database.forTenant({ tenantId: person.tenant, reason: 'membership.create' }, (tx) =>
      tx.insert(memberships).values({ tenantId: person.tenant, userId, roles: ['member'] }),
    )
  }

  // One browser a device of Mia's signed in with, still signed in.
  await admin.query(
    `insert into auth_sessions (id, token, user_id, expires_at, user_agent, device_id)
     values ('session-mia', 'token-mia', 'mia', now() + interval '1 day',
             'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/129.0 Mobile Safari/537.36',
             'device-mia')`,
  )

  northShelves['tools'] = await shelf(north.id, 'mia', 'Werkzeug', 'device-mia')
  northShelves['other'] = await shelf(north.id, 'lea', 'Ersatzteile')

  await database.forTenant(
    { tenantId: north.id, userId: 'mia', reason: 'shelves.write', deviceId: 'device-mia' },
    (tx) =>
      tx
        .update(shelves)
        .set({ label: 'Werkzeug und Messgeräte', closed: true })
        .where(eq(shelves.id, northShelves['tools'] as never)),
  )

  const [note] = await database.forTenant(
    { tenantId: north.id, userId: 'lea', reason: 'notes.write' },
    (tx) =>
      tx
        .insert(notes)
        .values({
          tenantId: north.id,
          shelfId: northShelves['tools'] as never,
          text: 'Zange fehlt',
        })
        .returning({ id: notes.id }),
  )
  noteId = note?.id ?? ''

  // A note on the other shelf, which the log of the first never takes in.
  await database.forTenant({ tenantId: north.id, userId: 'lea', reason: 'notes.write' }, (tx) =>
    tx
      .insert(notes)
      .values({ tenantId: north.id, shelfId: northShelves['other'] as never, text: 'Sicherungen' }),
  )

  const [letter] = await database.forTenant(
    { tenantId: north.id, userId: 'lea', reason: 'letters.write' },
    (tx) =>
      tx
        .insert(letters)
        .values({ tenantId: north.id, subject: 'Wartung im Oktober' })
        .returning({ id: letters.id }),
  )
  letterId = letter?.id ?? ''

  const [line] = await database.forTenant(
    { tenantId: north.id, userId: 'lea', reason: 'letters.write' },
    (tx) =>
      tx
        .insert(letterLines)
        .values({ tenantId: north.id, letterId: letterId as never, quantity: 2, price: 1500 })
        .returning({ id: letterLines.id }),
  )
  lineId = line?.id ?? ''

  // Somebody else changes the line and leaves its letter alone, so that a page
  // of her changes carries no field that points at the letter.
  await database.forTenant({ tenantId: north.id, userId: 'mia', reason: 'letters.write' }, (tx) =>
    tx
      .update(letterLines)
      .set({ quantity: 3 })
      .where(eq(letterLines.id, lineId as never)),
  )

  await shelf(south.id, 'susi', 'Südregal')
  await shelf(west.id, 'wanda', 'Westregal')

  const parts = auditLogParts({ access: { catalogue }, vocabulary: probeAuditVocabulary })

  app = (
    await Test.createTestingModule({
      controllers: parts.controllers,
      providers: [
        { provide: Database, useValue: database },
        ...parts.providers,
        { provide: IDENTITY_SOURCE, useValue: headerIdentities<MemberIdentity<Right>>() },
        { provide: AUTHORIZATION, useValue: words },
        { provide: TRUSTED_ORIGINS, useValue: [] },
        { provide: APP_GUARD, useClass: SameOriginGuard },
        { provide: APP_GUARD, useClass: AuthorizationGuard },
        { provide: APP_FILTER, useClass: databaseErrors().DatabaseExceptionFilter },
      ],
    }).compile()
  ).createNestApplication()
  await app.init()
}, 60_000)

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
  foundation.remove()
})

describe('the routes of the log', () => {
  it('are refused to an application whose catalogue lacks the right of the log', () => {
    expect(() =>
      auditLogParts({ access: { catalogue: probeCatalogue }, vocabulary: probeAuditVocabulary }),
    ).toThrow('The catalogue lacks the right of the change log: audit.read')
  })
})

describe('who reads the log', () => {
  it.each(['mia', 'gero'] as const)('refuses %s, who lacks the right', async (person) => {
    await get(person, '/audit/changes').expect(403)
    await get(person, '/audit/chain').expect(403)
    await get(person, '/audit/people').expect(403)
  })

  it('shows the changes of the tenant, newest first, with names', async () => {
    const found = await page('lea')
    const update = found.changes.find(
      (change) => change.recordId === northShelves['tools'] && change.operation === 'update',
    )

    expect(found.changes.length).toBeGreaterThan(5)
    expect(update?.fields.map((field) => field.field)).toEqual(['closed', 'label'])
    expect(update?.fields.find((field) => field.field === 'label')).toEqual({
      field: 'label',
      before: 'Werkzeug',
      after: 'Werkzeug und Messgeräte',
    })
    expect(update?.userId).toBe('mia')
    expect(update?.reason).toBe('shelves.write')
    expect(found.people['mia']).toBe('Mia Mitglied')
    expect(found.titles[northShelves['tools'] ?? '']).toEqual({
      table: 'shelves',
      field: 'label',
      title: 'Werkzeug und Messgeräte',
      kind: null,
    })

    const sequences = found.changes.map((change) => change.firstSequence)

    expect(sequences).toEqual([...sequences].sort((one, other) => other - one))
  })

  it('names the device a change came from, also when the change does not move it', async () => {
    const found = await page('lea', `?table=shelves&record=${northShelves['tools']}`)
    const writes = found.changes.filter((change) => change.table === 'shelves')

    // The insert set the device and the update kept it: both came from it.
    expect(writes.map((change) => change.deviceId)).toEqual(['device-mia', 'device-mia'])
    expect(found.devices['device-mia']).toContain('Android')
  })

  it('never shows the log of another tenant', async () => {
    const southern = await page('susi')

    expect(southern.changes.every((change) => change.recordId !== northShelves['tools'])).toBe(true)
    expect(Object.values(southern.titles).map((title) => title.title)).not.toContain(
      'Werkzeug und Messgeräte',
    )

    const narrowed = await page('susi', `?table=shelves&record=${northShelves['tools']}`)

    expect(narrowed.changes).toEqual([])
  })
})

describe('the log of one record', () => {
  it('takes in the parts of the record and nothing beside it', async () => {
    const found = await page('lea', `?table=shelves&record=${northShelves['tools']}`)
    const records = new Set(found.changes.map((change) => change.recordId))

    expect(records).toEqual(new Set([northShelves['tools'], noteId]))
    expect(found.titles[noteId]).toMatchObject({ table: 'notes', title: 'Zange fehlt' })
  })

  it('names what a field points at', async () => {
    const found = await page('lea', `?table=shelves&record=${northShelves['tools']}`)
    const note = found.changes.find((change) => change.recordId === noteId)

    expect(note?.fields.find((field) => field.field === 'shelf_id')?.after).toBe(
      northShelves['tools'],
    )
    expect(found.titles[northShelves['tools'] ?? '']?.title).toBe('Werkzeug und Messgeräte')
  })

  it('brings the name of the record a part is named after', async () => {
    const found = await page('lea', `?table=letters&record=${letterId}`)

    expect(new Set(found.changes.map((change) => change.recordId))).toEqual(
      new Set([letterId, lineId]),
    )
    expect(found.titles[lineId]).toEqual({
      table: 'letter_lines',
      field: 'letter_id',
      title: letterId,
      kind: null,
    })
    expect(found.titles[letterId]?.title).toBe('Wartung im Oktober')
  })

  it('names that record also when no change on the page points at it', async () => {
    const found = await page('lea', '?person=mia&table=letter_lines')

    expect(found.changes.map((change) => change.recordId)).toEqual([lineId])
    expect(found.changes[0]?.fields.some((field) => field.field === 'letter_id')).toBe(false)
    expect(found.titles[lineId]?.title).toBe(letterId)
    expect(found.titles[letterId]?.title).toBe('Wartung im Oktober')
  })
})

describe('filters and pages', () => {
  it('narrows to a person and to a kind of record', async () => {
    const mia = await page('lea', '?person=mia')

    expect(mia.changes.length).toBeGreaterThan(0)
    expect(mia.changes.every((change) => change.userId === 'mia')).toBe(true)

    const lines = await page('lea', '?table=letter_lines')

    // The line as it was made and as it was changed after.
    expect(lines.changes.map((change) => change.recordId)).toEqual([lineId, lineId])
  })

  it('narrows to days in Berlin', async () => {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(new Date())

    expect((await page('lea', `?since=${today}`)).changes.length).toBeGreaterThan(0)
    expect((await page('lea', '?until=2020-01-01')).changes).toEqual([])
  })

  it('cuts pages between changes and loses none', async () => {
    for (let index = 0; index < auditPageSize + 5; index += 1) {
      await shelf(south.id, 'susi', `Regal ${String(index)}`)
    }

    const first = await page('susi', '?table=shelves')

    expect(first.changes).toHaveLength(auditPageSize)
    expect(first.next).not.toBeNull()

    const second = await page('susi', `?table=shelves&before=${String(first.next)}`)
    const all = [...first.changes, ...second.changes]

    expect(second.next).toBeNull()
    expect(new Set(all.map((change) => change.changeId)).size).toBe(all.length)
    // Every shelf of the south once, each with all its fields in one change.
    expect(all.filter((change) => change.operation === 'insert')).toHaveLength(auditPageSize + 6)
    expect(all.every((change) => change.fields.some((field) => field.field === 'label'))).toBe(true)
  })

  it('refuses a filter that is not one, in words a person reads', async () => {
    await get('lea', '/audit/changes?since=03.10.2026').expect(400)
    await get('lea', '/audit/changes?since=2026-10-03&until=2026-09-01').expect(400)
    await get('lea', '/audit/changes?table=secrets').expect(400)
    await get('lea', '/audit/changes?before=0').expect(400)

    const single = await get('lea', `/audit/changes?table=notes&record=${noteId}`).expect(400)

    expect((single.body as { message: string }).message).toBe(
      'Einen einzelnen Datensatz gibt es nur für Regal und Brief, mit table.',
    )
    await get('lea', `/audit/changes?record=${noteId}`).expect(400)
  })
})

describe('the people for the filter', () => {
  it('lists everybody who worked in the tenant, by name', async () => {
    const answer = await get('lea', '/audit/people').expect(200)

    expect((answer.body as AuditPerson[]).map((person) => person.name)).toEqual([
      'Gero Gast',
      'Lea Leitung',
      'Mia Mitglied',
    ])
  })
})

describe('the check of the chain', () => {
  async function check(person: Person): Promise<AuditChainReport> {
    const answer = await get(person, '/audit/chain').expect(200)

    return answer.body as AuditChainReport
  }

  it('finds the chain of a tenant whole', async () => {
    const report = await check('lea')

    expect(report.brokenAt).toBeNull()
    expect(report.problem).toBeNull()
    expect(report.checked).toBeGreaterThan(5)
  })

  /**
   * A tenant is at work while its chain is checked. The check asks twice, how
   * far the chain fits together and how many entries its head counts, and a
   * change written between the two was an entry the head counted and the walk
   * had not seen: a whole log was reported as one with its newest entries
   * taken away. Both are read as the tenant stood at one moment.
   *
   * The change is written here the moment the check has had its first answer,
   * through the database it was handed, so that it lands exactly between the
   * two and not when chance has it.
   */
  it('reads the chain as it stood at one moment, also while the tenant is at work', async () => {
    let answered = 0

    const interrupted = (tx: TenantTransaction): TenantTransaction =>
      new Proxy(tx, {
        get(target, property) {
          const found: unknown = Reflect.get(target, property, target)

          if (property !== 'execute' || typeof found !== 'function') {
            return typeof found === 'function' ? found.bind(target) : found
          }

          return async (...statement: unknown[]) => {
            const result: unknown = await Reflect.apply(found, target, statement)

            answered += 1

            if (answered === 1) {
              await shelf(north.id, 'mia', 'Zwischenregal')
            }

            return result
          }
        },
      })
    const atWork = {
      forTenant: (
        actor: Parameters<Database['forTenant']>[0],
        work: (tx: TenantTransaction) => unknown,
      ) => database.forTenant(actor, (tx) => Promise.resolve(work(interrupted(tx)))),
      readingTenant: (
        actor: Parameters<Database['readingTenant']>[0],
        work: (tx: TenantTransaction) => unknown,
      ) => database.readingTenant(actor, (tx) => Promise.resolve(work(interrupted(tx)))),
    } as unknown as Database

    const before = await check('lea')
    const report = await checkAuditChain(atWork, { tenantId: north.id, userId: 'lea' })

    expect(answered).toBeGreaterThan(1)
    expect(report.problem).toBeNull()
    expect(report.brokenAt).toBeNull()
    // What it saw is the chain from before the shelf, and the shelf is in the
    // chain the next check walks.
    expect(report.checked).toBe(before.checked)
    expect((await check('lea')).checked).toBeGreaterThan(report.checked)
  })

  it('finds an entry changed past the application, and when it was written', async () => {
    const client = await admin.connect()

    try {
      await client.query('alter table audit_entries disable trigger "audit_entries_stay"')
      await client.query(
        `update audit_entries set new_value = 'Ostregal'
          where tenant_id = $1 and table_name = 'shelves' and field = 'label'`,
        [west.id],
      )
    } finally {
      await client.query('alter table audit_entries enable trigger "audit_entries_stay"')
      client.release()
    }

    const report = await check('wanda')

    expect(report.problem).toBe('Der Eintrag wurde nachträglich verändert.')
    expect(report.brokenAt).toBeGreaterThan(0)
    expect(report.brokenAtTime).not.toBeNull()
    // The other tenants are not touched by it.
    expect((await check('lea')).brokenAt).toBeNull()
  })

  it('finds entries taken from the end of the chain', async () => {
    const client = await admin.connect()

    try {
      await client.query('alter table audit_entries disable trigger "audit_entries_stay"')
      await client.query(
        `delete from audit_entries
          where tenant_id = $1
            and sequence = (select max(sequence) from audit_entries where tenant_id = $1)`,
        [south.id],
      )
    } finally {
      await client.query('alter table audit_entries enable trigger "audit_entries_stay"')
      client.release()
    }

    const report = await check('susi')

    expect(report.problem).toBe('Der letzte Eintrag fehlt.')
    expect(report.brokenAt).toBe(report.checked + 1)
  })
})

describe('a value the log keeps to itself', () => {
  /**
   * The log holds the hash of a one time link as it holds every value, and
   * the chain is hashed over it. What a reader of the log gets is that it was
   * set. Hidden on the page alone, it went out with the answer to everybody
   * who may read the log, for any page to show (opengewerk-haustechnik#31).
   */
  it('never leaves the server, on the page of all changes or on the one of its table', async () => {
    const hash = 'c0ffee'.repeat(10)

    await database.forTenant(
      { tenantId: north.id, userId: 'lea', reason: 'membership.write' },
      (tx) =>
        tx.insert(invitations).values({
          tenantId: north.id,
          email: 'neu@example.de',
          name: 'Nele Neu',
          roles: ['member'],
          tokenHash: hash,
          invitedBy: 'lea',
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        }),
    )

    const every = await get('lea', '/audit/changes').expect(200)
    const narrowed = await get('lea', '/audit/changes?table=invitations').expect(200)
    const [change] = (narrowed.body as AuditPage).changes

    expect(change?.fields.find((field) => field.field === 'token_hash')).toEqual({
      field: 'token_hash',
      before: null,
      after: 'gesetzt',
    })
    // The address beside it is no secret and reads as it is.
    expect(change?.fields.find((field) => field.field === 'email')?.after).toBe('neu@example.de')
    expect(JSON.stringify(every.body)).not.toContain(hash)
    expect(JSON.stringify(narrowed.body)).not.toContain(hash)

    const { rows } = await admin.query<{ new_value: string }>(
      `select new_value from audit_entries
        where tenant_id = $1 and table_name = 'invitations' and field = 'token_hash'`,
      [north.id],
    )

    expect(rows).toEqual([{ new_value: hash }])
  })
})
