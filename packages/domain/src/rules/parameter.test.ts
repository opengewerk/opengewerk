import { describe, expect, it } from 'vitest'

import { tenantParameterKeys, tenantParameterProblem, tenantParameterUnits } from './parameter.js'

/**
 * What the value of a setting has to be. Asked where a setting is stored, so
 * that no way in writes a value the screens would never send.
 */
describe('the value of a setting a business makes', () => {
  it('is a 1 or a 0 for everything that is a yes or a no', () => {
    const flags = tenantParameterKeys.filter((key) => tenantParameterUnits[key] === 'flag')

    // Four of the five settings there are. The list is not written out here,
    // so that a further yes or no is held to the same rule without a line.
    expect(flags.length).toBeGreaterThanOrEqual(4)

    for (const key of flags) {
      expect(tenantParameterProblem(key, 0)).toBeNull()
      expect(tenantParameterProblem(key, 1)).toBeNull()

      for (const value of [2, -1, 7]) {
        expect(tenantParameterProblem(key, value)).toBe(
          'Diese Einstellung ist an oder aus: der Wert ist 1 oder 0.',
        )
      }
    }
  })

  it('is the range a document may state for the payment term, with the sentence of the forms', () => {
    for (const days of [0, 14, 365]) {
      expect(tenantParameterProblem('invoice.payment_term_days', days)).toBeNull()
    }

    for (const days of [-1, 366]) {
      expect(tenantParameterProblem('invoice.payment_term_days', days)).toBe(
        'Das Zahlungsziel liegt zwischen 0 und 365 Tagen, 0 heißt sofort zahlbar.',
      )
    }
  })
})
