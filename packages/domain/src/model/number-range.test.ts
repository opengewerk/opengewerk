import { describe, expect, it } from 'vitest'

import {
  formatDocumentNumber,
  InvalidPatternError,
  numberRangeOf,
  patternProblem,
} from './number-range.js'

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

/**
 * A pattern as a business types it on the screen. The same sentences reach the
 * field and the refusal of the route, so what is checked here is what both say.
 */
describe('a pattern a business sets', () => {
  it('takes the ones the defaults are made of, and a few others', () => {
    for (const pattern of [
      'RE-{year}-{number:4}',
      '{number}',
      'AN/{year}/{number:5}',
      'R.{number:10}',
    ]) {
      expect(patternProblem(pattern)).toBeNull()
    }
  })

  it('needs exactly one place for the counter', () => {
    expect(patternProblem('RE-{year}')).toContain('Es fehlt {number}')
    expect(patternProblem('{number}-{number:4}')).toContain('zweimal')
  })

  it('knows only the year and the counter', () => {
    expect(patternProblem('RE-{jahr}-{number}')).toContain('Unbekannter Platzhalter {jahr}')
    expect(patternProblem('RE-{year}-{year}-{number}')).toContain('Das Jahr steht zweimal')
    expect(patternProblem('RE-{number:0}')).toContain('1 bis 10 Stellen')
    expect(patternProblem('RE-{number:11}')).toContain('1 bis 10 Stellen')
  })

  it('keeps what stands between them to what numbers are written with', () => {
    expect(patternProblem('Rä-{number}')).toContain('ohne Umlaute')
    expect(patternProblem('RE {number}')).toContain('ohne Umlaute')
    expect(patternProblem('RE-{number')).toContain('ohne Gegenstück')
    expect(patternProblem('')).toBe('Das Muster ist leer.')
    expect(patternProblem(`${'R'.repeat(40)}{number}`)).toContain('länger als 40')
  })
})
