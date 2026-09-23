import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import type { TaxTreatment } from '../model/document.js'
import type { IsoDate } from '../model/identifier.js'
import type { BilledAmount, Deducted } from './invoice.js'
import {
  billedAfter,
  billedOf,
  comparableQuantities,
  lineNetCents,
  totalsFor,
  treatmentFor,
} from './invoice.js'
import { RuleError } from './rule.js'
import type { VatRate } from './tax.js'
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
    // 2.5 hours at 58.00 euros.
    expect(lineNetCents({ quantityMilli: 2500, unitPriceCents: 5800 })).toBe(14500)
  })

  it('rounds half away from zero, the same way the tax does', () => {
    // 0.005 times 100 cents is exactly half a cent.
    expect(lineNetCents({ quantityMilli: 5, unitPriceCents: 100 })).toBe(1)
    expect(lineNetCents({ quantityMilli: -5, unitPriceCents: 100 })).toBe(-1)
  })

  it('handles the quantity a lump sum carries', () => {
    expect(lineNetCents({ quantityMilli: 1000, unitPriceCents: 249900 })).toBe(249900)
  })
})

describe('the totals of a document', () => {
  it('add the lines up and tax the sum, not each line', () => {
    // Three lines that would come to one cent more if each were taxed on its
    // own. This is the case the order in the law exists for.
    const totals = totalsFor(rules, [line(1003), line(1003), line(1003)], standard)

    expect(totals.netCents).toBe(3009)
    // 19 percent of 3009 is 571.71, rounded commercially 572.
    expect(totals.taxCents).toBe(572)
    // Taxed line by line it would be three times 191, which is 573.
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
    // Two lump sums are the same unit and still not comparable: that both are
    // "1" says nothing about whether the same work was done.
    expect(comparableQuantities('flat_rate', 'flat_rate')).toBe(false)
  })
})

/**
 * The properties. Section 4.8 asks for these because the examples above only
 * cover what somebody imagined, and a sum is the kind of thing that is wrong
 * in the case nobody imagined.
 */
/**
 * A chain of cumulative invoices. Every state is the total progress so far,
 * every invoice deducts what the ones before it billed, and the last one is
 * the final invoice.
 */
function billedChain(
  states: readonly (readonly { netCents: number; vatRate: VatRate }[])[],
  dates: readonly IsoDate[] = [],
  taxTreatment: TaxTreatment = 'standard',
): readonly BilledAmount[] {
  const earlier: Deducted[] = []

  states.forEach((state, index) => {
    const document = { documentDate: dates[index] ?? '2026-09-20', taxTreatment }
    const billed = billedAfter(totalsFor(rules, state, document), earlier, taxTreatment)

    earlier.push({ number: `RE-2026-000${String(index + 1)}`, taxTreatment, billed })
  })

  return earlier.map((entry) => entry.billed)
}

