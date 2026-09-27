import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import {
  type AuditChainReport,
  type AuditPage,
  auditPageSize,
  type RoleKey,
  type TenantId,
} from '@opengewerk/domain'
import { eq } from 'drizzle-orm'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { Database } from '../database/database.js'
import { newId } from '../database/identifier.js'
import { contacts, customers, memberships } from '../database/schema/index.js'
import {
  allowApplicationLogin,
  applicationDatabaseUrl,
  applyMigrations,
  connect,
  resetSchema,
} from '../database/test-database.js'
import { ApiModule } from './api.module.js'
import type { AuditPerson } from './audit.controller.js'
import { testIdentities as identities } from './test-identity.js'

/**
 * The change log for the owner, #285. What the routes hold: only the owner
 * reads it, never another business's, a page cuts between changes and not
 * through one, the log of a record takes in its parts and nothing else, and
 * the check of the chain finds an entry changed behind the application's back
 * as well as entries taken from its end.
 */

const north = newId<'tenant'>() as TenantId
const south = newId<'tenant'>() as TenantId
/** A business of its own for the damaged chain, so no other test sees the damage. */
const west = newId<'tenant'>() as TenantId

const people = {
  olga: { name: 'Olga Owner', tenant: north, roles: ['owner'] },
  britta: { name: 'Britta Büro', tenant: north, roles: ['office'] },
  max: { name: 'Max Monteur', tenant: north, roles: ['technician'] },
  susi: { name: 'Susi Süd', tenant: south, roles: ['owner'] },
  wanda: { name: 'Wanda West', tenant: west, roles: ['owner'] },
} as const

type Person = keyof typeof people

let admin: Pool
let database: Database
let app: INestApplication

function as(person: Person): string {
  const { tenant, roles } = people[person]

  return JSON.stringify({ userId: person, tenantId: tenant, roles: [...roles] as RoleKey[] })
}

function get(person: Person, path: string) {
  return request(app.getHttpServer()).get(path).set('x-test-identity', as(person))
}

async function page(person: Person, query = ''): Promise<AuditPage> {
  const answer = await get(person, `/audit/changes${query}`).expect(200)

  return answer.body as AuditPage
}

/** A customer written the way the application writes one, by a person on a device. */
async function customer(
  tenantId: TenantId,
  userId: string,
  name: string,
  deviceId?: string,
): Promise<string> {
  const [row] = await database.forTenant(
    { tenantId, userId, reason: 'sync.write', ...(deviceId ? { deviceId } : {}) },
    (tx) =>
      tx
        .insert(customers)
        .values({ tenantId, kind: 'business', name })
        .returning({ id: customers.id }),
  )

  if (!row) {
    throw new Error('No customer')
  }

  return row.id
}

const northCustomers: Record<string, string> = {}
let contactId = ''

beforeAll(async () => {
  admin = await connect()
  await resetSchema(admin)
  await applyMigrations()
  await allowApplicationLogin(admin)
  await admin.query('insert into tenants (id, name) values ($1, $2), ($3, $4), ($5, $6)', [
    north,
    'Elektro Nord GmbH',
    south,
    'Elektro Süd GmbH',
    west,
    'Elektro West GmbH',
  ])

  database = Database.connect(applicationDatabaseUrl())

  for (const [userId, person] of Object.entries(people)) {
    await admin.query('insert into auth_users (id, name, email) values ($1, $2, $3)', [
      userId,
      person.name,
      `${userId}@example.de`,
    ])
    // Through the application, so that the membership is in the business's log
    // the way every real one is.
    await database.forTenant({ tenantId: person.tenant, reason: 'membership.create' }, (tx) =>
      tx.insert(memberships).values({ tenantId: person.tenant, userId, roles: [...person.roles] }),
    )
  }

  // One browser a device of Britta's signed in with, still signed in.
  await admin.query(
    `insert into auth_sessions (id, token, user_id, expires_at, user_agent, device_id)
     values ('session-britta', 'token-britta', 'britta', now() + interval '1 day',
             'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/129.0 Mobile Safari/537.36',
             'device-britta')`,
  )

  northCustomers['hv'] = await customer(north, 'britta', 'Hausverwaltung Süd GmbH', 'device-britta')
  northCustomers['other'] = await customer(north, 'olga', 'Bäckerei Hoffmann e.K.')

  await database.forTenant(
    { tenantId: north, userId: 'britta', reason: 'sync.write', deviceId: 'device-britta' },
    (tx) =>
      tx
        .update(customers)
        .set({ street: 'Rheinstraße', phone: '0621 400 18 24' })
        .where(eq(customers.id, northCustomers['hv'] as never)),
  )

  const [contact] = await database.forTenant(
    { tenantId: north, userId: 'olga', reason: 'customer.write' },
    (tx) =>
      tx
        .insert(contacts)
        .values({
          tenantId: north,
          customerId: northCustomers['hv'] as never,
          givenName: 'Sabine',
          familyName: 'Keller',
        })
        .returning({ id: contacts.id }),
  )
  contactId = contact?.id ?? ''

  await customer(south, 'susi', 'Südstern OHG')
  await customer(west, 'wanda', 'Westwind KG')

  app = (
    await Test.createTestingModule({ imports: [ApiModule.create(database, identities)] }).compile()
  ).createNestApplication()
  await app.init()
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
})

