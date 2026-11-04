import type { IsoDate } from '@opengewerk/platform-domain'
import { describe, expect, it } from 'vitest'

import { shippedRules } from '../rules/shipped.js'
import { retentionKinds, retentionKindWords, retentionOf } from './retention.js'

const today = '2026-11-04' as IsoDate

describe('how long a paper is kept', () => {
  it('counts the booking vouchers eight years from the end of their year', () => {
    const kept = retentionOf('booking_vouchers', '2026-03-01' as IsoDate, today, shippedRules)

    expect(kept).toMatchObject({ years: 8, lastDay: '2034-12-31', mayGoOn: '2035-01-01' })
    expect(kept.source).toContain('§ 147 Abs. 1 Nr. 4')
    expect(kept.source).toContain('§ 14b')
  })

  it('takes the period in force on the day it is asked, as the transition of 2025 says', () => {
    // A voucher of 2016 had to stay until the end of 2026 under the old ten
    // years; under the eight years in force since 2025 it was free to go from
    // its first day (Art. 97 section 19a (2) EGAO).
    const voucher = '2016-06-30' as IsoDate

    expect(
      retentionOf('booking_vouchers', voucher, '2024-12-31' as IsoDate, shippedRules),
    ).toMatchObject({
      years: 10,
      lastDay: '2026-12-31',
    })
    expect(
      retentionOf('booking_vouchers', voucher, '2025-01-02' as IsoDate, shippedRules),
    ).toMatchObject({
      years: 8,
      lastDay: '2024-12-31',
      mayGoOn: '2025-01-01',
    })
  })

  it('keeps the books ten years and the business letters six', () => {
    expect(retentionOf('books', '2026-12-31' as IsoDate, today, shippedRules).lastDay).toBe(
      '2036-12-31',
    )
    expect(
      retentionOf('business_letters', '2026-01-01' as IsoDate, today, shippedRules).lastDay,
    ).toBe('2032-12-31')
    expect(
      retentionOf('other_tax_documents', '2026-07-15' as IsoDate, today, shippedRules).mayGoOn,
    ).toBe('2033-01-01')
  })

  it('counts the records of time from their own day, that day included', () => {
    expect(
      retentionOf('minimum_wage_records', '2026-03-01' as IsoDate, today, shippedRules),
    ).toMatchObject({
      years: 2,
      lastDay: '2028-02-29',
      mayGoOn: '2028-03-01',
    })
    expect(
      retentionOf('working_time_records', '2026-11-04' as IsoDate, today, shippedRules),
    ).toMatchObject({
      lastDay: '2028-11-03',
      mayGoOn: '2028-11-04',
    })
  })

  it('ends a period from the 29th of February on the 28th in a year without one', () => {
    expect(
      retentionOf(
        'minimum_wage_records',
        '2024-02-29' as IsoDate,
        '2024-03-01' as IsoDate,
        shippedRules,
      ),
    ).toMatchObject({
      lastDay: '2026-02-28',
      mayGoOn: '2026-03-01',
    })
  })

  it('has a period in years with its source for every kind today', () => {
    for (const kind of retentionKinds) {
      const rule = shippedRules.at(retentionKindWords[kind].rule, today)

      expect({ kind, unit: rule?.unit, sourced: (rule?.source.length ?? 0) > 0 }).toEqual({
        kind,
        unit: 'years',
        sourced: true,
      })
    }
  })

  it('says so rather than guessing where no period was in force', () => {
    expect(() =>
      retentionOf(
        'minimum_wage_records',
        '2014-06-01' as IsoDate,
        '2014-06-01' as IsoDate,
        shippedRules,
      ),
    ).toThrow('No retention period')
  })
})