describe('a cumulative invoice', () => {
  /**
   * The case #74 names: two progress invoices and a final one, and together
   * they come to the total of the work. Three times 4.000,50 euros, because at
   * that amount the tax of each part falls on half a cent. Billed one by one,
   * every part rounds up and the three together state 2.280,30 euros of tax on
   * work that owes 2.280,29. Billed cumulatively, the second invoice states a
   * cent less and the chain ends exactly on the whole.
   */
  it('adds up to the whole work to the cent, which billing each part alone does not', () => {
    const part = 400050
    const billed = billedChain([[line(part)], [line(2 * part)], [line(3 * part)]])
    const whole = totalsFor(rules, [line(3 * part)], standard)

    expect(billed.map((one) => one.netCents)).toEqual([400050, 400050, 400050])
    expect(billed.map((one) => one.taxCents)).toEqual([76010, 76009, 76010])
    expect(billed.map((one) => one.grossCents)).toEqual([476060, 476059, 476060])

    expect(whole.taxCents).toBe(228029)
    expect(billed.reduce((sum, one) => sum + one.taxCents, 0)).toBe(whole.taxCents)
    expect(billed.reduce((sum, one) => sum + one.grossCents, 0)).toBe(whole.grossCents)

    // Each part taxed on its own, the way unrelated invoices would be.
    const alone = totalsFor(rules, [line(part)], standard).taxCents

    expect(3 * alone).toBe(228030)
  })

  /**
   * The rate of 2020: sixteen percent from July to December. A progress
   * invoice in October states sixteen, the final invoice in January taxes the
   * whole work at nineteen and deducts the tax that was stated, which settles
   * the three points on the first part as well.
   */
  it('settles a change of rate in the final invoice', () => {
    const [progress, final] = billedChain(
      [[line(1_000_000)], [line(2_500_000)]],
      ['2020-10-01', '2021-01-15'],
    )

    expect(progress).toMatchObject({ netCents: 1_000_000, taxCents: 160_000 })
    expect(final).toMatchObject({ netCents: 1_500_000, taxCents: 315_000 })
    expect(final?.byRate).toEqual([
      {
        rate: 'standard',
        basisPoints: 1900,
        netCents: 1_500_000,
        taxCents: 315_000,
        grossCents: 1_815_000,
      },
    ])
  })

  it('deducts every rate from its own rate', () => {
    const [, final] = billedChain([
      [line(100_000), line(50_000, 'reduced')],
      [line(300_000), line(80_000, 'reduced')],
    ])

    expect(final?.byRate.map((entry) => [entry.rate, entry.netCents, entry.taxCents])).toEqual([
      ['reduced', 30_000, 2_100],
      ['standard', 200_000, 38_000],
    ])
  })

  it('bills its totals when there is nothing to deduct', () => {
    const totals = totalsFor(rules, [line(12_345)], standard)

    expect(billedAfter(totals, [], 'standard')).toEqual(billedOf(totals))
  })

  it('refuses progress invoices taxed another way, and names the one that does not fit', () => {
    const totals = totalsFor(rules, [line(100_000)], standard)
    const other: Deducted = {
      number: 'RE-2026-0007',
      taxTreatment: 'small_business',
      billed: billedOf(
        totalsFor(rules, [line(40_000)], { ...standard, taxTreatment: 'small_business' }),
      ),
    }

    expect(() => billedAfter(totals, [other], 'standard')).toThrow(RuleError)
    expect(() => billedAfter(totals, [other], 'standard')).toThrow(/RE-2026-0007/)
  })

  it('works under section 19 as well, without a rate block and without tax', () => {
    const billed = billedChain([[line(60_000)], [line(100_000)]], [], 'small_business')

    expect(billed.map((one) => [one.netCents, one.taxCents, one.byRate.length])).toEqual([
      [60_000, 0, 0],
      [40_000, 0, 0],
    ])
  })

  /**
   * The property behind the example: however long the chain, however the
   * progress moved, up or back, and whatever rates it touched, what all the
   * invoices billed together is exactly the total of the last state, in each
   * rate and in each figure.
   */
  it('a chain of any length ends exactly on its last total, always', () => {
    const amount = fc.integer({ min: -5_000_000, max: 50_000_000 })
    const rate: fc.Arbitrary<VatRate> = fc.constantFrom('standard', 'reduced')
    const state = fc.array(fc.record({ netCents: amount, vatRate: rate }), { maxLength: 8 })

    fc.assert(
      fc.property(fc.array(state, { minLength: 1, maxLength: 6 }), (states) => {
        const billed = billedChain(states)
        const last = totalsFor(rules, states.at(-1) ?? [], standard)
        const sum = (pick: (one: BilledAmount) => number) =>
          billed.reduce((total, one) => total + pick(one), 0)

        expect(sum((one) => one.netCents)).toBe(last.netCents)
        expect(sum((one) => one.taxCents)).toBe(last.taxCents)
        expect(sum((one) => one.grossCents)).toBe(last.grossCents)

        for (const which of ['standard', 'reduced'] as const) {
          const perRate = (entries: readonly { rate: VatRate; taxCents: number }[]) =>
            entries.find((entry) => entry.rate === which)?.taxCents ?? 0

          expect(sum((one) => perRate(one.byRate))).toBe(perRate(last.byRate))
        }
      }),
    )
  })
})

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

        // Negating in the test itself produces the minus zero the code no
        // longer produces: 0 becomes -0, and `toBe` compares with `Object.is`.
        // The expectation is therefore normalised the same way as the result,
        // otherwise the test would check the sign of zero instead of the
        // mirroring.
        const negated = (value: number) => (value === 0 ? 0 : -value)

        expect(mirrored.netCents).toBe(negated(totals.netCents))
        expect(mirrored.taxCents).toBe(negated(totals.taxCents))
        expect(mirrored.grossCents).toBe(negated(totals.grossCents))
      }),
    )
  })

  /**
   * The counter check to the normalisation: an amount of nothing never carries
   * a sign. `-0` is equal under `===` and unequal under `Object.is`, so it
   * shows up exactly where it is expensive and nowhere else.
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
