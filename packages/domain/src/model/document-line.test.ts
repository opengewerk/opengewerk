import { describe, expect, it } from 'vitest'

import { linePositionProblem, titleAmountProblem } from './document-line.js'

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
