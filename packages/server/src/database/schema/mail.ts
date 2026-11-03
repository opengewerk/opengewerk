import { mailOutboxSchema, reference } from '@opengewerk/platform-server'
import { foreignKey, index, pgEnum } from 'drizzle-orm/pg-core'

import { appointments } from './appointments.js'
import { deadlines } from './deadlines.js'
import { documents } from './documents.js'
import { earlyStartRequests } from './early-start-requests.js'
import { jobs } from './jobs.js'
import { tasks } from './tasks.js'

/**
 * What a message is about. One kind per cause the notifications know, and one
 * for the passkey added to an account (#167), which is told to the account
 * through the outbox of a business it works in. In the order the enum learnt
 * them, which is the order they stand in the database.
 */
export const mailKinds = [
  'task_due',
  'document',
  'invitation',
  'deadline_due',
  'passkey_added',
  // The instructions of a service call to its customer (#292).
  'job_instructions',
  // The confirmations to a customer (#315): an appointment arranged, moved or
  // cancelled, with its calendar file, and a service call the office took.
  'appointment_confirmation',
  'job_received',
  // The reminders of a due inspection or maintenance to a customer (#316).
  'customer_reminder',
] as const

/**
 * The file a message about a document carries: the PDF, or one of the two
 * forms of the e-invoice. Chosen when the message is written, made or read
 * when it is sent, so that the file is the one the document keeps.
 */
export const mailAttachment = pgEnum('mail_attachment', ['pdf', 'zugferd', 'xrechnung'])

/**
 * Every message the instance sends, before and after it went out.
 *
 * The table and how it is sent are the foundation's (`mailOutboxSchema`,
 * ADR 0010): written in the transaction of whatever caused a message, sent
 * by the job afterwards, once per cause. Kept here are the kinds of this
 * application and the columns for what its messages are about: the task that
 * is due, the document with the file it carries, and the deadline.
 */
export const { mailKind, mailStatus, mailOutbox } = mailOutboxSchema({
  kinds: mailKinds,
  columns: {
    taskId: reference<'task'>('task_id'),
    documentId: reference<'document'>('document_id'),
    attachment: mailAttachment('attachment'),
    deadlineId: reference<'deadline'>('deadline_id'),
    // The service call whose instructions go out, and the request for an
    // early start signed at the door that comes along, if one did (#292).
    jobId: reference<'job'>('job_id'),
    earlyStartRequestId: reference<'early-start-request'>('early_start_request_id'),
    // The appointment a confirmation is about (#315), whose calendar file is
    // made when the mail goes out. For a service call that came in, `job_id`
    // names the job, and `attachment` set to `pdf` means its instructions go along.
    appointmentId: reference<'appointment'>('appointment_id'),
  },
  constraints: (table) => [
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
      columns: [table.tenantId, table.deadlineId],
      foreignColumns: [deadlines.tenantId, deadlines.id],
      name: 'mail_outbox_deadline_in_tenant',
    }).onDelete('restrict'),
    index('mail_outbox_task_idx').on(table.tenantId, table.taskId),
    index('mail_outbox_document_idx').on(table.tenantId, table.documentId),
    foreignKey({
      columns: [table.tenantId, table.jobId],
      foreignColumns: [jobs.tenantId, jobs.id],
      name: 'mail_outbox_job_in_tenant',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.tenantId, table.earlyStartRequestId],
      foreignColumns: [earlyStartRequests.tenantId, earlyStartRequests.id],
      name: 'mail_outbox_early_start_request_in_tenant',
    }).onDelete('restrict'),
    index('mail_outbox_deadline_idx').on(table.tenantId, table.deadlineId),
    index('mail_outbox_job_idx').on(table.tenantId, table.jobId),
    index('mail_outbox_early_start_request_idx').on(table.tenantId, table.earlyStartRequestId),
    foreignKey({
      columns: [table.tenantId, table.appointmentId],
      foreignColumns: [appointments.tenantId, appointments.id],
      name: 'mail_outbox_appointment_in_tenant',
    }).onDelete('restrict'),
    index('mail_outbox_appointment_idx').on(table.tenantId, table.appointmentId),
  ],
})
