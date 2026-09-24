import { describe, expect, it } from 'vitest'

import { closesProgressInvoices, servicePeriodProblem } from './document.js'

describe('a service period', () => {
  it('is a single day, a period in order, or nothing yet', () => {
    expect(servicePeriodProblem('2026-09-10', null)).toBeNull()
    expect(servicePeriodProblem('2026-09-10', '2026-09-10')).toBeNull()
    expect(servicePeriodProblem('2026-09-10', '2026-09-12')).toBeNull()
    expect(servicePeriodProblem(null, null)).toBeNull()
    expect(servicePeriodProblem('', '')).toBeNull()
  })

  it('has no last day without a first', () => {
    expect(servicePeriodProblem(null, '2026-09-12')).toBe(
      'Ein letzter Tag der Leistung braucht einen ersten.',
    )
    expect(servicePeriodProblem('', '2026-09-12')).toBe(
      'Ein letzter Tag der Leistung braucht einen ersten.',
    )
  })

  it('does not end before it begins', () => {
    expect(servicePeriodProblem('2026-09-10', '2026-09-05')).toBe(
      'Der letzte Tag der Leistung liegt vor dem ersten.',
    )
  })

  it('reads a timestamp and a date for the same day as the same day', () => {
    expect(servicePeriodProblem('2026-09-10T00:00:00.000Z', '2026-09-10')).toBeNull()
  })
})

describe('an invoice that closes a row of progress invoices', () => {
  const deduction = { number: 'RE-2026-0001' }

  it('is a final invoice with a progress invoice among its deductions', () => {
    expect(closesProgressInvoices({ kind: 'final_invoice', deductions: [deduction] })).toBe(true)
  })

  it('is not a final invoice without one, which is a plain invoice', () => {
    expect(closesProgressInvoices({ kind: 'final_invoice', deductions: [] })).toBe(false)
  })

  it('is not a progress invoice, whatever it takes off', () => {
    expect(closesProgressInvoices({ kind: 'progress_invoice', deductions: [deduction] })).toBe(
      false,
    )
  })
})
