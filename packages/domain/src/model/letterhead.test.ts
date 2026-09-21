import { describe, expect, it } from 'vitest'

import { ibanIsValid } from './letterhead.js'

/**
 * The IBAN is the one field of a letterhead where a typing error costs money:
 * it is printed on every invoice, and a customer who pays into a wrong
 * account has paid. The check digits catch every single wrong character and
 * every swap of two neighbours, which is what this holds on to.
 */
describe('an IBAN', () => {
  it('adds up when it is right, however it is spaced', () => {
    expect(ibanIsValid('DE89370400440532013000')).toBe(true)
    expect(ibanIsValid('DE89 3704 0044 0532 0130 00')).toBe(true)
    expect(ibanIsValid('de89 3704 0044 0532 0130 00')).toBe(true)
    // Austria, shorter, and it has to work all the same.
    expect(ibanIsValid('AT61 1904 3002 3457 3201')).toBe(true)
  })

  it('does not add up with a single character wrong', () => {
    expect(ibanIsValid('DE89 3704 0044 0532 0130 01')).toBe(false)
  })

  it('does not add up with two neighbours swapped', () => {
    expect(ibanIsValid('DE89 3704 0044 0532 0103 00')).toBe(false)
  })

  it('is refused when it is not shaped like one at all', () => {
    expect(ibanIsValid('')).toBe(false)
    expect(ibanIsValid('DE89')).toBe(false)
    expect(ibanIsValid('Kontonummer 12345')).toBe(false)
  })
})
