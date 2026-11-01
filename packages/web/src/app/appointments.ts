import {
  addDays,
  berlinInstant,
  berlinWall,
  daysBetween,
  isConfirmed,
  type IsoDate,
  type Occurrence,
  occurrencesBetween,
  parseRule,
  type RecordState,
  ruleText,
} from '@opengewerk/domain'
import { count, maybeText, text } from '@opengewerk/platform-web/sync'

import type { BoardAbsence } from '../session/appointments.js'

/**
 * The appointments of #290 as both entries read them from the device: the
 * office puts them on its board, the site lists its own. What is shared is
 * reading the rows, the times a series takes place and the words for them.
 */

export interface AppointmentRow {
  readonly id: string
  readonly jobId: string
  readonly startsAt: string
  readonly endsAt: string
  readonly note: string | null
  readonly rrule: string | null
  readonly exdates: readonly IsoDate[]
  readonly revision: number
  readonly version: number
}

export interface PersonRow {
  readonly id: string
  readonly appointmentId: string
  readonly userId: string
  readonly confirmedRevision: number | null
  readonly confirmedAt: string | null
}

/**
 * The days a series takes out. A list travels as its JSON text (ADR 0005,
 * Nachtrag vom 04.10.2026), and what is not a list of days is none.
 */
function daysOf(value: unknown): IsoDate[] {
  let listed: unknown = value

  if (typeof value === 'string') {
    try {
      listed = JSON.parse(value)
    } catch {
      return []
    }
  }

  return Array.isArray(listed) ? listed.filter((on): on is string => typeof on === 'string') : []
}

export function appointmentOf(record: RecordState): AppointmentRow {
  return {
    id: text(record, 'id'),
    jobId: text(record, 'jobId'),
    startsAt: text(record, 'startsAt'),
    endsAt: text(record, 'endsAt'),
    note: maybeText(record, 'note'),
    rrule: maybeText(record, 'rrule'),
    exdates: daysOf(record['exdates']),
    revision: Math.max(1, count(record, 'revision')),
    version: count(record, 'version'),
  }
}

export function personOf(record: RecordState): PersonRow {
  const confirmed = record['confirmedRevision']

  return {
    id: text(record, 'id'),
    appointmentId: text(record, 'appointmentId'),
    userId: text(record, 'userId'),
    confirmedRevision: typeof confirmed === 'number' ? confirmed : null,
    confirmedAt: maybeText(record, 'confirmedAt'),
  }
}

