import type { IsoDate } from '@opengewerk/platform-domain'
import { describe, expect, it } from 'vitest'

import { shippedRules } from '../rules/shipped.js'
import { personErasureLabel, sicknessErasureLabel, staffYearErasureLabel } from './erasure.js'
import { retentionOf } from './retention.js'
import {
  personErasureDueOn,
  personHoldSentence,
  sicknessErasureDueOn,
  staffYearErasureDueOn,
} from './staff-erasure.js'

const today = '2026-11-04' as IsoDate

describe('when the staff fall due (#846)', () => {
  it('lets a sickness go a year after its last day, and not a day before', () => {
    expect(sicknessErasureDueOn('2025-10-14' as IsoDate, today, shippedRules)).toBe('2026-10-14')
    // The day after the 28th of February of a year without a 29th.
    expect(sicknessErasureDueOn('2024-02-29' as IsoDate, today, shippedRules)).toBe('2025-03-01')
  })

  it('lets the time and leave of a year go six years after its end, as papers of the payroll', () => {
    expect(staffYearErasureDueOn(2019, today, shippedRules)).toBe('2026-01-01')
    expect(staffYearErasureDueOn(2026, today, shippedRules)).toBe('2033-01-01')
  })

  it('keeps a year at least as long as the minimum wage and working time acts keep its last record', () => {
    // The last entry of a year may be written seven days later (§ 17 (1) MiLoG).
    const written = '2020-01-07' as IsoDate
    const year = staffYearErasureDueOn(2019, today, shippedRules)

    for (const kind of ['minimum_wage_records', 'working_time_records'] as const) {
      expect(year > retentionOf(kind, written, today, shippedRules).mayGoOn).toBe(true)
    }
  })

  it('lets the file of somebody who left go three years after the end of that year', () => {
    expect(personErasureDueOn('2022-06-30' as IsoDate, today, shippedRules)).toBe('2026-01-01')
    expect(personErasureDueOn('2022-12-31' as IsoDate, today, shippedRules)).toBe('2026-01-01')
    expect(personErasureDueOn('2023-01-01' as IsoDate, today, shippedRules)).toBe('2027-01-01')
  })

  it('names the source of each period', () => {
    expect(
      retentionOf('payroll_records', '2019-12-31' as IsoDate, today, shippedRules).source,
    ).toBe('§ 147 Abs. 1 Nr. 5, Abs. 3 Satz 1 AO; § 41 Abs. 1 Satz 9 EStG')
    expect(
      retentionOf('sickness_records', '2025-10-14' as IsoDate, today, shippedRules).source,
    ).toBe('§ 167 Abs. 2 Satz 1 SGB IX; § 3 Abs. 1 EFZG')
    expect(
      retentionOf('personnel_files', '2022-06-30' as IsoDate, today, shippedRules).source,
    ).toBe('§ 195, § 199 Abs. 1 BGB')
  })
})

describe('the staff as the deletion names them', () => {
  it('says the day, the year or the day of leaving, and nothing about who', () => {
    expect(sicknessErasureLabel('2025-10-14' as IsoDate)).toBe('Krankheit, letzter Tag 14.10.2025')
    expect(staffYearErasureLabel(2019)).toBe('Arbeitszeiten und Urlaub 2019')
    expect(personErasureLabel('2022-06-30' as IsoDate)).toBe('Akte, Austritt 30.06.2022')
  })

  it('says why a file stays', () => {
    expect(personHoldSentence('access_open')).toBe(
      'Ihr Zugang hat keinen letzten Tag, der vorbei ist.',
    )
  })
})
