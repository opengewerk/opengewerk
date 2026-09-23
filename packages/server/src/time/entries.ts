import { desc, eq, sql } from 'drizzle-orm'

import type { TenantTransaction } from '../database/database.js'
import { locationConsents, timeEntries } from '../database/schema/index.js'

/** Why a time entry from a device cannot land, in the shape of a sync conflict. */
export interface TimeEntryRefusal {
  readonly reason: 'record_missing' | 'changed_elsewhere'
  readonly fields: readonly string[]
}

/**
 * Who the request acts for, from the transaction. The trigger that writes the
 * owner of an entry reads the same setting, so both answer alike.
 */
export async function actingUser(tx: TenantTransaction): Promise<string | null> {
  const result = await tx.execute(
    sql`select nullif(current_setting('app.user_id', true), '') as user_id`,
  )

  return (result.rows[0] as { user_id: string | null } | undefined)?.user_id ?? null
}

/**
 * Whether a correction may land on the entry it names (#76).
 *
 * It may correct somebody's own entry and only once. The entry of a colleague
 * is not there as far as this person is concerned, which is the same answer
 * as for an entry that does not exist. A second correction of the same entry
 * means somebody corrected it on another device in the meantime; the unique
 * index in the database would say so too, but for the whole transmission.
 *
 * An entry that is not there at all is left to the check of the references,
 * which answers it the same way for every entity.
 */
export async function correctionRefusal(
  tx: TenantTransaction,
  values: Readonly<Record<string, unknown>>,
): Promise<TimeEntryRefusal | null> {
  const corrects = values['correctsEntryId']

  if (typeof corrects !== 'string') {
    return null
  }

  const [target] = await tx
    .select({ userId: timeEntries.userId })
    .from(timeEntries)
    .where(eq(timeEntries.id, corrects as never))

  if (!target) {
    return null
  }

  if (target.userId !== (await actingUser(tx))) {
    return { reason: 'record_missing', fields: ['correctsEntryId'] }
  }

  const [already] = await tx
    .select({ id: timeEntries.id })
    .from(timeEntries)
    .where(eq(timeEntries.correctsEntryId, corrects as never))

  return already ? { reason: 'changed_elsewhere', fields: ['correctsEntryId'] } : null
}

/**
 * Whether the person the request acts for has consented to their place being
 * recorded, by the latest of their answers. No answer is no consent.
 */
export async function consentGiven(tx: TenantTransaction): Promise<boolean> {
  const user = await actingUser(tx)

  if (!user) {
    return false
  }

  const [latest] = await tx
    .select({ given: locationConsents.given })
    .from(locationConsents)
    .where(eq(locationConsents.userId, user))
    .orderBy(desc(locationConsents.id))
    .limit(1)

  return latest?.given === true
}