describe('who reads the log', () => {
  it.each(['britta', 'max'] as const)('refuses %s, who is not the owner', async (person) => {
    await get(person, '/audit/changes').expect(403)
    await get(person, '/audit/chain').expect(403)
    await get(person, '/audit/people').expect(403)
  })

  it('shows the owner the changes of the business, newest first, with names', async () => {
    const found = await page('olga')
    const update = found.changes.find(
      (change) => change.recordId === northCustomers['hv'] && change.operation === 'update',
    )

    expect(found.changes.length).toBeGreaterThan(3)
    expect(update?.fields.map((field) => field.field)).toEqual(['phone', 'street'])
    expect(update?.fields.find((field) => field.field === 'street')).toEqual({
      field: 'street',
      before: null,
      after: 'Rheinstraße',
    })
    expect(update?.userId).toBe('britta')
    expect(update?.reason).toBe('sync.write')
    expect(found.people['britta']).toBe('Britta Büro')
    expect(found.titles[northCustomers['hv'] ?? '']).toMatchObject({
      table: 'customers',
      title: 'Hausverwaltung Süd GmbH',
      kind: 'business',
    })

    const sequences = found.changes.map((change) => change.firstSequence)

    expect(sequences).toEqual([...sequences].sort((one, other) => other - one))
  })

  it('names the device a change came from, also when the change does not move it', async () => {
    const found = await page('olga', `?table=customers&record=${northCustomers['hv']}`)
    const writes = found.changes.filter((change) => change.table === 'customers')

    // The insert set the device and the update kept it: both came from it.
    expect(writes.map((change) => change.deviceId)).toEqual(['device-britta', 'device-britta'])
    expect(found.devices['device-britta']).toContain('Android')
  })

  it('never shows the log of another business', async () => {
    const south = await page('susi')

    expect(south.changes.every((change) => change.recordId !== northCustomers['hv'])).toBe(true)
    expect(Object.values(south.titles).map((title) => title.title)).not.toContain(
      'Hausverwaltung Süd GmbH',
    )

    const narrowed = await page('susi', `?table=customers&record=${northCustomers['hv']}`)

    expect(narrowed.changes).toEqual([])
  })
})

describe('the log of one record', () => {
  it('takes in the parts of the record and nothing beside it', async () => {
    const found = await page('olga', `?table=customers&record=${northCustomers['hv']}`)
    const records = new Set(found.changes.map((change) => change.recordId))

    expect(records).toEqual(new Set([northCustomers['hv'], contactId]))
    expect(found.titles[contactId]).toMatchObject({ table: 'contacts', title: 'Sabine Keller' })
  })

  it('names what a field points at', async () => {
    const found = await page('olga', `?table=customers&record=${northCustomers['hv']}`)
    const contact = found.changes.find((change) => change.recordId === contactId)

    expect(contact?.fields.find((field) => field.field === 'customer_id')?.after).toBe(
      northCustomers['hv'],
    )
    expect(found.titles[northCustomers['hv'] ?? '']?.title).toBe('Hausverwaltung Süd GmbH')
  })
})

