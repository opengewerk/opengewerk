import type { DeadlineRegistry, PushEntry, PushOccasion, TenantId } from '@opengewerk/domain'
import { and, eq, gt, inArray } from 'drizzle-orm'

import type { Database } from '../database/database.js'
import { newId } from '../database/identifier.js'
import {
  authSessions,
  pushOptOuts,
  pushOutbox,
  pushSubscriptions,
} from '../database/schema/index.js'
import { deadlineKinds } from '../deadlines/registry.js'
import {
  berlinClock,
  causeOf,
  deadlineStillDue,
  type Notification,
  taskStillDue,
} from './notify.js'
import { deadlineDuePush, type PushText, taskDuePush, testPush } from './templates.js'

/**
 * The second channel of the notifications (#284): push messages to the
 * devices of the people in a business, beside the mail of `notify`.
 *
 * The same notifications, raised by the same functions, and decided the same
 * way: `taskStillDue` and `deadlineStillDue` say whether there is still
 * something to tell and whom, for mail and push alike. What differs is only
 * where the message goes and how little it may say. A module never writes a
 * push message itself, as it never writes a mail.
 */

type SubscriptionRow = typeof pushSubscriptions.$inferSelect

/** Where a tap leads, on a device that works in the office and on one on site. */
const links: Readonly<Record<PushOccasion | 'test', Readonly<Record<PushEntry, string>>>> = {
  task_due: { office: '/aufgaben', site: '/m/' },
  deadline_due: { office: '/fristen', site: '/m/' },
  test: { office: '/konto', site: '/m/' },
}

/** What a push message needs besides its cause: the moment, and the kinds of deadline. */
export interface PushNotifyContext {
  readonly now: Date
  readonly deadlineKinds?: DeadlineRegistry
}

/** A message waiting to be written: for whom, about what, and until when it is any use. */
interface PushDraft {
  readonly kind: PushOccasion | 'test'
  readonly cause: string
  readonly userId: string
  readonly text: PushText
  readonly expiresAt: Date
}

function hoursAfter(now: Date, hours: number): Date {
  return new Date(now.getTime() + hours * 3_600_000)
}

/** The end of the day in Berlin that `now` falls on, give or take the hour of a clock change. */
function endOfDay(now: Date): Date {
  return new Date(now.getTime() + (24 * 60 - berlinClock(now).minute) * 60_000)
}

/**
 * The devices among these whose session still exists. A device is signed in
 * with a session, and a device signed out, by itself, from another one or by a
 * new password, gets nothing more; the preview has no session and keeps its
 * devices.
 */
export async function signedIn(
  database: Database,
  devices: readonly SubscriptionRow[],
  now: Date,
): Promise<readonly SubscriptionRow[]> {
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

/**
 * Writes one message per device of the person, unless the person switched
 * the occasion off or has no device that is still signed in. Once per cause
 * and device, like a mail once per cause.
 */
async function writePush(
  database: Database,
  tenantId: TenantId,
  draft: PushDraft,
  now: Date,
): Promise<readonly string[]> {
  const actor = { tenantId, reason: 'notification' }
  const devices = await database.forTenant(actor, async (tx) => {
    if (draft.kind !== 'test') {
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
          url: links[draft.kind][device.entry],
          expiresAt: draft.expiresAt,
        })),
      )
      .onConflictDoNothing({
        target: [pushOutbox.tenantId, pushOutbox.cause, pushOutbox.subscriptionId],
      })
      .returning({ id: pushOutbox.id }),
  )

  return written.map((row) => row.id)
}

/**
 * Turns a notification into push messages, one for every device of the
 * person it is for, or into nothing. Only the notifications about somebody
 * who works in the business; a message to a customer goes by mail.
 *
 * Returns the identifiers of the messages it wrote.
 */
export async function notifyPush(
  database: Database,
  tenantId: TenantId,
  notification: Notification,
  context: PushNotifyContext,
): Promise<readonly string[]> {
  const actor = { tenantId, reason: 'notification' }

  switch (notification.kind) {
    case 'task_due': {
      const task = await database.forTenant(actor, (tx) => taskStillDue(tx, tenantId, notification))

      if (!task) {
        return []
      }

      return writePush(
        database,
        tenantId,
        {
          kind: 'task_due',
          cause: causeOf(notification),
          userId: task.assignee,
          text: taskDuePush(),
          // A task due today is worth a message until the day is over.
          expiresAt: endOfDay(context.now),
        },
        context.now,
      )
    }
    case 'deadline_due': {
      const registry = context.deadlineKinds ?? deadlineKinds
      const due = await database.forTenant(actor, (tx) =>
        deadlineStillDue(tx, tenantId, notification, registry),
      )

      if (!due) {
        return []
      }

      return writePush(
        database,
        tenantId,
        {
          kind: 'deadline_due',
          cause: causeOf(notification),
          userId: due.recipient,
          text: deadlineDuePush({ kind: due.kind.title, dueOn: due.deadline.dueOn }),
          // A reminder comes its lead before the day; a day late it still helps.
          expiresAt: hoursAfter(context.now, 24),
        },
        context.now,
      )
    }
    case 'document':
    case 'report_signed':
    case 'invitation':
      return []
  }
}

/**
 * The test from "Konto": one message to every device of the person that is
 * signed in, sent at once by the route and not by the job. Ten minutes long,
 * because a test that arrives an hour later tests nothing.
 */
export async function writeTestPush(
  database: Database,
  tenantId: TenantId,
  userId: string,
  now: Date,
): Promise<readonly string[]> {
  return writePush(
    database,
    tenantId,
    {
      kind: 'test',
      cause: `test:${newId()}`,
      userId,
      text: testPush(),
      expiresAt: new Date(now.getTime() + 10 * 60_000),
    },
    now,
  )
}
