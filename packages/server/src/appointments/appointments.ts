import {
  type AbsenceKind,
  type AppointmentId,
  type AppointmentPersonId,
  appointmentProblem,
  type Holiday,
  holidaysIn,
  isSeriesDay,
  type IsoDate,
  type JobId,
  nextOccurrence,
  parseRule,
  ruleOf,
  shippedRules,
  type TenantId,
} from '@opengewerk/domain'
import { stillWorks, type TenantTransaction } from '@opengewerk/platform-server'
import { memberships } from '@opengewerk/platform-server/schema'
import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm'

import { absencesBetween, holidaySettingOf } from '../absences/absences.js'
import {
  appointmentPeople,
  appointments,
  jobAssignments,
  jobs,
  people,
} from '../database/schema/index.js'

/**
 * The appointments of the planning board (#290, Feature-Gliederung 4.3):
 * made, moved and taken back in the office, confirmed by the people who go.
 *
 * Everything here runs at a route, with a network. A change is taken only
 * for the version of the appointment the board saw, and a change of when it
 * is counts `revision` up, so that a confirmation of the earlier version no
 * longer counts. Whoever gets an appointment is put on its job in the same
 * transaction, since a device holds only the jobs its person is on; taken
 * off an appointment, they stay on the job. What is news to whom is handed
 * back, and the route raises it after the transaction, by push.
 */

/** Refused for what was asked, as the sentence the form shows. */
export class AppointmentRefused extends Error {}

export class AppointmentNotFound extends Error {}

/** Changed by somebody else since the board read it. */
export class AppointmentMoved extends Error {}

/** What an appointment is to a person on it: new to them, changed, or no longer theirs. */
export type AppointmentChange = 'new' | 'changed' | 'cancelled'

/** One person on one appointment for whom something is news, raised once the change is written. */
export interface AppointmentNews {
  readonly personId: AppointmentPersonId
  readonly revision: number
  readonly change: AppointmentChange
}

export interface AppointmentInput {
  readonly jobId: JobId
  readonly startsAt: Date
  readonly endsAt: Date
  readonly note: string | null
  readonly rrule: string | null
  readonly exdates: readonly IsoDate[]
  readonly userIds: readonly string[]
}

type Row = typeof appointments.$inferSelect
type PersonRow = typeof appointmentPeople.$inferSelect

/** An appointment with the people on it, as a route answers. */
export interface AppointmentView {
  readonly appointment: Row
  readonly people: readonly PersonRow[]
}

const calendarDay = (value: unknown): value is IsoDate =>
  typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  new Date(`${value}T00:00:00Z`).toISOString().startsWith(value)

function moment(value: unknown): Date {
  return typeof value === 'string' && value.length <= 40 ? new Date(value) : new Date(Number.NaN)
}

/**
 * What a form sent, read into an appointment, or refused. The rule is kept in
 * the form OpenGewerk writes it, and the days taken out in order, each once.
 */
export function appointmentInputOf(body: Record<string, unknown>): AppointmentInput {
  const { jobId, note, rrule, exdates, userIds } = body

  if (typeof jobId !== 'string' || jobId.length === 0) {
    throw new AppointmentRefused('Ein Termin hängt an einem Auftrag.')
  }

  if (note !== undefined && note !== null && typeof note !== 'string') {
    throw new AppointmentRefused('Die Notiz ist ein Text.')
  }

  if (rrule !== undefined && rrule !== null && typeof rrule !== 'string') {
    throw new AppointmentRefused('Diese Wiederholung versteht OpenGewerk nicht.')
  }

  if (exdates !== undefined && (!Array.isArray(exdates) || !exdates.every(calendarDay))) {
    throw new AppointmentRefused('Die ausgenommenen Tage sind Tage wie 2026-11-09.')
  }

  if (
    !Array.isArray(userIds) ||
    !userIds.every((userId) => typeof userId === 'string' && userId.length > 0)
  ) {
    throw new AppointmentRefused('userIds ist die Liste der Personen, die hingehen.')
  }

  const rule = typeof rrule === 'string' && rrule.length > 0 ? parseRule(rrule) : null

  if (typeof rrule === 'string' && rrule.length > 0 && rule === null) {
    throw new AppointmentRefused('Diese Wiederholung versteht OpenGewerk nicht.')
  }

  const trimmed = typeof note === 'string' ? note.trim() : ''

  return {
    jobId: jobId as JobId,
    startsAt: moment(body.startsAt),
    endsAt: moment(body.endsAt),
    note: trimmed === '' ? null : trimmed,
    rrule: rule === null ? null : ruleOf(rule),
    exdates: [...new Set((exdates ?? []) as IsoDate[])].sort(),
    userIds: [...new Set(userIds as string[])].sort(),
  }
}

