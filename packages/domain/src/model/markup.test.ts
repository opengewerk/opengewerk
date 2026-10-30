import { describe, expect, it } from 'vitest'

import { tenantParameterProblem } from '../rules/parameter.js'
import { priceCentsMax } from './article.js'
import { markupOf, markupProblem, sellingCentsOf } from './markup.js'

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
