import {
  type CalendarEntry,
  calendarOf,
  inCalendarFeed,
  type IsoDate,
  type TenantId,
} from '@opengewerk/domain'
import {
  type Database,
  hashToken,
  mintToken,
  stillWorks,
  type TenantTransaction,
} from '@opengewerk/platform-server'
import { memberships } from '@opengewerk/platform-server/schema'
import { and, eq, isNull, sql } from 'drizzle-orm'

import { appointmentPeople, appointments } from '../database/schema/appointments.js'
import { calendarFeeds } from '../database/schema/calendar-feeds.js'
import { customers } from '../database/schema/customers.js'
import { jobs } from '../database/schema/jobs.js'
import { sites } from '../database/schema/sites.js'

/**
 * The own appointments in the own calendar (#291, Feature-Gliederung 4.3).
 *
 * A person makes the address of their calendar themselves, in the office under
 * "Konto" or on site under "Meine Termine", and sees it once: what stays
 * behind is the hash of its token, as for the link of an invitation. A new
 * address ends the one before it at once, which is how a lost one is locked.
 *
 * The calendar asks without a session. An address that was never made is not
 * there; one that was ended, and the one of somebody who no longer works in
 * the business, answers with a calendar without appointments, so that the
 * calendar subscribed to it empties itself on its next fetch instead of
 * keeping customers and addresses for good.
 */

/** Where the calendar of a person stands: since when it has an address, or none. */
export interface OwnCalendar {
  readonly since: Date | null
}

/** A new address, shown this once. */
export interface MadeCalendar {
  readonly address: string
  readonly since: Date
}

/** The address of a calendar, under the address of the instance. */
export function calendarAddress(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, '')}/calendar/${token}.ics`
}

export async function ownCalendar(tx: TenantTransaction, userId: string): Promise<OwnCalendar> {
  const [open] = await tx
    .select({ since: calendarFeeds.createdAt })
    .from(calendarFeeds)
    .where(and(eq(calendarFeeds.userId, userId), isNull(calendarFeeds.endedAt)))

  return { since: open?.since ?? null }
}

/** Ends the open address of a person, if there is one; true where there was. */
export async function endCalendar(
  tx: TenantTransaction,
  userId: string,
  now: Date,
): Promise<boolean> {
  const ended = await tx
    .update(calendarFeeds)
    .set({ endedAt: now, updatedAt: now })
    .where(and(eq(calendarFeeds.userId, userId), isNull(calendarFeeds.endedAt)))
    .returning({ id: calendarFeeds.id })

  return ended.length > 0
}

/** A new address for a person, which ends the one before it in the same step. */
export async function makeCalendar(
  tx: TenantTransaction,
  tenantId: TenantId,
  userId: string,
  origin: string,
  now: Date,
): Promise<MadeCalendar> {
  await endCalendar(tx, userId, now)

  const { token, hash } = mintToken()

  await tx
    .insert(calendarFeeds)
    .values({ tenantId, userId, tokenHash: hash, createdAt: now, updatedAt: now })

  return { address: calendarAddress(origin, token), since: now }
}

/** The row `calendar_feed_for` hands back. */
interface FeedRow {
  readonly feed: string
  readonly business: TenantId
  readonly company: string
  readonly person: string
  readonly ended: string | Date | null
}

/**
 * The calendar behind a token as iCalendar, or null where no address has it.
 *
 * Found outside any business through `calendar_feed_for`, then read inside the
 * one it names: the appointments the person goes to, not the ones they were
 * taken off, from 90 days back on.
 */
export async function calendarFor(
  database: Database,
  token: string,
  origin: string,
  now: Date,
): Promise<string | null> {
  const hash = hashToken(token)
  const found = await database.forInstance((tx) =>
    tx.execute(sql`select * from calendar_feed_for(${hash})`),
  )
  const row = found.rows[0] as FeedRow | undefined

  if (!row) {
    return null
  }

  const name = `Termine bei ${row.company}`

  if (row.ended !== null) {
    return calendarOf(name, [])
  }

  const entries = await database.forTenant({ tenantId: row.business, reason: 'calendar' }, (tx) =>
    entriesOf(tx, row.person, origin, now),
  )

  return calendarOf(name, entries)
}

async function entriesOf(
  tx: TenantTransaction,
  userId: string,
  origin: string,
  now: Date,
): Promise<CalendarEntry[]> {
  const [member] = await tx
    .select({ blockedAt: memberships.blockedAt, lastDay: memberships.lastDay })
    .from(memberships)
    .where(eq(memberships.userId, userId))

  if (!member || !stillWorks(member, now)) {
    return []
  }

  const rows = await tx
    .select({
      id: appointments.id,
      revision: appointments.revision,
      createdAt: appointments.createdAt,
      changedAt: appointments.updatedAt,
      startsAt: appointments.startsAt,
      endsAt: appointments.endsAt,
      rrule: appointments.rrule,
      exdates: appointments.exdates,
      note: appointments.note,
      jobId: jobs.id,
      number: jobs.number,
      designation: jobs.designation,
      customer: customers.name,
      siteStreet: sites.street,
      siteHouseNumber: sites.houseNumber,
      sitePostalCode: sites.postalCode,
      siteCity: sites.city,
      customerStreet: customers.street,
      customerHouseNumber: customers.houseNumber,
      customerPostalCode: customers.postalCode,
      customerCity: customers.city,
    })
    .from(appointmentPeople)
    .innerJoin(appointments, eq(appointments.id, appointmentPeople.appointmentId))
    .innerJoin(jobs, eq(jobs.id, appointments.jobId))
    .innerJoin(customers, eq(customers.id, jobs.customerId))
    .leftJoin(sites, eq(sites.id, jobs.siteId))
    .where(
      and(
        eq(appointmentPeople.userId, userId),
        isNull(appointmentPeople.deletedAt),
        isNull(appointments.deletedAt),
      ),
    )
    .orderBy(appointments.startsAt)

  const site = origin.replace(/\/+$/, '')

  return rows
    .map((row): CalendarEntry => ({
      uid: row.id,
      revision: row.revision,
      createdAt: row.createdAt,
      changedAt: row.changedAt,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      rrule: row.rrule,
      exdates: daysOf(row.exdates),
      title: `${row.designation}, ${row.customer}`,
      // The place is the site of the job; a job without one is at the customer's.
      place:
        row.siteStreet !== null || row.siteCity !== null
          ? addressOf(row.siteStreet, row.siteHouseNumber, row.sitePostalCode, row.siteCity)
          : addressOf(
              row.customerStreet,
              row.customerHouseNumber,
              row.customerPostalCode,
              row.customerCity,
            ),
      description: [row.number === null ? null : `Auftrag ${row.number}`, row.customer, row.note]
        .filter((line) => line !== null)
        .join('\n'),
      url: site === '' ? null : `${site}/m/auftraege/${row.jobId}`,
    }))
    .filter((entry) => inCalendarFeed(entry, now))
}

function daysOf(value: readonly string[] | null): readonly IsoDate[] {
  return (value ?? []) as readonly IsoDate[]
}

/** "Am Wingertsberg 8, 69214 Eppelheim", from what there is of it, or null. */
function addressOf(
  street: string | null,
  houseNumber: string | null,
  postalCode: string | null,
  city: string | null,
): string | null {
  const line = [street, houseNumber].filter(Boolean).join(' ')
  const place = [postalCode, city].filter(Boolean).join(' ')
  const whole = [line, place].filter((part) => part !== '').join(', ')

  return whole === '' ? null : whole
}
