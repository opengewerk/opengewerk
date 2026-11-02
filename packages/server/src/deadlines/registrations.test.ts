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
 * The entry of the business in the installer directory of a grid operator as
 * a deadline (#306), run against a database: due on its last day, the owner's,
 * ninety days ahead. A later day moves it; an entry without a number or
 * without a last day makes none, and a grid operator removed lets it drop.
 */

const north = newId<'tenant'>() as TenantId
const south = newId<'tenant'>() as TenantId

let admin: Pool
let database: Database

/** Long before the reminder, like the other tests of the engine, years ahead. */
const early = new Date('2037-01-01T08:00:00Z')

async function anOperator(over: {
  name?: string
  number?: string | null
  until?: string | null
  tenant?: TenantId
}): Promise<string> {
  const id = newId<'grid-operator'>()

  await admin.query(
    `insert into grid_operators (id, tenant_id, name, registration_number, registered_until)
     values ($1, $2, $3, $4, $5)`,
    [
      id,
      over.tenant ?? north,
      over.name ?? 'Stadtwerke Neckartal Netze GmbH',
      over.number === undefined ? 'IV-2023-0417' : over.number,
      over.until === undefined ? '2037-09-30' : over.until,
    ],
  )

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
  database = Database.connect(applicationDatabaseUrl())
})

beforeEach(async () => {
  await admin.query(
    `begin; set local session_replication_role = replica;
     delete from deadlines; delete from tasks; delete from grid_operators;
     commit;`,
  )
})

afterAll(async () => {
  await database.close()
  await admin.end()
})

describe('the entry of the business in an installer directory', () => {
  it('runs out as a deadline on its last day, named by the grid operator', async () => {
    const operator = await anOperator({})

    expect(await runDeadlinesOf({ database }, north, early)).toMatchObject({ created: 1 })
    expect(await kept()).toEqual([
      expect.objectContaining({
        kind: 'elektro.installer_registration',
        sourceId: operator,
        sourceLabel: 'Stadtwerke Neckartal Netze GmbH',
        installationId: null,
        siteId: null,
        anchorOn: '2037-09-30',
        dueOn: '2037-09-30',
        naturalUserId: null,
        status: 'open',
      }),
    ])
    // Only in its own business.
    expect(await kept(south)).toEqual([])
  })

  it('moves with a later day', async () => {
    const operator = await anOperator({})

    await runDeadlinesOf({ database }, north, early)
    await admin.query(`update grid_operators set registered_until = '2039-03-31' where id = $1`, [
      operator,
    ])
    await runDeadlinesOf({ database }, north, early)

    expect(await kept()).toEqual([expect.objectContaining({ dueOn: '2039-03-31', status: 'open' })])
  })

  it('makes none without a number or without a last day', async () => {
    await anOperator({ name: 'Ohne Nummer', number: null })
    await anOperator({ name: 'Nur Leerzeichen', number: '  ' })
    await anOperator({ name: 'Ohne Ende', until: null })

    expect(await runDeadlinesOf({ database }, north, early)).toMatchObject({ created: 0 })
    expect(await kept()).toEqual([])
  })

  it('drops out when its grid operator is removed', async () => {
    const operator = await anOperator({})

    await runDeadlinesOf({ database }, north, early)
    await admin.query('update grid_operators set deleted_at = now() where id = $1', [operator])
    await runDeadlinesOf({ database }, north, early)

    expect(await kept()).toEqual([expect.objectContaining({ status: 'dropped' })])
  })
})
