import { smtpSecurities } from '@opengewerk/domain'
import {
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

import { primaryId, reference, timestamps } from './columns.js'
import { documents } from './documents.js'
import { invitations } from './memberships.js'
import { tenantIsolation } from './rls.js'
import { tasks } from './tasks.js'
import { tenantColumn } from './tenants.js'

/** What a message is about. One kind per cause the notifications know. */
export const mailKind = pgEnum('mail_kind', ['task_due', 'document', 'invitation'])

/**
 * The file a message about a document carries: the PDF, or one of the two
 * forms of the e-invoice. Chosen when the message is written, made or read
 * when it is sent, so that the file is the one the document keeps.
 */
export const mailAttachment = pgEnum('mail_attachment', ['pdf', 'zugferd', 'xrechnung'])

/**
 * Where a message stands. `failed` is the end of trying, not the end of the
 * row: the message stays, with the last error, and nothing is ever deleted.
 */
export const mailStatus = pgEnum('mail_status', ['pending', 'sent', 'failed'])

/**
 * Every message the instance sends, before and after it went out.
 *
 * A message is written here in the transaction of whatever caused it and sent
 * afterwards, by the job in `mail/worker.ts`. A mail server that does not
 * answer for two hours therefore costs two hours and nothing else: the row
 * waits, the job tries again, and the cause that wrote it has long committed.
 * The same shape as the outbox of a device, turned round.
 *
 * What goes out is decided when the row is written, subject and text included.
 * The row is the record of what the business told somebody and when, which is
 * the question the audit log will be asked about an invoice sent by mail; a
 * text put together again at sending time could say something the row does
 * not.
 *
 * `cause` makes a message happen once per cause. A due task is caused by the
 * task and its day, so the job that looks for due tasks every minute writes
 * one row and not sixty, and a task moved to another day is a new cause.
 */
export const mailOutbox = pgTable(
  'mail_outbox',
  {
    id: primaryId<'mail'>(),
    ...tenantColumn,
    kind: mailKind('kind').notNull(),
    cause: text('cause').notNull(),
    taskId: reference<'task'>('task_id'),
    documentId: reference<'document'>('document_id'),
    attachment: mailAttachment('attachment'),
    invitationId: reference<'invitation'>('invitation_id'),
    /** Who asked for the message, for one somebody asked for. Null for a due task. */
    requestedBy: text('requested_by'),
    senderName: text('sender_name').notNull(),
    replyTo: text('reply_to'),
    recipientAddress: text('recipient_address').notNull(),
    recipientName: text('recipient_name'),
    subject: text('subject').notNull(),
    body: text('body').notNull(),
    status: mailStatus('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    lastError: text('last_error'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    foreignKey({
      columns: [table.tenantId, table.taskId],
      foreignColumns: [tasks.tenantId, tasks.id],
      name: 'mail_outbox_task_in_tenant',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.tenantId, table.documentId],
      foreignColumns: [documents.tenantId, documents.id],
      name: 'mail_outbox_document_in_tenant',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.tenantId, table.invitationId],
      foreignColumns: [invitations.tenantId, invitations.id],
      name: 'mail_outbox_invitation_in_tenant',
    }).onDelete('restrict'),
    unique('mail_outbox_once_per_cause').on(table.tenantId, table.cause),
    index('mail_outbox_due_idx').on(table.tenantId, table.status, table.nextAttemptAt),
    index('mail_outbox_task_idx').on(table.tenantId, table.taskId),
    index('mail_outbox_document_idx').on(table.tenantId, table.documentId),
    index('mail_outbox_invitation_idx').on(table.tenantId, table.invitationId),
  ],
)

/** How the connection to the mail server of a business is protected. */
export const mailSecurity = pgEnum('mail_security', smtpSecurities)

/**
 * The mail server a business sends through, and the signature under what it
 * sends. One row per business, which the unique index holds, and none for a
 * business that sends no mail: then nothing is written for it and nothing
 * sent, as if the feature were not there.
 *
 * Per business and not per instance. A message goes out from the business's
 * own mailbox, with its own login, so that a customer sees the address they
 * know and the provider of that mailbox vouches for it. On an instance with
 * several businesses each one brings its own.
 *
 * The password is not here. It is sealed in `secrets`, which the audit log
 * does not watch; this table carries the moment it was set, and the log sees
 * that change like any other, with the person who made it.
 *
 * No sync columns: a device does not send mail and never sees this row.
 */
export const mailSettings = pgTable(
  'mail_settings',
  {
    id: primaryId<'mail_settings'>(),
    ...tenantColumn,
    host: text('host').notNull(),
    port: integer('port').notNull(),
    security: mailSecurity('security').notNull(),
    /** The login to the mailbox. Null for a relay that takes mail without one. */
    username: text('username'),
    /** The address every message of this business leaves from. */
    fromAddress: text('from_address').notNull(),
    /** The signature with its placeholders, as written. Null means the letterhead. */
    signature: text('signature'),
    /** When the password was last set, null while there is none. */
    passwordSetAt: timestamp('password_set_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    uniqueIndex('mail_settings_tenant').on(table.tenantId),
  ],
)