describe('filters and pages', () => {
  it('narrows to a person and to a kind of record', async () => {
    const britta = await page('olga', '?person=britta')

    expect(britta.changes.length).toBeGreaterThan(0)
    expect(britta.changes.every((change) => change.userId === 'britta')).toBe(true)

    const contactsOnly = await page('olga', '?table=contacts')

    expect(contactsOnly.changes.map((change) => change.recordId)).toEqual([contactId])
  })

  it('narrows to days in Berlin', async () => {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(new Date())

    expect((await page('olga', `?since=${today}`)).changes.length).toBeGreaterThan(0)
    expect((await page('olga', '?until=2020-01-01')).changes).toEqual([])
  })

  it('cuts pages between changes and loses none', async () => {
    for (let index = 0; index < auditPageSize + 5; index += 1) {
      await customer(south, 'susi', `Kunde ${String(index)}`)
    }

    const first = await page('susi', '?table=customers')

    expect(first.changes).toHaveLength(auditPageSize)
    expect(first.next).not.toBeNull()

    const second = await page('susi', `?table=customers&before=${String(first.next)}`)
    const all = [...first.changes, ...second.changes]

    expect(second.next).toBeNull()
    expect(new Set(all.map((change) => change.changeId)).size).toBe(all.length)
    // Every customer of the south once, each with all its fields in one change.
    expect(all.filter((change) => change.operation === 'insert')).toHaveLength(auditPageSize + 6)
    expect(all.every((change) => change.fields.some((field) => field.field === 'name'))).toBe(true)
  })

  it('refuses a filter that is not one', async () => {
    await get('olga', '/audit/changes?since=27.09.2026').expect(400)
    await get('olga', '/audit/changes?since=2026-09-27&until=2026-09-01').expect(400)
    await get('olga', '/audit/changes?table=secrets').expect(400)
    await get('olga', `/audit/changes?record=${northCustomers['hv']}`).expect(400)
    await get('olga', `/audit/changes?table=contacts&record=${contactId}`).expect(400)
    await get('olga', '/audit/changes?before=0').expect(400)
  })
})

describe('the people for the filter', () => {
  it('lists everybody who worked in the business, by name', async () => {
    const answer = await get('olga', '/audit/people').expect(200)

    expect((answer.body as AuditPerson[]).map((person) => person.name)).toEqual([
      'Britta Büro',
      'Max Monteur',
      'Olga Owner',
    ])
  })
})

describe('the check of the chain', () => {
  async function check(person: Person): Promise<AuditChainReport> {
    const answer = await get(person, '/audit/chain').expect(200)

    return answer.body as AuditChainReport
  }

  it('finds the chain of a business whole', async () => {
    const report = await check('olga')

    expect(report.brokenAt).toBeNull()
    expect(report.problem).toBeNull()
    expect(report.checked).toBeGreaterThan(5)
  })

  it('finds an entry changed past the application, and when it was written', async () => {
    const client = await admin.connect()

    try {
      await client.query('alter table audit_entries disable trigger "audit_entries_stay"')
      await client.query(
        `update audit_entries set new_value = 'Ostwind KG'
          where tenant_id = $1 and table_name = 'customers' and field = 'name'`,
        [west],
      )
    } finally {
      await client.query('alter table audit_entries enable trigger "audit_entries_stay"')
      client.release()
    }

    const report = await check('wanda')

    expect(report.problem).toBe('Der Eintrag wurde nachträglich verändert.')
    expect(report.brokenAt).toBeGreaterThan(0)
    expect(report.brokenAtTime).not.toBeNull()
    // The other businesses are not touched by it.
    expect((await check('olga')).brokenAt).toBeNull()
  })

  it('finds entries taken from the end of the chain', async () => {
    const client = await admin.connect()

    try {
      await client.query('alter table audit_entries disable trigger "audit_entries_stay"')
      await client.query(
        `delete from audit_entries
          where tenant_id = $1
            and sequence = (select max(sequence) from audit_entries where tenant_id = $1)`,
        [south],
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
