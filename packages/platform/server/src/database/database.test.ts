import type { TenantId } from '@opengewerk/platform-domain'
import { sql } from 'drizzle-orm'
import { rmSync } from 'node:fs'

import type { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { Database, type TenantTransaction } from './database.js'
import { newId } from './identifier.js'
import { probeDatabase, probeMigrations } from './probe-database.js'
import { tableNames } from './test-database.js'

// The one way to the data. What is held here is what the policies of every
// application read: the tenant of the transaction, set before anything else
// happens and gone when the transaction ends. Whether a policy then keeps two
// tenants apart is tested where the tables are, in the application.

const emptyFolder = probeMigrations([])
const kit = probeDatabase(emptyFolder)

let pool: Pool
let database: Database

interface Settings extends Record<string, unknown> {
  readonly tenant: string
  readonly user: string
  readonly reason: string
  readonly device: string
}

/**
 * What the transaction carries. Never set and set to nothing are read as the
 * same here, as the policies and the triggers read them: a setting that a
 * connection has carried once comes back empty rather than missing, so which
 * of the two a transaction sees depends on what the connection did before.
 */
async function settings(tx: TenantTransaction): Promise<Settings> {
  const result = await tx.execute<Settings>(sql`
    select coalesce(current_setting('app.tenant_id', true), '') as tenant,
           coalesce(current_setting('app.user_id', true), '') as "user",
           coalesce(current_setting('app.reason', true), '') as reason,
           coalesce(current_setting('app.device_id', true), '') as device`)

  return result.rows[0] as Settings
}

beforeAll(async () => {
  pool = await kit.connect()
  await kit.resetSchema(pool)
  database = Database.connect(kit.testDatabaseUrl())
})

afterAll(async () => {
  await database.close()
  await kit.resetSchema(pool)
  await pool.end()
  rmSync(emptyFolder, { recursive: true, force: true })
})

describe('a transaction for a tenant', () => {
  it('carries the tenant, the person, the reason and the device', async () => {
    const tenantId = newId<'tenant'>()

    const found = await database.forTenant(
      { tenantId, userId: 'user-1', reason: 'probe', deviceId: 'tablet' },
      settings,
    )

    expect(found).toEqual({ tenant: tenantId, user: 'user-1', reason: 'probe', device: 'tablet' })
  })

  it('says nothing for what the caller did not give, instead of inventing it', async () => {
    const tenantId = newId<'tenant'>()

    expect(await database.forTenant({ tenantId }, settings)).toEqual({
      tenant: tenantId,
      user: '',
      reason: '',
      device: '',
    })
  })

  /**
   * Refused before a connection is taken. A caller without a proper tenant
   * would otherwise read an empty result as "this tenant has no data yet".
   */
  it('refuses anything that is not a tenant', async () => {
    for (const not of ['', 'probe', "' or 1=1 --"]) {
      await expect(database.forTenant({ tenantId: not as TenantId }, settings)).rejects.toThrow(
        'Not a tenant id',
      )
    }
  })

  /**
   * The part that matters most. A connection that kept the last tenant would
   * hand its rows to the next request that happens to get it.
   */
  it('leaves nothing on the connection when it ends', async () => {
    const single = Database.connect(kit.testDatabaseUrl())

    try {
      await single.forTenant({ tenantId: newId<'tenant'>(), userId: 'user-1' }, settings)

      // Asked many times, so that the one connection of before is among them.
      for (let round = 0; round < 8; round += 1) {
        const after = await single.forInstance(settings)

        expect(after.tenant).toBe('')
        expect(after.user).toBe('')
      }
    } finally {
      await single.close()
    }
  })

  it('commits when the work returns and rolls back when it throws', async () => {
    const tenantId = newId<'tenant'>()

    await database.forTenant({ tenantId }, (tx) =>
      tx.execute(sql`create table probe_kept (id integer primary key)`),
    )

    await expect(
      database.forTenant({ tenantId }, async (tx) => {
        await tx.execute(sql`create table probe_lost (id integer primary key)`)
        throw new Error('the work failed')
      }),
    ).rejects.toThrow('the work failed')

    expect(await tableNames(pool)).toEqual(['probe_kept'])
  })
})

describe('a transaction for the instance', () => {
  it('sets no tenant, so that a policy comparing against one matches nothing', async () => {
    expect(await database.forInstance(settings, 'user-1')).toEqual({
      tenant: '',
      user: 'user-1',
      reason: 'authentication',
      device: '',
    })
  })

  it('walks from the instance into a tenant once, in one transaction', async () => {
    const tenantId = newId<'tenant'>()

    const [before, after] = await database.forInstanceAndTenant('setup', async ({ tx, enter }) => {
      const outside = await settings(tx)

      await enter(tenantId, 'user-1')

      return [outside, await settings(tx)]
    })

    expect(before).toEqual({ tenant: '', user: '', reason: 'setup', device: '' })
    expect(after).toEqual({ tenant: tenantId, user: 'user-1', reason: 'setup', device: '' })
  })

  it('refuses to enter anything that is not a tenant', async () => {
    await expect(
      database.forInstanceAndTenant('setup', ({ enter }) => enter('probe' as TenantId, 'user-1')),
    ).rejects.toThrow('Not a tenant id')
  })
})

describe('a connection the database server ends', () => {
  // What `restore.sh` does to every connection of the application, and what a
  // restart of the database server does. Without a listener, the event that
  // reports it ends the process, and Vitest reports it as an unhandled error.

  /** Waits for `found`, for up to two seconds. */
  async function until(found: () => boolean): Promise<void> {
    for (let tries = 0; tries < 100 && !found(); tries += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
  }

  async function backendOf(tx: TenantTransaction): Promise<number> {
    const result = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`)

    return Number(result.rows[0]?.pid)
  }

  async function watched(
    test: (watched: Database, complaints: string[]) => Promise<void>,
  ): Promise<void> {
    const complaints: string[] = []
    const one = Database.connect(kit.testDatabaseUrl(), (line) => {
      complaints.push(line)
    })

    try {
      await test(one, complaints)
    } finally {
      await one.close()
    }
  }

  it('is said while it rests in the pool, and the next request gets another', async () => {
    await watched(async (one, complaints) => {
      const resting = await one.forInstance(backendOf)

      await pool.query('select pg_terminate_backend($1)', [resting])
      await until(() => complaints.length > 0)

      expect(complaints).toEqual([expect.stringMatching(/ruhende Verbindung/)])
      expect(await one.forInstance(backendOf)).not.toBe(resting)
    })
  })

  const ways: [
    string,
    (one: Database, work: (tx: TenantTransaction) => Promise<void>) => Promise<void>,
  ][] = [
    ['for a tenant', (one, work) => one.forTenant({ tenantId: newId<'tenant'>() }, work)],
    ['for the instance', (one, work) => one.forInstance(work)],
    ['into a tenant', (one, work) => one.forInstanceAndTenant('setup', ({ tx }) => work(tx))],
  ]

  it.each(ways)(
    'is said once while a transaction %s has it, and the transaction fails with its own error',
    async (_way, transaction) => {
      await watched(async (one, complaints) => {
        const failed = transaction(one, async (tx) => {
          await pool.query('select pg_terminate_backend($1)', [await backendOf(tx)])
          await until(() => complaints.length > 0)
          await tx.execute(sql`select 'after the end'`)
        })

        await expect(failed).rejects.toThrow(/after the end/)
        expect(complaints).toEqual([expect.stringMatching(/mitten in einer Transaktion/)])
        expect(await one.isReachable()).toBe(true)
      })
    },
  )
})

describe('the health check', () => {
  it('says whether the database answers, and hands out no connection', async () => {
    expect(await database.isReachable()).toBe(true)

    const nowhere = Database.connect('postgres://probe:probe@127.0.0.1:1/probe_test')

    try {
      expect(await nowhere.isReachable()).toBe(false)
    } finally {
      await nowhere.close()
    }
  })
})
