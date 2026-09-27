import type { DeadlineSetting } from '@opengewerk/domain'

import type { TenantTransaction } from '../database/database.js'
import { deadlineSettings } from '../database/schema/index.js'

/** What a business has set for each kind of deadline, by kind. */
export async function settingsOf(
  tx: TenantTransaction,
): Promise<ReadonlyMap<string, DeadlineSetting>> {
  const rows = await tx.select().from(deadlineSettings)

  return new Map(
    rows.map((row) => [
      row.kind,
      {
        kind: row.kind,
        leadDays: row.leadDays,
        intervalDays: row.intervalDays,
        responsibleUserId: row.responsibleUserId,
      },
    ]),
  )
}
