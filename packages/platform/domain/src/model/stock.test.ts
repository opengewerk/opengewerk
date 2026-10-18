import { describe, expect, it } from 'vitest'

import {
  belowMinimum,
  eanProblem,
  stockArticleProblems,
  stockLevel,
  stockLimits,
  stockMovementProblems,
  stockSupplierProblems,
  storeArticleProblems,
  storeProblems,
} from './stock.js'

/**
 * The stock as a building block of the foundation (ADR 0011): what an
 * article, a supplier, a store and a booking have to carry, and how the
 * bookings make the stock.
 */

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

describe('an article', () => {
  const article = { number: 'A-1002', designation: 'Akku Notleuchte', ean: null, unit: 'piece' }

  it('has a number, a designation and a unit of the list, and an EAN where it is given', () => {
    expect(stockArticleProblems(article)).toEqual({})
    expect(stockArticleProblems({ ...article, ean: '4006381333931' })).toEqual({})
    expect(stockArticleProblems({ ...article, number: ' ' })).toHaveProperty('number')
    expect(stockArticleProblems({ ...article, designation: '' })).toHaveProperty('designation')
    expect(
      stockArticleProblems({ ...article, number: 'x'.repeat(stockLimits.articleNumber + 1) }),
    ).toHaveProperty('number')
    expect(stockArticleProblems({ ...article, ean: '4006381333932' })).toHaveProperty('ean')
    expect(stockArticleProblems({ ...article, unit: 'hour' })).toHaveProperty('unit')
    // A change of one field is not refused for another nobody touched.
    expect(stockArticleProblems({ designation: 'Neu' })).toEqual({})
  })
})

describe('a supplier and a store', () => {
  it('have a name, and a supplier a mail address and a country of their shape', () => {
    expect(stockSupplierProblems({ name: 'Großhandel', country: 'DE' })).toEqual({})
    expect(stockSupplierProblems({ name: '' })).toHaveProperty('name')
    expect(stockSupplierProblems({ email: 'keine Adresse' })).toHaveProperty('email')
    expect(stockSupplierProblems({ country: 'Deutschland' })).toHaveProperty('country')
    expect(storeProblems({ name: 'Hauptlager', location: null })).toEqual({})
    expect(storeProblems({ name: '  ' })).toHaveProperty('name')
  })

  it('keep a minimum of an article from zero, or none', () => {
    expect(storeArticleProblems({ minimumMilli: 10_000 })).toEqual({})
    expect(storeArticleProblems({ minimumMilli: null })).toEqual({})
    expect(storeArticleProblems({ minimumMilli: -1 })).toHaveProperty('minimumMilli')
    expect(storeArticleProblems({ minimumMilli: 1.5 })).toHaveProperty('minimumMilli')
  })

  it('keep where an article lies in a store as a text up to its bound, or none', () => {
    expect(storeArticleProblems({ bin: 'Regal 3, Fach 1' })).toEqual({})
    expect(storeArticleProblems({ bin: null })).toEqual({})
    expect(storeArticleProblems({ bin: 'x'.repeat(stockLimits.bin) })).toEqual({})
    expect(storeArticleProblems({ bin: 'x'.repeat(stockLimits.bin + 1) })).toHaveProperty('bin')
    expect(storeArticleProblems({ bin: 3 })).toHaveProperty('bin')
  })
})

describe('a write-off (opengewerk-haustechnik#430)', () => {
  it('takes away a quantity above zero and names its reason', () => {
    expect(
      stockMovementProblems({ kind: 'write_off', quantityMilli: 2000, reason: 'Für das Foyer' }),
    ).toEqual({})
    expect(stockMovementProblems({ kind: 'write_off', quantityMilli: 2000 })).toEqual({
      reason: 'Eine Ausbuchung nennt ihren Grund.',
    })
    expect(
      stockMovementProblems({ kind: 'write_off', quantityMilli: 2000, reason: '  ' }),
    ).toHaveProperty('reason')
    expect(
      stockMovementProblems({ kind: 'write_off', quantityMilli: 0, reason: 'Für das Foyer' }),
    ).toHaveProperty('quantityMilli')
    expect(
      stockMovementProblems({
        kind: 'write_off',
        quantityMilli: 2000,
        reason: 'Für das Foyer',
        supplierId: 'p-1',
      }),
    ).toHaveProperty('supplierId')
  })

  it('takes the stock down, below zero where it does not reach', () => {
    const at = (second: number) => new Date(Date.UTC(2026, 9, 18, 8, 0, second))

    expect(
      stockLevel([
        { kind: 'receipt', quantityMilli: 3000, createdAt: at(1) },
        { kind: 'write_off', quantityMilli: 2000, createdAt: at(2) },
      ]),
    ).toBe(1000)
    expect(
      stockLevel([
        { kind: 'receipt', quantityMilli: 1000, createdAt: at(1) },
        { kind: 'write_off', quantityMilli: 3000, createdAt: at(2) },
      ]),
    ).toBe(-2000)
  })
})

