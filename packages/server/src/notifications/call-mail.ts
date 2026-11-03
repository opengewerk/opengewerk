import {
  berlinClock,
  type EarlyStartRequestId,
  type JobId,
  type TenantId,
} from '@opengewerk/domain'
import type { Database, TenantTransaction } from '@opengewerk/platform-server'
import { and, desc, eq, gte, isNull, or, sql } from 'drizzle-orm'

import { earlyStartRequests, mailOutbox } from '../database/schema/index.js'
import { issuerOf } from '../documents/content.js'
import { callOf } from '../service-calls/instructions.js'
import { causeOf, nameOf, type Notification, signatureFor } from './notify.js'
import { callInstructionsMessage } from './templates.js'

/**
 * How far back the job looks for requests signed at the door that have not
 * gone out: two days, as for a report. A device that comes back after a week
 * brings a request whose instructions the office has sent by then or not, and
 * that is its decision, at the job.
 */
const requestsWithinHours = 48

/** One message with the instructions of a service call, as the office lists it. */
export interface CallMailRow {
  readonly id: string
  readonly to: string
  readonly status: 'pending' | 'sent' | 'failed'
  readonly lastError: string | null
  readonly sentAt: Date | null
  readonly createdAt: Date
  readonly requestedBy: string | null
  /** The request signed at the door it carries, or null for the instructions alone. */
  readonly earlyStartRequestId: string | null
}

/**
 * Every message with the instructions of a service call, newest first. Read
 * here and not in the route, so that the outbox is touched where messages are
 * written and where they are sent (`mail/boundaries.test.ts`).
 */
/**
 * A message that carries the instructions of a call: the office's own
 * sending, the one after a request at the door, and the confirmation of a
 * service call for a consumer (#315). A confirmation of an appointment at the
 * same job carries none.
 */
function carriesInstructions(jobId: JobId) {
  return and(
    eq(mailOutbox.jobId, jobId),
    or(
      eq(mailOutbox.kind, 'job_instructions'),
      and(eq(mailOutbox.kind, 'job_received'), eq(mailOutbox.attachment, 'pdf')),
    ),
  )
}

export async function messagesAboutCall(
  tx: TenantTransaction,
  jobId: JobId,
): Promise<readonly CallMailRow[]> {
  return tx
    .select({
      id: mailOutbox.id,
      to: mailOutbox.recipientAddress,
      status: mailOutbox.status,
      lastError: mailOutbox.lastError,
      sentAt: mailOutbox.sentAt,
      createdAt: mailOutbox.createdAt,
      requestedBy: mailOutbox.requestedBy,
      earlyStartRequestId: mailOutbox.earlyStartRequestId,
    })
    .from(mailOutbox)
    .where(carriesInstructions(jobId))
    .orderBy(desc(mailOutbox.createdAt), desc(mailOutbox.id))
}

/**
 * Whether a message with the instructions of this call to this address is
 * still waiting: a second click would send them twice the moment the mail
 * server is back, as for a document.
 */
export async function callMailWaiting(
  tx: TenantTransaction,
  jobId: JobId,
  address: string,
): Promise<boolean> {
  const [waiting] = await tx
    .select({ id: mailOutbox.id })
    .from(mailOutbox)
    .where(
      and(
        carriesInstructions(jobId),
        eq(mailOutbox.recipientAddress, address),
        eq(mailOutbox.status, 'pending'),
      ),
    )
    .limit(1)

  return waiting !== undefined
}

/**
 * The requests for an early start signed at the door lately that have not
 * gone to their customer, as notifications (#292). Always, without a setting:
 * the request and the instructions belong on a durable medium with the
 * customer (§ 357a Abs. 2 BGB), and the mail is that.
 */
export async function signedEarlyStarts(
  database: Database,
  tenantId: TenantId,
  now: Date,
): Promise<readonly Extract<Notification, { readonly kind: 'early_start_signed' }>[]> {
  const since = new Date(now.getTime() - requestsWithinHours * 3_600_000)

  return database.forTenant({ tenantId, reason: 'notification' }, async (tx) => {
    const rows = await tx
      .select({ id: earlyStartRequests.id })
      .from(earlyStartRequests)
      .where(
        and(
          isNull(earlyStartRequests.deletedAt),
          gte(earlyStartRequests.createdAt, since),
          sql`not exists (
            select 1 from ${mailOutbox}
             where ${mailOutbox.tenantId} = ${earlyStartRequests.tenantId}
               and ${mailOutbox.cause} = 'early_start_signed:' || ${earlyStartRequests.id}::text
          )`,
        ),
      )

    return rows.map((row) => ({ kind: 'early_start_signed' as const, requestId: row.id }))
  })
}

/**
 * A request signed at the door on its way to the customer, with the
 * instructions it was signed under. To the address the customer has now, and
 * to nobody when there is none: the office sees at the job that nothing went
 * out, and prints them.
 */
export async function signedEarlyStartMail(
  database: Database,
  tenantId: TenantId,
  notification: Extract<Notification, { kind: 'early_start_signed' }>,
): Promise<readonly string[]> {
  return database.forTenant({ tenantId, reason: 'notification' }, async (tx) => {
    const [request] = await tx
      .select({
        id: earlyStartRequests.id,
        jobId: earlyStartRequests.jobId,
        signerName: earlyStartRequests.signerName,
        signedAt: earlyStartRequests.signedAt,
      })
      .from(earlyStartRequests)
      .where(eq(earlyStartRequests.id, notification.requestId as EarlyStartRequestId))

    const call = request ? await callOf(tx, request.jobId) : null

    if (!request || !call?.customerEmail) {
      return []
    }

    const issuer = await issuerOf(tx, tenantId)
    // Sent because somebody signed, and by nobody in the business.
    const text = callInstructionsMessage({
      call,
      signed: { signerName: request.signerName, signedOn: berlinClock(request.signedAt).day },
      issuer,
      signature: await signatureFor(tx, tenantId, issuer, null),
    })

    const written = await tx
      .insert(mailOutbox)
      .values({
        tenantId,
        kind: 'job_instructions',
        cause: causeOf(notification),
        jobId: call.id,
        earlyStartRequestId: request.id,
        requestedBy: null,
        senderName: issuer.name,
        replyTo: issuer.email,
        recipientAddress: call.customerEmail,
        recipientName: call.customerName,
        subject: text.subject,
        body: text.body,
      })
      .onConflictDoNothing({ target: [mailOutbox.tenantId, mailOutbox.cause] })
      .returning({ id: mailOutbox.id })

    return written.map((row) => row.id)
  })
}

/**
 * The instructions of a service call sent from the office (#292), for a call
 * taken on the phone: the instructions and the sheet for an early start, to
 * fill in and send back. Written for whoever asked, under their name.
 */
export async function callInstructionsMail(
  database: Database,
  tenantId: TenantId,
  notification: Extract<Notification, { kind: 'job_instructions' }>,
): Promise<readonly string[]> {
  const senderName = await nameOf(database, notification.requestedBy)

  return database.forTenant({ tenantId, reason: 'notification' }, async (tx) => {
    const call = await callOf(tx, notification.jobId)

    if (!call) {
      return []
    }

    const issuer = await issuerOf(tx, tenantId)
    const text = callInstructionsMessage({
      call,
      signed: null,
      issuer,
      signature: await signatureFor(tx, tenantId, issuer, senderName),
    })

    const written = await tx
      .insert(mailOutbox)
      .values({
        tenantId,
        kind: 'job_instructions',
        cause: causeOf(notification),
        jobId: call.id,
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
