import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

// Section 4.8 of the concept asks for property based tests on the booking
// rules: sum check, debit equals credit, tax reconciliation. Those arrive with
// the rules themselves. This file keeps the machinery honest in the meantime,
// and it checks the part that is easy to get wrong: that a property which is
// false actually fails instead of passing quietly.
describe('fast-check', () => {
  it('holds a property that is true for every input', () => {
    fc.assert(
      fc.property(fc.integer(), fc.integer(), (left, right) => {
        expect(left + right).toBe(right + left)
      }),
    )
  })

  it('reports a counterexample when a property does not hold', () => {
    expect(() =>
      fc.assert(
        fc.property(fc.integer({ min: 0 }), (value) => {
          expect(value).toBeLessThan(1_000)
        }),
      ),
    ).toThrow(/[Cc]ounterexample/)
  })
})
