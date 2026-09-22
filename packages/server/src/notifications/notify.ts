import {
  type DocumentId,
  type InvitationId,
  type IsoDate,
  shippedRules,
  type TaskId,
  type TenantId,
} from '@opengewerk/domain'
import { and, eq, gte, isNull, sql } from 'drizzle-orm'

import { accountsOf, stillOpen } from '../authentication/administration.js'
import type { Database } from '../database/database.js'
import { parameterAt } from '../database/parameters.js'
import {
  customers,
  documents,
  documentSignatures,
  invitations,
  jobs,
  mailOutbox,
  memberships,
  sites,
  tasks,
} from '../database/schema/index.js'
import { contentOf, frozenContent, issuerOf } from '../documents/content.js'
import {
  type DocumentAttachment,
  documentMessage,
  invitationMessage,
  signedReportMessage,
  taskDueMessage,
} from './templates.js'

/**
 * Something that happened and may be worth a message.
 *
 * The notifications have exactly two sources, section 2 of the concept says:
 * a deadline that has come and a status that has changed. A module that wants
 * somebody told raises one of these; it never writes a message itself, and it
 * never talks to a mail server. The deadline engine of phase 2 raises its own
 * through the same door.
 *
 * A task that falls due is a deadline. A document the office sends to its
 * customer is a change of status, the one from issued to on its way: the
 * route that records the wish raises it, and what the message says, which
 * file goes along and from whom it comes is decided here, as for any other.
 */
export type Notification =
  | {
      readonly kind: 'task_due'
      readonly taskId: TaskId
      readonly dueOn: IsoDate
    }
  | {
      readonly kind: 'document'
      readonly documentId: DocumentId
      /**
       * One per wish to send. Sending the same invoice again, because the
       * customer lost it, is a new cause and a new message.
       */
      readonly request: string
      readonly to: { readonly address: string; readonly name: string | null }
      readonly attachment: DocumentAttachment
      /** Who asked, for the audit log and for the screen of the document. */
      readonly requestedBy: string
    }
  | {
      /**
       * A report the customer signed on site, sent to that customer at once
       * where the business has switched that on. A change of status like the
       * one above, raised by the signature instead of by a button.
       */
      readonly kind: 'report_signed'
      readonly documentId: DocumentId
    }
  | {
      /**
       * Somebody invited to work in the business, with the link by mail
       * instead of passed on by the office. A change of status again: the
       * invitation exists and is to be delivered.
       */
      readonly kind: 'invitation'
      readonly invitationId: InvitationId
      readonly requestedBy: string
    }

/** What every message needs besides its cause: where the instance is reached. */
export interface NotifyContext {
  /** The first trusted origin, for links back into the instance. */
  readonly origin: string
}

