import type { TenantId } from '@opengewerk/platform-domain'

import type { Database, TenantTransaction } from '../database/database.js'
import { deadlineRuns } from '../database/schema/deadline-settings.js'

/** How the last passes over the deadlines of a tenant went. */
export interface DeadlineRun {
  /** The end of the last pass that went through, null before the first. */
  readonly succeededAt: Date | null
  /** The end of the last pass that failed, null when none has. */
  readonly failedAt: Date | null
}

/**
 * Writes down how a pass over a tenant ended, after the pass and in a
 * transaction of its own: a pass that failed rolled back whatever it did, and
 * that it failed still has to be seen.
 */
export async function recordDeadlinePass(
  database: Database,
  tenantId: TenantId,
  outcome: 'succeeded' | 'failed',
  at: Date,
): Promise<void> {
  const column = outcome === 'succeeded' ? { succeededAt: at } : { failedAt: at }

  await database.forTenant({ tenantId, reason: 'deadline' }, (tx) =>
    tx
      .insert(deadlineRuns)
      .values({ tenantId, ...column })
      .onConflictDoUpdate({ target: deadlineRuns.tenantId, set: { ...column, updatedAt: at } }),
  )
}

/** How the last passes over the deadlines of the tenant of this transaction went. */
export async function deadlineRunOf(tx: TenantTransaction): Promise<DeadlineRun> {
  const [row] = await tx
    .select({ succeededAt: deadlineRuns.succeededAt, failedAt: deadlineRuns.failedAt })
    .from(deadlineRuns)

  return { succeededAt: row?.succeededAt ?? null, failedAt: row?.failedAt ?? null }
}
