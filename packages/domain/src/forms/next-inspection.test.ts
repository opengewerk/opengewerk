import { describe, expect, it } from 'vitest'

import type { FormDefinition } from './definition.js'
import {
  inspectionDueAfter,
  isNextInspection,
  nextInspectionField,
  nextInspectionOn,
} from './next-inspection.js'

/**
 * The next inspection a protocol names (#301): an interval in months in a
 * field of one key, counted from the day of the test. What the deadline
 * engine reminds of and what the paper says come from here.
 */

function protocol(field: Record<string, unknown> | null): FormDefinition {
  return {
    key: 'probe',
    version: 1,
    title: 'Probe',
    attachesTo: 'installation',
    sections: [
      {
        key: 'result',
        title: 'Ergebnis',
        fields: field === null ? [] : [field as never],
      },
    ],
  }
}

const months = {
  kind: 'number',
  key: 'next_inspection_months',
  label: 'Prüffrist bis zur nächsten Prüfung',
  unit: 'month',
  decimals: 0,
}

describe('the next inspection of a protocol', () => {
  it('is its interval in months after the day of the test', () => {
    expect(
      nextInspectionOn(protocol(months), { next_inspection_months: 48_000 }, '2026-09-18'),
    ).toBe('2030-09-18')
    expect(
      nextInspectionOn(protocol(months), { next_inspection_months: 12_000 }, '2026-11-02'),
    ).toBe('2027-11-02')
  })

  it('ends on the last day of a month too short for the day of the test', () => {
    expect(inspectionDueAfter('2028-02-29', 12_000)).toBe('2029-02-28')
    expect(inspectionDueAfter('2026-08-31', 6_000)).toBe('2027-02-28')
  })

  it('is none without an interval to count with', () => {
    for (const value of [undefined, 0, 601_000, 47_500, -12_000, '48', true]) {
      expect(inspectionDueAfter('2026-09-18', value as never), String(value)).toBeNull()
    }

    expect(inspectionDueAfter('2026-09-18', 1_000)).toBe('2026-10-18')
    expect(inspectionDueAfter('2026-09-18', 600_000)).toBe('2076-09-18')
  })

  it('is named only by a number field of its key counted in months', () => {
    expect(nextInspectionField(protocol(months))).toEqual(months)
    expect(nextInspectionField(protocol(null))).toBeNull()
    expect(nextInspectionField(protocol({ ...months, unit: 'hour' }))).toBeNull()
    expect(nextInspectionField(protocol({ ...months, key: 'interval' }))).toBeNull()
    expect(isNextInspection({ ...months, kind: 'text' } as never)).toBe(false)
    // A value under the key counts only where the form names the field so.
    expect(
      nextInspectionOn(
        protocol({ ...months, unit: 'hour' }),
        { next_inspection_months: 48_000 },
        '2026-09-18',
      ),
    ).toBeNull()
    expect(
      nextInspectionOn(
        protocol({ ...months, key: 'interval' }),
        { interval: 48_000 },
        '2026-09-18',
      ),
    ).toBeNull()
  })
})
