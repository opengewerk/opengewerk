import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import type { VatRate } from './tax.js'
import { comparableQuantities, lineNetCents, totalsFor, treatmentFor } from './invoice.js'
import { shippedRules } from './shipped.js'

/**
 * The arithmetic of an invoice, which is the part of this package with the
 * shortest way to somebody's money. Section 4.8 asks for properties and not
 * only examples, and the three at the bottom are why: a sum that is right for
 * the cases somebody thought of is not yet a sum that is right.
 */

const rules = shippedRules

function line(netCents: number, vatRate: VatRate = 'standard') {
  return { netCents, vatRate }
}

const standard = { documentDate: '2026-09-20', taxTreatment: 'standard' } as const

describe('a line total', () => {
  it('is quantity times price, in whole cents', () => {
    // 2,5 Stunden zu 58,00 Euro.
    expect(lineNetCents({ quantityMilli: 2500, unitPriceCents: 5800 })).toBe(14500)
  })

  it('rounds half away from zero, the same way the tax does', () => {
    // 0,005 mal 100 Cent ist genau ein halber Cent.
    expect(lineNetCents({ quantityMilli: 5, unitPriceCents: 100 })).toBe(1)
    expect(lineNetCents({ quantityMilli: -5, unitPriceCents: 100 })).toBe(-1)
  })

  it('handles the quantity a lump sum carries', () => {
    expect(lineNetCents({ quantityMilli: 1000, unitPriceCents: 249900 })).toBe(249900)
  })
})

describe('the totals of a document', () => {
  it('add the lines up and tax the sum, not each line', () => {
    // Drei Zeilen, die einzeln besteuert einen Cent mehr ergäben. Das ist der
    // Fall, für den die Reihenfolge im Gesetz steht.
    const totals = totalsFor(rules, [line(1003), line(1003), line(1003)], standard)

    expect(totals.netCents).toBe(3009)
    // 19 Prozent auf 3009 sind 571,71, kaufmännisch 572.
    expect(totals.taxCents).toBe(572)
    // Einzeln besteuert wären es dreimal 191 gleich 573.
    expect(totals.taxCents).not.toBe(573)
    expect(totals.grossCents).toBe(3581)
  })

  it('shows one figure per rate, because a document can carry two', () => {
    const totals = totalsFor(rules, [line(10000), line(5000, 'reduced')], standard)

    expect(totals.byRate).toHaveLength(2)
    const byRate = new Map(totals.byRate.map((entry) => [entry.rate, entry]))
    expect(byRate.get('standard')?.taxCents).toBe(1900)
    expect(byRate.get('reduced')?.taxCents).toBe(350)
    expect(totals.taxCents).toBe(2250)
  })

  /**
   * The engine turns on the date, so this is the test that says so. Nothing in
   * the calculation reads a clock, and an invoice from the second half of 2020
   * is still an invoice at sixteen percent.
   */
  it('uses the rates of the document date and not of today', () => {
    const then = totalsFor(rules, [line(10000)], {
      documentDate: '2020-08-01',
      taxTreatment: 'standard',
    })

    expect(then.taxCents).toBe(1600)
    expect(then.byRate[0]?.basisPoints).toBe(1600)
  })

  it('carries no rate block and no zero when no tax is shown', () => {
    for (const treatment of ['small_business', 'reverse_charge'] as const) {
      const totals = totalsFor(rules, [line(10000), line(5000, 'reduced')], {
        documentDate: '2026-09-20',
        taxTreatment: treatment,
      })

      expect(totals.netCents).toBe(15000)
      expect(totals.taxCents).toBe(0)
      expect(totals.grossCents).toBe(15000)
      // Kein Eintrag mit null, sondern gar keiner. Eine Zeile "0,00 EUR
      // Umsatzsteuer" sagt etwas anderes und Falsches.
      expect(totals.byRate).toEqual([])
      expect(totals.taxNote).not.toBeNull()
    }
  })

  it('names the paragraph in the sentence, because that is what makes it valid', () => {
    const small = totalsFor(rules, [line(100)], {
      documentDate: '2026-09-20',
      taxTreatment: 'small_business',
    })
    const reverse = totalsFor(rules, [line(100)], {
      documentDate: '2026-09-20',
      taxTreatment: 'reverse_charge',
    })

    expect(small.taxNote).toContain('§ 19')
    expect(reverse.taxNote).toContain('§ 13b')
  })

  it('leaves a title out, so it opens no tax group of zero at its default rate', () => {
    const heading = { netCents: 0, vatRate: 'standard', kind: 'title' } as const
    const totals = totalsFor(rules, [heading, line(5000, 'reduced')], standard)

    expect(totals.byRate.map((entry) => entry.rate)).toEqual(['reduced'])
    expect(totals.grossCents).toBe(5350)
  })

  it('is empty rather than wrong for a document without lines', () => {
    const totals = totalsFor(rules, [], standard)

    expect(totals).toMatchObject({ netCents: 0, taxCents: 0, grossCents: 0, byRate: [] })
  })

  it('gives the same answer whatever order the lines arrive in', () => {
    const lines = [line(1234), line(5678, 'reduced'), line(99)]
    const forwards = totalsFor(rules, lines, standard)
    const backwards = totalsFor(rules, [...lines].reverse(), standard)

    expect(backwards).toEqual(forwards)
  })
})

