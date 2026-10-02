import { describe, expect, it } from 'vitest'

import { InvalidPatternError, numberFromPattern, patternProblem } from './number-range.js'

describe('a number from a pattern', () => {
  it('fills year and counter into the pattern', () => {
    expect(numberFromPattern('NR-{year}-{number:4}', { counter: 7, year: 2037 })).toBe(
      'NR-2037-0007',
    )
  })

  it('keeps the width once the counter outgrows it', () => {
    expect(numberFromPattern('NR-{number:3}', { counter: 12_345, year: 2037 })).toBe('NR-12345')
  })

  it('writes a counter without a width as it is', () => {
    expect(numberFromPattern('{number}/{year}', { counter: 42, year: 2037 })).toBe('42/2037')
  })

  it('refuses a pattern that has no place for the counter', () => {
    // Such a pattern would hand the same number to everything, and whatever
    // keeps the numbers apart would then refuse the second one. Better to say
    // so here.
    expect(() => numberFromPattern('NR-{year}', { counter: 1, year: 2037 })).toThrow(
      InvalidPatternError,
    )
  })

  it('refuses a counter that is not a positive whole number', () => {
    for (const counter of [0, -1, 1.5, Number.NaN]) {
      expect(() => numberFromPattern('NR-{number}', { counter, year: 2037 })).toThrow(
        InvalidPatternError,
      )
    }
  })
})

/**
 * A pattern as a tenant types it on the screen. The same sentences reach the
 * field and the refusal of the route, so what is checked here is what both say.
 */
describe('a pattern a tenant sets', () => {
  it('takes the common shapes', () => {
    for (const pattern of [
      'NR-{year}-{number:4}',
      '{number}',
      'A/{year}/{number:5}',
      'R.{number:10}',
      'x_{number:1}',
    ]) {
      expect(patternProblem(pattern)).toBeNull()
    }
  })

  it('needs exactly one place for the counter', () => {
    expect(patternProblem('NR-{year}')).toBe(
      'Es fehlt {number}, die laufende Nummer. Ohne sie wäre jede Nummer gleich.',
    )
    expect(patternProblem('{number}-{number:4}')).toBe(
      'Die laufende Nummer steht zweimal im Muster.',
    )
  })

  it('knows only the year and the counter', () => {
    expect(patternProblem('NR-{jahr}-{number}')).toContain('Unbekannter Platzhalter {jahr}')
    expect(patternProblem('NR-{year}-{year}-{number}')).toBe('Das Jahr steht zweimal im Muster.')
    expect(patternProblem('NR-{number:0}')).toContain('1 bis 10 Stellen')
    expect(patternProblem('NR-{number:11}')).toContain('1 bis 10 Stellen')
  })

  it('keeps what stands between them to what numbers are written with', () => {
    expect(patternProblem('Nä-{number}')).toContain('ohne Umlaute')
    expect(patternProblem('NR {number}')).toContain('ohne Umlaute')
    expect(patternProblem('NR-{number')).toContain('ohne Gegenstück')
    expect(patternProblem('')).toBe('Das Muster ist leer.')
    expect(patternProblem('   ')).toBe('Das Muster ist leer.')
    expect(patternProblem(`${'R'.repeat(40)}{number}`)).toContain('länger als 40')
  })

  it('says of every pattern it takes that a number can be built from it', () => {
    // The two functions are asked one after the other: the form asks the
    // first, the server builds with the second. A pattern the first lets
    // through and the second throws on would be a number nobody can draw.
    for (const pattern of ['NR-{year}-{number:4}', '{number}', 'A/{year}/{number:5}']) {
      expect(patternProblem(pattern)).toBeNull()
      expect(() => numberFromPattern(pattern, { counter: 1, year: 2037 })).not.toThrow()
    }
  })
})
