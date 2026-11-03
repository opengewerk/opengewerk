import {
  type AppointmentId,
  appointmentWhen,
  berlinClock,
  type CalendarParty,
  filledMailSubject,
  filledMailText,
  instructionsSentence,
  invitationOf,
  type IsoDate,
  type JobId,
  letterheadSignature,
  type MailFacts,
  type MailOccasion,
  type MailText,
  shippedMails,
  type TenantId,
  type TenantParameterKey,
} from '@opengewerk/domain'
import type { Database, TenantTransaction } from '@opengewerk/platform-server'
import { and, eq, gte, isNotNull, isNull, sql } from 'drizzle-orm'

import { parameterAt } from '../database/parameters.js'
import {
  appointments,
  customers,
  jobs,
  mailOutbox,
  mailSettings,
  sites,
  textSnippets,
} from '../database/schema/index.js'
import { issuerOf } from '../documents/content.js'
import { callInstructions, callOf } from '../service-calls/instructions.js'
import { causeOf, type Notification, signatureFor } from './notify.js'

/**
 * The confirmations to a customer (#315, decided on 27.09.2026): about an
 * appointment of their job that is arranged, moved or cancelled, with its
 * calendar file, and about a service call the office took. Each switched on
 * by the business on its own; the text is the business's snippet for the
 * occasion or the shipped one, the signature the business's.
 *
 * Raised by the job like a signed report: it looks two days back for what
 * changed and was not confirmed yet, and a message is written once per cause.
 */
const changesWithinHours = 48

type AppointmentConfirmation = Extract<Notification, { readonly kind: 'appointment_confirmation' }>
type JobReceived = Extract<Notification, { readonly kind: 'job_received' }>

async function switchedOn(tx: TenantTransaction, key: TenantParameterKey, at: Date) {
  return (await parameterAt(tx, key, berlinClock(at).day))?.value === 1
}

/** The words of a mail for an occasion: the business's snippet for it, or the shipped one. */
export async function mailTextOf(tx: TenantTransaction, occasion: MailOccasion): Promise<MailText> {
  const [own] = await tx
    .select({ subject: textSnippets.title, text: textSnippets.text })
    .from(textSnippets)
    .where(eq(textSnippets.mailOccasion, occasion))

  return own ?? shippedMails[occasion]
}

function jobLabel(job: { readonly number: string | null; readonly designation: string }): string {
  return job.number ? `${job.number} ${job.designation}` : job.designation
}

/**
 * The appointments to confirm: of a job whose customer has an address,
 * changed in the last two days, not over yet, with the switch on on the day
 * of the change, and not confirmed in this version. The first confirmation of
 * an appointment says it was arranged, whatever its version; a later one that
 * it moved; a cancellation goes only to a customer who was told of it.
 */
export async function changedAppointments(
  database: Database,
  tenantId: TenantId,
  now: Date,
): Promise<readonly AppointmentConfirmation[]> {
  const since = new Date(now.getTime() - changesWithinHours * 3_600_000)

  return database.forTenant({ tenantId, reason: 'notification' }, async (tx) => {
    const rows = await tx
      .select({
        id: appointments.id,
        revision: appointments.revision,
        endsAt: appointments.endsAt,
        rrule: appointments.rrule,
        changedAt: appointments.updatedAt,
        deletedAt: appointments.deletedAt,
        told: sql<number>`(select count(*)::int from ${mailOutbox}
          where ${mailOutbox.tenantId} = ${appointments.tenantId}
            and ${mailOutbox.appointmentId} = ${appointments.id})`,
        confirmed: sql<boolean>`exists (select 1 from ${mailOutbox}
          where ${mailOutbox.tenantId} = ${appointments.tenantId}
            and ${mailOutbox.cause} = 'appointment_confirmation:' || ${appointments.id}::text || ':' ||
              case when ${appointments.deletedAt} is null then ${appointments.revision}::text else 'cancelled' end)`,
      })
      .from(appointments)
      .innerJoin(jobs, eq(jobs.id, appointments.jobId))
      .innerJoin(customers, eq(customers.id, jobs.customerId))
      .where(
        and(gte(appointments.updatedAt, since), isNull(jobs.deletedAt), isNotNull(customers.email)),
      )

    const found: AppointmentConfirmation[] = []

    for (const row of rows) {
      const cancelled = row.deletedAt !== null

      if (
        row.confirmed ||
        (cancelled ? row.told === 0 : row.rrule === null && row.endsAt.getTime() <= now.getTime())
      ) {
        continue
      }

      if (!(await switchedOn(tx, 'appointment.mail_to_customer', row.deletedAt ?? row.changedAt))) {
        continue
      }

      found.push({
        kind: 'appointment_confirmation',
        appointmentId: row.id,
        revision: row.revision,
        change: cancelled ? 'cancelled' : row.told === 0 ? 'arranged' : 'moved',
      })
    }

    return found
  })
}

