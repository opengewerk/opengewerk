import { describe, expect, it } from 'vitest'

import { servicePeriodProblem } from './document.js'

describe('a service period', () => {
  it('is a single day, a period in order, or nothing yet', () => {
    expect(servicePeriodProblem('2026-09-10', null)).toBeNull()
    expect(servicePeriodProblem('2026-09-10', '2026-09-10')).toBeNull()
    expect(servicePeriodProblem('2026-09-10', '2026-09-12')).toBeNull()
    expect(servicePeriodProblem(null, null)).toBeNull()
    expect(servicePeriodProblem('', '')).toBeNull()
  })

  it('has no last day without a first', () => {
    expect(servicePeriodProblem(null, '2026-09-12')).toBe(
      'Ein letzter Tag der Leistung braucht einen ersten.',
    )
    expect(servicePeriodProblem('', '2026-09-12')).toBe(
      'Ein letzter Tag der Leistung braucht einen ersten.',
    )
  })

  it('does not end before it begins', () => {
    expect(servicePeriodProblem('2026-09-10', '2026-09-05')).toBe(
      'Der letzte Tag der Leistung liegt vor dem ersten.',
    )
  })

  it('reads a timestamp and a date for the same day as the same day', () => {
    expect(servicePeriodProblem('2026-09-10T00:00:00.000Z', '2026-09-10')).toBeNull()
  })
})
