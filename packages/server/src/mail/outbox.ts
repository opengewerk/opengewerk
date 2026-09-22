import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm'

import type { TenantTransaction } from '../database/database.js'
import { mailOutbox } from '../database/schema/index.js'
import type { MailDeliveryError } from './transport.js'

export type OutboxRow = typeof mailOutbox.$inferSelect

/**
 * How long a message waits after each failed attempt, in minutes.
 *
 * Quick at first, because most failures are a server restarting, then
 * patient: from the fifth attempt on every three hours. Twenty attempts cover
 * a little over two days, which is a weekend with the mail server down.
 */
export const retryMinutes: readonly number[] = [1, 5, 15, 60, 180]

/** After this many attempts a message is given up on. It stays, as `failed`. */
export const maximumAttempts = 20

/**
 * How long a claimed message is left alone before it counts as not sent.
 *
 * A message is claimed in one short transaction and sent outside of it, so
 * that no transaction stays open while a mail server takes its time. Should
 * the process die in between, the claim runs out and the message goes out on
 * the next pass. It may then arrive twice, which beats never.
 */
export const claimMinutes = 10

function minutesAfter(now: Date, minutes: number): Date {
  return new Date(now.getTime() + minutes * 60_000)
}

/** The wait before the next attempt, after this many attempts so far. */
export function retryDelay(attempts: number): number {
  const index = Math.min(Math.max(attempts, 1), retryMinutes.length) - 1

  return retryMinutes[index] ?? 180
}

/**
 * Takes the messages that are due and marks them as being sent.
 *
 * `skip locked` lets two passes run side by side without sending anything
 * twice: a row one of them holds is invisible to the other until it commits,
 * and by then it is no longer due.
 */
export async function claimDue(
  tx: TenantTransaction,
  now: Date,
  limit = 20,
): Promise<readonly OutboxRow[]> {
  const due = await tx
    .select({ id: mailOutbox.id })
    .from(mailOutbox)
    .where(and(eq(mailOutbox.status, 'pending'), lte(mailOutbox.nextAttemptAt, now)))
    .orderBy(asc(mailOutbox.nextAttemptAt), asc(mailOutbox.createdAt))
    .limit(limit)
    .for('update', { skipLocked: true })

  if (due.length === 0) {
    return []
  }

  return tx
    .update(mailOutbox)
    .set({
      attempts: sql`${mailOutbox.attempts} + 1`,
      nextAttemptAt: minutesAfter(now, claimMinutes),
      updatedAt: now,
    })
    .where(
      inArray(
        mailOutbox.id,
        due.map((row) => row.id),
      ),
    )
    .returning()
}

/** The message went out. */
export async function markSent(tx: TenantTransaction, id: OutboxRow['id'], now: Date) {
  await tx
    .update(mailOutbox)
    .set({ status: 'sent', sentAt: now, lastError: null, updatedAt: now })
    .where(eq(mailOutbox.id, id))
}

/**
 * The message did not go out this time.
 *
 * It waits and is tried again, unless the answer was one that will not
 * change or it has been tried often enough. Either way the row stays, with
 * what went wrong, so that a message nobody received is a message somebody
 * can find.
 */
export async function markFailed(
  tx: TenantTransaction,
  row: Pick<OutboxRow, 'id' | 'attempts'>,
  failure: MailDeliveryError,
  now: Date,
): Promise<'retry' | 'failed'> {
  const givenUp = failure.permanent || row.attempts >= maximumAttempts
  const reason = [failure.code, failure.message].filter(Boolean).join(': ').slice(0, 1000)

  await tx
    .update(mailOutbox)
    .set({
      status: givenUp ? 'failed' : 'pending',
      lastError: reason,
      nextAttemptAt: givenUp ? now : minutesAfter(now, retryDelay(row.attempts)),
      updatedAt: now,
    })
    .where(eq(mailOutbox.id, row.id))

  return givenUp ? 'failed' : 'retry'
}

/**
 * Gives up on every message of this business that is still waiting, with the
 * reason. For a business that removed its mail server: what was waiting would
 * otherwise go out whenever a server is set up again, weeks later perhaps,
 * about things long done.
 */
export async function giveUpPending(tx: TenantTransaction, reason: string, now: Date) {
  await tx
    .update(mailOutbox)
    .set({ status: 'failed', lastError: reason, nextAttemptAt: now, updatedAt: now })
    .where(eq(mailOutbox.status, 'pending'))
}