describe('a booking', () => {
  it('adds or takes away a quantity above zero, and a count finds one from zero with its reason', () => {
    expect(stockMovementProblems({ kind: 'receipt', quantityMilli: 20_000 })).toEqual({})
    expect(stockMovementProblems({ kind: 'receipt', quantityMilli: 0 })).toHaveProperty(
      'quantityMilli',
    )
    expect(stockMovementProblems({ kind: 'withdrawal', quantityMilli: -1 })).toHaveProperty(
      'quantityMilli',
    )
    expect(stockMovementProblems({ kind: 'count', quantityMilli: 0, reason: 'Inventur' })).toEqual(
      {},
    )
    expect(stockMovementProblems({ kind: 'count', quantityMilli: 2000 })).toHaveProperty('reason')
    expect(
      stockMovementProblems({ kind: 'count', quantityMilli: 2000, reason: '   ' }),
    ).toHaveProperty('reason')
    expect(stockMovementProblems({ kind: 'transfer', quantityMilli: 1 })).toHaveProperty('kind')
  })

  it('names the other store for a transfer, and only for one', () => {
    expect(
      stockMovementProblems({
        kind: 'transfer_out',
        quantityMilli: 3000,
        storeId: 'st-1',
        counterpartStoreId: 'st-2',
      }),
    ).toEqual({})
    expect(stockMovementProblems({ kind: 'transfer_in', quantityMilli: 3000 })).toEqual({
      counterpartStoreId: 'Eine Umbuchung nennt das andere Lager.',
    })
    expect(
      stockMovementProblems({
        kind: 'transfer_in',
        quantityMilli: 3000,
        storeId: 'st-1',
        counterpartStoreId: 'st-1',
      }),
    ).toEqual({ counterpartStoreId: 'Umgebucht wird in ein anderes Lager.' })
    expect(
      stockMovementProblems({ kind: 'receipt', quantityMilli: 1000, counterpartStoreId: 'st-2' }),
    ).toEqual({ counterpartStoreId: 'Ein anderes Lager nennt nur eine Umbuchung.' })
  })

  it('names a supplier only for a receipt', () => {
    expect(
      stockMovementProblems({ kind: 'receipt', quantityMilli: 1000, supplierId: 's-1' }),
    ).toEqual({})
    expect(
      stockMovementProblems({ kind: 'withdrawal', quantityMilli: 1000, supplierId: 's-1' }),
    ).toHaveProperty('supplierId')
  })
})

describe('the stock', () => {
  const at = (minute: number) => new Date(Date.UTC(2026, 9, 15, 8, minute))

  it('is the sum of its bookings in the order the server took them, and a count sets it', () => {
    expect(stockLevel([])).toBe(0)
    expect(
      stockLevel([
        { kind: 'withdrawal', quantityMilli: 2000, createdAt: at(3) },
        { kind: 'receipt', quantityMilli: 6000, createdAt: at(1) },
        { kind: 'count', quantityMilli: 5000, createdAt: at(2) },
      ]),
    ).toBe(3000)
    // More taken than lay there: the stock is negative and says so.
    expect(stockLevel([{ kind: 'withdrawal', quantityMilli: 1000, createdAt: at(1) }])).toBe(-1000)
  })

  it('takes a transfer out away and adds a transfer in', () => {
    expect(
      stockLevel([
        { kind: 'receipt', quantityMilli: 5000, createdAt: at(1) },
        { kind: 'transfer_out', quantityMilli: 5000, createdAt: at(2) },
      ]),
    ).toBe(0)
    expect(
      stockLevel([
        { kind: 'receipt', quantityMilli: 2000, createdAt: at(1) },
        { kind: 'transfer_in', quantityMilli: 3000, createdAt: at(2) },
      ]),
    ).toBe(5000)
  })

  it('is below its minimum only where the store keeps one', () => {
    expect(belowMinimum(3000, 10_000)).toBe(true)
    expect(belowMinimum(10_000, 10_000)).toBe(false)
    expect(belowMinimum(0, null)).toBe(false)
  })
})
