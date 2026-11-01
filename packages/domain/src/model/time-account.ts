import {
  addDays,
  type IsoDate,
  type WeekdayMinutes,
  weekdayMinutes,
  weekdays,
  type WorkingTime,
  workingTimeOn,
} from '@opengewerk/platform-domain'

import { berlinDay, hoursText } from '../rules/working-time.js'
import { type Absence, type AbsenceSpan, halvesOn } from './absence.js'
import { daysFrom } from './holiday.js'
import { effectiveEntries, minutesBetween, type TimeEntryKind } from './time-entry.js'

/**
 * The time account (#289, Feature-Gliederung 4.4): what was agreed against
 * what was recorded, day by day.
 *
 * The target of a day is the agreed working time that held on it. A public
 * holiday, approved leave or a sickness takes it to nothing, half a day to
 * half; a request still open or turned down takes nothing. What was recorded
 * is work and travel, not breaks, from the entries that count, so that a
 * correction counts on the day its time lies and the entry it corrects not
 * at all. The account begins with the first agreed working time and ends
 * with leaving, and it counts up to yesterday: today is not over yet.
 *
 * Why a day has no target the account does not say, so that no sickness can
 * be read from it.
 */

type Week = Pick<WorkingTime, 'validFrom' | WeekdayMinutes> & {
  readonly deletedAt: Date | string | null
}

type Away = Pick<Absence, 'state'> & AbsenceSpan

type Recorded = {
  readonly id?: unknown
  readonly kind: TimeEntryKind
  readonly startedAt: Date | string
  readonly endedAt: Date | string
  readonly correctsEntryId?: unknown
  readonly withdrawn?: unknown
}

/** One day of an account: its target and what was recorded on it, in minutes, and whether it counts yet. */
export interface AccountDay {
  readonly on: IsoDate
  readonly targetMinutes: number
  readonly workedMinutes: number
  readonly counted: boolean
}

/** The minutes agreed for a day by the working time that held on it, before anything takes them away. */
export function agreedMinutesOn(times: readonly Week[], on: IsoDate): number {
  const time = workingTimeOn(times, on)
  const weekday = weekdays[(new Date(`${on}T00:00:00Z`).getUTCDay() + 6) % 7]

  return time === null || weekday === undefined ? 0 : time[weekdayMinutes[weekday]]
}

/**
 * The target of a day: the agreed minutes, nothing on a public holiday, and
 * less by each half of the day somebody was away with approved leave or sick.
 * Leave and a sickness on the same half take that half once.
 */
export function targetOn(
  times: readonly Week[],
  away: readonly Away[],
  isHoliday: (on: IsoDate) => boolean,
  on: IsoDate,
): number {
  const agreed = agreedMinutesOn(times, on)

  if (agreed === 0 || isHoliday(on)) {
    return 0
  }

  let halves = 0

  for (const absence of away) {
    if (absence.state === 'approved') {
      halves = Math.max(halves, halvesOn(absence, on))
    }
  }

  return halves >= 2 ? 0 : halves === 1 ? Math.round(agreed / 2) : agreed
}

/** Work and travel of each day from the entries that count, by the day an entry begins in Germany. */
export function workedByDay(entries: readonly Recorded[]): ReadonlyMap<IsoDate, number> {
  const byDay = new Map<IsoDate, number>()

  for (const entry of effectiveEntries(entries)) {
    if (entry.kind !== 'break') {
      const on = berlinDay(entry.startedAt)

      byDay.set(on, (byDay.get(on) ?? 0) + minutesBetween(entry.startedAt, entry.endedAt))
    }
  }

  return byDay
}

/** The first day of an account: the first agreed working time, not before joining. */
export function accountStart(times: readonly Week[], joinedOn: IsoDate | null): IsoDate | null {
  let first: IsoDate | null = null

  for (const time of times) {
    if (time.deletedAt === null && (first === null || time.validFrom < first)) {
      first = time.validFrom
    }
  }

  return first !== null && joinedOn !== null && joinedOn > first ? joinedOn : first
}

/**
 * The last day an account counts: yesterday, or the day somebody left if that
 * was earlier. Null before the account has begun.
 */
export function countedUntil(
  startsOn: IsoDate | null,
  leftOn: IsoDate | null,
  today: IsoDate,
): IsoDate | null {
  const yesterday = addDays(today, -1)
  const until = leftOn !== null && leftOn < yesterday ? leftOn : yesterday

  return startsOn === null || until < startsOn ? null : until
}

/**
 * The days of an account from one day to another. A day before the account
 * begins or after it ends has no target and counts nothing; a day after the
 * last counted day shows its target and what was recorded so far, and counts
 * nothing yet.
 */
export function accountDays(input: {
  readonly times: readonly Week[]
  readonly away: readonly Away[]
  readonly isHoliday: (on: IsoDate) => boolean
  readonly worked: ReadonlyMap<IsoDate, number>
  readonly startsOn: IsoDate | null
  readonly leftOn: IsoDate | null
  readonly until: IsoDate | null
  readonly from: IsoDate
  readonly to: IsoDate
}): AccountDay[] {
  return daysFrom(input.from, input.to).map((on) => {
    const open =
      input.startsOn !== null &&
      on >= input.startsOn &&
      (input.leftOn === null || on <= input.leftOn)

    return {
      on,
      targetMinutes: open ? targetOn(input.times, input.away, input.isHoliday, on) : 0,
      workedMinutes: open ? (input.worked.get(on) ?? 0) : 0,
      counted: open && input.until !== null && on <= input.until,
    }
  })
}

/** What the counted days of a stretch add up to: target, recorded, and the balance of the two. */
export function balanceOf(days: readonly AccountDay[]): {
  readonly targetMinutes: number
  readonly workedMinutes: number
  readonly balanceMinutes: number
} {
  let target = 0
  let worked = 0

  for (const day of days) {
    if (day.counted) {
      target += day.targetMinutes
      worked += day.workedMinutes
    }
  }

  return { targetMinutes: target, workedMinutes: worked, balanceMinutes: worked - target }
}

/** "+24:45 Std." or "−1:30 Std.": a balance with its sign, the minus a real one. */
export function balanceText(minutes: number): string {
  return `${minutes < 0 ? '−' : '+'}${hoursText(Math.abs(minutes))}`
}
