import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Post,
  Query,
  UnprocessableEntityException,
} from '@nestjs/common'
import {
  communicationProblems,
  type CustomerId,
  customerMailKinds,
  type HistoryItem,
  type SiteId,
} from '@opengewerk/domain'
import { Database, isUuid, pick, type TenantTransaction } from '@opengewerk/platform-server'
import { and, desc, eq, inArray, isNull, type SQL, sql } from 'drizzle-orm'

import {
  appointmentPeople,
  appointments,
  communications,
  customers,
  jobs,
  sites,
} from '../database/schema/index.js'
import { RequiresPermission } from './authorization.js'
import { CurrentIdentity, type RequestIdentity } from './identity.js'

/** How many lines of each kind the history reads at most: the latest, for one record. */
const historyLimit = 200

/** Which record a history is asked for: a customer with its sites, or one site. */
type Subject = { readonly customerId: CustomerId } | { readonly siteId: SiteId }

function subjectFrom(query: Readonly<Record<string, unknown>>): Subject {
  const customerId = query['customerId']
  const siteId = query['siteId']

  if (typeof customerId === 'string' && isUuid(customerId) && siteId === undefined) {
    return { customerId: customerId as CustomerId }
  }

  if (typeof siteId === 'string' && isUuid(siteId) && customerId === undefined) {
    return { siteId: siteId as SiteId }
  }

  throw new BadRequestException('Gefragt wird nach einem Kunden oder nach einem Objekt.')
}

function iso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString()
}

/**
 * The messages that went to the customer or about the site, found through
 * what each names: a document, a job, an appointment or a deadline. Only the
 * kinds the customer receives, and for each its subject, recipient and state.
 */
async function mailsOf(tx: TenantTransaction, subject: Subject): Promise<HistoryItem[]> {
  const owner: SQL =
    'customerId' in subject
      ? sql`coalesce(d.customer_id, j.customer_id, aj.customer_id, dl.customer_id) = ${subject.customerId}`
      : sql`coalesce(d.site_id, j.site_id, aj.site_id, dl.site_id) = ${subject.siteId}`
  const kinds = sql.join(
    customerMailKinds.map((kind) => sql`${kind}`),
    sql`, `,
  )
  const rows = await tx.execute<{
    id: string
    kind: (typeof customerMailKinds)[number]
    subject: string
    recipient_address: string
    status: 'pending' | 'sent' | 'failed'
    at: Date | string
    site_id: string | null
  }>(sql`
    select m.id, m.kind, m.subject, m.recipient_address, m.status,
           coalesce(m.sent_at, m.created_at) as at,
           coalesce(d.site_id, j.site_id, aj.site_id, dl.site_id) as site_id
      from mail_outbox m
      left join documents d on d.id = m.document_id
      left join jobs j on j.id = m.job_id
      left join appointments a on a.id = m.appointment_id
      left join jobs aj on aj.id = a.job_id
      left join deadlines dl on dl.id = m.deadline_id
     where m.kind::text in (${kinds}) and ${owner}
     order by coalesce(m.sent_at, m.created_at) desc
     limit ${historyLimit}`)

  return rows.rows.map((row) => ({
    type: 'mail' as const,
    at: iso(row.at),
    id: row.id,
    kind: row.kind,
    subject: row.subject,
    recipient: row.recipient_address,
    status: row.status,
    siteId: row.site_id,
  }))
}

/** The appointments of the jobs of the customer or at the site, with who goes. */
async function appointmentsOf(tx: TenantTransaction, subject: Subject): Promise<HistoryItem[]> {
  const rows = await tx
    .select({
      id: appointments.id,
      startsAt: appointments.startsAt,
      endsAt: appointments.endsAt,
      rrule: appointments.rrule,
      jobId: jobs.id,
      jobDesignation: jobs.designation,
      siteId: jobs.siteId,
    })
    .from(appointments)
    .innerJoin(jobs, eq(jobs.id, appointments.jobId))
    .where(
      and(
        isNull(appointments.deletedAt),
        isNull(jobs.deletedAt),
        'customerId' in subject
          ? eq(jobs.customerId, subject.customerId)
          : eq(jobs.siteId, subject.siteId),
      ),
    )
    .orderBy(desc(appointments.startsAt))
    .limit(historyLimit)

  const people =
    rows.length === 0
      ? []
      : await tx
          .select({
            appointmentId: appointmentPeople.appointmentId,
            userId: appointmentPeople.userId,
          })
          .from(appointmentPeople)
          .where(
            and(
              inArray(
                appointmentPeople.appointmentId,
                rows.map((row) => row.id),
              ),
              isNull(appointmentPeople.deletedAt),
            ),
          )

  return rows.map((row) => ({
    type: 'appointment' as const,
    at: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    id: row.id,
    jobId: row.jobId,
    jobDesignation: row.jobDesignation,
    siteId: row.siteId,
    userIds: people
      .filter((person) => person.appointmentId === row.id)
      .map((person) => person.userId),
    series: row.rrule !== null,
  }))
}

