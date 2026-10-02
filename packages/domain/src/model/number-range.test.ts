import { numberFromPattern, patternProblem } from '@opengewerk/platform-domain'
import { describe, expect, it } from 'vitest'

import { defaultPatterns, numberRangeKeys, numberRangeOf } from './number-range.js'

describe('the number ranges', () => {
  it('put every kind of invoice into one sequence', () => {
    // Section 14 UStG wants one number per invoice, assigned once and running
    // without gaps. A cancellation is an invoice as well, and a sequence of
    // its own would leave a hole in the one that counts.
    expect(numberRangeOf('final_invoice')).toBe('invoice')
    expect(numberRangeOf('partial_invoice')).toBe('invoice')
    expect(numberRangeOf('credit_note')).toBe('invoice')
    expect(numberRangeOf('cancellation_invoice')).toBe('invoice')
  })

  it('keep quotes out of it', () => {
    expect(numberRangeOf('quote')).toBe('quote')
    expect(numberRangeOf('cost_estimate')).toBe('quote')
  })
})

/**
 * The patterns a business starts with. How a pattern is read is the
 * foundation's; that these six are patterns, and what the first numbers of a
 * business look like, is said here.
 */
describe('the patterns a sequence starts with', () => {
  it('are patterns, every one of them', () => {
    for (const key of numberRangeKeys) {
      expect(patternProblem(defaultPatterns[key])).toBeNull()
    }
  })

  it('make the numbers a business has always had', () => {
    const first = (key: (typeof numberRangeKeys)[number]) =>
      numberFromPattern(defaultPatterns[key], { counter: 7, year: 2026 })

    expect(numberRangeKeys.map(first)).toEqual([
      'AU-2026-0007',
      'AN-2026-0007',
      'AB-2026-0007',
      'LS-2026-0007',
      'RB-2026-0007',
      'RE-2026-0007',
    ])
  })
})
