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
 * The deadline a customer sets to remedy a defect (#311): one for each defect
 * still to be remedied that has a day, with the owner, until it is remedied.
 */

const north = newId<'tenant'>() as TenantId

let admin: Pool
let database: Database
let job = ''

/** Long before the reminder. */
const early = new Date('2026-11-10T08:00:00Z')

async function aDefect(remedyDueOn: string | null): Promise<string> {
  const id = newId<'defect'>()

  await admin.query(
    `insert into defects (id, tenant_id, job_id, description, reported_at, remedy_due_on)
     values ($1, $2, $3, 'Halter des Ladekabels locker.', '2026-11-10T09:42:00Z', $4)`,
    [id, north, job, remedyDueOn],
  )

  return id
}

async function aStep(defect: string, step: string): Promise<void> {
  await admin.query(
    'insert into defect_steps (tenant_id, defect_id, step, taken_at) values ($1, $2, $3, now())',
    [north, defect, step],
  )
}

async function kept(): Promise<DeadlineRow[]> {
  return database.forTenant({ tenantId: north }, (tx) => tx.select().from(deadlines))
}

beforeAll(async () => {
  admin = await connect()
  await resetToMigrated()
  await admin.query('insert into tenants (id, name) values ($1, $2)', [north, 'Elektro Nord GmbH'])
  await shipRoles(admin, north)
  database = Database.connect(applicationDatabaseUrl())
})

beforeEach(async () => {
  await admin.query(
    `begin; set local session_replication_role = replica;
     delete from deadlines; delete from tasks; delete from defect_steps; delete from defects;
     delete from jobs; delete from customers;
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

describe('the customer’s deadline to remedy a defect (#311)', () => {
  it('is a deadline of the engine, named by the defect and its job', async () => {
    const defect = await aDefect('2026-11-24')
    await aDefect(null)
    await runDeadlinesOf({ database }, north, early)

    expect(await kept()).toEqual([
      expect.objectContaining({
        kind: 'defect.remedy',
        sourceId: defect,
        sourceLabel: 'Halter des Ladekabels locker., AU-2026-0231',
        jobId: job,
        anchorOn: '2026-11-10',
        dueOn: '2026-11-24',
        status: 'open',
      }),
    ])
  })

  it('stays while the defect is in progress, and drops once it is remedied', async () => {
    const defect = await aDefect('2026-11-24')
    await aStep(defect, 'in_progress')
    await runDeadlinesOf({ database }, north, early)
    expect((await kept()).map((row) => row.status)).toEqual(['open'])

    await aStep(defect, 'resolved')
    await runDeadlinesOf({ database }, north, early)
    expect((await kept()).filter((row) => row.status === 'open')).toEqual([])
  })

  it('drops with a defect that is removed', async () => {
    const defect = await aDefect('2026-11-24')
    await runDeadlinesOf({ database }, north, early)
    await admin.query('update defects set deleted_at = now() where id = $1', [defect])
    await runDeadlinesOf({ database }, north, early)

    expect((await kept()).filter((row) => row.status === 'open')).toEqual([])
  })
})
