import type { IsoDate } from '@opengewerk/platform-domain'
import { describe, expect, it } from 'vitest'

import type { CustomerId, DocumentId, SiteId } from './identifier.js'
import { declineRefusal, offerDeclineProblems } from './offer-decline.js'
import { pipelineOf } from './prospect.js'

const today = '2026-11-04' as IsoDate
const offeredOn = '2026-10-21' as IsoDate

describe('marking an offer as declined (#841)', () => {
  const open = { kind: 'quote', status: 'issued', followed: false, contracted: false } as const

  it('takes an issued quote or cost estimate that nothing follows', () => {
    expect(declineRefusal(open)).toBeNull()
    expect(declineRefusal({ ...open, kind: 'cost_estimate' })).toBeNull()
  })

  it('refuses a draft, an invoice, and an offer that a document or a contract follows', () => {
    expect(declineRefusal({ ...open, status: 'draft' })).toContain('festgeschriebenes')
    expect(declineRefusal({ ...open, kind: 'final_invoice' })).toContain('nur ein Angebot')
    expect(declineRefusal({ ...open, followed: true })).toContain('schon ein Beleg')
    expect(declineRefusal({ ...open, contracted: true })).toContain('Wartungsvertrag')
  })

  it('takes a day between the offer and today and a reason of at most 500 characters', () => {
    expect(
      offerDeclineProblems({ declinedOn: today, reason: 'Preis' }, { today, offeredOn }),
    ).toEqual({})
    expect(
      offerDeclineProblems({ declinedOn: offeredOn, reason: null }, { today, offeredOn }),
    ).toEqual({})
    expect(
      offerDeclineProblems({ declinedOn: '2026-11-05' }, { today, offeredOn })['declinedOn'],
    ).toBe('Der Tag der Ablehnung liegt nicht in der Zukunft.')
    expect(
      offerDeclineProblems({ declinedOn: '2026-10-20' }, { today, offeredOn })['declinedOn'],
    ).toBe('Abgelehnt wird ein Angebot nicht vor seinem Datum.')
    expect(
      offerDeclineProblems({ declinedOn: today, reason: 'x'.repeat(501) }, { today, offeredOn })[
        'reason'
      ],
    ).toContain('500')
  })

  it('takes a declined offer out of the pipeline, and leaves an ordered one where it is', () => {
    const offer = (id: string) => ({
      id: id as DocumentId,
      kind: 'quote' as const,
      status: 'issued' as const,
      customerId: 'c-1' as CustomerId,
      siteId: 's-1' as SiteId,
      jobId: null,
      predecessorDocumentId: null,
      issuedAt: '2026-10-21T09:00:00Z',
    })
    const kept = offer('q-1')
    const turnedDown = offer('q-2')
    const ordered = offer('q-3')
    const confirmation = {
      ...offer('ab-1'),
      kind: 'order_confirmation' as const,
      predecessorDocumentId: ordered.id,
    }
    const pipeline = pipelineOf({
      prospects: [],
      documents: [kept, turnedDown, ordered, confirmation],
      jobs: [],
      declined: [turnedDown.id, ordered.id],
      today,
    })

    expect(pipeline.offer.map((deal) => deal.headId)).toEqual([kept.id])
    expect(pipeline.order.map((deal) => deal.headId)).toEqual([ordered.id])
  })
})
