import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import type { IsoDate } from '../model/identifier.js'
import { addDays, lateFrom, lateInterestOn } from './payment.js'
import { applyRate, RuleError, type RuleRecord, ruleSet } from './rule.js'
import { tenantParameterKeys, tenantParameterUnits } from './parameter.js'
import { rulePackages, shippedRules } from './shipped.js'
import { vatOn, withinSmallBusinessLimits } from './tax.js'

function record(over: Partial<RuleRecord> = {}): RuleRecord {
  return {
    key: 'probe.value',
    validFrom: '2020-01-01' as IsoDate,
    validUntil: null,
    unit: 'basis_points',
    value: 100,
    source: 'Nur für den Test',
    ...over,
  }
}

describe('the same document under two states of the law', () => {
  it('comes out differently, and each time by the rules of its own day', () => {
    // The acceptance test for this issue, and a real case rather than an
    // invented one: the standard rate was lowered to sixteen percent for the
    // second half of 2020 and went back to nineteen on the first of January.
    const netCents = 100_000

    const inTheDip = vatOn(shippedRules, { netCents, rate: 'standard' }, '2020-08-01' as IsoDate)
    const after = vatOn(shippedRules, { netCents, rate: 'standard' }, '2021-01-01' as IsoDate)

    expect(inTheDip.basisPoints).toBe(1600)
    expect(inTheDip.taxCents).toBe(16_000)
    expect(after.basisPoints).toBe(1900)
    expect(after.taxCents).toBe(19_000)
  })

  it('does not change its mind years later', () => {
    // Nothing in the calculation knows what today is. That single absence is
    // what makes an invoice from 2020 still an invoice from 2020 in 2030.
    const first = vatOn(shippedRules, { netCents: 4321, rate: 'reduced' }, '2020-09-15' as IsoDate)
    const again = vatOn(shippedRules, { netCents: 4321, rate: 'reduced' }, '2020-09-15' as IsoDate)

    expect(first).toEqual(again)
    expect(first.basisPoints).toBe(500)
  })
})

describe('a new rate', () => {
  it('is a record and not a release', () => {
    // The other acceptance test. Nothing below touches a line of logic: the
    // same functions, a set with one more entry in it, a different answer.
    const withoutIt = ruleSet(shippedRules.all())
    const invented = '2030-01-01' as IsoDate

    expect(() => vatOn(withoutIt, { netCents: 1000, rate: 'standard' }, invented)).not.toThrow()
    expect(vatOn(withoutIt, { netCents: 1000, rate: 'standard' }, invented).basisPoints).toBe(1900)

    const withIt = ruleSet([
      ...shippedRules
        .all()
        .map((entry) =>
          entry.key === 'vat.standard' && entry.validUntil === null
            ? { ...entry, validUntil: '2029-12-31' as IsoDate }
            : entry,
        ),
      record({
        key: 'vat.standard',
        validFrom: invented,
        value: 2000,
        source: 'Erfunden, nur für diesen Test',
      }),
    ])

    expect(vatOn(withIt, { netCents: 1000, rate: 'standard' }, invented).basisPoints).toBe(2000)
    // And the old document is untouched by it.
    expect(
      vatOn(withIt, { netCents: 1000, rate: 'standard' }, '2021-01-01' as IsoDate).basisPoints,
    ).toBe(1900)
  })
})

describe('a set of rules', () => {
  it('refuses two that would apply on the same day', () => {
    // Not when somebody looks it up, but when the set is built. Two rates in
    // force at once is not a question with an answer, and finding that out
    // during a month end close would be the worst possible moment.
    expect(() =>
      ruleSet([
        record({ validFrom: '2020-01-01' as IsoDate, validUntil: null }),
        record({ validFrom: '2021-01-01' as IsoDate }),
      ]),
    ).toThrow(RuleError)
  })

  it('accepts two that follow one another', () => {
    expect(() =>
      ruleSet([
        record({ validFrom: '2020-01-01' as IsoDate, validUntil: '2020-12-31' as IsoDate }),
        record({ validFrom: '2021-01-01' as IsoDate }),
      ]),
    ).not.toThrow()
  })

  it('refuses a period that ends before it starts', () => {
    expect(() =>
      ruleSet([
        record({ validFrom: '2021-01-01' as IsoDate, validUntil: '2020-12-31' as IsoDate }),
      ]),
    ).toThrow(RuleError)
  })

  it('refuses a value that is not a whole number', () => {
    // Nineteen percent as 0.19 is where the cents start going missing.
    expect(() => ruleSet([record({ value: 19.5 })])).toThrow(RuleError)
  })

  it('says nothing rather than something when no rule covers the day', () => {
    const rules = ruleSet([record({ validFrom: '2020-01-01' as IsoDate })])

    expect(rules.at('probe.value', '2019-12-31' as IsoDate)).toBeNull()
    expect(() => rules.valueAt('probe.value', 'basis_points', '2019-12-31' as IsoDate)).toThrow(
      /keine Regel/,
    )
  })

  it('refuses to hand out a value in a unit it is not kept in', () => {
    const rules = ruleSet([record({ unit: 'cents', value: 4000 })])

    expect(() => rules.valueAt('probe.value', 'basis_points', '2020-06-01' as IsoDate)).toThrow(
      /angegeben/,
    )
  })
})

