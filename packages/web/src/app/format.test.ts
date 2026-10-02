import { describe, expect, it } from 'vitest'

import { addressLine, countryName, countryOptions } from './format.js'

describe('the country of an address (#144)', () => {
  const vienna = {
    id: 'c-1',
    street: 'Ringstraße',
    houseNumber: '1',
    postalCode: '1010',
    city: 'Wien',
    country: 'AT',
  }

  it('is named on the line of an address abroad, and not at home', () => {
    expect(addressLine(vienna)).toBe('Ringstraße 1, 1010 Wien, Österreich')
    expect(addressLine({ ...vienna, country: 'DE' })).toBe('Ringstraße 1, 1010 Wien')
  })

  it('is offered with Germany first and the rest by their German names', () => {
    expect(countryOptions[0]).toEqual({ value: 'DE', label: 'Deutschland' })

    const rest = countryOptions.slice(1).map((option) => option.label)

    expect(rest).toEqual([...rest].sort((left, right) => left.localeCompare(right, 'de')))
    expect(countryName('CH')).toBe('Schweiz')
  })
})
