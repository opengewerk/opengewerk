import { describe, expect, it } from 'vitest'

import { todayInGermany, yearInGermany } from './today.js'

describe('the calendar of the businesses', () => {
  it('is already in the new year while UTC still has the old one', () => {
    // Half past midnight on the first of January in Germany.
    const moment = new Date('2026-12-31T23:30:00Z')

    expect(todayInGermany(moment)).toBe('2027-01-01')
    expect(yearInGermany(moment)).toBe(2027)
  })

  it('keeps the year on an ordinary evening in summer', () => {
    expect(yearInGermany(new Date('2027-07-15T22:30:00Z'))).toBe(2027)
  })
})