/** "07:30", the clock in Germany. */
export function clockOf(at: Date | string): string {
  const { minute } = berlinWall(at)

  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`
}

export const shortDays = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'] as const
export const longDays = [
  'Montag',
  'Dienstag',
  'Mittwoch',
  'Donnerstag',
  'Freitag',
  'Samstag',
  'Sonntag',
] as const

export function weekdayIndex(on: IsoDate): number {
  return (new Date(`${on}T12:00:00Z`).getUTCDay() + 6) % 7
}

/** "09.11." */
export function dayMonth(on: IsoDate): string {
  return `${on.slice(8, 10)}.${on.slice(5, 7)}.`
}

/** The Monday of the week a day lies in. */
export function mondayOf(on: IsoDate): IsoDate {
  return addDays(on, -weekdayIndex(on))
}

/** The rule of a series in words, or null for a single appointment. */
export function seriesText(appointment: AppointmentRow): string | null {
  const rule = appointment.rrule === null ? null : parseRule(appointment.rrule)

  return rule === null ? null : ruleText(rule, berlinWall(appointment.startsAt).day)
}

/** The same appointment moved by whole days, at the same clock time, or lengthened at its end. */
export function shifted(
  appointment: Pick<AppointmentRow, 'startsAt' | 'endsAt'>,
  startDays: number,
  endDays: number,
): { readonly startsAt: string; readonly endsAt: string } {
  const start = berlinWall(appointment.startsAt)
  const end = berlinWall(appointment.endsAt)

  return {
    startsAt: berlinInstant(addDays(start.day, startDays), start.minute).toISOString(),
    endsAt: berlinInstant(addDays(end.day, endDays), end.minute).toISOString(),
  }
}

/** One time of an appointment on the board, in the row of one person. */
export interface Placed {
  readonly appointment: AppointmentRow
  readonly occurrence: Occurrence
  readonly person: PersonRow
  readonly confirmed: boolean
  /** The first and last column it covers, counted from the first day shown. */
  readonly first: number
  readonly last: number
  /** Whether it begins before the first day shown or ends after the last. */
  readonly cutBefore: boolean
  readonly cutAfter: boolean
  readonly lane: number
  readonly away: boolean
}

/** Whether somebody is away on any day from one to another. */
export function awayBetween(
  absences: readonly BoardAbsence[],
  userId: string,
  first: IsoDate,
  last: IsoDate,
): boolean {
  return absences.some(
    (absence) => absence.userId === userId && absence.firstDay <= last && absence.lastDay >= first,
  )
}

/**
 * The times of the appointments on the board, row by row: each in the first
 * lane of its row where it overlaps nothing, so that two on the same day
 * stand one above the other.
 */
export function placeOnBoard(
  appointments: readonly AppointmentRow[],
  people: readonly PersonRow[],
  from: IsoDate,
  to: IsoDate,
  absences: readonly BoardAbsence[],
): ReadonlyMap<string, { readonly placed: readonly Placed[]; readonly lanes: number }> {
  const byId = new Map(appointments.map((appointment) => [appointment.id, appointment]))
  const rows = new Map<string, Omit<Placed, 'lane'>[]>()
  const length = daysBetween(from, to)

  for (const person of people) {
    const appointment = byId.get(person.appointmentId)

    if (appointment === undefined) {
      continue
    }

    for (const occurrence of occurrencesBetween(appointment, from, to)) {
      const first = Math.max(0, daysBetween(from, occurrence.firstDay))
      const last = Math.min(length, daysBetween(from, occurrence.lastDay))

      rows.set(person.userId, [
        ...(rows.get(person.userId) ?? []),
        {
          appointment,
          occurrence,
          person,
          confirmed: isConfirmed(person, appointment),
          first,
          last,
          cutBefore: occurrence.firstDay < from,
          cutAfter: occurrence.lastDay > to,
          away: awayBetween(absences, person.userId, occurrence.firstDay, occurrence.lastDay),
        },
      ])
    }
  }

  const out = new Map<string, { placed: Placed[]; lanes: number }>()

  for (const [userId, items] of rows) {
    const lanes: { first: number; last: number }[][] = []
    const placed: Placed[] = []

    for (const item of [...items].sort(
      (a, b) =>
        a.first - b.first || a.occurrence.startsAt.getTime() - b.occurrence.startsAt.getTime(),
    )) {
      let lane = lanes.findIndex((taken) =>
        taken.every((other) => item.first > other.last || item.last < other.first),
      )

      if (lane < 0) {
        lane = lanes.length
        lanes.push([])
      }

      lanes[lane]?.push(item)
      placed.push({ ...item, lane })
    }

    out.set(userId, { placed, lanes: Math.max(1, lanes.length) })
  }

  return out
}

/** One time of an appointment on one day of somebody's list on site. */
export interface MyDay {
  readonly on: IsoDate
  readonly appointment: AppointmentRow
  readonly occurrence: Occurrence
  readonly person: PersonRow
  readonly confirmed: boolean
  /** Which day of a time over several days this is, and of how many. */
  readonly part: { readonly day: number; readonly of: number } | null
}

/**
 * The appointments of one person from one day to another, day by day: a time
 * over several days stands on each of them, as in a calendar.
 */
export function myDays(
  appointments: readonly AppointmentRow[],
  people: readonly PersonRow[],
  userId: string,
  from: IsoDate,
  to: IsoDate,
): MyDay[] {
  const byId = new Map(appointments.map((appointment) => [appointment.id, appointment]))
  const out: MyDay[] = []

  for (const person of people) {
    const appointment = byId.get(person.appointmentId)

    if (person.userId !== userId || appointment === undefined) {
      continue
    }

    for (const occurrence of occurrencesBetween(appointment, from, to)) {
      const of = daysBetween(occurrence.firstDay, occurrence.lastDay) + 1

      for (let day = 0; day < of; day += 1) {
        const on = addDays(occurrence.firstDay, day)

        if (on >= from && on <= to) {
          out.push({
            on,
            appointment,
            occurrence,
            person,
            confirmed: isConfirmed(person, appointment),
            part: of > 1 ? { day: day + 1, of } : null,
          })
        }
      }
    }
  }

  return out.sort(
    (a, b) =>
      a.on.localeCompare(b.on) || a.occurrence.startsAt.getTime() - b.occurrence.startsAt.getTime(),
  )
}

/**
 * When a time is on a day of somebody's list: "07:20 bis 12:00" on a single
 * day; over several, the day of it and from or until when.
 */
export function whenOnDay(day: MyDay): { readonly line: string; readonly until: string | null } {
  const { occurrence, part } = day

  if (part === null) {
    return {
      line: `${clockOf(occurrence.startsAt)} bis ${clockOf(occurrence.endsAt)}`,
      until: null,
    }
  }

  const last = occurrence.lastDay
  const until = `Bis ${longDays[weekdayIndex(last)]}, ${dayMonth(last)}, ${clockOf(occurrence.endsAt)}`

  if (part.day === 1) {
    return { line: `Tag 1 von ${String(part.of)}, ab ${clockOf(occurrence.startsAt)}`, until }
  }

  return {
    line: `Tag ${String(part.day)} von ${String(part.of)}${part.day === part.of ? `, bis ${clockOf(occurrence.endsAt)}` : ', ganztags'}`,
    until: part.day === part.of ? null : until,
  }
}
