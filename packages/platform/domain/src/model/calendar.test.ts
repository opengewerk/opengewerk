import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { addDays, addMonths, easterSunday } from './calendar.js'
import type { IsoDate } from './identifier.js'

/** A day between 1900 and 2199, as an ISO date. */
const days = fc
  .date({
    min: new Date('1900-01-01T00:00:00Z'),
    max: new Date('2199-12-31T00:00:00Z'),
    noInvalidDate: true,
  })
  .map((day) => day.toISOString().slice(0, 10) as IsoDate)

function lastDayOf(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

describe('adding days', () => {
  it('crosses a month, a year and a leap day', () => {
    expect(addDays('2026-10-03' as IsoDate, 5)).toBe('2026-10-08')
    expect(addDays('2026-12-30' as IsoDate, 3)).toBe('2027-01-02')
    expect(addDays('2028-02-28' as IsoDate, 1)).toBe('2028-02-29')
    expect(addDays('2026-03-01' as IsoDate, -1)).toBe('2026-02-28')
  })

  it('comes back to the day it started from', () => {
    fc.assert(
      fc.property(days, fc.integer({ min: -4000, max: 4000 }), (day, count) => {
        expect(addDays(addDays(day, count), -count)).toBe(day)
      }),
    )
  })
})

describe('adding months', () => {
  it('keeps the day of the month where the month has it', () => {
    expect(addMonths('2026-10-03' as IsoDate, 1)).toBe('2026-11-03')
    expect(addMonths('2026-12-15' as IsoDate, 1)).toBe('2027-01-15')
    expect(addMonths('2026-01-15' as IsoDate, -1)).toBe('2025-12-15')
    expect(addMonths('2026-10-03' as IsoDate, 120)).toBe('2036-10-03')
  })

  it('takes the last day of a month that is too short for the day', () => {
    expect(addMonths('2026-01-31' as IsoDate, 1)).toBe('2026-02-28')
    expect(addMonths('2028-01-31' as IsoDate, 1)).toBe('2028-02-29')
    expect(addMonths('2026-05-31' as IsoDate, 1)).toBe('2026-06-30')
    expect(addMonths('2026-03-31' as IsoDate, -1)).toBe('2026-02-28')
    expect(addMonths('2028-02-29' as IsoDate, 12)).toBe('2029-02-28')
    expect(addMonths('2028-02-29' as IsoDate, 48)).toBe('2032-02-29')
  })

  it('lands on the day of the month, or on the last day where the month is shorter', () => {
    fc.assert(
      fc.property(days, fc.integer({ min: -1200, max: 1200 }), (day, months) => {
        const result = addMonths(day, months)
        const counted = Number(day.slice(0, 4)) * 12 + Number(day.slice(5, 7)) - 1 + months
        const year = Math.floor(counted / 12)
        const month = counted - year * 12 + 1

        expect(Number(result.slice(0, 4))).toBe(year)
        expect(Number(result.slice(5, 7))).toBe(month)
        expect(Number(result.slice(8, 10))).toBe(
          Math.min(Number(day.slice(8, 10)), lastDayOf(year, month)),
        )
      }),
    )
  })

  it('comes back from a day every month has', () => {
    const early = days.filter((day) => Number(day.slice(8, 10)) <= 28)

    fc.assert(
      fc.property(early, fc.integer({ min: -1200, max: 1200 }), (day, months) => {
        expect(addMonths(addMonths(day, months), -months)).toBe(day)
      }),
    )
  })

  it('never goes back when more months are added', () => {
    fc.assert(
      fc.property(
        days,
        fc.integer({ min: 0, max: 600 }),
        fc.integer({ min: 1, max: 600 }),
        (day, start, more) => {
          expect(addMonths(day, start) < addMonths(day, start + more)).toBe(true)
        },
      ),
    )
  })
})

/**
 * Easter by Gauss's rule, with its two exceptions, as a second reckoning
 * that shares no step with the one under test: the day after the 21st of
 * March is the 22nd plus d plus e, in April where that passes the 31st.
 */
function easterByGauss(year: number): string {
  const century = Math.floor(year / 100)
  const p = Math.floor((13 + 8 * century) / 25)
  const q = Math.floor(century / 4)
  const m = (15 - p + century - q + 30 * 30) % 30
  const n = (4 + century - q) % 7
  const d = (19 * (year % 19) + m) % 30
  const e = (2 * (year % 4) + 4 * (year % 7) + 6 * d + n) % 7
  const pad = (value: number) => String(value).padStart(2, '0')

  if (d === 29 && e === 6) {
    return `${String(year)}-04-19`
  }

  if (d === 28 && e === 6 && (11 * m + 11) % 30 < 19) {
    return `${String(year)}-04-18`
  }

  const march = 22 + d + e

  return march > 31 ? `${String(year)}-04-${pad(march - 31)}` : `${String(year)}-03-${pad(march)}`
}

describe('Easter Sunday', () => {
  it('falls on the days the calendars name', () => {
    expect(easterSunday(1818)).toBe('1818-03-22')
    expect(easterSunday(1943)).toBe('1943-04-25')
    expect(easterSunday(1981)).toBe('1981-04-19')
    expect(easterSunday(2000)).toBe('2000-04-23')
    expect(easterSunday(2019)).toBe('2019-04-21')
    expect(easterSunday(2024)).toBe('2024-03-31')
    expect(easterSunday(2025)).toBe('2025-04-20')
    expect(easterSunday(2026)).toBe('2026-04-05')
    expect(easterSunday(2027)).toBe('2027-03-28')
    expect(easterSunday(2038)).toBe('2038-04-25')
    expect(easterSunday(2049)).toBe('2049-04-18')
    expect(easterSunday(2285)).toBe('2285-03-22')
  })

  it('is the day of a second reckoning in every year, a Sunday between the 22nd of March and the 25th of April', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1583, max: 9999 }), (year) => {
        const easter = easterSunday(year)

        expect(easter).toBe(easterByGauss(year))
        expect(new Date(`${easter}T00:00:00Z`).getUTCDay()).toBe(0)
        expect(easter.slice(5) >= '03-22' && easter.slice(5) <= '04-25').toBe(true)
      }),
      { numRuns: 2000 },
    )
  })

  it('is reckoned only where the Gregorian calendar and a year of four digits hold', () => {
    expect(() => easterSunday(1582)).toThrow(RangeError)
    expect(() => easterSunday(10000)).toThrow(RangeError)
    expect(() => easterSunday(2026.5)).toThrow(RangeError)
  })
})
