import type { TenantTransaction } from '@opengewerk/platform-server'
import { and, asc, eq, gt, inArray, lte, sql } from 'drizzle-orm'

import { pushOutbox, pushSubscriptions } from '../database/schema/index.js'

export type PushRow = typeof pushOutbox.$inferSelect
export type SubscriptionRow = typeof pushSubscriptions.$inferSelect

/**
 * How long a message waits after each failed attempt, in minutes. Shorter than
 * for mail and fewer of them: a push message is about today, and one that
 * cannot go out within the hour is not much use after it. Its `expires_at`
 * ends the trying in any case.
 */
export const pushRetryMinutes: readonly number[] = [1, 5, 15, 30, 60]

/** After this many attempts a message is given up on. */
export const pushMaximumAttempts = 6

/** How long a claimed message is left alone, as for mail (`claimMinutes`). */
export const pushClaimMinutes = 10

function minutesAfter(now: Date, minutes: number): Date {
  return new Date(now.getTime() + minutes * 60_000)
}

/** A message that is due, with the device it goes to. */
export interface ClaimedPush {
  readonly message: PushRow
  readonly subscription: SubscriptionRow
}

/**
 * Takes the messages that are due and not expired and marks them as being
 * sent, `skip locked` as for mail, so that two passes side by side send
 * nothing twice. `only` narrows it to messages just written, for the test
 * that the route sends at once.
 */
export async function claimDuePush(
  tx: TenantTransaction,
  now: Date,
  only?: readonly string[],
  limit = 50,
): Promise<readonly ClaimedPush[]> {
  const due = await tx
    .select({ id: pushOutbox.id })
    .from(pushOutbox)
    .where(
      and(
        eq(pushOutbox.status, 'pending'),
        gt(pushOutbox.expiresAt, now),
        // Messages just written are due whatever the clock of the database
        // put into `next_attempt_at`, which runs apart from this one.
        only ? inArray(pushOutbox.id, only as PushRow['id'][]) : lte(pushOutbox.nextAttemptAt, now),
      ),
    )
    .orderBy(asc(pushOutbox.nextAttemptAt), asc(pushOutbox.createdAt))
    .limit(limit)
    .for('update', { skipLocked: true })

  if (due.length === 0) {
    return []
  }

  const claimed = await tx
    .update(pushOutbox)
    .set({
      attempts: sql`${pushOutbox.attempts} + 1`,
      nextAttemptAt: minutesAfter(now, pushClaimMinutes),
      updatedAt: now,
    })
    .where(
      inArray(
        pushOutbox.id,
        due.map((row) => row.id),
      ),
    )
    .returning()

  const devices = await tx
    .select()
    .from(pushSubscriptions)
    .where(
      inArray(
        pushSubscriptions.id,
        claimed.map((row) => row.subscriptionId),
      ),
    )
  const byId = new Map(devices.map((device) => [device.id, device]))

  return claimed.flatMap((message) => {
    const subscription = byId.get(message.subscriptionId)

    return subscription ? [{ message, subscription }] : []
  })
}

/**
 * Gives up on the messages that were not sent in time. A reminder of a task
 * that was due yesterday says nothing any more; the row stays, with why.
 */
export async function giveUpLatePush(tx: TenantTransaction, now: Date): Promise<number> {
  const given = await tx
    .update(pushOutbox)
    .set({
      status: 'failed',
      lastError: 'Nicht rechtzeitig zugestellt, die Nachricht wäre zu spät gekommen.',
      updatedAt: now,
    })
    .where(and(eq(pushOutbox.status, 'pending'), lte(pushOutbox.expiresAt, now)))
    .returning({ id: pushOutbox.id })

  return given.length
}

/** The message went out. */
export async function markPushSent(tx: TenantTransaction, id: PushRow['id'], now: Date) {
  await tx
    .update(pushOutbox)
    .set({ status: 'sent', sentAt: now, lastError: null, updatedAt: now })
    .where(eq(pushOutbox.id, id))
}

/**
 * The message did not go out this time. It waits and is tried again, unless
 * the answer will not change, it has been tried often enough or it would come
 * too late; then it stays as `failed`, with the reason.
 */
export async function markPushFailed(
  tx: TenantTransaction,
  row: Pick<PushRow, 'id' | 'attempts' | 'expiresAt'>,
  failure: {
    readonly reason: string
    readonly permanent: boolean
    readonly afterSeconds?: number | null
  },
  now: Date,
): Promise<'retry' | 'failed'> {
  const index = Math.min(Math.max(row.attempts, 1), pushRetryMinutes.length) - 1
  const waited = failure.afterSeconds
    ? Math.max(failure.afterSeconds / 60, pushRetryMinutes[index] ?? 60)
    : (pushRetryMinutes[index] ?? 60)
  const next = minutesAfter(now, waited)
  const givenUp = failure.permanent || row.attempts >= pushMaximumAttempts || next >= row.expiresAt

  await tx
    .update(pushOutbox)
    .set({
      status: givenUp ? 'failed' : 'pending',
      lastError: failure.reason.slice(0, 1000),
      nextAttemptAt: givenUp ? now : next,
      updatedAt: now,
    })
    .where(eq(pushOutbox.id, row.id))

  return givenUp ? 'failed' : 'retry'
}
