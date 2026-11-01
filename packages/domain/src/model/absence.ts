import {
  type Id,
  type IsoDate,
  type PersonId,
  type Synced,
  type WeekdayMinutes,
  weekdayMinutes,
  weekdays,
  type WorkingTime,
  workingTimeOn,
} from '@opengewerk/platform-domain'

import { daysFrom } from './holiday.js'

/**
 * Leave and sickness (#288, Feature-Gliederung 4.9).
 *
 * An absence is a span of days, either end of which may be half: the first
 * day from noon, the last day until noon. Leave counts in working days of the
 * agreed working time that are no public holiday, and a day somebody is sick
 * does not count as leave even within approved leave (section 9 BUrlG).
 * Everything is counted in half days, as whole numbers, for the reason the
 * rule units give: two and a half days is 5, and 5 adds up.
 *
 * Of a sickness nothing is kept but that and how long: there is no field for
 * a reason, and a note is refused. Whoever keeps absences sees the kind;
 * whoever only plans reads `absentLabel` instead (section 7 of the concept).
 */

export type AbsenceId = Id<'absence'>
export type LeaveEntitlementId = Id<'leave-entitlement'>

export const absenceKinds = ['vacation', 'sickness'] as const

export type AbsenceKind = (typeof absenceKinds)[number]

export const absenceKindLabel: Readonly<Record<AbsenceKind, string>> = {
  vacation: 'Urlaub',
  sickness: 'Krankheit',
}

/** What somebody who only plans reads in place of the kind. */
export const absentLabel = 'Abwesend'

/**
 * Where an absence stands. Leave a person asks for is requested until the
 * office decides; what the office enters itself, leave or sickness, is
 * approved from the start. A sickness is never requested.
 */
export const absenceStates = ['requested', 'approved', 'rejected'] as const

export type AbsenceState = (typeof absenceStates)[number]

export function absenceStateLabel(kind: AbsenceKind, state: AbsenceState): string {
  if (state === 'requested') {
    return 'Beantragt'
  }

  if (state === 'rejected') {
    return 'Abgelehnt'
  }

  return kind === 'sickness' ? 'Eingetragen' : 'Freigegeben'
}

/** The days of an absence: either end may be half. */
export interface AbsenceSpan {
  readonly firstDay: IsoDate
  readonly lastDay: IsoDate
  /** Away on the first day only from noon. */
  readonly startsAtNoon: boolean
  /** Away on the last day only until noon. */
  readonly endsAtNoon: boolean
}

export interface Absence extends Synced, AbsenceSpan {
  readonly id: AbsenceId
  readonly personId: PersonId
  readonly kind: AbsenceKind
  readonly state: AbsenceState
  /** What the person wrote to the office with a request. Never on a sickness. */
  readonly note: string | null
  /** What the office answered when it turned a request down. */
  readonly answer: string | null
  readonly decidedBy: string | null
  readonly decidedAt: Date | null
}

/** Days of leave a person has in a year, and what came over from the year before. */
export interface LeaveEntitlement extends Synced {
  readonly id: LeaveEntitlementId
  readonly personId: PersonId
  readonly year: number
  readonly entitledHalfDays: number
  readonly carriedHalfDays: number
}

export const absenceLimits = {
  note: 500,
  answer: 500,
  /** Half days in a year at most, a leap year's. */
  halfDays: 2 * 366,
  firstYear: 2000,
  lastYear: 2100,
} as const

type Problems = Record<string, string>

const calendarDay = (value: unknown): value is IsoDate =>
  typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
  new Date(`${value}T00:00:00Z`).toISOString().startsWith(value)

const optionalText = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : null

/**
 * What is wrong with an absence, by field: days that are days in their
 * order, a single day not half twice over, and no note on a sickness.
 */
