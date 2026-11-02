import type { TenantId } from '@opengewerk/domain'
import { Database, newId } from '@opengewerk/platform-server'
import type { Pool } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { deadlines, tasks } from '../database/schema/index.js'
import {
  applicationDatabaseUrl,
  connect,
  resetToMigrated,
  shipRoles,
} from '../database/test-database.js'
import { type DeadlineRow, runDeadlinesOf } from './engine.js'

/**
 * The recurring inspection of #301 as a deadline, run against a database:
 * the last signed protocol after DIN VDE 0105-100 of an installation names
 * the interval to the next one, and the deadline engine makes of it one
 * deadline at the installation, due when that protocol says, reminding the
 * person who signed sixty days before. A newer protocol moves it; a draft,
 * a first inspection before its third version and an interval nobody can
 * count with make none; the installation gone, the deadline drops. Since
 * #814 the first inspection of a new installation names the first recurring
 * one, and one after an extension or a change leaves the deadline as it was,
 * unless it names an interval that ends sooner (#822).
 */

const north = newId<'tenant'>() as TenantId
const south = newId<'tenant'>() as TenantId

let admin: Pool
let database: Database
let place: { customer: string; site: string; installation: string }

/** Long before the reminder, like the other tests of the engine, years ahead. */
const early = new Date('2037-06-01T08:00:00Z')

