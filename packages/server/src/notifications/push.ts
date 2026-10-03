import {
  type DeadlineRegistry,
  type PushEntry,
  pushEntries,
  type PushOccasion,
  pushOccasionWords,
  type TenantId,
} from '@opengewerk/domain'
import type { Database, PushDraft, PushRules } from '@opengewerk/platform-server'

import { deadlineKinds } from '../deadlines/registry.js'
import { pushes } from '../push/outbox.js'
import {
  berlinClock,
  causeOf,
  deadlineStillDue,
  type Notification,
  taskStillDue,
} from './notify.js'
import { deadlineDuePush, taskDuePush, testPush } from './templates.js'

/**
 * The second channel of the notifications (#284): push messages to the
 * devices of the people in a business, beside the mail of `notify`.
 *
 * The same notifications, raised by the same functions, and decided the same
 * way: `taskStillDue` and `deadlineStillDue` say whether there is still
 * something to tell and whom, for mail and push alike. What differs is only
 * where the message goes and how little it may say. A module never writes a
 * push message itself, as it never writes a mail. Writing, one message per
 * device, and sending are the foundation's (`pushStore`, ADR 0010).
 */

/** Where a tap leads, on a device that works in the office and on one on site. */
const links: Readonly<Record<PushOccasion | 'test', Readonly<Record<PushEntry, string>>>> = {
  task_due: { office: '/aufgaben', site: '/m/' },
  deadline_due: { office: '/fristen', site: '/m/' },
  test: { office: '/konto', site: '/m/' },
}

/**
 * What this application says about push to the routes of the foundation: a
 * device works in the office or on site, the occasions in the words of
 * "Konto", and the test message.
 */
export const pushRules: PushRules<PushEntry, PushOccasion> = {
  store: pushes,
  entries: pushEntries,
  entryRefused: 'Ein Gerät arbeitet im Büro ("office") oder auf der Baustelle ("site").',
  occasions: pushOccasionWords,
  test: { text: testPush(), urls: links.test },
}

/** What a push message needs besides its cause: the moment, and the kinds of deadline. */
export interface PushNotifyContext {
  readonly now: Date
  readonly deadlineKinds?: DeadlineRegistry
}

function hoursAfter(now: Date, hours: number): Date {
  return new Date(now.getTime() + hours * 3_600_000)
}

/** The end of the day in Berlin that `now` falls on, give or take the hour of a clock change. */
function endOfDay(now: Date): Date {
  return new Date(now.getTime() + (24 * 60 - berlinClock(now).minute) * 60_000)
}

/** Writes the message of a draft, one per signed in device of its person. */
function writePush(
  database: Database,
  tenantId: TenantId,
  draft: PushDraft<PushEntry, PushOccasion>,
  now: Date,
): Promise<readonly string[]> {
  return pushes.write(database, tenantId, draft, now)
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
          urls: links.task_due,
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
          urls: links.deadline_due,
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