/**
 * A confirmation of an appointment on its way: the text for its change, to
 * the address the customer has now. The calendar file is made when the
 * message goes out (`withAppointmentInvitation`).
 */
export async function appointmentConfirmationMail(
  database: Database,
  tenantId: TenantId,
  notification: AppointmentConfirmation,
): Promise<readonly string[]> {
  return database.forTenant({ tenantId, reason: 'notification' }, async (tx) => {
    const [row] = await tx
      .select({
        id: appointments.id,
        startsAt: appointments.startsAt,
        endsAt: appointments.endsAt,
        jobId: jobs.id,
        number: jobs.number,
        designation: jobs.designation,
        customerName: customers.name,
        customerEmail: customers.email,
      })
      .from(appointments)
      .innerJoin(jobs, eq(jobs.id, appointments.jobId))
      .innerJoin(customers, eq(customers.id, jobs.customerId))
      .where(eq(appointments.id, notification.appointmentId as AppointmentId))

    if (!row?.customerEmail) {
      return []
    }

    const issuer = await issuerOf(tx, tenantId)
    const text = await mailTextOf(tx, `appointment_${notification.change}`)
    const facts: MailFacts = {
      kunde: row.customerName,
      termin: appointmentWhen(row.startsAt, row.endsAt),
      auftrag: jobLabel(row),
      frist: null,
      datum: null,
      benutzer: null,
      briefkopf: letterheadSignature(issuer),
    }
    // Sent because something changed, and by nobody in the business.
    const signature = await signatureFor(tx, tenantId, issuer, null)

    const written = await tx
      .insert(mailOutbox)
      .values({
        tenantId,
        kind: 'appointment_confirmation',
        cause: causeOf(notification),
        appointmentId: row.id,
        jobId: row.jobId,
        requestedBy: null,
        senderName: issuer.name,
        replyTo: issuer.email,
        recipientAddress: row.customerEmail,
        recipientName: row.customerName,
        subject: filledMailSubject(text.subject, facts),
        body: `${filledMailText(text.text, facts)}\n\n-- \n${signature}`,
      })
      .onConflictDoNothing({ target: [mailOutbox.tenantId, mailOutbox.cause] })
      .returning({ id: mailOutbox.id })

    return written.map((written) => written.id)
  })
}

/** The service calls to confirm: made in the last two days, with the switch on on that day. */
export async function receivedServiceCalls(
  database: Database,
  tenantId: TenantId,
  now: Date,
): Promise<readonly JobReceived[]> {
  const since = new Date(now.getTime() - changesWithinHours * 3_600_000)

  return database.forTenant({ tenantId, reason: 'notification' }, async (tx) => {
    const rows = await tx
      .select({ id: jobs.id, createdAt: jobs.createdAt })
      .from(jobs)
      .innerJoin(customers, eq(customers.id, jobs.customerId))
      .where(
        and(
          eq(jobs.kind, 'service'),
          isNull(jobs.deletedAt),
          gte(jobs.createdAt, since),
          isNotNull(customers.email),
          sql`not exists (
            select 1 from ${mailOutbox}
             where ${mailOutbox.tenantId} = ${jobs.tenantId}
               and ${mailOutbox.cause} = 'job_received:' || ${jobs.id}::text
          )`,
        ),
      )

    const found: JobReceived[] = []

    for (const row of rows) {
      if (await switchedOn(tx, 'service_call.mail_on_receipt', row.createdAt)) {
        found.push({ kind: 'job_received', jobId: row.id })
      }
    }

    return found
  })
}

/**
 * A confirmation of a service call on its way. For a consumer it carries the
 * instructions (#292) as a PDF when they can be printed today, and a sentence
 * about them after the business's text; when the letterhead lacks what they
 * need, it goes without, and the card at the job says what is missing, as it
 * does for the office's own sending.
 */
