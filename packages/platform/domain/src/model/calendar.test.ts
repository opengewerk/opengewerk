import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { addDays, addMonths } from './calendar.js'
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
