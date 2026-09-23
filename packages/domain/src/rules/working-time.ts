import type { IsoDate } from '../model/identifier.js'
import type { TimeEntryKind } from '../model/time-entry.js'
import { addDays } from './payment.js'
import type { RuleSet } from './rule.js'

/** An entry as the warnings need it: what it was, and from when to when. */
export interface TimedEntry {
  readonly kind: TimeEntryKind | string
  readonly startedAt: Date | string
  readonly endedAt: Date | string
}

/** The kinds that count as working time. Travel counts, which is a reading and in #31. */
const working = new Set(['work', 'travel'])

const berlin = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Berlin',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/**
 * The day an instant falls on in Germany, as ISO. The working day of a person
 * in Mannheim ends at midnight in Mannheim, not in Greenwich.
 */
export function berlinDay(at: Date | string): IsoDate {
  return berlin.format(typeof at === 'string' ? new Date(at) : at) as IsoDate
}

/** "31.12.2026", the way a German reads a date. */
function day(on: IsoDate): string {
  return `${on.slice(8, 10)}.${on.slice(5, 7)}.${on.slice(0, 4)}`
}

/** "9:30 Std." for a number of minutes. */
export function hoursText(minutes: number): string {
  return `${String(Math.floor(minutes / 60))}:${String(minutes % 60).padStart(2, '0')} Std.`
}

/** Adds whole years to an ISO date. The 29th of February lands on the 1st of March. */
function addYears(on: IsoDate, years: number): IsoDate {
  const at = new Date(`${on}T00:00:00Z`)
  at.setUTCFullYear(at.getUTCFullYear() + years)

  return at.toISOString().slice(0, 10) as IsoDate
}

export const workingTimeWarningKinds = [
  'daily_maximum',
  'break',
  'without_break',
  'rest',
  'overlap',
] as const

export type WorkingTimeWarningKind = (typeof workingTimeWarningKinds)[number]

export interface WorkingTimeWarning {
  readonly kind: WorkingTimeWarningKind
  readonly text: string
}

interface Stretch {
  readonly start: number
  readonly end: number
}

function stretchOf(entry: TimedEntry): Stretch {
  return {
    start: new Date(entry.startedAt).getTime(),
    end: new Date(entry.endedAt).getTime(),
  }
}

function minutes(stretch: Stretch): number {
  return Math.round((stretch.end - stretch.start) / 60_000)
}

/** Stretches joined where they touch or overlap, in order. */
function merged(stretches: readonly Stretch[]): Stretch[] {
  const joined: Stretch[] = []

  for (const next of [...stretches].sort((left, right) => left.start - right.start)) {
    const last = joined.at(-1)

    if (last && next.start <= last.end) {
      joined[joined.length - 1] = { start: last.start, end: Math.max(last.end, next.end) }
    } else {
      joined.push(next)
    }
  }

  return joined
}

/**
 * What the Working Hours Act would say about one person's day, as warnings
 * and never as a refusal (#76).
 *
 * A technician in a cellar at ten at night has to be able to write down what
 * they really did; a record that stops them writes the wrong day, and a wrong
 * record is worse than one that shows a breach. So the entries are taken as
 * they are and the office is told.
 *
 * `entries` are the entries that count (`effectiveEntries`) of one person; the
 * day's are those that start on it in Germany. Working time is work and
 * travel. A break is every gap of at least the smallest allowed part between
 * two stretches of work, whether it was recorded as a break or not: a gap in
 * which somebody did not work is a break, and one of ten minutes is no break
 * at all under § 4. The rest period is measured back from the first start of
 * the day to the last end of work before it, whichever day that was.
 */
