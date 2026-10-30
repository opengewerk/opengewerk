import { describe, expect, it } from 'vitest'

import { tenantParameterProblem } from '../rules/parameter.js'
import { sellingCentsOf } from './markup.js'
import {
  articleMetalProblem,
  gramsFrom,
  kilogramsLabel,
  markupOnMetalOf,
  metalLimits,
  metalPriceProblem,
  metalSurchargeCents,
  type PricedMetal,
} from './metal.js'

/** H05V-U 1 mm² at the wholesaler: copper on a base of 150 € for 100 kg, 9,6 kg a kilometre. */
const cable = (centsPerHundredKg: number | null): PricedMetal => ({
  metal: 'copper',
  baseEuros: 150,
  gramsPerThousand: 9_600,
  centsPerHundredKg,
})

/**
 * The metal surcharge (#462): the example of the issue, the rounding, a price
 * below the base or none at all, and whose word on the markup wins.
 */
describe('the metal surcharge', () => {
  it('works out the example of the issue, with and without the markup', () => {
    // (1402,67 € - 150 €) for 100 kg, 0,96 kg in 100 m: 12,0256 €, so 12,03 €.
    expect(metalSurchargeCents([cable(140_267)], 100)).toBe(1203)
    // The purchase price of the list, 14,18 € for 100 m, and the surcharge: 26,21 €.
    expect(1418 + metalSurchargeCents([cable(140_267)], 100)).toBe(2621)
    // Sold with 22 %: 17,30 € and the surcharge as it is, or marked up as well.
    const selling = sellingCentsOf(1418, 2200)

    expect(selling).toBe(1730)
    expect((selling ?? 0) + metalSurchargeCents([cable(140_267)], 100)).toBe(2933)
    // 12,0256 € with 22 % are 14,671232 €.
    expect((selling ?? 0) + metalSurchargeCents([cable(140_267)], 100, 2200)).toBe(3197)
  })

  it('is worked out for the units the price is for, and rounded once', () => {
    // One metre: 0,120256 €, so 12 cents; 100 m are not 100 times the rounded metre.
    expect(metalSurchargeCents([cable(140_267)], 1)).toBe(12)
    expect(metalSurchargeCents([cable(140_267)], 1000)).toBe(12_026)
    // Two metals are added before the one rounding: 0,4 cents each make one cent.
    const half = (metal: 'copper' | 'aluminium'): PricedMetal => ({
      metal,
      baseEuros: 0,
      gramsPerThousand: 4_000,
      centsPerHundredKg: 10_000,
    })

    expect(metalSurchargeCents([half('copper')], 1)).toBe(0)
    expect(metalSurchargeCents([half('copper'), half('aluminium')], 1)).toBe(1)
  })

  it('rounds half a cent up', () => {
    // 50 cents over the base for 100 kg, a kilogram in 1000 units: half a cent a unit.
    const halfCent: PricedMetal = {
      metal: 'copper',
      baseEuros: 100,
      gramsPerThousand: 1_000_000,
      centsPerHundredKg: 10_050,
    }

    expect(metalSurchargeCents([halfCent], 1)).toBe(1)
  })

  it('adds nothing for a metal without a price or one below its base', () => {
    expect(metalSurchargeCents([cable(null)], 100)).toBe(0)
    expect(metalSurchargeCents([cable(15_000)], 100)).toBe(0)
    expect(metalSurchargeCents([cable(14_000)], 100, 2200)).toBe(0)
    expect(metalSurchargeCents([], 100)).toBe(0)
  })

  it('stays exact at the limits', () => {
    const most: PricedMetal = {
      metal: 'copper',
      baseEuros: 0,
      gramsPerThousand: metalLimits.gramsPerThousand,
      centsPerHundredKg: metalLimits.priceCents,
    }

    // 999.999,99 € for 100 kg, 999.999,9 kg in 1000 units: a number beyond 2^53 before it is divided.
    expect(metalSurchargeCents([most], 1)).toBe(999_999_890)
  })

  it('takes the narrowest word on the markup, and none means without', () => {
    expect(markupOnMetalOf(null, null, false)).toBe(false)
    expect(markupOnMetalOf(undefined, undefined, true)).toBe(true)
    expect(markupOnMetalOf(null, true, false)).toBe(true)
    expect(markupOnMetalOf(false, true, true)).toBe(false)
    expect(markupOnMetalOf(true, false, false)).toBe(true)
  })
})

describe('the figures of a metal', () => {
  it('reads a weight in kg with up to three places as grams', () => {
    expect(gramsFrom('9,6')).toEqual({ grams: 9_600 })
    expect(gramsFrom(' 43.2 ')).toEqual({ grams: 43_200 })
    expect(gramsFrom('0,096')).toEqual({ grams: 96 })
    expect(gramsFrom('120')).toEqual({ grams: 120_000 })
    expect(gramsFrom('0,0192')).toHaveProperty('problem')
    expect(gramsFrom('-1')).toHaveProperty('problem')
    expect(gramsFrom('')).toHaveProperty('problem')
    expect(kilogramsLabel(43_200)).toBe('43,2')
    expect(kilogramsLabel(96)).toBe('0,096')
  })

  it('keeps a base in whole euros and a weight within the limits', () => {
    expect(articleMetalProblem(150, 9_600)).toBeNull()
    expect(articleMetalProblem(0, 0)).toBeNull()
    expect(articleMetalProblem(150.5, 9_600)).not.toBeNull()
    expect(articleMetalProblem(-1, 9_600)).not.toBeNull()
    expect(articleMetalProblem(150, metalLimits.gramsPerThousand + 1)).not.toBeNull()
    expect(articleMetalProblem('150', 9_600)).not.toBeNull()
  })

  it('wants a metal price above nothing and within what a price may be', () => {
    expect(metalPriceProblem(140_267)).toBeNull()
    expect(metalPriceProblem(0)).not.toBeNull()
    expect(metalPriceProblem(metalLimits.priceCents + 1)).not.toBeNull()
    expect(metalPriceProblem(1402.67)).not.toBeNull()
  })

  it('stores the markup on the metal as a flag', () => {
    expect(tenantParameterProblem('material.markup_on_metal', 1)).toBeNull()
    expect(tenantParameterProblem('material.markup_on_metal', 0)).toBeNull()
    expect(tenantParameterProblem('material.markup_on_metal', 2)).not.toBeNull()
  })
})
