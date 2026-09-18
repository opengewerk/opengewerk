import { describe, expect, it } from 'vitest'

import { formatDocumentNumber, InvalidPatternError, numberRangeOf } from './number-range.js'

describe('a document number', () => {
  it('fills year and counter into the pattern', () => {
    expect(formatDocumentNumber('RE-{year}-{number:4}', { counter: 7, year: 2026 })).toBe(
      'RE-2026-0007',
    )
  })

  it('keeps the width once the counter outgrows it', () => {
    expect(formatDocumentNumber('RE-{number:3}', { counter: 12_345, year: 2026 })).toBe('RE-12345')
  })

  it('refuses a pattern that has no place for the counter', () => {
    // Such a pattern would hand the same number to every document, and the
    // unique index would then refuse the second one. Better to say so here.
    expect(() => formatDocumentNumber('RE-{year}', { counter: 1, year: 2026 })).toThrow(
      InvalidPatternError,
    )
  })

  it('refuses a counter that is not a positive whole number', () => {
    expect(() => formatDocumentNumber('RE-{number}', { counter: 0, year: 2026 })).toThrow(
      InvalidPatternError,
    )
  })
})

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
