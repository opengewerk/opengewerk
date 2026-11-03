import type { TenantId } from '@opengewerk/domain'
import { Database, newId } from '@opengewerk/platform-server'
import type { Pool } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { deadlines } from '../database/schema/index.js'
import {
  applicationDatabaseUrl,
  connect,
  resetToMigrated,
  shipRoles,
} from '../database/test-database.js'
import { type DeadlineRow, runDeadlinesOf } from './engine.js'

/**
 * The warranty of #310 as a deadline, run against a database: the last signed
 * acceptance of a job starts it, its length out of the rules, due on its last
 * day and with the owner; with the VOB/B and the maintenance not handed over a
 * second one for the parts that need it. A refused acceptance starts none, a
 * newer one moves it, and with the job it drops.
 */

const north = newId<'tenant'>() as TenantId

let admin: Pool
let database: Database
let job = ''

/** Long before the reminder, like the other tests of the engine. */
const early = new Date('2027-06-01T08:00:00Z')

async function anAcceptance(on: string, values: Record<string, unknown>, status = 'signed') {
  const id = newId<'form-record'>()

  await admin.query(
    `insert into form_records (id, tenant_id, definition_key, definition_version, job_id, performed_on, status, values)
     values ($1, $2, 'acceptance', 1, $3, $4, $5, $6)`,
    [id, north, job, on, status, JSON.stringify(values)],
  )

  return id
}

async function kept(): Promise<DeadlineRow[]> {
  return database.forTenant({ tenantId: north }, (tx) => tx.select().from(deadlines))
}

beforeAll(async () => {
  admin = await connect()
  await resetToMigrated()
  await admin.query('insert into tenants (id, name) values ($1, $2)', [north, 'Elektro Nord GmbH'])
  await shipRoles(admin, north)
  await admin.query(
    "insert into auth_users (id, name, email) values ('olga', 'Olga Inhaberin', 'olga@example.de')",
  )
  await admin.query(
    "insert into memberships (tenant_id, user_id, roles) values ($1, 'olga', '{owner}')",
    [north],
  )
  database = Database.connect(applicationDatabaseUrl())
})

beforeEach(async () => {
  await admin.query(
    `begin; set local session_replication_role = replica;
     delete from deadlines; delete from tasks; delete from form_records; delete from jobs; delete from customers;
     commit;`,
  )

  const customer = newId<'customer'>()

  job = newId<'job'>()
  await admin.query(
    "insert into customers (id, tenant_id, kind, name) values ($1, $2, 'private', 'Familie Weber')",
    [customer, north],
  )
  await admin.query(
    `insert into jobs (id, tenant_id, customer_id, kind, status, number, designation)
     values ($1, $2, $3, 'project', 'completed', 'AU-2026-0231', 'Wallbox Garage montieren')`,
    [job, north, customer],
  )
})

afterAll(async () => {
  await database.close()
  await admin.end()
})

describe('a signed acceptance of a job (#310)', () => {
  it('starts the warranty as a deadline at the job, with the owner', async () => {
    await anAcceptance('2026-11-05', { result: 'accepted', building_work: true, vob_agreed: false })
    await runDeadlinesOf({ database }, north, early)

    expect(await kept()).toEqual([
      expect.objectContaining({
        kind: 'warranty.expiry',
        sourceId: job,
        sourceLabel: 'Wallbox Garage montieren, AU-2026-0231',
        jobId: job,
        anchorOn: '2026-11-05',
        dueOn: '2031-11-05',
        status: 'open',
      }),
    ])
  })

  it('runs four years with the VOB/B, and two more for the parts whose maintenance is not handed over', async () => {
    const record = await anAcceptance('2026-11-05', {
      result: 'accepted_with_reservations',
      building_work: true,
      vob_agreed: true,
      maintenance_transferred: false,
    })
    await runDeadlinesOf({ database }, north, early)

    const rows = (await kept()).sort((left, right) => left.dueOn.localeCompare(right.dueOn))

    expect(rows.map((row) => [row.sourceId, row.sourceLabel, row.dueOn])).toEqual([
      [record, 'Wallbox Garage montieren, AU-2026-0231, wartungsbedürftige Teile', '2028-11-05'],
      [job, 'Wallbox Garage montieren, AU-2026-0231', '2030-11-05'],
    ])
  })

  it('moves with a newer acceptance, and a draft does not count', async () => {
    await anAcceptance('2026-11-05', { result: 'accepted', building_work: false })
    await anAcceptance('2026-12-01', { result: 'accepted', building_work: true }, 'draft')
    await runDeadlinesOf({ database }, north, early)
    expect((await kept()).map((row) => row.dueOn)).toEqual(['2028-11-05'])

    await anAcceptance('2026-11-20', { result: 'accepted', building_work: true })
    await runDeadlinesOf({ database }, north, early)
    expect((await kept()).filter((row) => row.status === 'open').map((row) => row.dueOn)).toEqual([
      '2031-11-20',
    ])
  })
})

describe('no warranty comes', () => {
  it('from a refused acceptance', async () => {
    await anAcceptance('2026-11-05', { result: 'refused', building_work: true })
    await runDeadlinesOf({ database }, north, early)

    expect(await kept()).toEqual([])
  })

  it('from a job that is gone', async () => {
    await anAcceptance('2026-11-05', { result: 'accepted', building_work: true })
    await admin.query(
      `begin; set local session_replication_role = replica; update jobs set deleted_at = now(); commit;`,
    )
    await runDeadlinesOf({ database }, north, early)

    expect((await kept()).filter((row) => row.status === 'open')).toEqual([])
  })
})
