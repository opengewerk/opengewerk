import { describe, expect, it } from 'vitest'

import { businessNameMaxLength, businessNameProblem } from './tenant.js'

/**
 * The name of a business, asked at the first run and again whenever the owner
 * changes it (#276). Both doors refuse the same names with the same sentence.
 */
describe('the name of a business', () => {
  it('is fine when there is one', () => {
    expect(businessNameProblem('Elektro Kohm')).toBeNull()
    expect(businessNameProblem('  Elektro Kohm  ')).toBeNull()
  })

  it('is missing when it is empty or only spaces', () => {
    expect(businessNameProblem('')).toBe('Der Name des Betriebs fehlt.')
    expect(businessNameProblem('   ')).toBe('Der Name des Betriebs fehlt.')
  })

  it('may be as long as the limit and no longer, spaces around it not counted', () => {
    expect(businessNameProblem('x'.repeat(businessNameMaxLength))).toBeNull()
    expect(businessNameProblem(` ${'x'.repeat(businessNameMaxLength)} `)).toBeNull()
    expect(businessNameProblem('x'.repeat(businessNameMaxLength + 1))).toContain(
      `länger als ${String(businessNameMaxLength)} Zeichen`,
    )
  })
})
