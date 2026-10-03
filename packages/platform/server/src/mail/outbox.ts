import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm'

import type { TenantTransaction } from '../database/database.js'
import type { MailOutboxTable, OutboxMessage } from '../database/schema/mail-outbox.js'
import type { MailDeliveryError } from './transport.js'

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

/** The messages of the outbox of one application, claimed, marked and given up on. */
export interface MailOutboxStore<Message extends OutboxMessage = OutboxMessage> {
  /**
   * Takes the messages that are due and marks them as being sent.
   *
   * `skip locked` lets two passes run side by side without sending anything
   * twice: a row one of them holds is invisible to the other until it
   * commits, and by then it is no longer due.
   */
  claimDue(tx: TenantTransaction, now: Date, limit?: number): Promise<readonly Message[]>
  /** The message went out. */
  markSent(tx: TenantTransaction, id: Message['id'], now: Date): Promise<void>
  /**
   * The message did not go out this time.
   *
   * It waits and is tried again, unless the answer was one that will not
   * change or it has been tried often enough. Either way the row stays, with
   * what went wrong, so that a message nobody received is a message somebody
   * can find.
   */
  markFailed(
    tx: TenantTransaction,
    row: Pick<Message, 'id' | 'attempts'>,
    failure: MailDeliveryError,
    now: Date,
  ): Promise<'retry' | 'failed'>
  /**
   * Gives up on every message of this tenant that is still waiting, with the
   * reason. For a tenant that removed its mail server: what was waiting would
   * otherwise go out whenever a server is set up again, weeks later perhaps,
   * about things long done.
   */
  giveUpPending(tx: TenantTransaction, reason: string, now: Date): Promise<void>
}

/**
 * The store over the outbox an application made with `mailOutboxSchema`.
 *
 * Only the columns every outbox has are touched, so the statements are the
 * same whatever the kinds are called and whatever the application keeps
 * beside them; a claimed message comes back whole, with those columns too.
 */
export function mailOutboxStore<Message extends OutboxMessage>(table: {
  readonly $inferSelect: Message
}): MailOutboxStore<Message> {
  const outbox = table as unknown as MailOutboxTable

  return {
    async claimDue(tx, now, limit = 20) {
      const due = await tx
        .select({ id: outbox.id })
        .from(outbox)
        .where(and(eq(outbox.status, 'pending'), lte(outbox.nextAttemptAt, now)))
        .orderBy(asc(outbox.nextAttemptAt), asc(outbox.createdAt))
        .limit(limit)
        .for('update', { skipLocked: true })

      if (due.length === 0) {
        return []
      }

      const claimed = await tx
        .update(outbox)
        .set({
          attempts: sql`${outbox.attempts} + 1`,
          nextAttemptAt: minutesAfter(now, claimMinutes),
          updatedAt: now,
        })
        .where(
          inArray(
            outbox.id,
            due.map((row) => row.id),
          ),
        )
        .returning()

      return claimed as unknown as readonly Message[]
    },

    async markSent(tx, id, now) {
      await tx
        .update(outbox)
        .set({ status: 'sent', sentAt: now, lastError: null, updatedAt: now })
        .where(eq(outbox.id, id))
    },

    async markFailed(tx, row, failure, now) {
      const givenUp = failure.permanent || row.attempts >= maximumAttempts
      const reason = [failure.code, failure.message].filter(Boolean).join(': ').slice(0, 1000)

      await tx
        .update(outbox)
        .set({
          status: givenUp ? 'failed' : 'pending',
          lastError: reason,
          nextAttemptAt: givenUp ? now : minutesAfter(now, retryDelay(row.attempts)),
          updatedAt: now,
        })
        .where(eq(outbox.id, row.id))

      return givenUp ? 'failed' : 'retry'
    },

    async giveUpPending(tx, reason, now) {
      await tx
        .update(outbox)
        .set({ status: 'failed', lastError: reason, nextAttemptAt: now, updatedAt: now })
        .where(eq(outbox.status, 'pending'))
    },
  }
}
