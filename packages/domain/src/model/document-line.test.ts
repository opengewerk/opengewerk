import { describe, expect, it } from 'vitest'

import {
  linePositionProblem,
  lumpSumPriceBaseProblem,
  priceBaseOf,
  priceBaseProblem,
  titleAmountProblem,
} from './document-line.js'

describe('the place of a line', () => {
  it('is counted from one', () => {
    expect(linePositionProblem(1)).toBeNull()
    expect(linePositionProblem(42)).toBeNull()

    for (const wrong of [0, -1, 1.5, '1', null, undefined]) {
      expect(linePositionProblem(wrong)).toBe('Positionen zählen ab 1.')
    }
  })
})

describe('the amount on a title', () => {
  it('is none', () => {
    expect(titleAmountProblem({ kind: 'title', quantityMilli: 0, unitPriceCents: 0 })).toBeNull()
    expect(titleAmountProblem({ kind: 'title' })).toBeNull()
  })

  it('is refused as soon as there is a quantity or a price', () => {
    expect(titleAmountProblem({ kind: 'title', quantityMilli: 1000, unitPriceCents: 0 })).toBe(
      'Ein Titel trägt weder Menge noch Preis.',
    )
    expect(titleAmountProblem({ kind: 'title', quantityMilli: 0, unitPriceCents: 500 })).toBe(
      'Ein Titel trägt weder Menge noch Preis.',
    )
  })

  it('is nothing to a position, which may carry any', () => {
    expect(
      titleAmountProblem({ kind: 'item', quantityMilli: 2000, unitPriceCents: 5000 }),
    ).toBeNull()
    expect(titleAmountProblem({ quantityMilli: 2000, unitPriceCents: 5000 })).toBeNull()
  })
})

describe('the price unit of a line (#456)', () => {
  it('is one of the four steps of a wholesaler', () => {
    for (const base of [1, 10, 100, 1000]) {
      expect(priceBaseProblem(base)).toBeNull()
    }

    for (const base of [0, 5, 50, 10_000, -100, 1.5, '100', null, undefined]) {
      expect(priceBaseProblem(base)).toBe('Ein Preis gilt je 1, 10, 100 oder 1000 Einheiten.')
    }
  })

  it('reads as one where a value names none of them', () => {
    expect(priceBaseOf(100)).toBe(100)
    expect(priceBaseOf(undefined)).toBe(1)
    expect(priceBaseOf('100')).toBe(1)
  })
})

describe('the price unit of a lump sum (#456)', () => {
  it('is one, or left out', () => {
    expect(lumpSumPriceBaseProblem({ unit: 'flat_rate', priceBase: 1 })).toBeNull()
    expect(lumpSumPriceBaseProblem({ unit: 'flat_rate' })).toBeNull()
    expect(lumpSumPriceBaseProblem({ unit: 'piece', priceBase: 100 })).toBeNull()
  })

  it('is refused for anything else', () => {
    expect(lumpSumPriceBaseProblem({ unit: 'flat_rate', priceBase: 100 })).toBe(
      'Eine Pauschale hat keine Preiseinheit.',
    )
  })
})