describe('which treatment a document gets', () => {
  it('puts section 19 in front of section 13b, because there is nothing to reverse', () => {
    expect(
      treatmentFor({
        businessClaimsSmallBusiness: true,
        customerIsConstructionServiceRecipient: true,
      }),
    ).toBe('small_business')
  })

  it('reverses the charge for a construction customer of a taxed business', () => {
    expect(
      treatmentFor({
        businessClaimsSmallBusiness: false,
        customerIsConstructionServiceRecipient: true,
      }),
    ).toBe('reverse_charge')
  })

  it('is standard when neither applies', () => {
    expect(
      treatmentFor({
        businessClaimsSmallBusiness: false,
        customerIsConstructionServiceRecipient: false,
      }),
    ).toBe('standard')
  })
})

describe('a quantity comparison', () => {
  it('only compares the same unit, and never a lump sum with itself', () => {
    expect(comparableQuantities('hour', 'hour')).toBe(true)
    expect(comparableQuantities('hour', 'piece')).toBe(false)
    // Zwei Pauschalen sind dieselbe Einheit und trotzdem nicht vergleichbar:
    // dass beide "1" sind, sagt nichts darüber, ob dasselbe geleistet wurde.
    expect(comparableQuantities('flat_rate', 'flat_rate')).toBe(false)
  })
})

/**
 * The properties. Section 4.8 asks for these because the examples above only
 * cover what somebody imagined, and a sum is the kind of thing that is wrong
 * in the case nobody imagined.
 */
describe('whatever the lines are', () => {
  const amount = fc.integer({ min: -1_000_000_00, max: 1_000_000_00 })
  const rate: fc.Arbitrary<VatRate> = fc.constantFrom('standard', 'reduced')
  const lines = fc.array(fc.record({ netCents: amount, vatRate: rate }), { maxLength: 40 })

  it('the net is the sum of the lines, always', () => {
    fc.assert(
      fc.property(lines, (given) => {
        const totals = totalsFor(rules, given, standard)

        expect(totals.netCents).toBe(given.reduce((sum, one) => sum + one.netCents, 0))
      }),
    )
  })

  it('net plus tax is gross, always', () => {
    fc.assert(
      fc.property(lines, (given) => {
        const totals = totalsFor(rules, given, standard)

        expect(totals.netCents + totals.taxCents).toBe(totals.grossCents)
      }),
    )
  })

  it('the rate blocks add up to the whole, always', () => {
    fc.assert(
      fc.property(lines, (given) => {
        const totals = totalsFor(rules, given, standard)
        const fromBlocks = totals.byRate.reduce((sum, entry) => sum + entry.netCents, 0)

        expect(fromBlocks).toBe(totals.netCents)
        expect(totals.byRate.reduce((sum, entry) => sum + entry.taxCents, 0)).toBe(totals.taxCents)
      }),
    )
  })

  /**
   * The one that matters for a cancellation: negating every line has to negate
   * the whole document, to the cent. If rounding drifted anywhere, a credit
   * note would not cancel the invoice it corrects and the difference would sit
   * in the books forever.
   */
  it('a document of the opposite sign cancels it exactly', () => {
    fc.assert(
      fc.property(lines, (given) => {
        const totals = totalsFor(rules, given, standard)
        const mirrored = totalsFor(
          rules,
          given.map((one) => ({ ...one, netCents: -one.netCents })),
          standard,
        )

        // Das Negieren im Test erzeugt selbst die minus Null, die der Code
        // inzwischen nicht mehr erzeugt: aus 0 wird -0, und `toBe` vergleicht
        // mit `Object.is`. Die Erwartung wird deshalb genauso normalisiert wie
        // das Ergebnis, sonst prüfte der Test das Vorzeichen der Null statt
        // der Spiegelung.
        const negated = (value: number) => (value === 0 ? 0 : -value)

        expect(mirrored.netCents).toBe(negated(totals.netCents))
        expect(mirrored.taxCents).toBe(negated(totals.taxCents))
        expect(mirrored.grossCents).toBe(negated(totals.grossCents))
      }),
    )
  })

  /**
   * Die Gegenprobe zur Normalisierung: ein Betrag von nichts trägt nie ein
   * Vorzeichen. `-0` vergleicht sich mit `===` gleich und mit `Object.is`
   * ungleich, fällt also genau dort auf, wo es teuer ist, und nirgends sonst.
   */
  it('a total of nothing never carries a sign', () => {
    const empty = totalsFor(rules, [line(0), line(0, 'reduced')], standard)

    expect(Object.is(empty.netCents, -0)).toBe(false)
    expect(Object.is(empty.taxCents, -0)).toBe(false)
    expect(Object.is(empty.grossCents, -0)).toBe(false)
    expect(Object.is(lineNetCents({ quantityMilli: -0, unitPriceCents: 100 }), -0)).toBe(false)
  })

  it('a line total never drifts from quantity times price', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -10_000_000, max: 10_000_000 }),
        fc.integer({ min: -100_000_00, max: 100_000_00 }),
        (quantityMilli, unitPriceCents) => {
          const net = lineNetCents({ quantityMilli, unitPriceCents })
          const exact = (quantityMilli * unitPriceCents) / 1000

          expect(Math.abs(net - exact)).toBeLessThanOrEqual(0.5)
        },
      ),
    )
  })
})