describe('the packages that ship', () => {
  it('carry a paragraph for every single value', () => {
    // The difference between a number somebody can check and a number somebody
    // has to believe.
    const unsourced = shippedRules.all().filter((entry) => entry.source.trim().length === 0)

    expect(shippedRules.all().length).toBeGreaterThan(15)
    expect(unsourced).toEqual([])
  })

  it('say in the file itself where they stop', () => {
    for (const entry of rulePackages) {
      expect(entry.note.trim().length).toBeGreaterThan(0)
    }
  })

  it('leave no hole inside a run of one key', () => {
    // A hole is allowed at the end of a package, where knowledge stops. One in
    // the middle is a maintenance slip, and it would show up as an invoice
    // that cannot be calculated on one particular day.
    const byKey = new Map<string, RuleRecord[]>()

    for (const entry of shippedRules.all()) {
      byKey.set(entry.key, [...(byKey.get(entry.key) ?? []), entry])
    }

    const holes: string[] = []

    for (const [key, entries] of byKey) {
      const ordered = [...entries].sort((left, right) =>
        left.validFrom.localeCompare(right.validFrom),
      )

      for (let index = 1; index < ordered.length; index += 1) {
        const earlier = ordered[index - 1]
        const later = ordered[index]

        if (earlier?.validUntil && later && addDays(earlier.validUntil, 1) !== later.validFrom) {
          holes.push(`${key}: ${earlier.validUntil} bis ${later.validFrom}`)
        }
      }
    }

    expect(holes).toEqual([])
  })
})

describe('the tax on an amount', () => {
  it('rounds half a cent away from zero, the way a merchant does', () => {
    // 19 percent of 3.45 euro is 65.55 cents. A credit note has to mirror the
    // invoice it corrects rather than drift a cent away from it.
    expect(applyRate(345, 1900)).toBe(66)
    expect(applyRate(-345, 1900)).toBe(-66)
  })

  it('never loses a cent between net and gross', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100_000_000 }), (netCents) => {
        const taxed = vatOn(shippedRules, { netCents, rate: 'standard' }, '2026-09-18' as IsoDate)

        return taxed.grossCents === taxed.netCents + taxed.taxCents
      }),
    )
  })
})

describe('the small business limits', () => {
  it('are the ones of the year that is being asked about', () => {
    const turnover = { previousYearCents: 2_300_000, currentYearCents: 3_000_000 }

    // 23.000 euro was over the limit until the end of 2024 and under it from
    // 2025, and the same figures give opposite answers accordingly.
    expect(
      withinSmallBusinessLimits(shippedRules, turnover, '2024-06-01' as IsoDate),
    ).toMatchObject({ withinLimits: false, previousYearLimitCents: 2_200_000 })
    expect(
      withinSmallBusinessLimits(shippedRules, turnover, '2025-06-01' as IsoDate),
    ).toMatchObject({ withinLimits: true, previousYearLimitCents: 2_500_000 })
  })
})

describe('an invoice that was not paid', () => {
  it('falls late by a number of days that is a rule, not a constant', () => {
    expect(lateFrom(shippedRules, '2024-03-01' as IsoDate)).toBe('2024-03-31')
  })

  it('costs the base rate of its own half year plus the premium', () => {
    const owed = { principalCents: 1_000_000, days: 90, debtor: 'business' as const }

    const early = lateInterestOn(shippedRules, owed, '2024-03-01' as IsoDate)
    const later = lateInterestOn(shippedRules, owed, '2024-09-01' as IsoDate)

    // 3,62 plus 9 in the first half of 2024, 3,37 plus 9 in the second. The
    // Bundesbank sets that rate anew twice a year, and each time it is a line
    // in a data file rather than a release.
    expect(early.basisPoints).toBe(1262)
    expect(later.basisPoints).toBe(1237)
    expect(early.interestCents).toBeGreaterThan(later.interestCents)
    expect(early.flatFeeCents).toBe(4000)
  })

  it('costs a consumer less, and no flat fee', () => {
    const owed = { principalCents: 1_000_000, days: 90, debtor: 'consumer' as const }
    const interest = lateInterestOn(shippedRules, owed, '2024-03-01' as IsoDate)

    expect(interest.premiumBasisPoints).toBe(500)
    expect(interest.flatFeeCents).toBe(0)
  })

  it('gets no answer at all where no base rate has been entered', () => {
    // The package stops where the entered values stop, and the engine refuses
    // rather than inventing a rate. An invented interest rate on a real
    // invoice is worse than a missing one, and this is how the gap announces
    // itself: loudly, and before anything leaves the house.
    expect(() =>
      lateInterestOn(
        shippedRules,
        { principalCents: 1000, days: 30, debtor: 'business' },
        '2026-01-01' as IsoDate,
      ),
    ).toThrow(/base_rate/)
  })
})

describe('what a business sets and what the law sets', () => {
  it('do not share a single key', () => {
    // The seam, checked rather than asserted in a comment. If the two
    // namespaces ever met, a business could set a row that quietly moves a
    // legal threshold, and section 1.7 says in so many words that it cannot.
    const ruleKeys = new Set(shippedRules.keys())
    const overlap = tenantParameterKeys.filter((key) => ruleKeys.has(key))

    expect(ruleKeys.size).toBeGreaterThan(5)
    expect(overlap).toEqual([])
  })

  it('count in units that are declared, not guessed', () => {
    for (const key of tenantParameterKeys) {
      expect(tenantParameterUnits[key]).toBeDefined()
    }
  })
})
