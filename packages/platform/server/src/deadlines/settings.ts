import type { DeadlineSetting } from '@opengewerk/platform-domain'

import type { TenantTransaction } from '../database/database.js'
import { deadlineSettings } from '../database/schema/deadline-settings.js'

/** What a tenant has set for each kind of deadline, by kind. */
export async function deadlineSettingsOf(
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
        intervalMonths: row.intervalMonths,
        responsibleUserId: row.responsibleUserId,
      },
    ]),
  )
}