/**
 * The input checked as a whole. A day taken out that the series does not
 * have, after its rule or its times changed, is dropped: it would take out
 * nothing.
 */
function checked(input: AppointmentInput): AppointmentInput {
  const problem = appointmentProblem(input)

  if (problem !== null) {
    throw new AppointmentRefused(problem)
  }

  return { ...input, exdates: input.exdates.filter((on) => isSeriesDay(input, on)) }
}

/** Of some people, those who may be sent: they work in the business and are not shut out. */
async function refuseWhoCannotGo(
  tx: TenantTransaction,
  tenantId: TenantId,
  userIds: readonly string[],
  now: Date,
): Promise<void> {
  if (userIds.length === 0) {
    return
  }

  const able = new Set(
    (
      await tx
        .select({
          userId: memberships.userId,
          blockedAt: memberships.blockedAt,
          lastDay: memberships.lastDay,
        })
        .from(memberships)
        .where(and(eq(memberships.tenantId, tenantId), inArray(memberships.userId, [...userIds])))
    )
      .filter((member) => stillWorks(member, now))
      .map((member) => member.userId),
  )

  if (userIds.some((userId) => !able.has(userId))) {
    throw new AppointmentRefused(
      'Einen Termin bekommt nur, wer in diesem Betrieb arbeitet und nicht gesperrt ist.',
    )
  }
}

/** Puts people on a job who are not on it yet: whoever goes to an appointment there. */
async function putOnJob(
  tx: TenantTransaction,
  tenantId: TenantId,
  jobId: JobId,
  userIds: readonly string[],
): Promise<void> {
  if (userIds.length === 0) {
    return
  }

  const on = new Set(
    (
      await tx
        .select({ userId: jobAssignments.userId })
        .from(jobAssignments)
        .where(
          and(
            eq(jobAssignments.jobId, jobId),
            inArray(jobAssignments.userId, [...userIds]),
            isNull(jobAssignments.deletedAt),
          ),
        )
    ).map((row) => row.userId),
  )
  const missing = userIds.filter((userId) => !on.has(userId))

  if (missing.length > 0) {
    await tx.insert(jobAssignments).values(missing.map((userId) => ({ tenantId, jobId, userId })))
  }
}

async function peopleOn(tx: TenantTransaction, id: AppointmentId): Promise<PersonRow[]> {
  return tx
    .select()
    .from(appointmentPeople)
    .where(and(eq(appointmentPeople.appointmentId, id), isNull(appointmentPeople.deletedAt)))
}

async function openAppointment(tx: TenantTransaction, id: string): Promise<Row> {
  const [row] = await tx
    .select()
    .from(appointments)
    .where(and(eq(appointments.id, id as AppointmentId), isNull(appointments.deletedAt)))

  if (!row) {
    throw new AppointmentNotFound()
  }

  return row
}

export async function createAppointment(
  tx: TenantTransaction,
  tenantId: TenantId,
  raw: AppointmentInput,
  now: Date,
): Promise<{ readonly view: AppointmentView; readonly news: readonly AppointmentNews[] }> {
  const input = checked(raw)
  const [job] = await tx
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.id, input.jobId), isNull(jobs.deletedAt)))

  if (!job) {
    throw new AppointmentRefused('Einen Termin gibt es nur an einem Auftrag dieses Betriebs.')
  }

  await refuseWhoCannotGo(tx, tenantId, input.userIds, now)

  const [appointment] = await tx
    .insert(appointments)
    .values({
      tenantId,
      jobId: input.jobId,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      note: input.note,
      rrule: input.rrule,
      exdates: input.exdates,
    })
    .returning()

  if (!appointment) {
    throw new AppointmentRefused('Der Termin ließ sich nicht anlegen.')
  }

  const placed = await tx
    .insert(appointmentPeople)
    .values(
      input.userIds.map((userId) => ({
        tenantId,
        appointmentId: appointment.id,
        userId,
      })),
    )
    .returning()

  await putOnJob(tx, tenantId, input.jobId, input.userIds)

  return {
    view: { appointment, people: placed },
    news: placed.map((person) => ({ personId: person.id, revision: 1, change: 'new' as const })),
  }
}