export async function jobReceivedMail(
  database: Database,
  tenantId: TenantId,
  notification: JobReceived,
): Promise<readonly string[]> {
  return database.forTenant({ tenantId, reason: 'notification' }, async (tx) => {
    const call = await callOf(tx, notification.jobId as JobId)

    if (!call?.customerEmail) {
      return []
    }

    const instructions = await callInstructions(tx, call, berlinClock(new Date()).day)
    const withInstructions = instructions.refusal === null && instructions.gaps.length === 0
    const issuer = await issuerOf(tx, tenantId)
    const text = await mailTextOf(tx, 'job_received')
    const facts: MailFacts = {
      kunde: call.customerName,
      termin: null,
      auftrag: jobLabel(call),
      frist: null,
      datum: null,
      benutzer: null,
      briefkopf: letterheadSignature(issuer),
    }
    const signature = await signatureFor(tx, tenantId, issuer, null)
    const body =
      filledMailText(text.text, facts) + (withInstructions ? `\n\n${instructionsSentence}` : '')

    const written = await tx
      .insert(mailOutbox)
      .values({
        tenantId,
        kind: 'job_received',
        cause: causeOf(notification),
        jobId: call.id,
        attachment: withInstructions ? 'pdf' : null,
        requestedBy: null,
        senderName: issuer.name,
        replyTo: issuer.email,
        recipientAddress: call.customerEmail,
        recipientName: call.customerName,
        subject: filledMailSubject(text.subject, facts),
        body: `${body}\n\n-- \n${signature}`,
      })
      .onConflictDoNothing({ target: [mailOutbox.tenantId, mailOutbox.cause] })
      .returning({ id: mailOutbox.id })

    return written.map((row) => row.id)
  })
}

/**
 * The calendar file of an appointment as it is now (#315): to take it into
 * the customer's calendar, to move it there, or to take it out once it is
 * cancelled. Null for an appointment there is no longer any trace of.
 */
export async function appointmentInvitation(
  tx: TenantTransaction,
  tenantId: TenantId,
  appointmentId: AppointmentId,
  attendee: CalendarParty,
): Promise<{ readonly text: string; readonly method: 'REQUEST' | 'CANCEL' } | null> {
  const [row] = await tx
    .select({
      id: appointments.id,
      revision: appointments.revision,
      createdAt: appointments.createdAt,
      changedAt: appointments.updatedAt,
      deletedAt: appointments.deletedAt,
      startsAt: appointments.startsAt,
      endsAt: appointments.endsAt,
      rrule: appointments.rrule,
      exdates: appointments.exdates,
      number: jobs.number,
      designation: jobs.designation,
      street: sites.street,
      houseNumber: sites.houseNumber,
      postalCode: sites.postalCode,
      city: sites.city,
    })
    .from(appointments)
    .innerJoin(jobs, eq(jobs.id, appointments.jobId))
    .leftJoin(sites, eq(sites.id, jobs.siteId))
    .where(eq(appointments.id, appointmentId))

  if (!row) {
    return null
  }

  const issuer = await issuerOf(tx, tenantId)
  const [settings] = await tx.select({ from: mailSettings.fromAddress }).from(mailSettings)
  const cancelled = row.deletedAt !== null
  const street = [row.street, row.houseNumber].filter(Boolean).join(' ')
  const town = [row.postalCode, row.city].filter(Boolean).join(' ')
  const place = [street, town].filter((part) => part !== '').join(', ')

  return {
    method: cancelled ? 'CANCEL' : 'REQUEST',
    text: invitationOf(
      {
        uid: row.id,
        // A cancellation is a version after the last one the customer got.
        revision: cancelled ? row.revision + 1 : row.revision,
        createdAt: row.createdAt,
        changedAt: row.deletedAt ?? row.changedAt,
        startsAt: row.startsAt,
        endsAt: row.endsAt,
        rrule: row.rrule,
        exdates: (row.exdates ?? []) as IsoDate[],
        title: `${issuer.name}: ${jobLabel(row)}`,
        place: place === '' ? null : place,
        description: null,
        url: null,
      },
      {
        organizer: { name: issuer.name, address: issuer.email ?? settings?.from ?? '' },
        attendee,
      },
      cancelled,
    ),
  }
}
