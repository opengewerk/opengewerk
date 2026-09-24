import { describe, expect, it } from 'vitest'

import {
  addressLine,
  centsAsInput,
  countryName,
  countryOptions,
  fileSize,
  parseEuros,
  parseQuantity,
  percent,
  today,
} from './format.js'

/**
 * Reading a number the way it is typed in Germany. The cases are the ones a
 * price field meets in an office: a thousands separator, a slip on an English
 * keyboard, a euro sign pasted along, and the figures that must be refused
 * rather than guessed at.
 */
describe('a typed amount', () => {
  it('reads the comma as the decimal separator and dots as thousands', () => {
    expect(parseEuros('1.234,56')).toBe(123456)
    expect(parseEuros('1234,56')).toBe(123456)
    expect(parseEuros('49,9')).toBe(4990)
    expect(parseEuros('12')).toBe(1200)
  })

  it('takes a single dot as a decimal point, unless three digits follow it', () => {
    expect(parseEuros('2.5')).toBe(250)
    expect(parseQuantity('2.5')).toBe(2500)
    expect(parseQuantity('1.234')).toBe(1_234_000)
  })

  it('ignores spaces, a no-break space and a euro sign', () => {
    expect(parseEuros('1 234,56 €')).toBe(123456)
    expect(parseEuros(`1${String.fromCharCode(0xa0)}234,56`)).toBe(123456)
  })

  it('keeps a sign, and never a negative zero', () => {
    expect(parseEuros('-50')).toBe(-5000)
    expect(Object.is(parseEuros('-0'), 0)).toBe(true)
  })

  it('refuses what it cannot read instead of reading part of it', () => {
    for (const typed of ['', 'zwölf', '1,2,3', '12,345', '1e3', '--5']) {
      expect(parseEuros(typed)).toBeNull()
    }
  })

  it('reads a quantity to three places and not more', () => {
    expect(parseQuantity('0,125')).toBe(125)
    expect(parseQuantity('0,1255')).toBeNull()
  })

  it('refuses a figure the database could not hold', () => {
    expect(parseEuros('21.474.836,47')).toBe(2_147_483_647)
    expect(parseEuros('21.474.836,48')).toBeNull()
  })

  it('writes cents back the way they are read', () => {
    expect(parseEuros(centsAsInput(123456))).toBe(123456)
  })
})

describe('the rest of the formatting', () => {
  it('writes a rate the way the printed document does', () => {
    expect(percent(1900)).toBe('19 %')
    expect(percent(750)).toBe('7,5 %')
  })

  it('knows the day in Germany, not in UTC', () => {
    // Half past midnight in Berlin is still the evening before in UTC.
    expect(today(new Date('2026-09-20T22:30:00Z'))).toBe('2026-09-21')
  })
})

describe('the size of a file', () => {
  it('is in bytes, kilobytes or megabytes, written the German way', () => {
    expect(fileSize(512)).toBe('512 Byte')
    expect(fileSize(340_400)).toBe('340 kB')
    expect(fileSize(1_234_567)).toBe('1,2 MB')
    expect(fileSize(25_000_000)).toBe('25 MB')
  })
})

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