/**
 * A change of an appointment, taken whole: when it is, its note, its rule,
 * the days taken out and who goes. Only for the version the board read; a
 * change of when it is counts the revision up and is news to everybody who
 * stays on it.
 */
export async function changeAppointment(
  tx: TenantTransaction,
  tenantId: TenantId,
  id: string,
  raw: AppointmentInput,
  version: number,
  now: Date,
): Promise<{ readonly view: AppointmentView; readonly news: readonly AppointmentNews[] }> {
  const row = await openAppointment(tx, id)

  if (row.version !== version) {
    throw new AppointmentMoved()
  }

  if (raw.jobId !== row.jobId) {
    throw new AppointmentRefused('Ein Termin bleibt an seinem Auftrag.')
  }

  const input = checked(raw)
  const current = await peopleOn(tx, row.id)
  const held = new Set(current.map((person) => person.userId))
  const adding = input.userIds.filter((userId) => !held.has(userId))
  const removing = current.filter((person) => !input.userIds.includes(person.userId))

  await refuseWhoCannotGo(tx, tenantId, adding, now)

  const moved =
    row.startsAt.getTime() !== input.startsAt.getTime() ||
    row.endsAt.getTime() !== input.endsAt.getTime() ||
    row.rrule !== input.rrule ||
    row.exdates.join(',') !== input.exdates.join(',')
  const revision = moved ? row.revision + 1 : row.revision

  // Written also when only the people change, so that the version counts up
  // and a board that read the appointment before finds it changed.
  const [appointment] = await tx
    .update(appointments)
    .set({
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      note: input.note,
      rrule: input.rrule,
      exdates: input.exdates,
      revision,
    })
    .where(eq(appointments.id, row.id))
    .returning()

  if (!appointment) {
    throw new AppointmentNotFound()
  }

  if (removing.length > 0) {
    await tx
      .update(appointmentPeople)
      .set({ deletedAt: now })
      .where(
        inArray(
          appointmentPeople.id,
          removing.map((person) => person.id),
        ),
      )
  }

  const added =
    adding.length === 0
      ? []
      : await tx
          .insert(appointmentPeople)
          .values(
            adding.map((userId) => ({
              tenantId,
              appointmentId: row.id,
              userId,
            })),
          )
          .returning()

  await putOnJob(tx, tenantId, row.jobId, adding)

  const staying = current.filter((person) => input.userIds.includes(person.userId))
  const news: AppointmentNews[] = [
    ...(moved
      ? staying.map((person) => ({ personId: person.id, revision, change: 'changed' as const }))
      : []),
    ...added.map((person) => ({ personId: person.id, revision, change: 'new' as const })),
    ...removing.map((person) => ({ personId: person.id, revision, change: 'cancelled' as const })),
  ]

  return { view: { appointment, people: [...staying, ...added] }, news }
}

/** An appointment taken back, for the version the board read: news to everybody on it. */
export async function removeAppointment(
  tx: TenantTransaction,
  id: string,
  version: number,
  now: Date,
): Promise<readonly AppointmentNews[]> {
  const row = await openAppointment(tx, id)

  if (row.version !== version) {
    throw new AppointmentMoved()
  }

  const current = await peopleOn(tx, row.id)

  if (current.length > 0) {
    await tx
      .update(appointmentPeople)
      .set({ deletedAt: now })
      .where(
        inArray(
          appointmentPeople.id,
          current.map((person) => person.id),
        ),
      )
  }

  await tx.update(appointments).set({ deletedAt: now }).where(eq(appointments.id, row.id))

  return current.map((person) => ({
    personId: person.id,
    revision: row.revision,
    change: 'cancelled' as const,
  }))
}

/**
 * A person confirms the version of an appointment they saw. Only their own
 * place on it, and only the version it is in now: a confirmation of one the
 * office has changed since would confirm what nobody plans any more.
 */
