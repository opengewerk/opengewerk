import type { IsoDate } from '@opengewerk/platform-domain'
import { describe, expect, it } from 'vitest'

import { shippedRules } from '../rules/shipped.js'
import {
  answerDueOf,
  type CustomerFacts,
  customerErasureDueOn,
  customerHolds,
  customerHoldSentence,
  documentRetentionKind,
  erasureRequestAnswer,
  erasureRequestProblem,
} from './customer-erasure.js'

const today = '2026-11-04' as IsoDate
const day = (value: string) => value as IsoDate

const nothing: CustomerFacts = {
  documents: [],
  warrantiesEndOn: [],
  openJobs: 0,
  runningContracts: 0,
}

describe('the retention of a document', () => {
  it('keeps every invoice, credit note and cancellation as a booking voucher', () => {
    for (const kind of [
      'progress_invoice',
      'partial_invoice',
      'final_invoice',
      'credit_note',
      'cancellation_invoice',
      'recurring_invoice',
    ] as const) {
      expect(documentRetentionKind(kind, 'issued')).toBe('booking_vouchers')
      expect(documentRetentionKind(kind, 'cancelled')).toBe('booking_vouchers')
    }
  })

  it('keeps every other fixed or signed document as a business letter', () => {
    expect(documentRetentionKind('quote', 'issued')).toBe('business_letters')
    expect(documentRetentionKind('time_and_material_report', 'signed')).toBe('business_letters')
    expect(documentRetentionKind('delivery_note', 'signed')).toBe('business_letters')
  })

  it('keeps no draft', () => {
    expect(documentRetentionKind('final_invoice', 'draft')).toBeNull()
    expect(documentRetentionKind('quote', 'draft')).toBeNull()
  })
})

describe('what holds a customer', () => {
  it('is nothing when nothing runs', () => {
    expect(customerHolds(nothing, today, shippedRules)).toEqual([])
  })

  it('is an invoice until the end of the eighth year after its own', () => {
    const facts: CustomerFacts = {
      ...nothing,
      documents: [
        { kind: 'final_invoice', status: 'issued', documentDate: day('2020-05-04') },
        { kind: 'quote', status: 'issued', documentDate: day('2024-02-01') },
        { kind: 'final_invoice', status: 'draft', documentDate: day('2026-10-01') },
      ],
    }

    // The invoice of 2020 is kept to the end of 2028, the quote of 2024 for
    // six years to the end of 2030; the draft keeps nothing.
    expect(customerHolds(facts, today, shippedRules)).toEqual([
      { kind: 'retention', until: '2030-12-31' },
    ])
  })

  it('is no longer a document whose last day has passed', () => {
    const facts: CustomerFacts = {
      ...nothing,
      documents: [{ kind: 'final_invoice', status: 'issued', documentDate: day('2017-06-01') }],
    }

    expect(customerHolds(facts, today, shippedRules)).toEqual([])
    expect(customerHolds(facts, day('2025-12-31'), shippedRules)).toEqual([
      { kind: 'retention', until: '2025-12-31' },
    ])
  })

  it('is the latest warranty while it runs', () => {
    const facts: CustomerFacts = {
      ...nothing,
      warrantiesEndOn: [day('2027-03-01'), day('2029-08-15'), day('2025-01-01')],
    }

    expect(customerHolds(facts, today, shippedRules)).toEqual([
      { kind: 'warranty', until: '2029-08-15' },
    ])
    expect(customerHolds(facts, day('2029-08-16'), shippedRules)).toEqual([])
  })

  it('is an open job or a running contract, on no day', () => {
    expect(customerHolds({ ...nothing, openJobs: 1 }, today, shippedRules)).toEqual([
      { kind: 'open_job', until: null },
    ])
    expect(customerHolds({ ...nothing, runningContracts: 2 }, today, shippedRules)).toEqual([
      { kind: 'running_contract', until: null },
    ])
  })

  it('reads as a sentence for the office', () => {
    expect(customerHoldSentence({ kind: 'retention', until: day('2030-12-31') })).toBe(
      'Belege sind bis 31.12.2030 aufzubewahren.',
    )
    expect(customerHoldSentence({ kind: 'warranty', until: day('2029-08-15') })).toBe(
      'Die Gewährleistung läuft bis 15.08.2029.',
    )
    expect(customerHoldSentence({ kind: 'open_job', until: null })).toBe(
      'Ein Auftrag ist noch offen.',
    )
  })
})

describe('when a customer falls due', () => {
  it('is the months without contact when nothing holds it', () => {
    expect(
      customerErasureDueOn({
        holds: [],
        lastContactOn: day('2023-03-31'),
        contactMonths: 36,
        requestedOn: null,
      }),
    ).toBe('2026-03-31')
  })

  it('is the day after the last hold when that is later', () => {
    expect(
      customerErasureDueOn({
        holds: [
          { kind: 'retention', until: day('2030-12-31') },
          { kind: 'warranty', until: day('2028-05-01') },
        ],
        lastContactOn: day('2023-03-31'),
        contactMonths: 36,
        requestedOn: null,
      }),
    ).toBe('2031-01-01')
  })

  it('is the day it asked, without the months, when nothing holds it', () => {
    expect(
      customerErasureDueOn({
        holds: [],
        lastContactOn: day('2026-10-30'),
        contactMonths: 36,
        requestedOn: day('2026-11-02'),
      }),
    ).toBe('2026-11-02')
    expect(
      customerErasureDueOn({
        holds: [{ kind: 'warranty', until: day('2027-01-31') }],
        lastContactOn: day('2026-10-30'),
        contactMonths: 36,
        requestedOn: day('2026-11-02'),
      }),
    ).toBe('2027-02-01')
  })

  it('is no day while a job or a contract runs', () => {
    expect(
      customerErasureDueOn({
        holds: [{ kind: 'running_contract', until: null }],
        lastContactOn: day('2020-01-01'),
        contactMonths: 36,
        requestedOn: day('2026-11-02'),
      }),
    ).toBeNull()
  })
})

describe('a request for deletion', () => {
  it('is answered within a month, on the last day of a shorter one', () => {
    expect(answerDueOf(day('2026-11-04'))).toBe('2026-12-04')
    expect(answerDueOf(day('2027-01-31'))).toBe('2027-02-28')
  })

  it('is answered by erasing when nothing holds, by restricting while a paper does, else not yet', () => {
    expect(erasureRequestAnswer([])).toBe('erase')
    expect(erasureRequestAnswer([{ kind: 'retention', until: day('2030-12-31') }])).toBe('restrict')
    expect(
      erasureRequestAnswer([
        { kind: 'retention', until: day('2030-12-31') },
        { kind: 'open_job', until: null },
      ]),
    ).toBeNull()
  })

  it('is recorded with the day it came in and how', () => {
    expect(erasureRequestProblem({ receivedOn: '2026-11-03', channel: 'email' }, today)).toBeNull()
    expect(erasureRequestProblem({ receivedOn: '2026-11-05', channel: 'email' }, today)).toContain(
      'Zukunft',
    )
    expect(erasureRequestProblem({ receivedOn: '2026-02-30', channel: 'email' }, today)).toContain(
      'kein Tag',
    )
    expect(erasureRequestProblem({ receivedOn: '2026-11-03', channel: 'fax' }, today)).toContain(
      'keiner der Wege',
    )
    expect(erasureRequestProblem(null, today)).toContain('kein Tag')
  })
})
