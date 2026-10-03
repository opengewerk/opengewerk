import type { DeadlineRegistry, TenantId } from '@opengewerk/domain'
import { type Database, occasionsOf } from '@opengewerk/platform-server'

import {
  causeOf,
  deadlineDue,
  documentToCustomer,
  dueDeadlines,
  dueTasks,
  invitationByMail,
  type Notification,
  type NotifyContext,
  signedReport,
  signedReports,
  taskDue,
} from './notify.js'
import { pushDeadlineDue, type PushNotifyContext, pushTaskDue } from './push.js'

/** What the writers of this application need beside the moment: the kinds of deadline, for a test. */
export interface NotificationExtra {
  readonly deadlineKinds?: DeadlineRegistry
}

/**
 * The occasions of this application, one per kind of notification, for the
 * mechanism of the foundation (`occasionsOf`, ADR 0010): what is due by
 * itself, who is told, what a message says and what it carries.
 *
 * A task due this morning and a deadline that reminds go by mail and by push;
 * a document the office sends, a report signed on site and an invitation by
 * mail only. The task, the signed report and the deadline are raised by the
 * jobs every minute, the document and the invitation by the route that
 * records the wish.
 */
export const occasions = occasionsOf<Notification, NotificationExtra>({
  task_due: {
    causeOf,
    raise: {
      mail: (database, tenantId, now) => dueTasks(database, tenantId, now, 'mail'),
      push: (database, tenantId, now) => dueTasks(database, tenantId, now, 'push'),
    },
    mail: taskDue,
    push: pushTaskDue,
  },
  document: {
    causeOf,
    mail: (database, tenantId, notification) =>
      documentToCustomer(database, tenantId, notification),
  },
  report_signed: {
    causeOf,
    raise: { mail: (database, tenantId, now) => signedReports(database, tenantId, now) },
    mail: (database, tenantId, notification) => signedReport(database, tenantId, notification),
  },
  invitation: {
    causeOf,
    mail: (database, tenantId, notification) => invitationByMail(database, tenantId, notification),
  },
  deadline_due: {
    causeOf,
    raise: {
      mail: (database, tenantId, now, extra) =>
        dueDeadlines(database, tenantId, now, extra.deadlineKinds, 'mail'),
      push: (database, tenantId, now, extra) =>
        dueDeadlines(database, tenantId, now, extra.deadlineKinds, 'push'),
    },
    mail: deadlineDue,
    push: pushDeadlineDue,
  },
})

/**
 * Turns a notification into a message in the outbox, or into nothing.
 *
 * The only door a message is written through. It decides who is told and
 * what the message says, from the state of things right now: a task that was
 * done in the meantime, moved to another day or handed to somebody who has
 * since been shut out of the business gets no message. Sending is not done
 * here; the row waits for the job, and that is what lets a message survive a
 * mail server that is gone for an afternoon.
 *
 * Written once per cause. Asked twice for the same one, the second time finds
 * the row and writes nothing, so whoever raises notifications does not have to
 * remember what it raised.
 *
 * Returns the identifiers of the messages it wrote.
 */
export function notify(
  database: Database,
  tenantId: TenantId,
  notification: Notification,
  context: NotifyContext,
): Promise<readonly string[]> {
  return occasions.mail(database, tenantId, notification, { ...context, now: new Date() })
}

/**
 * Turns a notification into push messages, one for every device of the
 * person it is for, or into nothing. Returns the identifiers of the messages.
 */
export function notifyPush(
  database: Database,
  tenantId: TenantId,
  notification: Notification,
  context: PushNotifyContext,
): Promise<readonly string[]> {
  return occasions.push(database, tenantId, notification, context)
}
