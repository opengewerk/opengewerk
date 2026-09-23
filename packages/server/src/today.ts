import type { IsoDate } from '@opengewerk/domain'

/**
 * Today as a date, in the time zone of the businesses this is written for.
 * Not the server's clock read as UTC: between midnight and two in the morning
 * that would still be yesterday, and a document dated yesterday is a
 * different document.
 */
export function todayInGermany(now: Date = new Date()): IsoDate {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(now)
}

/**
 * The year of a moment, as it is in Germany.
 *
 * `getFullYear` answers in the time zone of the process, and a container runs
 * in UTC unless somebody sets `TZ`. On the first of January that is still the
 * old year until one in the morning, so an invoice issued in that hour carried
 * last year's number (#146).
 */
export function yearInGermany(moment: Date = new Date()): number {
  return Number(todayInGermany(moment).slice(0, 4))
}
