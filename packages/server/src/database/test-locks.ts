import type { TenantId } from '@opengewerk/domain'
import type { Database, TenantTransaction } from '@opengewerk/platform-server'
import type { Pool } from 'pg'

/** A transaction that did its work and stays open, with the locks it took. */
export interface HeldOpen<T> {
  /** Settles once the work is done and its locks are held, or it failed. */
  readonly open: Promise<void>
  /** Lets the transaction commit. */
  readonly release: () => void
  /** What the transaction answered, once committed. */
  readonly done: Promise<T>
}

/**
 * Runs `work` in a transaction of the tenant and keeps the transaction open
 * until released, for the tests of what waits for what: whatever another
 * transaction does in between meets the locks `work` took.
 */
export function heldOpen<T>(
  database: Database,
  tenantId: TenantId,
  work: (tx: TenantTransaction) => Promise<T>,
): HeldOpen<T> {
  let release = (): void => undefined
  const released = new Promise<void>((resolve) => {
    release = resolve
  })
  let opened = (): void => undefined
  const open = new Promise<void>((resolve) => {
    opened = resolve
  })

  const done = database.forTenant({ tenantId }, async (tx) => {
    const result = await work(tx)
    opened()
    await released

    return result
  })

  return {
    open: Promise.race([open, done.then(() => undefined)]),
    release,
    done,
  }
}

/**
 * Waits until a session of this database waits for a lock, or until `other`
 * has settled, for two seconds at most. Without the lock a test is about, the
 * second writer does not wait at all, and the test then sees what it did.
 */
export async function untilWaiting(admin: Pool, other: Promise<unknown>): Promise<void> {
  let settled = false
  other.then(
    () => {
      settled = true
    },
    () => {
      settled = true
    },
  )

  const deadline = Date.now() + 2000

  while (!settled && Date.now() < deadline) {
    const { rows } = await admin.query<{ waiting: number }>(
      "select count(*)::int as waiting from pg_stat_activity where wait_event_type = 'Lock' and datname = current_database()",
    )

    if ((rows[0]?.waiting ?? 0) > 0) {
      return
    }

    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}
