import type { Id, IsoDate, Synced } from './identifier.js'

/**
 * The people who work for a tenant (ADR 0016): a file of its own, with an
 * account of the tenant or without one, so that somebody without a phone
 * holds qualifications and a working time as well. Not the same as an
 * account: the account is how somebody signs in, the person is the work they
 * do here, from the day they joined to the day they left.
 *
 * Who reads and keeps the files, the deadline of a qualification that runs
 * out and the words of the change log stay with the application; the person
 * themself reads their own file through their account.
 */

export type PersonId = Id<'person'>
export type WorkingTimeId = Id<'working-time'>

/** The bounds of what a person carries, the same in a form, a route and the database. */
export const personLimits = {
  name: 120,
} as const

/** A person who works for the tenant, marked and never removed. */
export interface Person extends Synced {
  readonly id: PersonId
  readonly name: string
  /** The account of this tenant the person signs in with, or null for somebody without one. */
  readonly userId: string | null
  readonly joinedOn: IsoDate | null
  /** The last day the person works here, or null while nobody has said so. */
  readonly leftOn: IsoDate | null
}

/** How a person stands on a day: not yet joined, at work, or gone. */
export type PersonStanding = 'joining' | 'employed' | 'left'

export const personStandingLabel: Readonly<Record<PersonStanding, string>> = {
  joining: 'Tritt noch ein',
  employed: 'Beschäftigt',
  left: 'Ausgetreten',
}

/** How a person stands on a day. They work through the day they leave on. */
export function personStanding(
  person: Pick<Person, 'joinedOn' | 'leftOn'>,
  day: IsoDate,
): PersonStanding {
  if (person.leftOn !== null && person.leftOn < day) {
    return 'left'
  }

  return person.joinedOn !== null && person.joinedOn > day ? 'joining' : 'employed'
}

/** The days of a week, Monday first, as a working time names them. */
export const weekdays = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const

export type Weekday = (typeof weekdays)[number]

export const weekdayLabel: Readonly<Record<Weekday, string>> = {
  monday: 'Montag',
  tuesday: 'Dienstag',
  wednesday: 'Mittwoch',
  thursday: 'Donnerstag',
  friday: 'Freitag',
  saturday: 'Samstag',
  sunday: 'Sonntag',
}

export const weekdayShort: Readonly<Record<Weekday, string>> = {
  monday: 'Mo',
  tuesday: 'Di',
  wednesday: 'Mi',
  thursday: 'Do',
  friday: 'Fr',
  saturday: 'Sa',
  sunday: 'So',
}

/** The column of a working time that holds the minutes of a weekday. */
export type WeekdayMinutes = `${Weekday}Minutes`

export const weekdayMinutes: Readonly<Record<Weekday, WeekdayMinutes>> = {
  monday: 'mondayMinutes',
  tuesday: 'tuesdayMinutes',
  wednesday: 'wednesdayMinutes',
  thursday: 'thursdayMinutes',
  friday: 'fridayMinutes',
  saturday: 'saturdayMinutes',
  sunday: 'sundayMinutes',
}

/**
 * The working time agreed with a person from a day on: how many minutes on
 * each day of the week. It holds until the day before the next one; once
 * its day has begun it stays as it is, so that a month gone by is counted by
 * the time that held then, and a change is a new one from a later day.
 */
export interface WorkingTime extends Synced, Readonly<Record<WeekdayMinutes, number>> {
  readonly id: WorkingTimeId
  readonly personId: PersonId
  readonly validFrom: IsoDate
}

/** The minutes of a day: no more than the day has. */
export const workingTimeLimits = {
  dayMinutes: 24 * 60,
} as const

/** The minutes of a week of a working time. */
export function weekMinutes(time: Readonly<Record<WeekdayMinutes, number>>): number {
  return weekdays.reduce((sum, day) => sum + time[weekdayMinutes[day]], 0)
}

/**
 * The working time that holds on a day: of those not taken out, the one with
 * the latest day on or before it; none before the first.
 */
export function workingTimeOn<Time extends Pick<WorkingTime, 'validFrom'>>(
  times: readonly (Time & { readonly deletedAt: Date | string | null })[],
  day: IsoDate,
): Time | null {
  let found: Time | null = null

  for (const time of times) {
    if (time.deletedAt === null && time.validFrom <= day) {
      if (found === null || time.validFrom > found.validFrom) {
        found = time
      }
    }
  }

  return found
}

/** Whether the day of a working time has begun, after which it stays as it is. */
export function workingTimeHasBegun(time: Pick<WorkingTime, 'validFrom'>, today: IsoDate): boolean {
  return time.validFrom <= today
}

type Problems = Record<string, string>

const calendarDay = (value: unknown): value is IsoDate =>
  typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
  new Date(`${value}T00:00:00Z`).toISOString().startsWith(value)

/**
 * What is wrong with a person, by field: a name within its bound, days that
 * are days, and no leaving before joining. Whether the account belongs to
 * the tenant and to nobody else here, the database holds.
 */
export function personProblems(person: Readonly<Record<string, unknown>>): Readonly<Problems> {
  const problems: Problems = {}
  const name = typeof person['name'] === 'string' ? person['name'].trim() : ''

  if (name === '') {
    problems['name'] = 'Der Name fehlt.'
  } else if (name.length > personLimits.name) {
    problems['name'] = `Höchstens ${String(personLimits.name)} Zeichen.`
  }

  const userId = person['userId'] ?? null

  if (userId !== null && (typeof userId !== 'string' || userId.trim() === '')) {
    problems['userId'] = 'Wählen Sie einen Zugang oder keinen.'
  }

  const joinedOn = person['joinedOn'] ?? null
  const leftOn = person['leftOn'] ?? null

  if (joinedOn !== null && !calendarDay(joinedOn)) {
    problems['joinedOn'] = 'Der Eintritt ist ein Tag, geschrieben 2026-10-03, oder leer.'
  }

  if (leftOn !== null && !calendarDay(leftOn)) {
    problems['leftOn'] = 'Der Austritt ist ein Tag, geschrieben 2026-10-03, oder leer.'
  } else if (calendarDay(joinedOn) && calendarDay(leftOn) && leftOn < joinedOn) {
    problems['leftOn'] = 'Der Austritt liegt nicht vor dem Eintritt.'
  }

  return problems
}

/**
 * What is wrong with a working time, by field: a day it holds from, and for
 * every weekday whole minutes no longer than the day.
 */
export function workingTimeProblems(time: Readonly<Record<string, unknown>>): Readonly<Problems> {
  const problems: Problems = {}

  if (!calendarDay(time['validFrom'])) {
    problems['validFrom'] = 'Gültig ab ist ein Tag, geschrieben 2026-10-03.'
  }

  for (const day of weekdays) {
    const minutes = time[weekdayMinutes[day]]

    if (
      typeof minutes !== 'number' ||
      !Number.isInteger(minutes) ||
      minutes < 0 ||
      minutes > workingTimeLimits.dayMinutes
    ) {
      problems[weekdayMinutes[day]] = `${weekdayLabel[day]}: von 0 bis 24 Stunden.`
    }
  }

  return problems
}
