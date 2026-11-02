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
 * The test of an appliance after DGUV Vorschrift 3 as a deadline (#303), run
 * against a database: the last signed test of an appliance names the
 * interval to the next one, and the engine makes of it one deadline at the
 * appliance. Its task names the site, and the appliances of a site due the
 * same day for the same person share one: a hundred appliances at a customer
 * are one task, and once it is done, so are their deadlines.
 */

const north = newId<'tenant'>() as TenantId
const south = newId<'tenant'>() as TenantId

let admin: Pool
let database: Database
let place: { customer: string; site: string; other: string }

/** Long before the reminder, like the other tests of the engine, years ahead. */
const early = new Date('2037-06-01T08:00:00Z')
/** Thirty days before the 18th of September, the lead of the kind. */
const leadDay = new Date('2037-08-19T08:00:00Z')

async function anAppliance(
  designation: string,
  over: { inventoryNumber?: string | null; site?: string; tenant?: TenantId } = {},
): Promise<string> {
  const id = newId<'appliance'>()

  await admin.query(
    `insert into appliances (id, tenant_id, site_id, inventory_number, designation, protection_class)
     values ($1, $2, $3, $4, $5, 'I')`,
    [
      id,
      over.tenant ?? north,
      over.site ?? place.site,
      over.inventoryNumber === undefined ? '005' : over.inventoryNumber,
      designation,
    ],
  )

  return id
}

async function aTest(over: {
  appliance: string
  performedOn: string
  months?: number
  status?: 'draft' | 'signed'
  by?: string
  tenant?: TenantId
}): Promise<string> {
  const id = newId<'form-record'>()
  const values = { tester: 'Max Monteur', next_inspection_months: (over.months ?? 12) * 1000 }
  // Who writes a row is what the trigger of 0004 takes from the session, as
  // the sync sets it: for a signed test, whoever signed it.
  const client = await admin.connect()

  try {
    await client.query('begin')
    await client.query(`select set_config('app.user_id', $1, true)`, [over.by ?? 'max'])
    await client.query(
      `insert into form_records (id, tenant_id, definition_key, definition_version, appliance_id, performed_on, status, values)
       values ($1, $2, 'dguv-v3', 1, $3, $4, $5, $6)`,
      [
        id,
        over.tenant ?? north,
        over.appliance,
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

async function madeTasks() {
  return database.forTenant({ tenantId: north }, (tx) => tx.select().from(tasks))
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
  // Past every rule that keeps a row, as the superuser: a signed test is held
  // by the trigger of 0043.
  await admin.query(
    `begin; set local session_replication_role = replica;
     delete from deadlines; delete from tasks; delete from form_records;
     delete from appliances; delete from sites; delete from customers;
     commit;`,
  )

  place = { customer: newId<'customer'>(), site: newId<'site'>(), other: newId<'site'>() }
  await admin.query(
    `insert into customers (id, tenant_id, kind, name) values ($1, $2, 'business', 'Hausverwaltung Süd GmbH')`,
    [place.customer, north],
  )
  await admin.query(
    `insert into sites (id, tenant_id, customer_id, designation)
     values ($1, $2, $3, 'Rheinstraße 12'), ($4, $2, $3, 'Lagerhalle Nord')`,
    [place.site, north, place.customer, place.other],
  )
})

afterAll(async () => {
  await database.close()
  await admin.end()
})

describe('a signed test of an appliance', () => {
  it('names the next test as a deadline at its appliance', async () => {
    const coffee = await anAppliance('Kaffeemaschine')

    await aTest({ appliance: coffee, performedOn: '2036-09-18' })

    expect(await runDeadlinesOf({ database }, north, early)).toMatchObject({ created: 1 })
    expect(await kept()).toEqual([
      expect.objectContaining({
        kind: 'elektro.appliance_inspection',
        sourceId: coffee,
        sourceLabel: '005 Kaffeemaschine am Objekt Rheinstraße 12',
        installationId: null,
        siteId: place.site,
        customerId: place.customer,
        anchorOn: '2036-09-18',
        dueOn: '2037-09-18',
        naturalUserId: 'max',
        status: 'open',
      }),
    ])
  })

  it('gives the appliances of a site due the same day one task, named after the site', async () => {
    const coffee = await anAppliance('Kaffeemaschine')
    const drill = await anAppliance('Bohrhammer', { inventoryNumber: '001' })
    const later = await anAppliance('Heizlüfter', { inventoryNumber: '003' })
    const elsewhere = await anAppliance('Leiter', { inventoryNumber: '009', site: place.other })

    await aTest({ appliance: coffee, performedOn: '2036-09-18' })
    await aTest({ appliance: drill, performedOn: '2036-09-18' })
    // Due a month later, and at another site the same day: tasks of their own.
    await aTest({ appliance: later, performedOn: '2036-10-18' })
    await aTest({ appliance: elsewhere, performedOn: '2036-09-18' })

    expect(await runDeadlinesOf({ database }, north, leadDay)).toMatchObject({ reminded: 3 })

    const made = await madeTasks()

    expect(made.map((task) => [task.title, task.dueOn, task.assigneeUserId]).sort()).toEqual([
      ['Geräte nach DGUV Vorschrift 3 prüfen am Objekt Lagerhalle Nord', '2037-09-18', 'max'],
      ['Geräte nach DGUV Vorschrift 3 prüfen am Objekt Rheinstraße 12', '2037-09-18', 'max'],
    ])

    const shared = made.find((task) => task.title.endsWith('Rheinstraße 12'))
    const byAppliance = new Map((await kept()).map((row) => [String(row.sourceId), row.taskId]))

    expect(byAppliance.get(coffee)).toBe(shared?.id)
    expect(byAppliance.get(drill)).toBe(shared?.id)
    expect(byAppliance.get(later)).toBeNull()
  })

  it('shares no task with another person, nor with one that is done', async () => {
    const coffee = await anAppliance('Kaffeemaschine')
    const drill = await anAppliance('Bohrhammer', { inventoryNumber: '001' })

    await aTest({ appliance: coffee, performedOn: '2036-09-18' })
    await aTest({ appliance: drill, performedOn: '2036-09-18', by: 'olga' })
    await runDeadlinesOf({ database }, north, leadDay)

    expect((await madeTasks()).map((task) => task.assigneeUserId).sort()).toEqual(['max', 'olga'])

    // Max does his task; an appliance tested the same day and entered later
    // gets a task of its own and does not hang on the one already done.
    await admin.query(
      `update tasks set status = 'done', updated_by = 'max' where assignee_user_id = 'max'`,
    )

    const heater = await anAppliance('Heizlüfter', { inventoryNumber: '003' })

    await aTest({ appliance: heater, performedOn: '2036-09-18' })
    await runDeadlinesOf({ database }, north, new Date('2037-08-20T08:00:00Z'))

    const open = (await madeTasks()).filter(
      (task) => task.assigneeUserId === 'max' && task.status === 'open',
    )
    const byAppliance = new Map((await kept()).map((row) => [String(row.sourceId), row.taskId]))

    expect(open).toHaveLength(1)
    expect(byAppliance.get(heater)).toBe(open[0]?.id)
  })

  it('is done for every appliance once their shared task is done', async () => {
    const coffee = await anAppliance('Kaffeemaschine')
    const drill = await anAppliance('Bohrhammer', { inventoryNumber: '001' })

    await aTest({ appliance: coffee, performedOn: '2036-09-18' })
    await aTest({ appliance: drill, performedOn: '2036-09-18' })
    await runDeadlinesOf({ database }, north, leadDay)
    await admin.query(`update tasks set status = 'done', updated_by = 'max'`)
    await runDeadlinesOf({ database }, north, new Date('2037-08-20T08:00:00Z'))

    expect((await kept()).map((row) => row.status)).toEqual(['done', 'done'])
  })

  it('moves with a newer test, and a draft does not count', async () => {
    const coffee = await anAppliance('Kaffeemaschine')

    await aTest({ appliance: coffee, performedOn: '2036-09-18' })
    await aTest({ appliance: coffee, performedOn: '2037-01-10', months: 6, by: 'olga' })
    await aTest({ appliance: coffee, performedOn: '2037-03-01', months: 3, status: 'draft' })
    await runDeadlinesOf({ database }, north, early)

    expect(await kept()).toEqual([
      expect.objectContaining({
        anchorOn: '2037-01-10',
        dueOn: '2037-07-10',
        naturalUserId: 'olga',
      }),
    ])
  })

  it('drops out when its appliance is deleted', async () => {
    const coffee = await anAppliance('Kaffeemaschine')

    await aTest({ appliance: coffee, performedOn: '2036-09-18' })
    await runDeadlinesOf({ database }, north, early)
    await admin.query(`update appliances set deleted_at = now() where id = $1`, [coffee])
    await runDeadlinesOf({ database }, north, early)

    expect(await kept()).toEqual([expect.objectContaining({ status: 'dropped' })])
  })
})

describe('no deadline of an appliance comes', () => {
  it('from a test of another business', async () => {
    const southCustomer = newId<'customer'>()
    const southSite = newId<'site'>()

    await admin.query(
      `insert into customers (id, tenant_id, kind, name) values ($1, $2, 'business', 'Süd')`,
      [southCustomer, south],
    )
    await admin.query(
      `insert into sites (id, tenant_id, customer_id, designation) values ($1, $2, $3, 'Süd 1')`,
      [southSite, south, southCustomer],
    )
    const theirs = await anAppliance('Bohrhammer', { site: southSite, tenant: south })

    await aTest({ appliance: theirs, performedOn: '2036-09-18', by: 'susi', tenant: south })
    await runDeadlinesOf({ database }, north, early)

    expect(await kept()).toEqual([])
  })
})
