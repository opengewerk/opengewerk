import type { IsoDate, TaskId, TenantId } from '@opengewerk/domain'
import { and, eq, isNull, sql } from 'drizzle-orm'

import { accountsOf } from '../authentication/administration.js'
import type { Database } from '../database/database.js'
import { customers, jobs, mailOutbox, memberships, sites, tasks } from '../database/schema/index.js'
import { issuerOf } from '../documents/content.js'
import { taskDueMessage } from './templates.js'

/**
 * Something that happened and may be worth a message.
 *
 * The notifications have exactly two sources, section 2 of the concept says:
 * a deadline that has come and a status that has changed. A module that wants
 * somebody told raises one of these; it never writes a message itself, and it
 * never talks to a mail server. Phase 1 knows one kind. The deadline engine of
 * phase 2 raises its own through the same door.
 */
export type Notification = {
  readonly kind: 'task_due'
  readonly taskId: TaskId
  readonly dueOn: IsoDate
}

/** What every message needs besides its cause: where the instance is reached. */
export interface NotifyContext {
  /** The first trusted origin, for links back into the instance. */
  readonly origin: string
}

/** The cause a message is written once for. */
export function causeOf(notification: Notification): string {
  return `${notification.kind}:${notification.taskId}:${notification.dueOn}`
}

/** The day and the minute of the day in Berlin, where the businesses are. */
export function berlinClock(now: Date): { readonly day: IsoDate; readonly minute: number } {
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? '00'

  return {
    day: `${part('year')}-${part('month')}-${part('day')}` as IsoDate,
    minute: Number(part('hour')) * 60 + Number(part('minute')),
  }
}

/**
 * From when in the morning a task due today is told to its person.
 *
 * Not at midnight: a message that arrives at six is at the top of the inbox
 * when the day starts, one from midnight is under everything that came after.
 */
export const dueTasksFromMinute = 6 * 60

/**
 * The tasks due today that have not been told yet, as notifications.
 *
 * Asked every minute, and cheap because of that last condition: a task that
 * already has its message is not looked at again. Only the day itself counts.
 * A task created for a day already past has been late since it was written,
 * and a backlog of messages for old tasks is not what somebody switching mail
 * on wants to find in everybody's inbox.
 */
export async function dueTasks(
  database: Database,
  tenantId: TenantId,
  now: Date,
): Promise<readonly Notification[]> {
  const { day, minute } = berlinClock(now)

  if (minute < dueTasksFromMinute) {
    return []
  }

  const rows = await database.forTenant({ tenantId, reason: 'notification' }, (tx) =>
    tx
      .select({ id: tasks.id, dueOn: tasks.dueOn })
      .from(tasks)
      .where(
        and(
          eq(tasks.status, 'open'),
          isNull(tasks.deletedAt),
          eq(tasks.dueOn, day),
          sql`not exists (
            select 1 from ${mailOutbox}
             where ${mailOutbox.tenantId} = ${tasks.tenantId}
               and ${mailOutbox.cause} = 'task_due:' || ${tasks.id}::text || ':' || to_char(${tasks.dueOn}, 'YYYY-MM-DD')
          )`,
        ),
      ),
  )

  return rows.map((row) => ({
    kind: 'task_due' as const,
    taskId: row.id,
    dueOn: row.dueOn as IsoDate,
  }))
}

/**
 * Turns a notification into a message in the outbox, or into nothing.
 *
 * The only place a message is written. It decides who is told and what the
 * message says, from the state of things right now: a task that was done in
 * the meantime, moved to another day or handed to somebody who has since been
 * shut out of the business gets no message. Sending is not done here; the
 * row waits for the job in `mail/worker.ts`, and that is what lets a message
 * survive a mail server that is gone for an afternoon.
 *
 * Written once per cause. Asked twice for the same one, the second time finds
 * the row and writes nothing, so whoever raises notifications does not have to
 * remember what it raised.
 *
 * Returns how many messages it wrote.
 */
export async function notify(
  database: Database,
  tenantId: TenantId,
  notification: Notification,
  context: NotifyContext,
): Promise<number> {
  const actor = { tenantId, reason: 'notification' }

  const found = await database.forTenant(actor, async (tx) => {
    const [task] = await tx
      .select({
        id: tasks.id,
        title: tasks.title,
        notes: tasks.notes,
        dueOn: tasks.dueOn,
        status: tasks.status,
        deletedAt: tasks.deletedAt,
        assignee: tasks.assigneeUserId,
        customer: customers.name,
        site: sites.designation,
        job: jobs.designation,
      })
      .from(tasks)
      .leftJoin(customers, eq(customers.id, tasks.customerId))
      .leftJoin(sites, eq(sites.id, tasks.siteId))
      .leftJoin(jobs, eq(jobs.id, tasks.jobId))
      .where(eq(tasks.id, notification.taskId))

    if (
      !task ||
      task.status !== 'open' ||
      task.deletedAt !== null ||
      task.dueOn !== notification.dueOn
    ) {
      return null
    }

    const [member] = await tx
      .select({ blockedAt: memberships.blockedAt })
      .from(memberships)
      .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, task.assignee)))

    if (!member || member.blockedAt !== null) {
      return null
    }

    return { task, issuer: await issuerOf(tx, tenantId) }
  })

  if (!found) {
    return 0
  }

  // The address lives with the account, on the instance. The one identifier
  // asked for came out of this business's membership a moment ago.
  const account = (await accountsOf(database, [found.task.assignee], '')).get(found.task.assignee)

  if (!account) {
    return 0
  }

  const text = taskDueMessage({
    task: found.task,
    recipientName: account.name,
    issuer: found.issuer,
    origin: context.origin,
  })

  const written = await database.forTenant(actor, (tx) =>
    tx
      .insert(mailOutbox)
      .values({
        tenantId,
        kind: 'task_due',
        cause: causeOf(notification),
        taskId: found.task.id,
        senderName: found.issuer.name,
        replyTo: found.issuer.email,
        recipientAddress: account.email,
        recipientName: account.name,
        subject: text.subject,
        body: text.body,
      })
      .onConflictDoNothing({ target: [mailOutbox.tenantId, mailOutbox.cause] })
      .returning({ id: mailOutbox.id }),
  )

  return written.length
}