async function aProtocol(over: {
  performedOn: string
  months?: number | null
  key?: string
  version?: number
  status?: 'draft' | 'signed'
  occasion?: string
  by?: string
  installation?: string
  tenant?: TenantId
}): Promise<string> {
  const id = newId<'form-record'>()
  const values: Record<string, unknown> = { tester: 'Max Monteur' }

  if (over.months !== null) {
    values['next_inspection_months'] = (over.months ?? 48) * 1000
  }

  if (over.occasion !== undefined) {
    values['occasion'] = over.occasion
  }

  // Who writes a row is what the trigger of 0004 takes from the session, as
  // the sync sets it: for a signed protocol, whoever signed it.
  const client = await admin.connect()

  try {
    await client.query('begin')
    await client.query(`select set_config('app.user_id', $1, true)`, [over.by ?? 'max'])
    await client.query(
      `insert into form_records (id, tenant_id, definition_key, definition_version, installation_id, performed_on, status, values)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        id,
        over.tenant ?? north,
        over.key ?? 'vde-0105-100',
        over.version ?? 1,
        over.installation ?? place.installation,
        over.performedOn,
        over.status ?? 'signed',
        JSON.stringify(values),
      ],
    )
    await client.query('commit')
  } finally {
    client.release()
  }

  return id
}

async function kept(tenant: TenantId = north): Promise<DeadlineRow[]> {
  return database.forTenant({ tenantId: tenant }, (tx) => tx.select().from(deadlines))
}

beforeAll(async () => {
  admin = await connect()
  await resetToMigrated()
  await admin.query('insert into tenants (id, name) values ($1, $2), ($3, $4)', [
    north,
    'Elektro Nord GmbH',
    south,
    'Elektro Süd GmbH',
  ])
  await shipRoles(admin, north, south)

  for (const [userId, name, tenant, roles] of [
    ['olga', 'Olga Inhaberin', north, ['owner']],
    ['max', 'Max Monteur', north, ['technician']],
    ['susi', 'Susi Süd', south, ['owner']],
  ] as const) {
    await admin.query('insert into auth_users (id, name, email) values ($1, $2, $3)', [
      userId,
      name,
      `${userId}@example.de`,
    ])
    await admin.query('insert into memberships (tenant_id, user_id, roles) values ($1, $2, $3)', [
      tenant,
      userId,
      [...roles],
    ])
  }

  database = Database.connect(applicationDatabaseUrl())
})

beforeEach(async () => {
  // Past every rule that keeps a row, as the superuser: a signed protocol is
  // held by the trigger of 0043.
  await admin.query(
    `begin; set local session_replication_role = replica;
     delete from deadlines; delete from tasks; delete from form_records;
     delete from installations; delete from sites; delete from customers;
     commit;`,
  )

  place = {
    customer: newId<'customer'>(),
    site: newId<'site'>(),
    installation: newId<'installation'>(),
  }
  await admin.query(
    `insert into customers (id, tenant_id, kind, name) values ($1, $2, 'business', 'Hausverwaltung Süd GmbH')`,
    [place.customer, north],
  )
  await admin.query(
    `insert into sites (id, tenant_id, customer_id, designation) values ($1, $2, $3, 'Rheinstraße 12')`,
    [place.site, north, place.customer],
  )
  await admin.query(
    `insert into installations (id, tenant_id, site_id, kind, designation)
     values ($1, $2, $3, 'meter_cabinet', 'Zählerschrank, Keller')`,
    [place.installation, north, place.site],
  )
})

afterAll(async () => {
  await database.close()
  await admin.end()
})

describe('a signed protocol of a recurring inspection', () => {
  it('names the next inspection as a deadline at its installation', async () => {
    await aProtocol({ performedOn: '2033-09-18' })

    expect(await runDeadlinesOf({ database }, north, early)).toMatchObject({
      created: 1,
      reminded: 0,
    })
    expect(await kept()).toEqual([
      expect.objectContaining({
        kind: 'elektro.recurring_inspection',
        sourceId: place.installation,
        sourceLabel: 'Zählerschrank, Keller am Objekt Rheinstraße 12',
        installationId: place.installation,
        siteId: place.site,
        customerId: place.customer,
        documentId: null,
        jobId: null,
        anchorOn: '2033-09-18',
        dueOn: '2037-09-18',
        naturalUserId: 'max',
        status: 'open',
      }),
    ])
  })

  it('counts its months the way a period in months ends', async () => {
    await aProtocol({ performedOn: '2036-02-29', months: 12 })
    await runDeadlinesOf({ database }, north, early)

    expect(await kept()).toEqual([expect.objectContaining({ dueOn: '2037-02-28' })])
  })

  it('reminds whoever signed sixty days before, with a task named after the installation', async () => {
    await aProtocol({ performedOn: '2033-09-18' })

    // The 20th of July is sixty days before the 18th of September.
    expect(
      await runDeadlinesOf({ database }, north, new Date('2037-07-19T08:00:00Z')),
    ).toMatchObject({ reminded: 0 })
    expect(
      await runDeadlinesOf({ database }, north, new Date('2037-07-20T08:00:00Z')),
    ).toMatchObject({ reminded: 1 })

    const made = await database.forTenant({ tenantId: north }, (tx) => tx.select().from(tasks))

    expect(made).toEqual([
      expect.objectContaining({
        title: 'Wiederholungsprüfung: Zählerschrank, Keller am Objekt Rheinstraße 12',
        assigneeUserId: 'max',
      }),
    ])
  })

  it('moves with a newer protocol, and a draft does not count', async () => {
    await aProtocol({ performedOn: '2033-09-18' })
    await runDeadlinesOf({ database }, north, early)
    await aProtocol({ performedOn: '2035-03-02', months: 24, by: 'olga' })
    await aProtocol({ performedOn: '2036-01-15', months: 6, status: 'draft' })
    await runDeadlinesOf({ database }, north, early)

    expect(await kept()).toEqual([
      expect.objectContaining({
        anchorOn: '2035-03-02',
        dueOn: '2037-03-02',
        naturalUserId: 'olga',
        status: 'open',
      }),
    ])
  })

  it('keeps its deadline when a first inspection follows it', async () => {
    // An extension tested after DIN VDE 0100-600 names no next inspection;
    // the last recurring one still says when the whole installation is due.
    await aProtocol({ performedOn: '2033-09-18' })
    await aProtocol({ performedOn: '2035-01-10', months: 12, key: 'vde-0100-600', version: 2 })
    await runDeadlinesOf({ database }, north, early)

    expect(await kept()).toEqual([
      expect.objectContaining({ anchorOn: '2033-09-18', dueOn: '2037-09-18', status: 'open' }),
    ])
  })

  it('keeps its deadline when an extension or a change after it names no interval, or a longer one', async () => {
    await aProtocol({ performedOn: '2033-09-18' })
    await aProtocol({
      performedOn: '2035-01-10',
      months: null,
      key: 'vde-0100-600',
      version: 3,
      occasion: 'extension',
    })
    await aProtocol({
      performedOn: '2036-04-20',
      months: 48,
      key: 'vde-0100-600',
      version: 3,
      occasion: 'change',
    })
    await runDeadlinesOf({ database }, north, early)

    expect(await kept()).toEqual([
      expect.objectContaining({ anchorOn: '2033-09-18', dueOn: '2037-09-18', status: 'open' }),
    ])
  })

  it('is drawn forward by an extension or a change after it that is due sooner (#822)', async () => {
    await aProtocol({ performedOn: '2033-09-18' })
    await runDeadlinesOf({ database }, north, early)
    await aProtocol({
      performedOn: '2035-01-10',
      months: 24,
      key: 'vde-0100-600',
      version: 3,
      occasion: 'extension',
      by: 'olga',
    })
    await aProtocol({
      performedOn: '2035-06-01',
      months: 48,
      key: 'vde-0100-600',
      version: 3,
      occasion: 'change',
    })
    await runDeadlinesOf({ database }, north, early)

    expect(await kept()).toEqual([
      expect.objectContaining({
        sourceId: place.installation,
        anchorOn: '2035-01-10',
        dueOn: '2037-01-10',
        naturalUserId: 'olga',
        status: 'open',
      }),
    ])
  })

  it('is not drawn forward by an extension before it', async () => {
    await aProtocol({
      performedOn: '2032-01-10',
      months: 12,
      key: 'vde-0100-600',
      version: 3,
      occasion: 'extension',
    })
    await aProtocol({ performedOn: '2033-09-18' })
    await runDeadlinesOf({ database }, north, early)

    expect(await kept()).toEqual([
      expect.objectContaining({ anchorOn: '2033-09-18', dueOn: '2037-09-18' }),
    ])
  })

  it('drops out when its installation is deleted', async () => {
    await aProtocol({ performedOn: '2033-09-18' })
    await runDeadlinesOf({ database }, north, early)
    await admin.query('update installations set deleted_at = now() where id = $1', [
      place.installation,
    ])
    await runDeadlinesOf({ database }, north, early)

    expect(await kept()).toEqual([expect.objectContaining({ status: 'dropped' })])
  })
})

describe('a signed first inspection of a new installation (#814)', () => {
  it('names the first recurring inspection as the deadline of its installation', async () => {
    await aProtocol({
      performedOn: '2033-09-18',
      months: 48,
      key: 'vde-0100-600',
      version: 3,
      occasion: 'new',
    })
    await runDeadlinesOf({ database }, north, early)

    expect(await kept()).toEqual([
      expect.objectContaining({
        kind: 'elektro.recurring_inspection',
        sourceId: place.installation,
        anchorOn: '2033-09-18',
        dueOn: '2037-09-18',
        naturalUserId: 'max',
        status: 'open',
      }),
    ])
  })

  it('moves the deadline of a recurring inspection before it', async () => {
    await aProtocol({ performedOn: '2031-05-04' })
    await aProtocol({
      performedOn: '2034-02-01',
      months: 24,
      key: 'vde-0100-600',
      version: 3,
      occasion: 'new',
    })
    await runDeadlinesOf({ database }, north, early)

    expect(await kept()).toEqual([
      expect.objectContaining({ anchorOn: '2034-02-01', dueOn: '2036-02-01' }),
    ])
  })
})

describe('no deadline comes', () => {
  it('from a first inspection before its third version, which names no next one', async () => {
    await aProtocol({ performedOn: '2033-09-18', key: 'vde-0100-600', version: 2 })
    await runDeadlinesOf({ database }, north, early)

    expect(await kept()).toEqual([])
  })

  it('from the first inspection of an extension, with no test of the whole before it', async () => {
    await aProtocol({
      performedOn: '2033-09-18',
      months: 48,
      key: 'vde-0100-600',
      version: 3,
      occasion: 'extension',
    })
    await runDeadlinesOf({ database }, north, early)

    expect(await kept()).toEqual([])
  })

  it('from a last protocol whose interval nobody can count with, not even out of an older one', async () => {
    await aProtocol({ performedOn: '2031-05-04' })
    await aProtocol({ performedOn: '2033-09-18', months: 0 })
    await runDeadlinesOf({ database }, north, early)

    expect(await kept()).toEqual([])
  })

  it('from a protocol of another business', async () => {
    await aProtocol({ performedOn: '2033-09-18' })
    await runDeadlinesOf({ database }, south, early)

    expect(await kept(south)).toEqual([])
  })
})

describe('a signed commissioning protocol of a wallbox (#307)', () => {
  it('names the first recurring inspection, as the first inspection of a new installation does', async () => {
    await aProtocol({ performedOn: '2033-11-02', months: 48, key: 'vde-0100-722' })
    await runDeadlinesOf({ database }, north, early)

    expect(await kept()).toEqual([
      expect.objectContaining({
        kind: 'elektro.recurring_inspection',
        sourceId: place.installation,
        anchorOn: '2033-11-02',
        dueOn: '2037-11-02',
        naturalUserId: 'max',
      }),
    ])
  })

  it('makes none for a battery, whose commissioning names no next inspection', async () => {
    await aProtocol({ performedOn: '2033-11-02', months: 48, key: 'battery-commissioning' })
    await runDeadlinesOf({ database }, north, early)

    expect(await kept()).toEqual([])
  })
})
