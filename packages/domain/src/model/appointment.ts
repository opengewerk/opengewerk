import { addDays, berlinClock, type IsoDate, type Synced } from '@opengewerk/platform-domain'

import type { AppointmentId, AppointmentPersonId, JobId } from './identifier.js'

/**
 * An appointment at a job (#290, Feature-Gliederung 4.3): when, who goes, and
 * a short note. The place is the site of the job.
 *
 * Written in the office at the route, with a network, and read everywhere
 * else: a device holds the appointments of its jobs and writes none. Every
 * change of when it is, its times, its rule or the days taken out of it,
 * counts `revision` up, because a confirmation holds for the version a person
 * saw and not for a later one.
 *
 * A series is a rule after RFC 5545 (RRULE, EXDATE), so that a calendar reads
 * it unchanged (#291). The clock time stays the same across the change of
 * time: an appointment at seven in winter is at seven in summer.
 */
export interface Appointment extends Synced {
  readonly id: AppointmentId
  readonly jobId: JobId
  readonly startsAt: Date
  readonly endsAt: Date
  readonly note: string | null
  /** The rule of a series, the value of an RRULE; null for a single appointment. */
  readonly rrule: string | null
  /** The days of a series taken out of it, in German time. */
  readonly exdates: readonly IsoDate[]
  readonly revision: number
}

/** Somebody who goes to an appointment, and the version of it they confirmed. */
export interface AppointmentPerson extends Synced {
  readonly id: AppointmentPersonId
  readonly appointmentId: AppointmentId
  readonly userId: string
  readonly confirmedRevision: number | null
  readonly confirmedAt: Date | null
}

/** The most a note may say: what matters on site, kept short. */
export const longestAppointmentNote = 500

/** An appointment lasts at most this many days, the first and the last counted. */
export const longestAppointmentDays = 62

/** A series takes out at most this many of its days. */
export const mostExceptions = 366

/** Confirmed means confirmed in the version the appointment is in now. */
export function isConfirmed(
  person: { readonly confirmedRevision: number | null },
  appointment: { readonly revision: number },
): boolean {
  return person.confirmedRevision === appointment.revision
}

// --- German time ---------------------------------------------------------------------------

function dayParts(on: IsoDate): [number, number, number] {
  const [year, month, day] = on.split('-').map(Number)

  return [year ?? 0, month ?? 1, day ?? 1]
}

/** Minutes the clock in Germany is ahead of UTC at a moment: 60 in winter, 120 in summer. */
function berlinOffset(at: number): number {
  const { day, minute } = berlinClock(new Date(at))
  const [year, month, date] = dayParts(day)
  const wall = Date.UTC(year, month - 1, date) + minute * 60_000

  return Math.round((wall - Math.floor(at / 60_000) * 60_000) / 60_000)
}

/**
 * The moment a clock in Germany shows a minute of a day. Asked twice, because
 * the offset of the guess can be the one on the other side of a change of time.
 */
export function berlinInstant(on: IsoDate, minute: number): Date {
  const [year, month, date] = dayParts(on)
  const wall = Date.UTC(year, month - 1, date) + minute * 60_000
  const first = wall - berlinOffset(wall) * 60_000

  return new Date(wall - berlinOffset(first) * 60_000)
}

/** The day and minute of a moment in Germany. */
export function berlinWall(at: Date | string): { readonly day: IsoDate; readonly minute: number } {
  return berlinClock(typeof at === 'string' ? new Date(at) : at)
}

/** 0 for Monday up to 6 for Sunday. */
export function weekdayOf(on: IsoDate): number {
  const [year, month, date] = dayParts(on)

  return (new Date(Date.UTC(year, month - 1, date)).getUTCDay() + 6) % 7
}

/** Whole days from one day to another. */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  const [y1, m1, d1] = dayParts(from)
  const [y2, m2, d2] = dayParts(to)

  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000)
}

// --- The rule of a series ------------------------------------------------------------------

export const repeatFrequencies = ['daily', 'weekly', 'monthly', 'yearly'] as const

export type RepeatFrequency = (typeof repeatFrequencies)[number]

/**
 * What OpenGewerk understands of RFC 5545: every so many days, weeks, months
 * or years, in a week on some weekdays, until a day or so many times. A month
 * repeats on the day of the month of the first appointment and a year on its
 * date; a month without that day has none, as the RFC says of a date that
 * does not exist.
 */
