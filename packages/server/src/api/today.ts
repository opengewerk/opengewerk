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
