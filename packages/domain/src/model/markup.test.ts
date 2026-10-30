import type { IsoDate } from '@opengewerk/platform-domain'
import { describe, expect, it } from 'vitest'

import { tenantParameterProblem } from '../rules/parameter.js'
import { priceCentsMax } from './article.js'
import {
  basisPointsFrom,
  followedPrices,
  markupLabel,
  markupOf,
  markupFrom,
  markupProblem,
  sellingCentsOf,
  unitCentsFrom,
} from './markup.js'

/**
 * The selling price from a purchase price and a markup (#463): the rounding,
 * the limits, and which markup wins.
 */
describe('the selling price from a purchase price and a markup', () => {
  it('rounds to the cent, half a cent up', () => {
    // 3,50 € with 25 % are 4,375 €, 2,05 € with 25 % 2,5625 €, 54,00 € with 22 % 65,88 €.
    expect(sellingCentsOf(350, 2500)).toBe(438)
    expect(sellingCentsOf(205, 2500)).toBe(256)
    expect(sellingCentsOf(5400, 2200)).toBe(6588)
    // 0,01 € with 49,99 % stays a cent, with 50 % it becomes two.
    expect(sellingCentsOf(1, 4999)).toBe(1)
    expect(sellingCentsOf(1, 5000)).toBe(2)
    expect(sellingCentsOf(1234, 0)).toBe(1234)
  })

  it('is exact for the largest price and markup, and none above what a price may be', () => {
    expect(sellingCentsOf(9_999_999, 90_000)).toBe(99_999_990)
    expect(sellingCentsOf(priceCentsMax, 0)).toBe(priceCentsMax)
    expect(sellingCentsOf(priceCentsMax, 1)).toBeNull()
  })
})

describe('the markup that makes a selling price', () => {
  it("is the article's own, else the supplier's, else the business's", () => {
    const own = { fixed: false, basisPoints: 1000 }

    expect(markupOf(own, 2200, 2500)).toBe(1000)
    expect(markupOf(null, 2200, 2500)).toBe(2200)
    expect(markupOf(undefined, null, 2500)).toBe(2500)
    expect(markupOf(null, null, null)).toBeNull()
    // Zero is a markup, not none.
    expect(markupOf({ fixed: false, basisPoints: 0 }, 2200, 2500)).toBe(0)
    expect(markupOf(null, 0, 2500)).toBe(0)
  })

  it('is none for a fixed price, whatever the supplier and the business have', () => {
    expect(markupOf({ fixed: true, basisPoints: null }, 2200, 2500)).toBeNull()
  })

  it('lies between 0 and 1.000 % in whole hundredths of a percent', () => {
    const sentence =
      'Ein Aufschlag liegt zwischen 0 und 1.000 % und hat höchstens zwei Stellen nach dem Komma.'

    for (const fine of [0, 2250, 100_000]) {
      expect(markupProblem(fine)).toBeNull()
      expect(tenantParameterProblem('material.markup_basis_points', fine)).toBeNull()
    }

    for (const wrong of [-1, 100_001, 22.5, Number.NaN, '2500', null]) {
      expect(markupProblem(wrong)).toBe(sentence)
    }

    expect(tenantParameterProblem('material.markup_basis_points', 100_001)).toBe(sentence)
  })
})