export async function confirmAppointment(
  tx: TenantTransaction,
  userId: string,
  id: string,
  revision: number,
  now: Date,
): Promise<PersonRow> {
  const row = await openAppointment(tx, id)
  const [person] = await tx
    .select()
    .from(appointmentPeople)
    .where(
      and(
        eq(appointmentPeople.appointmentId, row.id),
        eq(appointmentPeople.userId, userId),
        isNull(appointmentPeople.deletedAt),
      ),
    )

  if (!person) {
    throw new AppointmentNotFound()
  }

  if (row.revision !== revision) {
    throw new AppointmentMoved()
  }

  const [confirmed] = await tx
    .update(appointmentPeople)
    .set({ confirmedRevision: revision, confirmedAt: now })
    .where(eq(appointmentPeople.id, person.id))
    .returning()

  if (!confirmed) {
    throw new AppointmentNotFound()
  }

  return confirmed
}

/**
 * Whether a piece of news is still news, decided when the message is
 * written: the person still on the appointment in that version, or for a
 * cancellation no longer on it; still working in the business; and a time
 * of it not over yet. The message names that time.
 */
export async function stillNews(
  tx: TenantTransaction,
  tenantId: TenantId,
  news: AppointmentNews,
  now: Date,
): Promise<{ readonly userId: string; readonly startsAt: Date } | null> {
  const [found] = await tx
    .select({ person: appointmentPeople, appointment: appointments })
    .from(appointmentPeople)
    .innerJoin(appointments, eq(appointments.id, appointmentPeople.appointmentId))
    .where(eq(appointmentPeople.id, news.personId))

  if (!found) {
    return null
  }

  const { person, appointment } = found
  const gone = person.deletedAt !== null || appointment.deletedAt !== null

  if (news.change === 'cancelled' ? !gone : gone || appointment.revision !== news.revision) {
    return null
  }

  const [member] = await tx
    .select({ blockedAt: memberships.blockedAt, lastDay: memberships.lastDay })
    .from(memberships)
    .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, person.userId)))
  const next = nextOccurrence(appointment, now)

  return member && stillWorks(member, now) && next !== null
    ? { userId: person.userId, startsAt: next.startsAt }
    : null
}

// --- What the board needs beside the appointments ----------------------------------------------

/** At most this many days at once: four weeks with room on either side. */
export const boardDays = 62

/** Somebody with an access who is away, as whoever plans may see it. */
export interface BoardAbsence {
  readonly userId: string
  readonly kind: AbsenceKind | 'absent'
  readonly firstDay: IsoDate
  readonly lastDay: IsoDate
  readonly startsAtNoon: boolean
  readonly endsAtNoon: boolean
}

/**
 * What the board shows beside the appointments, which every device of the
 * office holds: who is away, approved leave and sickness of the people with
 * an access, the kind only for whoever keeps absences (#288), and the public
 * holidays of the business.
 */
export async function boardOf(
  tx: TenantTransaction,
  from: IsoDate,
  to: IsoDate,
  seesKinds: boolean,
): Promise<{ readonly absences: readonly BoardAbsence[]; readonly holidays: readonly Holiday[] }> {
  const staff = await tx
    .select({ id: people.id, userId: people.userId })
    .from(people)
    .where(and(isNull(people.deletedAt), isNotNull(people.userId)))
  const users = new Map(staff.map((person) => [person.id, person.userId ?? '']))
  const rows = await absencesBetween(tx, [...users.keys()], from, to)
  const setting = await holidaySettingOf(tx)
  const holidays: Holiday[] = []

  if (setting !== null) {
    for (let year = Number(from.slice(0, 4)); year <= Number(to.slice(0, 4)); year += 1) {
      holidays.push(
        ...holidaysIn(shippedRules, setting, year).filter(
          (holiday) => holiday.on >= from && holiday.on <= to,
        ),
      )
    }
  }

  return {
    absences: rows
      .filter((row) => row.state === 'approved')
      .map((row) => ({
        userId: users.get(row.personId) ?? '',
        kind: seesKinds ? row.kind : 'absent',
        firstDay: row.firstDay,
        lastDay: row.lastDay,
        startsAtNoon: row.startsAtNoon,
        endsAtNoon: row.endsAtNoon,
      })),
    holidays,
  }
}