export function workingTimeWarnings(
  entries: readonly TimedEntry[],
  on: IsoDate,
  rules: RuleSet,
): WorkingTimeWarning[] {
  const value = (key: string) => rules.valueAt(key, 'minutes', on)
  const warnings: WorkingTimeWarning[] = []
  const ofTheDay = entries.filter((entry) => berlinDay(entry.startedAt) === on)
  const raw = ofTheDay.map(stretchOf).sort((left, right) => left.start - right.start)

  for (let index = 1; index < raw.length; index += 1) {
    const before = raw[index - 1]
    const after = raw[index]

    if (before && after && after.start < before.end) {
      warnings.push({
        kind: 'overlap',
        text: 'Zwei Einträge überschneiden sich. Die Summe des Tages zählt die Zeit nur einmal.',
      })
      break
    }
  }

  const work = merged(ofTheDay.filter((entry) => working.has(entry.kind)).map(stretchOf))

  if (work.length === 0) {
    return warnings
  }

  const total = work.reduce((sum, stretch) => sum + minutes(stretch), 0)
  const block = value('working_time.break_block')
  let breaks = 0
  let longest = 0
  let running = work[0] ? minutes(work[0]) : 0

  for (let index = 1; index < work.length; index += 1) {
    const before = work[index - 1]
    const after = work[index]

    if (!before || !after) {
      continue
    }

    const gap = Math.round((after.start - before.end) / 60_000)

    if (gap >= block) {
      breaks += gap
      longest = Math.max(longest, running)
      running = minutes(after)
    } else {
      running += gap + minutes(after)
    }
  }

  longest = Math.max(longest, running)

  const maximum = value('working_time.daily_maximum')

  if (total > maximum) {
    warnings.push({
      kind: 'daily_maximum',
      text: `${hoursText(total)} Arbeit am ${day(on)}. Erlaubt sind höchstens ${hoursText(maximum)} (§ 3 ArbZG).`,
    })
  }

  const needed =
    total > value('working_time.long_break_after')
      ? value('working_time.long_break')
      : total > value('working_time.break_after')
        ? value('working_time.break')
        : 0

  if (breaks < needed) {
    warnings.push({
      kind: 'break',
      text:
        `${String(breaks)} Minuten Pause bei ${hoursText(total)} Arbeit am ${day(on)}. ` +
        `Verlangt sind ${String(needed)} Minuten, in Abschnitten von mindestens ${String(block)} ` +
        'Minuten (§ 4 ArbZG).',
    })
  }

  const withoutBreak = value('working_time.without_break')

  if (longest > withoutBreak) {
    warnings.push({
      kind: 'without_break',
      text: `${hoursText(longest)} am Stück ohne Pause. Erlaubt sind höchstens ${hoursText(withoutBreak)} (§ 4 Satz 3 ArbZG).`,
    })
  }

  const firstStart = work[0]?.start ?? 0
  const lastEndBefore = entries
    .filter((entry) => working.has(entry.kind))
    .map(stretchOf)
    .filter((stretch) => stretch.end <= firstStart)
    .reduce<number | null>((latest, stretch) => Math.max(latest ?? stretch.end, stretch.end), null)

  if (lastEndBefore !== null) {
    const rest = Math.round((firstStart - lastEndBefore) / 60_000)

    const required = value('working_time.rest')

    if (rest < required) {
      warnings.push({
        kind: 'rest',
        text: `${hoursText(rest)} Ruhezeit vor Arbeitsbeginn am ${day(on)}. Verlangt sind ${hoursText(required)} am Stück (§ 5 ArbZG).`,
      })
    }
  }

  return warnings
}

/**
 * The last day the record of a day's work has to be written by, § 17 MiLoG:
 * the seventh calendar day after it.
 */
export function recordDeadline(workDay: IsoDate, rules: RuleSet): IsoDate {
  return addDays(workDay, rules.valueAt('minimum_wage.record_within', 'days', workDay))
}

/**
 * What to say about a record written after that day, or null in time. Said
 * and not refused, for the same reason as the warnings: a late record is
 * still better than none.
 */
export function lateRecordingText(workDay: IsoDate, today: IsoDate, rules: RuleSet): string | null {
  const deadline = recordDeadline(workDay, rules)

  return today > deadline
    ? `Nachgetragen nach dem ${day(deadline)}. § 17 MiLoG verlangt die Aufzeichnung bis zum siebten ` +
        'Tag nach der Arbeit; der Eintrag wird trotzdem gespeichert.'
    : null
}

/**
 * The first day a record of a day's work may be deleted: two years after the
 * day it had to be written by, § 17 MiLoG. Counted from the deadline and not
 * from the day of work, which is the later reading of "ab dem für die
 * Aufzeichnung maßgeblichen Zeitpunkt" and so the safe one. The database holds
 * the same bound (migration 0036).
 */
export function retentionEndsOn(workDay: IsoDate, rules: RuleSet): IsoDate {
  const deadline = recordDeadline(workDay, rules)

  return addDays(
    addYears(deadline, rules.valueAt('minimum_wage.record_retention', 'years', workDay)),
    1,
  )
}
