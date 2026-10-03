import type { TenantId } from '@opengewerk/platform-domain'
import { and, asc, eq, gt, inArray, isNotNull, lte, sql } from 'drizzle-orm'

import type { Database, TenantTransaction } from '../database/database.js'
import { authSessions } from '../database/schema/authentication.js'
import { type PushTables, pushTestKind } from '../database/schema/push.js'

/**
 * How long a message waits after each failed attempt, in minutes. Shorter than
 * for mail and fewer of them: a push message is about today, and one that
 * cannot go out within the hour is not much use after it. Its `expires_at`
 * ends the trying in any case.
 */
export const pushRetryMinutes: readonly number[] = [1, 5, 15, 30, 60]

/** After this many attempts a message is given up on. */
export const pushMaximumAttempts = 6

/** How long a claimed message is left alone, as for mail. */
export const pushClaimMinutes = 10

function minutesAfter(now: Date, minutes: number): Date {
  return new Date(now.getTime() + minutes * 60_000)
}

type Tables = PushTables

/** A device that takes push messages, as its row stands. */
export type PushDevice = Tables['pushSubscriptions']['$inferSelect']

/** A push message, as its row stands. */
export type PushRow = Tables['pushOutbox']['$inferSelect']

/** A message that is due, with the device it goes to. */
export interface ClaimedPush {
  readonly message: PushRow
  readonly subscription: PushDevice
}

/** What a push message says: a title and one line, never a name or an address. */
export interface PushText {
  readonly title: string
  readonly body: string
}

/** A message waiting to be written: for whom, about what, where a tap leads and until when it is any use. */
export interface PushDraft<Entry extends string, Occasion extends string> {
  readonly kind: Occasion | typeof pushTestKind
  readonly cause: string
  readonly userId: string
  readonly text: PushText
  /** Where a tap leads, on a device of each entry. */
  readonly urls: Readonly<Record<Entry, string>>
  readonly expiresAt: Date
}

/** Why a message did not go out, and whether waiting can help. */
export interface PushFailure {
  readonly reason: string
  readonly permanent: boolean
  /** What the push service asked to wait, in seconds, where it asked. */
  readonly afterSeconds?: number | null
}

/**
 * The devices among these whose session still exists. A device is signed in
 * with a session, and a device signed out, by itself, from another one or by a
 * new password, gets nothing more; a device without a session at all keeps
 * its messages.
 */
export async function signedIn<Device extends Pick<PushDevice, 'sessionId'>>(
  database: Database,
  devices: readonly Device[],
  now: Date,
): Promise<readonly Device[]> {
  const sessionIds = devices.flatMap((device) => (device.sessionId ? [device.sessionId] : []))
  const alive =
    sessionIds.length === 0
      ? new Set<string>()
      : new Set(
          (
            await database.forInstance((tx) =>
              tx
                .select({ id: authSessions.id })
                .from(authSessions)
                .where(and(inArray(authSessions.id, sessionIds), gt(authSessions.expiresAt, now))),
            )
          ).map((row) => row.id),
        )

  return devices.filter((device) => device.sessionId === null || alive.has(device.sessionId))
}

/** The devices and messages of push of one application, written, claimed, marked and taken off. */
export interface PushStore<Entry extends string = string, Occasion extends string = string> {
  /** The tables, for the routes of push. */
  readonly tables: PushTables<Entry, Occasion>
  /**
   * Writes one message per device of the person, unless the person switched
   * the occasion off or has no device that is still signed in. Once per cause
   * and device, like a mail once per cause. Returns the messages it wrote.
   */
  write(
    database: Database,
    tenantId: TenantId,
    draft: PushDraft<Entry, Occasion>,
    now: Date,
  ): Promise<readonly string[]>
  /** Whether anybody in this tenant takes push at all. */
  anyDevice(tx: TenantTransaction): Promise<boolean>
  /**
   * Takes off the devices of this tenant whose session no longer exists. The
   * browser still holds its subscription, but nobody is signed in there any
   * more, and a message would tell whoever picks the telephone up next what
   * is due. Returns how many.
   */
  forgetSignedOut(database: Database, tenantId: TenantId, now: Date): Promise<number>
  /** Takes a device off, and its messages with it. */
  forget(tx: TenantTransaction, subscriptionId: PushDevice['id']): Promise<void>
  /**
   * Takes the messages that are due and not expired and marks them as being
   * sent, `skip locked` as for mail, so that two passes side by side send
   * nothing twice. `only` narrows it to messages just written, for a test
   * message a route sends at once.
   */
  claimDue(
    tx: TenantTransaction,
    now: Date,
    only?: readonly string[],
    limit?: number,
  ): Promise<readonly ClaimedPush[]>
  /**
   * Gives up on the messages that were not sent in time: a reminder of
   * something due yesterday says nothing any more. The rows stay, with why.
   */
  giveUpLate(tx: TenantTransaction, now: Date): Promise<number>
  /** The message went out. */
  markSent(tx: TenantTransaction, id: PushRow['id'], now: Date): Promise<void>
  /**
   * The message did not go out this time. It waits and is tried again, unless
   * the answer will not change, it has been tried often enough or it would
   * come too late; then it stays as `failed`, with the reason.
   */
  markFailed(
    tx: TenantTransaction,
    row: Pick<PushRow, 'id' | 'attempts' | 'expiresAt'>,
    failure: PushFailure,
    now: Date,
  ): Promise<'retry' | 'failed'>
}