/** The cause a message is written once for. */
export function causeOf(notification: Notification): string {
  switch (notification.kind) {
    case 'task_due':
      return `task_due:${notification.taskId}:${notification.dueOn}`
    case 'document':
      return `document:${notification.documentId}:${notification.request}`
    case 'report_signed':
      return `report_signed:${notification.documentId}`
    case 'invitation':
      return `invitation:${notification.invitationId}`
  }
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
 * Returns the identifiers of the messages it wrote.
 */
export async function notify(
  database: Database,
  tenantId: TenantId,
  notification: Notification,
  context: NotifyContext,
): Promise<readonly string[]> {
  switch (notification.kind) {
    case 'task_due':
      return taskDue(database, tenantId, notification, context)
    case 'document':
      return documentToCustomer(database, tenantId, notification)
    case 'report_signed':
      return signedReport(database, tenantId, notification)
    case 'invitation':
      return invitationByMail(database, tenantId, notification)
  }
}

async function taskDue(
  database: Database,
  tenantId: TenantId,
  notification: Extract<Notification, { kind: 'task_due' }>,
  context: NotifyContext,
): Promise<readonly string[]> {
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
    return []
  }

  // The address lives with the account, on the instance. The one identifier
  // asked for came out of this business's membership a moment ago.
  const account = (await accountsOf(database, [found.task.assignee], '')).get(found.task.assignee)

  if (!account) {
    return []
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

  return written.map((row) => row.id)
}

/**
 * A document on its way to the customer.
 *
 * Only an issued one, read from what it froze: the message names the number,
 * the date and the amount the customer was sent, never a draft's. The sender
 * is the business as its letterhead stands today, because the message is
 * written today; the document inside is the one it was.
 */
async function documentToCustomer(
  database: Database,
  tenantId: TenantId,
  notification: Extract<Notification, { kind: 'document' }>,
): Promise<readonly string[]> {
  const actor = { tenantId, userId: notification.requestedBy, reason: 'notification' }

  return database.forTenant(actor, async (tx) => {
    const [document] = await tx
      .select()
      .from(documents)
      .where(and(eq(documents.id, notification.documentId), isNull(documents.deletedAt)))

    if (!document) {
      return []
    }

    const issuer = await issuerOf(tx, tenantId)
    let text: { readonly subject: string; readonly body: string }

    if (document.number === null) {
      // A report signed on site and not issued yet: read from its rows, which
      // the signature has fixed, and named by its day and the signature.
      const [signature] = await tx
        .select({ signedAt: documentSignatures.signedAt })
        .from(documentSignatures)
        .where(eq(documentSignatures.documentId, document.id))

      if (document.status !== 'signed' || !signature) {
        return []
      }

      text = signedReportMessage({
        content: await contentOf(tx, document, shippedRules),
        signedOn: berlinClock(signature.signedAt).day,
        issuer,
      })
    } else {
      const content = await frozenContent(tx, document.id)

      if (content === null) {
        return []
      }

      text = documentMessage({ content, attachment: notification.attachment, issuer })
    }

    const written = await tx
      .insert(mailOutbox)
      .values({
        tenantId,
        kind: 'document',
        cause: causeOf(notification),
        documentId: notification.documentId,
        attachment: notification.attachment,
        requestedBy: notification.requestedBy,
        senderName: issuer.name,
        replyTo: issuer.email,
        recipientAddress: notification.to.address,
        recipientName: notification.to.name,
        subject: text.subject,
        body: text.body,
      })
      .onConflictDoNothing({ target: [mailOutbox.tenantId, mailOutbox.cause] })
      .returning({ id: mailOutbox.id })

    return written.map((row) => row.id)
  })
}

/**
 * How far back a signature counts. The job looks every minute, so a report
 * signed a moment ago is found a moment later; the margin is for an instance
 * that was down for a night. Older signatures are left alone, and switching
 * the setting on with a day in the past does not send a pile of old reports.
 */
const signaturesWithinHours = 48

/**
 * The reports signed lately that the business wants sent to their customer
 * and that have not been, as notifications.
 *
 * Whether it wants that is the setting `report.mail_on_signature` on the day
 * of the signature, in Berlin: a report signed before it was switched on is
 * not sent afterwards, one signed while it was on is sent even if it was
 * switched off since.
 */
export async function signedReports(
  database: Database,
  tenantId: TenantId,
  now: Date,
): Promise<readonly Notification[]> {
  const since = new Date(now.getTime() - signaturesWithinHours * 3_600_000)

  return database.forTenant({ tenantId, reason: 'notification' }, async (tx) => {
    const rows = await tx
      .select({ id: documents.id, signedAt: documentSignatures.signedAt })
      .from(documents)
      .innerJoin(documentSignatures, eq(documentSignatures.documentId, documents.id))
      .where(
        and(
          eq(documents.kind, 'time_and_material_report'),
          isNull(documents.deletedAt),
          gte(documentSignatures.signedAt, since),
          sql`not exists (
            select 1 from ${mailOutbox}
             where ${mailOutbox.tenantId} = ${documents.tenantId}
               and ${mailOutbox.cause} = 'report_signed:' || ${documents.id}::text
          )`,
        ),
      )

    const wanted: Notification[] = []

    for (const row of rows) {
      const setting = await parameterAt(
        tx,
        'report.mail_on_signature',
        berlinClock(row.signedAt).day,
      )

      if (setting?.value === 1) {
        wanted.push({ kind: 'report_signed', documentId: row.id })
      }
    }

    return wanted
  })
}

/**
 * A signed report on its way to the customer who signed it.
 *
 * To the address the customer has now, and to nobody when there is none: the
 * office can still send it from the report once there is one. The report is
 * read the way its PDF is, from what it froze if it was issued in the
 * meantime, otherwise from its rows, which the signature has fixed.
 */
async function signedReport(
  database: Database,
  tenantId: TenantId,
  notification: Extract<Notification, { kind: 'report_signed' }>,
): Promise<readonly string[]> {
  return database.forTenant({ tenantId, reason: 'notification' }, async (tx) => {
    const [document] = await tx
      .select()
      .from(documents)
      .where(and(eq(documents.id, notification.documentId), isNull(documents.deletedAt)))

    if (!document) {
      return []
    }

    const [signature] = await tx
      .select({ signedAt: documentSignatures.signedAt })
      .from(documentSignatures)
      .where(eq(documentSignatures.documentId, document.id))

    const [customer] = await tx
      .select({ name: customers.name, email: customers.email })
      .from(customers)
      .where(eq(customers.id, document.customerId))

    if (!signature || !customer?.email) {
      return []
    }

    const content =
      document.number !== null
        ? await frozenContent(tx, document.id)
        : await contentOf(tx, document, shippedRules)

    if (content === null) {
      return []
    }

    const issuer = await issuerOf(tx, tenantId)
    const text = signedReportMessage({
      content,
      signedOn: berlinClock(signature.signedAt).day,
      issuer,
    })

    const written = await tx
      .insert(mailOutbox)
      .values({
        tenantId,
        kind: 'document',
        cause: causeOf(notification),
        documentId: document.id,
        attachment: 'pdf',
        requestedBy: null,
        senderName: issuer.name,
        replyTo: issuer.email,
        recipientAddress: customer.email,
        recipientName: customer.name,
        subject: text.subject,
        body: text.body,
      })
      .onConflictDoNothing({ target: [mailOutbox.tenantId, mailOutbox.cause] })
      .returning({ id: mailOutbox.id })

    return written.map((row) => row.id)
  })
}

/**
 * An invitation on its way to the person invited.
 *
 * Only an open one: called back, used or run out before the message is
 * written, it gets none. The message holds a placeholder where the link goes;
 * the job makes the token when it sends, see `mail/invitation-link.ts`.
 */
async function invitationByMail(
  database: Database,
  tenantId: TenantId,
  notification: Extract<Notification, { kind: 'invitation' }>,
): Promise<readonly string[]> {
  const actor = { tenantId, userId: notification.requestedBy, reason: 'notification' }

  const found = await database.forTenant(actor, async (tx) => {
    const [invitation] = await tx
      .select({
        id: invitations.id,
        email: invitations.email,
        name: invitations.name,
        invitedBy: invitations.invitedBy,
        expiresAt: invitations.expiresAt,
      })
      .from(invitations)
      .where(and(eq(invitations.id, notification.invitationId), stillOpen()))

    return invitation ? { invitation, issuer: await issuerOf(tx, tenantId) } : null
  })

  if (!found) {
    return []
  }

  // The one who invited works here, the invitation says so; their name is
  // looked up on the instance for exactly that identifier.
  const inviter = (await accountsOf(database, [found.invitation.invitedBy], '')).get(
    found.invitation.invitedBy,
  )
  const text = invitationMessage({
    name: found.invitation.name,
    inviter: inviter?.name ?? null,
    expiresAt: found.invitation.expiresAt,
    issuer: found.issuer,
  })

  const written = await database.forTenant(actor, (tx) =>
    tx
      .insert(mailOutbox)
      .values({
        tenantId,
        kind: 'invitation',
        cause: causeOf(notification),
        invitationId: found.invitation.id,
        requestedBy: notification.requestedBy,
        senderName: found.issuer.name,
        replyTo: found.issuer.email,
        recipientAddress: found.invitation.email,
        recipientName: found.invitation.name,
        subject: text.subject,
        body: text.body,
      })
      .onConflictDoNothing({ target: [mailOutbox.tenantId, mailOutbox.cause] })
      .returning({ id: mailOutbox.id }),
  )

  return written.map((row) => row.id)
}
