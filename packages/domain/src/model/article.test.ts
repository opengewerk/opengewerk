import { describe, expect, it } from 'vitest'

import {
  articleProblems,
  eanProblem,
  isCalendarDay,
  priceOn,
  priceProblems,
  priceStanding,
  supplierNumberProblem,
} from './article.js'
import { supplierProblems } from './supplier.js'

describe('the EAN of an article', () => {
  it('takes 13 and 8 digits with the right check digit', () => {
    expect(eanProblem('4006381333931')).toBeNull()
    expect(eanProblem('2001042000018')).toBeNull()
    expect(eanProblem('96385074')).toBeNull()
  })

  it('refuses a wrong check digit and a wrong length', () => {
    expect(eanProblem('4006381333932')).toBe('Die Prüfziffer der EAN stimmt nicht.')
    expect(eanProblem('96385075')).toBe('Die Prüfziffer der EAN stimmt nicht.')
    expect(eanProblem('400638133393')).toBe('Eine EAN hat 13 oder 8 Ziffern.')
    expect(eanProblem('40063813339A1')).toBe('Eine EAN hat 13 oder 8 Ziffern.')
  })
})

describe('the fields of an article', () => {
  const article = {
    number: '1042',
    designation: 'Mantelleitung NYM-J 3 × 1,5 mm²',
    ean: '2001042000018',
    unit: 'metre',
    groupOfGoods: 'Kabel und Leitungen',
    frequent: true,
  }

  it('are fine as a form fills them', () => {
    expect(articleProblems(article)).toEqual({})
    expect(articleProblems({ ...article, ean: '', groupOfGoods: null })).toEqual({})
  })

  it('want a number and a designation', () => {
    expect(articleProblems({ ...article, number: '  ', designation: '' })).toEqual({
      number: 'Ein Artikel braucht eine Nummer.',
      designation: 'Ein Artikel braucht eine Bezeichnung.',
    })
  })

  it('hold every text to a length', () => {
    const problems = articleProblems({
      ...article,
      number: 'x'.repeat(41),
      designation: 'x'.repeat(201),
      groupOfGoods: 'x'.repeat(81),
    })

    expect(Object.keys(problems).sort()).toEqual(['designation', 'groupOfGoods', 'number'])
    expect(supplierNumberProblem('x'.repeat(40))).toBeNull()
    expect(supplierNumberProblem('x'.repeat(41))).toMatch(/höchstens 40 Zeichen/)
  })

  it('know the units of a position and nothing else', () => {
    expect(articleProblems({ unit: 'package' })).toEqual({})
    expect(articleProblems({ unit: 'barrel' })).toEqual({ unit: 'Diese Einheit gibt es nicht.' })
  })

  it('judge only what is there, so a change of one field is not refused for another', () => {
    expect(articleProblems({ frequent: false })).toEqual({})
    expect(articleProblems({ frequent: 'ja' })).toEqual({ frequent: 'Häufig ist ja oder nein.' })
  })

  it('refuse an EAN that does not add up', () => {
    expect(articleProblems({ ean: '2001042000019' })).toEqual({
      ean: 'Die Prüfziffer der EAN stimmt nicht.',
    })
  })
})

describe('a price from a day on', () => {
  it('is whole cents from nothing to 999.999,99 € on a day of the calendar', () => {
    expect(priceProblems({ unitPriceCents: 92, validFrom: '2026-03-01' })).toEqual({})
    expect(priceProblems({ unitPriceCents: 0, validFrom: '2026-03-01' })).toEqual({})
    expect(priceProblems({ unitPriceCents: 99_999_999, validFrom: '2024-02-29' })).toEqual({})
  })

  it('refuses what is not', () => {
    expect(Object.keys(priceProblems({ unitPriceCents: -1, validFrom: '2026-02-30' }))).toEqual([
      'unitPriceCents',
      'validFrom',
    ])
    expect(priceProblems({ unitPriceCents: 9.5, validFrom: '2026-03-01' })).toHaveProperty(
      'unitPriceCents',
    )
    expect(priceProblems({ unitPriceCents: 100_000_000, validFrom: '2026-03-01' })).toHaveProperty(
      'unitPriceCents',
    )
  })

  it('is for one, ten, a hundred or a thousand units, and for one when none is named (#456)', () => {
    for (const priceBase of [1, 10, 100, 1000]) {
      expect(priceProblems({ unitPriceCents: 350, validFrom: '2026-03-01', priceBase })).toEqual({})
    }

    expect(priceProblems({ unitPriceCents: 350, validFrom: '2026-03-01', priceBase: 50 })).toEqual({
      priceBase: 'Ein Preis gilt je 1, 10, 100 oder 1000 Einheiten.',
    })
  })

  it('knows the days of the calendar', () => {
    expect(isCalendarDay('2028-02-29')).toBe(true)
    expect(isCalendarDay('2027-02-29')).toBe(false)
    expect(isCalendarDay('2026-13-01')).toBe(false)
    expect(isCalendarDay('1.3.2026')).toBe(false)
    expect(isCalendarDay(20260301)).toBe(false)
  })
})

describe('the price of a day', () => {
  const prices = [
    { validFrom: '2025-09-01', cents: 89 },
    { validFrom: '2026-10-01', cents: 98 },
    { validFrom: '2026-03-01', cents: 92 },
  ]

  it('is the latest that began by then, in whatever order they come', () => {
    expect(priceOn(prices, '2026-09-28')?.cents).toBe(92)
    expect(priceOn(prices, '2026-03-01')?.cents).toBe(92)
    expect(priceOn(prices, '2026-02-28')?.cents).toBe(89)
    expect(priceOn(prices, '2026-10-01')?.cents).toBe(98)
    expect(priceOn(prices, '2025-08-31')).toBeNull()
    expect(priceOn([], '2026-09-28')).toBeNull()
  })

  it('stands beside each price as the office writes it', () => {
    const [earlier, coming, current] = prices as [
      (typeof prices)[number],
      (typeof prices)[number],
      (typeof prices)[number],
    ]

    expect(priceStanding(coming, prices, '2026-09-28')).toBe('coming')
    expect(priceStanding(current, prices, '2026-09-28')).toBe('current')
    expect(priceStanding(earlier, prices, '2026-09-28')).toBe('earlier')
  })
})

describe('the fields of a supplier', () => {
  it('want a name and hold the customer number to a length', () => {
    expect(supplierProblems({ name: 'Elektro-Großhandel Rhein-Neckar GmbH' })).toEqual({})
    expect(supplierProblems({ name: ' ' })).toEqual({ name: 'Ein Lieferant braucht einen Namen.' })
    expect(supplierProblems({ customerNumber: 'x'.repeat(41) })).toEqual({
      customerNumber: 'Eine Kundennummer hat höchstens 40 Zeichen.',
    })
    expect(supplierProblems({ customerNumber: '448120' })).toEqual({})
  })
})