/**
 * The history at a customer and at a site (#313): the notes and calls the
 * office writes down, from then on unchanged, and beside them what
 * OpenGewerk sent the customer and the appointments of its jobs. Read with
 * the customers; written by whoever keeps them, in the office.
 */
@Controller('communications')
export class CommunicationsController {
  constructor(private readonly database: Database) {}

  @Get()
  @RequiresPermission('customer.read')
  history(@CurrentIdentity() identity: RequestIdentity, @Query() query: Record<string, unknown>) {
    const subject = subjectFrom(query)

    return this.database.forTenant(identity, async (tx) => {
      const [known] =
        'customerId' in subject
          ? await tx
              .select({ id: customers.id })
              .from(customers)
              .where(and(eq(customers.id, subject.customerId), isNull(customers.deletedAt)))
          : await tx
              .select({ id: sites.id })
              .from(sites)
              .where(and(eq(sites.id, subject.siteId), isNull(sites.deletedAt)))

      if (!known) {
        throw new NotFoundException()
      }

      const entries = await tx
        .select()
        .from(communications)
        .where(
          'customerId' in subject
            ? eq(communications.customerId, subject.customerId)
            : eq(communications.siteId, subject.siteId),
        )
        .orderBy(desc(communications.happenedAt))
        .limit(historyLimit)

      const items: HistoryItem[] = [
        ...entries.map((entry) => ({
          type: 'entry' as const,
          at: entry.happenedAt.toISOString(),
          entry: {
            id: entry.id,
            customerId: entry.customerId,
            siteId: entry.siteId,
            kind: entry.kind,
            direction: entry.direction,
            counterpart: entry.counterpart,
            text: entry.text,
            happenedAt: entry.happenedAt.toISOString(),
            createdBy: entry.createdBy,
          },
        })),
        ...(await mailsOf(tx, subject)),
        ...(await appointmentsOf(tx, subject)),
      ]

      return items
    })
  }

  /**
   * Writes a note or a call down, at the customer and at one of its sites
   * where it names one. Who wrote it comes from the request; when it was
   * from the body, now unless it says otherwise.
   */
  @Post()
  @RequiresPermission('customer.write')
  async create(@CurrentIdentity() identity: RequestIdentity, @Body() body: unknown) {
    const now = new Date()
    const given = pick(body, [
      'customerId',
      'siteId',
      'kind',
      'direction',
      'counterpart',
      'text',
      'happenedAt',
    ] as const)
    const counterpart =
      typeof given.counterpart === 'string' && given.counterpart.trim() !== ''
        ? given.counterpart.trim()
        : null
    const values = {
      kind: given.kind,
      direction: given.direction ?? null,
      counterpart,
      text: typeof given.text === 'string' ? given.text.trim() : given.text,
      happenedAt: given.happenedAt ?? now.toISOString(),
    }
    const [, problem] = Object.entries(communicationProblems(values, now))[0] ?? []

    if (problem !== undefined) {
      throw new UnprocessableEntityException(problem)
    }

    const customerId = given.customerId
    const siteId = given.siteId ?? null

    if (typeof customerId !== 'string' || !isUuid(customerId)) {
      throw new UnprocessableEntityException('Ein Eintrag gehört zu einem Kunden.')
    }

    if (siteId !== null && (typeof siteId !== 'string' || !isUuid(siteId))) {
      throw new UnprocessableEntityException('Dieses Objekt gibt es nicht.')
    }

    return this.database.forTenant(identity, async (tx) => {
      const [customer] = await tx
        .select({ id: customers.id })
        .from(customers)
        .where(and(eq(customers.id, customerId as CustomerId), isNull(customers.deletedAt)))

      if (!customer) {
        throw new NotFoundException()
      }

      if (siteId !== null) {
        const [site] = await tx
          .select({ customerId: sites.customerId })
          .from(sites)
          .where(and(eq(sites.id, siteId as SiteId), isNull(sites.deletedAt)))

        if (!site || site.customerId !== customer.id) {
          throw new UnprocessableEntityException('Das Objekt gehört nicht zu diesem Kunden.')
        }
      }

      const [written] = await tx
        .insert(communications)
        .values({
          tenantId: identity.tenantId,
          customerId: customer.id,
          siteId: siteId as SiteId | null,
          kind: values.kind as 'note' | 'call',
          direction: values.direction as 'incoming' | 'outgoing' | null,
          counterpart,
          text: values.text as string,
          happenedAt: new Date(values.happenedAt as string),
        })
        .returning()

      return written
    })
  }
}