export interface RepeatRule {
  readonly frequency: RepeatFrequency
  readonly interval: number
  /** For a week only, 0 for Monday up to 6 for Sunday; empty means the weekday of the first. */
  readonly weekdays: readonly number[]
  readonly until: IsoDate | null
  readonly count: number | null
}

const frequencyWords: Readonly<Record<RepeatFrequency, string>> = {
  daily: 'DAILY',
  weekly: 'WEEKLY',
  monthly: 'MONTHLY',
  yearly: 'YEARLY',
}

const dayWords = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const

/** The most an interval and a count may be. */
export const longestInterval = 99
export const mostOccurrences = 500

/**
 * The rule read from the value of an RRULE, or null for one OpenGewerk does
 * not understand. UNTIL may be a day or a moment; a moment counts by its day
 * in Germany.
 */
export function parseRule(text: string): RepeatRule | null {
  const parts = new Map<string, string>()

  for (const part of text.split(';')) {
    const [key, value, ...rest] = part.split('=')

    if (key === undefined || value === undefined || rest.length > 0 || parts.has(key)) {
      return null
    }

    parts.set(key.toUpperCase(), value.toUpperCase())
  }

  const frequency = repeatFrequencies.find((entry) => frequencyWords[entry] === parts.get('FREQ'))

  if (frequency === undefined) {
    return null
  }

  for (const key of parts.keys()) {
    if (!['FREQ', 'INTERVAL', 'BYDAY', 'UNTIL', 'COUNT', 'WKST'].includes(key)) {
      return null
    }
  }

  if (parts.has('WKST') && parts.get('WKST') !== 'MO') {
    return null
  }

  const interval = parts.has('INTERVAL') ? Number(parts.get('INTERVAL')) : 1
  const count = parts.has('COUNT') ? Number(parts.get('COUNT')) : null
  let weekdays: number[] = []

  if (parts.has('BYDAY')) {
    if (frequency !== 'weekly') {
      return null
    }

    weekdays = (parts.get('BYDAY') ?? '')
      .split(',')
      .map((word) => (dayWords as readonly string[]).indexOf(word))

    if (weekdays.some((day) => day < 0) || new Set(weekdays).size !== weekdays.length) {
      return null
    }

    weekdays.sort((a, b) => a - b)
  }

  const until = parts.has('UNTIL') ? untilDay(parts.get('UNTIL') ?? '') : null

  if (
    !Number.isInteger(interval) ||
    interval < 1 ||
    (count !== null && !Number.isInteger(count)) ||
    (parts.has('UNTIL') && until === null) ||
    (until !== null && count !== null)
  ) {
    return null
  }

  return { frequency, interval, weekdays, until, count }
}

function untilDay(value: string): IsoDate | null {
  const day = /^(\d{4})(\d{2})(\d{2})$/.exec(value)

  if (day) {
    return `${day[1]}-${day[2]}-${day[3]}` as IsoDate
  }

  const moment = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value)

  if (!moment) {
    return null
  }

  const [, year = 0, month = 1, date = 1, hour = 0, minute = 0, second = 0] = moment.map(Number)
  const at = new Date(Date.UTC(year, month - 1, date, hour, minute, second))

  return Number.isNaN(at.getTime()) ? null : berlinWall(at).day
}

/**
 * The value of an RRULE for a rule. UNTIL is written as the last moment of
 * its day in Germany, in UTC, as the RFC asks of a series whose start has a
 * time zone.
 */
export function ruleOf(rule: RepeatRule): string {
  const parts = [`FREQ=${frequencyWords[rule.frequency]}`]

  if (rule.interval !== 1) {
    parts.push(`INTERVAL=${String(rule.interval)}`)
  }

  if (rule.frequency === 'weekly' && rule.weekdays.length > 0) {
    parts.push(
      `BYDAY=${[...rule.weekdays]
        .sort((a, b) => a - b)
        .map((day) => dayWords[day])
        .join(',')}`,
    )
  }

  if (rule.until !== null) {
    const last = new Date(berlinInstant(addDays(rule.until, 1), 0).getTime() - 1000)

    parts.push(
      `UNTIL=${last
        .toISOString()
        .replace(/[-:]/g, '')
        .replace(/\.\d{3}/, '')}`,
    )
  } else if (rule.count !== null) {
    parts.push(`COUNT=${String(rule.count)}`)
  }

  return parts.join(';')
}

/**
 * What is wrong with a rule for a series that starts on a day, as the sentence
 * the form shows, or null.
 */
