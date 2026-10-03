import type { IsoDate } from './identifier.js'

/**
 * Counting with calendar days, without dragging a time zone along: an ISO
 * date is a day, and the arithmetic happens at midnight UTC, where no clock is
 * ever moved forward or back.
 */

/** Adds whole days to an ISO date; a negative number goes back. */
export function addDays(on: IsoDate, days: number): IsoDate {
  const at = new Date(`${on}T00:00:00Z`)
  at.setUTCDate(at.getUTCDate() + days)

  return at.toISOString().slice(0, 10) as IsoDate
}

/**
 * Adds whole months to an ISO date; a negative number goes back.
 *
 * The same day of the month, and where that month is too short for it, its
 * last day: the 31st of January and one month is the 28th or 29th of
 * February, and the 29th of February and one year in months is the 28th.
 * That is how a period in months ends when its last month lacks the day
 * (§ 188 Abs. 3 BGB), and it is what an interval of twelve months has to do
 * for an inspection done on the last day of a month.
 */
export function addMonths(on: IsoDate, months: number): IsoDate {
  const year = Number(on.slice(0, 4))
  const month = Number(on.slice(5, 7)) - 1
  const day = Number(on.slice(8, 10))
  const counted = year * 12 + month + months
  const targetYear = Math.floor(counted / 12)
  const targetMonth = counted - targetYear * 12
  // Day 0 of the following month is the last day of this one.
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate()
  const at = new Date(Date.UTC(targetYear, targetMonth, Math.min(day, lastDay)))

  return at.toISOString().slice(0, 10) as IsoDate
}
