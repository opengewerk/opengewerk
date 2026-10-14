import {
  type DeadlineSetting,
  type ReminderChannel,
  remindersQuietOn,
} from '@opengewerk/platform-domain'
import { type SQL, sql } from 'drizzle-orm'

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
        reminder: row.reminder ?? null,
      },
    ]),
  )
}

/**
 * Whether a deadline reminds on a channel, as a condition of a query over the
 * deadlines (opengewerk-haustechnik#269): its tenant has not set its kind to
 * a way that keeps this channel quiet. For the writers of the messages of an
 * application, which ask it beside whether the message was written already,
 * so that mail and push agree with what the settings of the deadlines say.
 * `tenant` and `kind` are the columns of the deadline the query reads.
 */
export function deadlineRemindsOn(channel: ReminderChannel, tenant: SQL, kind: SQL): SQL {
  const quiet = remindersQuietOn(channel).map((reminder) => sql`${reminder}`)

  return sql`not exists (select 1 from ${deadlineSettings} where ${deadlineSettings.tenantId} = ${tenant} and ${deadlineSettings.kind} = ${kind} and ${deadlineSettings.reminder} in (${sql.join(quiet, sql`, `)}))`
}