export function ruleProblem(rule: RepeatRule, startsOn: IsoDate): string | null {
  if (rule.interval > longestInterval) {
    return `Eine Serie wiederholt sich höchstens alle ${String(longestInterval)} Male.`
  }

  if (rule.count !== null && (rule.count < 1 || rule.count > mostOccurrences)) {
    return `Eine Serie hat zwischen einem und ${String(mostOccurrences)} Terminen.`
  }

  if (rule.until !== null && rule.until < startsOn) {
    return 'Eine Serie endet nicht vor ihrem ersten Termin.'
  }

  if (
    rule.frequency === 'weekly' &&
    rule.weekdays.length > 0 &&
    !rule.weekdays.includes(weekdayOf(startsOn))
  ) {
    return 'Der erste Termin liegt auf einem der gewählten Wochentage.'
  }

  return null
}

// --- When an appointment is ----------------------------------------------------------------

/** One time an appointment takes place: a single appointment once, a series on each of its days. */
export interface Occurrence {
  readonly startsAt: Date
  readonly endsAt: Date
  /** The day it begins, in German time; for a series the day that names it in EXDATE. */
  readonly firstDay: IsoDate
  readonly lastDay: IsoDate
}

type When = Pick<Appointment, 'rrule' | 'exdates'> & {
  readonly startsAt: Date | string
  readonly endsAt: Date | string
}

function asDate(value: Date | string): Date {
  return typeof value === 'string' ? new Date(value) : value
}

/** The days of a series from its first on, as many as `wanted` asks for, in order. */
function* seriesDays(rule: RepeatRule, first: IsoDate, from: IsoDate): Generator<IsoDate> {
  let produced = 0
  const done = (on: IsoDate) =>
    (rule.until !== null && on > rule.until) || (rule.count !== null && produced >= rule.count)

  if (rule.frequency === 'daily') {
    // Without a count nothing before the stretch matters, and the days can be skipped.
    let step =
      rule.count === null ? Math.max(0, Math.floor(daysBetween(first, from) / rule.interval)) : 0

    for (; ; step += 1) {
      const on = addDays(first, step * rule.interval)

      if (done(on)) {
        return
      }

      produced += 1
      yield on
    }
  }

  if (rule.frequency === 'weekly') {
    const days = rule.weekdays.length > 0 ? rule.weekdays : [weekdayOf(first)]
    const monday = addDays(first, -weekdayOf(first))
    let week =
      rule.count === null
        ? Math.max(0, Math.floor(daysBetween(monday, from) / 7 / rule.interval))
        : 0

    for (; ; week += 1) {
      for (const day of days) {
        const on = addDays(monday, week * 7 * rule.interval + day)

        if (on < first) {
          continue
        }

        if (done(on)) {
          return
        }

        produced += 1
        yield on
      }
    }
  }

  const [year, month, date] = dayParts(first)

  for (let step = 0; step < 100_000; step += 1) {
    const months = rule.frequency === 'monthly' ? step * rule.interval : step * rule.interval * 12
    const candidate = new Date(Date.UTC(year, month - 1 + months, date))

    // A month without the day, or a year without the 29th of February, has none.
    if (candidate.getUTCDate() !== date) {
      continue
    }

    const on = candidate.toISOString().slice(0, 10) as IsoDate

    if (done(on)) {
      return
    }

    produced += 1
    yield on
  }
}

/**
 * The times an appointment takes place that touch the days from `from` to
 * `to`, in order. A single appointment once, a series on each of its days but
 * those taken out, each as long as the first and at the same clock time.
 */
export function occurrencesBetween(appointment: When, from: IsoDate, to: IsoDate): Occurrence[] {
  const startsAt = asDate(appointment.startsAt)
  const endsAt = asDate(appointment.endsAt)
  const start = berlinWall(startsAt)
  const end = berlinWall(endsAt)
  const span = daysBetween(start.day, end.day)
  const rule = appointment.rrule === null ? null : parseRule(appointment.rrule)

  if (rule === null) {
    return start.day <= to && end.day >= from
      ? [{ startsAt, endsAt, firstDay: start.day, lastDay: end.day }]
      : []
  }

  const out: Occurrence[] = []
  const skipped = new Set(appointment.exdates)

  for (const on of seriesDays(rule, start.day, addDays(from, -span))) {
    if (on > to) {
      break
    }

    const lastDay = addDays(on, span)

    if (lastDay >= from && !skipped.has(on)) {
      out.push({
        startsAt: berlinInstant(on, start.minute),
        endsAt: berlinInstant(lastDay, end.minute),
        firstDay: on,
        lastDay,
      })
    }
  }

  return out
}