export function absenceProblems(absence: Readonly<Record<string, unknown>>): Readonly<Problems> {
  const problems: Problems = {}
  const kind = absence['kind']
  const firstDay = absence['firstDay']
  const lastDay = absence['lastDay']

  if (kind !== undefined && !(absenceKinds as readonly unknown[]).includes(kind)) {
    problems['kind'] = 'Wählen Sie Urlaub oder Krankheit.'
  }

  if (!calendarDay(firstDay)) {
    problems['firstDay'] = 'Der erste Tag ist ein Tag, geschrieben 2026-10-03.'
  }

  if (!calendarDay(lastDay)) {
    problems['lastDay'] = 'Der letzte Tag ist ein Tag, geschrieben 2026-10-03.'
  } else if (calendarDay(firstDay) && lastDay < firstDay) {
    problems['lastDay'] = 'Der letzte Tag liegt nicht vor dem ersten.'
  } else if (
    calendarDay(firstDay) &&
    firstDay === lastDay &&
    absence['startsAtNoon'] === true &&
    absence['endsAtNoon'] === true
  ) {
    problems['endsAtNoon'] = 'An einem einzigen Tag ab Mittag und bis Mittag ist kein halber Tag.'
  }

  const note = optionalText(absence['note'])

  if (note !== null && kind === 'sickness') {
    problems['note'] = 'Zu einer Krankheit gibt es keine Notiz.'
  } else if (note !== null && note.length > absenceLimits.note) {
    problems['note'] = `Höchstens ${String(absenceLimits.note)} Zeichen.`
  }

  return problems
}

/** What is wrong with the days of a year: whole half days, none below zero, no more than a year has. */
export function entitlementProblems(
  entitlement: Readonly<Record<string, unknown>>,
): Readonly<Problems> {
  const problems: Problems = {}
  const year = entitlement['year']

  if (
    typeof year !== 'number' ||
    !Number.isInteger(year) ||
    year < absenceLimits.firstYear ||
    year > absenceLimits.lastYear
  ) {
    problems['year'] = 'Das Jahr fehlt.'
  }

  for (const field of ['entitledHalfDays', 'carriedHalfDays'] as const) {
    const value = entitlement[field]

    if (
      typeof value !== 'number' ||
      !Number.isInteger(value) ||
      value < 0 ||
      value > absenceLimits.halfDays
    ) {
      problems[field] =
        'Ganze oder halbe Tage, nicht weniger als null und nicht mehr, als ein Jahr hat.'
    }
  }

  return problems
}

/** Whether two spans share a half day: the morning of one and the afternoon of the other do not. */
export function overlaps(one: AbsenceSpan, other: AbsenceSpan): boolean {
  if (one.firstDay > other.lastDay || other.firstDay > one.lastDay) {
    return false
  }

  // The morning of one and the afternoon of the other on the day where they meet.
  const meetAtNoon = (before: AbsenceSpan, after: AbsenceSpan) =>
    before.lastDay === after.firstDay && before.endsAtNoon && after.startsAtNoon

  return !meetAtNoon(one, other) && !meetAtNoon(other, one)
}

/** How many halves of a day a span covers: two, one, or none. */
export function halvesOn(span: AbsenceSpan, on: IsoDate): number {
  if (on < span.firstDay || on > span.lastDay) {
    return 0
  }

  let halves = 2

  if (on === span.firstDay && span.startsAtNoon) {
    halves -= 1
  }

  if (on === span.lastDay && span.endsAtNoon) {
    halves -= 1
  }

  return Math.max(halves, 0)
}

type Week = Pick<WorkingTime, 'validFrom' | WeekdayMinutes> & {
  readonly deletedAt: Date | string | null
}

/** Whether a day is a working day: the agreed working time has hours on it, and it is no holiday. */
export function isWorkingDay(
  times: readonly Week[],
  on: IsoDate,
  isHoliday: (on: IsoDate) => boolean,
): boolean {
  const time = workingTimeOn(times, on)

  if (time === null) {
    return false
  }

  const weekday = weekdays[(new Date(`${on}T00:00:00Z`).getUTCDay() + 6) % 7]

  return weekday !== undefined && time[weekdayMinutes[weekday]] > 0 && !isHoliday(on)
}

/** What counts in a year: half days entitled, carried over, approved, asked for, left, and sick. */
export interface LeaveYear {
  readonly year: number
  readonly entitledHalfDays: number
  readonly carriedHalfDays: number
  readonly approvedHalfDays: number
  readonly requestedHalfDays: number
  readonly restHalfDays: number
  readonly sickHalfDays: number
}

