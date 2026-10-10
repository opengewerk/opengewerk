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

/**
 * Easter Sunday of a year of the Gregorian calendar: the first Sunday after
 * the full moon on or after the 21st of March, by the tables of the church,
 * never before the 22nd of March and never after the 25th of April. Worked
 * out with the anonymous Gregorian algorithm (Meeus, Jones and Butcher). The
 * movable feasts are counted from it: Good Friday two days before, Whit
 * Monday fifty days after. For the years 1583 to 9999, where the Gregorian
 * calendar and a four digit year both hold.
 */
export function easterSunday(year: number): IsoDate {
  if (!Number.isInteger(year) || year < 1583 || year > 9999) {
    throw new RangeError(
      `Ostern wird für die Jahre 1583 bis 9999 gerechnet, nicht für ${String(year)}.`,
    )
  }

  const golden = year % 19
  const century = Math.floor(year / 100)
  const ofCentury = year % 100
  const leapCenturies = Math.floor(century / 4)
  const centuryLeft = century % 4
  const moonCorrection = Math.floor((century + 8) / 25)
  const moonShift = Math.floor((century - moonCorrection + 1) / 3)
  const epact = (19 * golden + century - leapCenturies - moonShift + 15) % 30
  const leapYears = Math.floor(ofCentury / 4)
  const yearLeft = ofCentury % 4
  const toSunday = (32 + 2 * centuryLeft + 2 * leapYears - epact - yearLeft) % 7
  const late = Math.floor((golden + 11 * epact + 22 * toSunday) / 451)
  const count = epact + toSunday - 7 * late + 114
  const month = Math.floor(count / 31)
  const day = (count % 31) + 1

  return `${String(year)}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` as IsoDate
}

/**
 * The day and the minute of the day in Germany, where every tenant of an
 * instance works: a deadline is due on a day there, and a reminder waits for
 * the morning there, whatever clock the server runs on.
 */
export function berlinClock(now: Date): { readonly day: IsoDate; readonly minute: number } {
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? '00'

  return {
    day: `${part('year')}-${part('month')}-${part('day')}` as IsoDate,
    minute: Number(part('hour')) * 60 + Number(part('minute')),
  }
}

/**
 * From when in the morning what is due today is told to its person: six
 * o'clock. Not at midnight, because a message that arrives at six is at the
 * top of the inbox when the day starts, and one from midnight is under
 * everything that came after it.
 */
export const morningMinute = 6 * 60
