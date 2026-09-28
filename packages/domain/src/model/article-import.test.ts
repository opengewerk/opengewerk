import { describe, expect, it } from 'vitest'

import { proposedValidFrom, validFromProblem } from './article-import.js'

describe('the day the prices of an import apply from (#297)', () => {
  it('is proposed as the day of the files, or today when that has passed', () => {
    expect(proposedValidFrom('2026-10-01', '2026-09-28')).toBe('2026-10-01')
    expect(proposedValidFrom('2026-01-02', '2026-09-28')).toBe('2026-09-28')
    expect(proposedValidFrom(null, '2026-09-28')).toBe('2026-09-28')
  })

  it('is never before today, so an old file does not rewrite a price already written', () => {
    expect(validFromProblem('2026-09-28', '2026-09-28')).toBeNull()
    expect(validFromProblem('2027-01-01', '2026-09-28')).toBeNull()
    expect(validFromProblem('2026-09-27', '2026-09-28')).toBe(
      'Ein Preis gilt nicht rückwirkend, frühestens ab heute.',
    )
  })

  it('is a day of the calendar', () => {
    for (const wrong of ['2026-02-30', '28.09.2026', '', null, 20260928]) {
      expect(validFromProblem(wrong, '2026-09-28')).toBe(
        'Die Preise gelten ab einem Tag des Kalenders.',
      )
    }
  })
})
