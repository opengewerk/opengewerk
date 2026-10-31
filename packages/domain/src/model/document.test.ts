import { describe, expect, it } from 'vitest'

import { permissionsOfRoles } from './authorization.js'
import {
  closesProgressInvoices,
  isSignable,
  mayDeleteDraft,
  repricedFrom,
  servicePeriodProblem,
  showsPrices,
} from './document.js'

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

/** Who may delete a draft (#786), decided on 30.10.2026. */
describe('deleting a draft', () => {
  const technician = new Set<string>(permissionsOfRoles(['technician']))
  const office = new Set<string>(permissionsOfRoles(['office']))
  const holding = (rights: ReadonlySet<string>) => (right: string) => rights.has(right)
  const draft = (createdBy: string | null) => ({ status: 'draft' as const, createdBy })

  it('is for whoever made it, and somebody else only with the right to delete drafts', () => {
    expect(mayDeleteDraft(draft('max'), 'max', holding(technician))).toBe(true)
    expect(mayDeleteDraft(draft('britta'), 'max', holding(technician))).toBe(false)
    expect(mayDeleteDraft(draft(null), 'max', holding(technician))).toBe(false)
    expect(mayDeleteDraft(draft('max'), 'britta', holding(office))).toBe(true)
    expect(mayDeleteDraft(draft(null), 'britta', holding(office))).toBe(true)
    expect(
      mayDeleteDraft(draft('britta'), 'max', holding(new Set([...technician, 'document.delete']))),
    ).toBe(true)
  })

  it('never takes a fixed or signed document, nor one without the right to write documents', () => {
    for (const status of ['signed', 'issued', 'cancelled'] as const) {
      expect(mayDeleteDraft({ status, createdBy: 'britta' }, 'britta', holding(office))).toBe(false)
    }

    expect(mayDeleteDraft(draft('max'), 'max', holding(new Set()))).toBe(false)
    expect(mayDeleteDraft(draft(null), null, holding(technician))).toBe(false)
  })

  it('is given to the owner and the office, and not to a technician', () => {
    expect(permissionsOfRoles(['owner'])).toContain('document.delete')
    expect(office.has('document.delete')).toBe(true)
    expect(technician.has('document.delete')).toBe(false)
  })
})

describe('a delivery note (#299)', () => {
  it('may be signed by its recipient, though it hangs at its order confirmation', () => {
    expect(isSignable({ kind: 'delivery_note', predecessorDocumentId: 'ab' })).toBe(true)
    // A report still signs only on its own, and nothing else signs at all.
    expect(isSignable({ kind: 'time_and_material_report', predecessorDocumentId: 'ab' })).toBe(
      false,
    )
    expect(isSignable({ kind: 'time_and_material_report', predecessorDocumentId: null })).toBe(true)
    expect(isSignable({ kind: 'order_confirmation', predecessorDocumentId: null })).toBe(false)
  })

  it('shows no prices, and the invoice out of it keeps those of the confirmation', () => {
    expect(showsPrices('delivery_note')).toBe(false)
    expect(repricedFrom('delivery_note')).toBe(false)
    expect(repricedFrom('time_and_material_report')).toBe(true)
  })
})