/** How an absence counts in working days and, if it is leave, in days of leave. */
export interface AbsenceCount {
  readonly workingHalfDays: number
  /** Null for a sickness, which is no leave; for leave, its working days less those somebody was sick. */
  readonly leaveHalfDays: number | null
  /** Working half days of the leave on which the person was sick. */
  readonly sickHalfDays: number
}

type Counted = Pick<Absence, 'kind' | 'state'> & AbsenceSpan

function sickHalvesOn(absences: readonly Counted[], on: IsoDate): number {
  let halves = 0

  for (const absence of absences) {
    if (absence.kind === 'sickness' && absence.state === 'approved') {
      halves = Math.max(halves, halvesOn(absence, on))
    }
  }

  return halves
}

/**
 * How one absence counts, within a stretch of days if one is given: its
 * working half days, and for leave those that count as leave, which are the
 * working half days on which the person was not sick.
 */
export function countAbsence(
  absence: Counted,
  context: {
    readonly others: readonly Counted[]
    readonly times: readonly Week[]
    readonly isHoliday: (on: IsoDate) => boolean
    readonly from?: IsoDate
    readonly to?: IsoDate
  },
): AbsenceCount {
  const first =
    context.from !== undefined && context.from > absence.firstDay ? context.from : absence.firstDay
  const last =
    context.to !== undefined && context.to < absence.lastDay ? context.to : absence.lastDay
  let working = 0
  let sick = 0

  for (const on of first <= last ? daysFrom(first, last) : []) {
    if (!isWorkingDay(context.times, on, context.isHoliday)) {
      continue
    }

    const halves = halvesOn(absence, on)

    working += halves

    if (absence.kind === 'vacation') {
      sick += Math.min(halves, sickHalvesOn(context.others, on))
    }
  }

  return {
    workingHalfDays: working,
    leaveHalfDays: absence.kind === 'vacation' ? working - sick : null,
    sickHalfDays: sick,
  }
}

/**
 * The year of one person: what they are entitled to and carried over, the
 * leave approved and asked for in it, what is left, and how long they were
 * sick. Leave across the turn of a year counts in each year with its days.
 * A rejected request counts nothing.
 */
export function leaveYear(input: {
  readonly year: number
  readonly entitlement: Pick<LeaveEntitlement, 'entitledHalfDays' | 'carriedHalfDays'> | null
  readonly absences: readonly Counted[]
  readonly times: readonly Week[]
  readonly isHoliday: (on: IsoDate) => boolean
}): LeaveYear {
  const from = `${String(input.year)}-01-01`
  const to = `${String(input.year)}-12-31`
  const context = {
    others: input.absences,
    times: input.times,
    isHoliday: input.isHoliday,
    from,
    to,
  }
  let approved = 0
  let requested = 0
  let sick = 0

  for (const absence of input.absences) {
    if (absence.lastDay < from || absence.firstDay > to || absence.state === 'rejected') {
      continue
    }

    const count = countAbsence(absence, context)

    if (absence.kind === 'sickness') {
      sick += count.workingHalfDays
    } else if (absence.state === 'approved') {
      approved += count.leaveHalfDays ?? 0
    } else {
      requested += count.leaveHalfDays ?? 0
    }
  }

  const entitled = input.entitlement?.entitledHalfDays ?? 0
  const carried = input.entitlement?.carriedHalfDays ?? 0

  return {
    year: input.year,
    entitledHalfDays: entitled,
    carriedHalfDays: carried,
    approvedHalfDays: approved,
    requestedHalfDays: requested,
    restHalfDays: entitled + carried - approved,
    sickHalfDays: sick,
  }
}

/** Half days as the screens write days: 5 is "2,5", 4 is "2". */
export function dayCount(halfDays: number): string {
  const whole = Math.trunc(halfDays / 2)
  const half = halfDays % 2 !== 0

  if (!half) {
    return String(whole)
  }

  return `${halfDays < 0 && whole === 0 ? '-' : ''}${String(whole)},5`
}