/** Whether a series has a time on a day, taken out or not: the days EXDATE may name. */
export function isSeriesDay(appointment: When, on: IsoDate): boolean {
  if (appointment.rrule === null) {
    return false
  }

  return occurrencesBetween({ ...appointment, exdates: [] }, on, on).some(
    (occurrence) => occurrence.firstDay === on,
  )
}

/** The first time an appointment takes place that is not over at a moment, or null. */
export function nextOccurrence(appointment: When, after: Date): Occurrence | null {
  const today = berlinWall(after).day

  for (let from = today, round = 0; round < 12; from = addDays(from, 366), round += 1) {
    const next = occurrencesBetween(appointment, from, addDays(from, 365)).find(
      (occurrence) => occurrence.endsAt.getTime() > after.getTime(),
    )

    if (next) {
      return next
    }
  }

  return null
}

/** What is wrong with what an appointment is, as the sentence the form shows, or null. */
export function appointmentProblem(input: {
  readonly startsAt: Date
  readonly endsAt: Date
  readonly note: string | null
  readonly rrule: string | null
  readonly exdates: readonly IsoDate[]
  readonly userIds: readonly string[]
}): string | null {
  if (Number.isNaN(input.startsAt.getTime()) || Number.isNaN(input.endsAt.getTime())) {
    return 'Ein Termin braucht Beginn und Ende.'
  }

  if (input.endsAt.getTime() <= input.startsAt.getTime()) {
    return 'Ein Termin endet nach seinem Beginn.'
  }

  const first = berlinWall(input.startsAt).day

  if (daysBetween(first, berlinWall(input.endsAt).day) >= longestAppointmentDays) {
    return `Ein Termin dauert höchstens ${String(longestAppointmentDays)} Tage.`
  }

  if (input.note !== null && input.note.length > longestAppointmentNote) {
    return `Die Notiz zu einem Termin hat höchstens ${String(longestAppointmentNote)} Zeichen.`
  }

  if (input.userIds.length === 0) {
    return 'Ein Termin braucht mindestens eine Person.'
  }

  if (input.rrule !== null) {
    const rule = parseRule(input.rrule)

    if (rule === null) {
      return 'Diese Wiederholung versteht OpenGewerk nicht.'
    }

    const problem = ruleProblem(rule, first)

    if (problem !== null) {
      return problem
    }
  }

  if (input.exdates.length > 0 && input.rrule === null) {
    return 'Nur eine Serie nimmt Tage aus.'
  }

  if (input.exdates.length > mostExceptions) {
    return `Eine Serie nimmt höchstens ${String(mostExceptions)} Tage aus.`
  }

  return null
}

// --- In words ------------------------------------------------------------------------------

const longDays = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag']

function germanDay(on: IsoDate): string {
  const [year, month, date] = dayParts(on)

  return `${String(date).padStart(2, '0')}.${String(month).padStart(2, '0')}.${String(year)}`
}

function listed(words: readonly string[]): string {
  return words.length < 2
    ? (words[0] ?? '')
    : `${words.slice(0, -1).join(', ')} und ${words[words.length - 1] ?? ''}`
}

/**
 * A series in words, for the form and the site: "Jeden Montag, bis
 * 21.12.2026", "Alle 2 Wochen am Montag und Donnerstag", "Monatlich am 5.,
 * 10 Mal".
 */
export function ruleText(rule: RepeatRule, startsOn: IsoDate): string {
  const days = (rule.weekdays.length > 0 ? rule.weekdays : [weekdayOf(startsOn)]).map(
    (day) => longDays[day] ?? '',
  )
  const [, month, date] = dayParts(startsOn)
  const every = rule.interval === 1
  let text: string

  switch (rule.frequency) {
    case 'daily':
      text = every ? 'Täglich' : `Alle ${String(rule.interval)} Tage`
      break
    case 'weekly':
      text = every
        ? `Jeden ${listed(days)}`
        : `Alle ${String(rule.interval)} Wochen am ${listed(days)}`
      break
    case 'monthly':
      text = every
        ? `Monatlich am ${String(date)}.`
        : `Alle ${String(rule.interval)} Monate am ${String(date)}.`
      break
    case 'yearly':
      text = `${every ? 'Jährlich' : `Alle ${String(rule.interval)} Jahre`} am ${String(date).padStart(2, '0')}.${String(month).padStart(2, '0')}.`
      break
  }

  if (rule.until !== null) {
    return `${text}, bis ${germanDay(rule.until)}`
  }

  return rule.count !== null ? `${text}, ${String(rule.count)} Mal` : text
}