/**
 * The store over the tables an application made with `pushSchema`. The
 * statements are the same whatever its entries and occasions are called.
 */
export function pushStore<const Entry extends string, const Occasion extends string>(
  tables: PushTables<Entry, Occasion>,
): PushStore<Entry, Occasion> {
  const { pushSubscriptions, pushOptOuts, pushOutbox } = tables as unknown as Tables

  async function forget(tx: TenantTransaction, subscriptionId: PushDevice['id']) {
    await tx.delete(pushSubscriptions).where(eq(pushSubscriptions.id, subscriptionId))
  }

  return {
    tables,

    async write(database, tenantId, draft, now) {
      const actor = { tenantId, reason: 'notification' }
      const devices = await database.forTenant(actor, async (tx) => {
        if (draft.kind !== pushTestKind) {
          const [off] = await tx
            .select({ id: pushOptOuts.id })
            .from(pushOptOuts)
            .where(and(eq(pushOptOuts.userId, draft.userId), eq(pushOptOuts.occasion, draft.kind)))

          if (off) {
            return []
          }
        }

        return tx.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, draft.userId))
      })
      const live = await signedIn(database, devices, now)

      if (live.length === 0) {
        return []
      }

      const urls = draft.urls as Readonly<Record<string, string>>
      const written = await database.forTenant(actor, (tx) =>
        tx
          .insert(pushOutbox)
          .values(
            live.map((device) => ({
              tenantId,
              kind: draft.kind,
              cause: draft.cause,
              subscriptionId: device.id,
              title: draft.text.title,
              body: draft.text.body,
              url: urls[device.entry] ?? '/',
              expiresAt: draft.expiresAt,
            })),
          )
          .onConflictDoNothing({
            target: [pushOutbox.tenantId, pushOutbox.cause, pushOutbox.subscriptionId],
          })
          .returning({ id: pushOutbox.id }),
      )

      return written.map((row) => row.id)
    },

    async anyDevice(tx) {
      const [device] = await tx
        .select({ id: pushSubscriptions.id })
        .from(pushSubscriptions)
        .limit(1)

      return device !== undefined
    },

    async forgetSignedOut(database, tenantId, now) {
      const actor = { tenantId, reason: 'push' }
      const bound = await database.forTenant(actor, (tx) =>
        tx.select().from(pushSubscriptions).where(isNotNull(pushSubscriptions.sessionId)),
      )

      if (bound.length === 0) {
        return 0
      }

      const alive = new Set((await signedIn(database, bound, now)).map((device) => device.id))
      const gone = bound.filter((device) => !alive.has(device.id))

      for (const device of gone) {
        await database.forTenant(actor, (tx) => forget(tx, device.id))
      }

      return gone.length
    },

    forget,

    async claimDue(tx, now, only, limit = 50) {
      const due = await tx
        .select({ id: pushOutbox.id })
        .from(pushOutbox)
        .where(
          and(
            eq(pushOutbox.status, 'pending'),
            gt(pushOutbox.expiresAt, now),
            // Messages just written are due whatever the clock of the database
            // put into `next_attempt_at`, which runs apart from this one.
            only
              ? inArray(pushOutbox.id, only as PushRow['id'][])
              : lte(pushOutbox.nextAttemptAt, now),
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
    },

    async giveUpLate(tx, now) {
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
    },

    async markSent(tx, id, now) {
      await tx
        .update(pushOutbox)
        .set({ status: 'sent', sentAt: now, lastError: null, updatedAt: now })
        .where(eq(pushOutbox.id, id))
    },

    async markFailed(tx, row, failure, now) {
      const index = Math.min(Math.max(row.attempts, 1), pushRetryMinutes.length) - 1
      const waited = failure.afterSeconds
        ? Math.max(failure.afterSeconds / 60, pushRetryMinutes[index] ?? 60)
        : (pushRetryMinutes[index] ?? 60)
      const next = minutesAfter(now, waited)
      const givenUp =
        failure.permanent || row.attempts >= pushMaximumAttempts || next >= row.expiresAt

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
    },
  }
}