describe('the selling prices that follow a purchase price', () => {
  const today = '2026-10-30' as IsoDate
  const price = (validFrom: string, cents: number, id = `p-${validFrom}`) => ({
    id,
    validFrom: validFrom as IsoDate,
    cents,
    priceBase: 100 as const,
  })
  // The cable of the board: 54,00 € for 100 m since March, 56,00 € from November.
  const purchases = [price('2026-03-01', 5400), price('2026-11-01', 5600)]

  it('are the purchase price with the markup from the day on, and from every later purchase price', () => {
    const { removed, added } = followedPrices(
      today,
      purchases,
      [price('2026-03-01', 6750, 'march'), price('2026-11-01', 7000, 'november')],
      2200,
    )

    // The price of November was worked out with the markup before and gives way.
    expect(removed).toEqual(['november'])
    expect(added).toEqual([
      { validFrom: today, cents: 6588, priceBase: 100, purchaseCents: 5400, basisPoints: 2200 },
      {
        validFrom: '2026-11-01',
        cents: 6832,
        priceBase: 100,
        purchaseCents: 5600,
        basisPoints: 2200,
      },
    ])
  })

  it('make no new price where the one that applies is the same, and keep one of the same day', () => {
    const held = [price('2026-03-01', 6588, 'march'), price('2026-11-01', 6832, 'november')]

    expect(followedPrices(today, purchases, held, 2200)).toEqual({ removed: [], added: [] })
  })

  it('change nothing without a markup or without a purchase price from the day on', () => {
    const held = [price('2026-11-01', 7000, 'november')]

    expect(followedPrices(today, purchases, held, null)).toEqual({ removed: [], added: [] })
    expect(followedPrices(today, [], held, 2200)).toEqual({ removed: [], added: [] })
  })

  it('never apply backwards', () => {
    const { removed, added } = followedPrices(
      today,
      [price('2026-03-01', 5400)],
      [price('2026-03-01', 6000, 'march'), price('2026-06-01', 6100, 'june')],
      2200,
    )

    expect(removed).toEqual([])
    expect(added.map((added) => added.validFrom)).toEqual([today])
  })
})

describe('a markup as the office types and reads it', () => {
  it('is read in percent with a comma or a point, at most two places after it', () => {
    for (const [typed, basisPoints] of [
      ['22', 2200],
      ['22,5', 2250],
      ['22,50', 2250],
      ['22.05', 2205],
      [' 25 % ', 2500],
      ['0', 0],
      ['1000', 100_000],
    ] as const) {
      expect(basisPointsFrom(typed)).toEqual({ basisPoints })
    }

    // A long run of spaces is no markup; how long reading it takes, CodeQL holds.
    expect(basisPointsFrom(`${' '.repeat(100_000)}x`)).toHaveProperty('problem')

    for (const typed of ['', 'zwölf', '22,555', '-5', '1000,01', '22,', '%']) {
      expect(basisPointsFrom(typed)).toEqual({
        problem:
          'Ein Aufschlag liegt zwischen 0 und 1.000 % und hat höchstens zwei Stellen nach dem Komma.',
      })
    }
  })

  it('is written in percent, as many places as it has', () => {
    expect(markupLabel(2250)).toBe('22,5 %')
    expect(markupLabel(2500)).toBe('25 %')
    expect(markupLabel(1)).toBe('0,01 %')
    expect(markupLabel(100_000)).toBe('1.000 %')
  })
})

describe('the purchase price and the markup at a position', () => {
  const cable = { cents: 5400, priceBase: 100 as const }

  it('make the unit price, for the price unit of the position', () => {
    expect(unitCentsFrom(cable, 100, 2200)).toBe(6588)
    // 0,54 € a metre with 22 % are 0,6588 €, half a cent up 0,66 €.
    expect(unitCentsFrom(cable, 1, 2200)).toBe(66)
    expect(unitCentsFrom(cable, 1000, 0)).toBe(54_000)
    // Exact where a number would no longer be: the largest price per 1000 with 1.000 %.
    expect(unitCentsFrom({ cents: 99_999_999, priceBase: 1 }, 1000, 100_000)).toBe(
      1_099_999_989_000,
    )
  })

  it('come back from a typed unit price, below the purchase price as less than nothing', () => {
    expect(markupFrom(cable, 100, 6588)).toBe(2200)
    expect(markupFrom(cable, 1, 66)).toBe(2222)
    expect(markupFrom(cable, 100, 4860)).toBe(-1000)
    expect(markupFrom({ cents: 0, priceBase: 1 }, 1, 100)).toBeNull()
  })
})
