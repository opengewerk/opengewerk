import type { IsoDate } from '@opengewerk/platform-domain'
import { describe, expect, it } from 'vitest'

import type { CustomerId, DocumentId, JobId, ProspectId, SiteId } from './identifier.js'
import {
  conversionProblem,
  type PipelineDocument,
  type PipelineJob,
  pipelineOf,
  type PipelineProspect,
  prospectChangeProblem,
  prospectDeletionProblem,
  prospectProblems,
  siteDesignationOf,
} from './prospect.js'

const today = '2026-11-04' as IsoDate

const valid = {
  kind: 'private',
  name: 'Brandt, Familie',
  concern: 'PV-Anlage mit Speicher',
  email: null,
  phone: '06203 84 21 57',
  street: 'Kastanienweg',
  houseNumber: '9',
  postalCode: '68535',
  city: 'Edingen-Neckarhausen',
  country: 'DE',
  source: 'phone',
  stage: 'qualified',
  lastContactOn: '2026-11-03',
}

describe('the values of a lead', () => {
  it('takes a lead with a name, a source, a stage and a day of last contact', () => {
    expect(prospectProblems(valid, today)).toEqual({})
    expect(prospectProblems({ ...valid, lastContactOn: today }, today)).toEqual({})
  })

  it('asks for a name, a source and a stage', () => {
    const problems = prospectProblems({ ...valid, name: '  ', source: 'fair', stage: 'won' }, today)

    expect(problems['name']).toBe('Ein Lead braucht einen Namen.')
    expect(problems['source']).toBe('Woher der Lead kommt, fehlt.')
    expect(problems['stage']).toBe('Der Stand fehlt.')
  })

  it('refuses a last contact in the future or not a day', () => {
    expect(
      prospectProblems({ ...valid, lastContactOn: '2026-11-05' }, today)['lastContactOn'],
    ).toBe('Der letzte Kontakt liegt nicht in der Zukunft.')
    expect(
      prospectProblems({ ...valid, lastContactOn: '2026-02-30' }, today)['lastContactOn'],
    ).toBe('Der letzte Kontakt ist ein Tag.')
  })

  it('holds the length of a name and a concern, the kind and the country', () => {
    const problems = prospectProblems(
      {
        ...valid,
        name: 'x'.repeat(201),
        concern: 'x'.repeat(5001),
        kind: 'tenant',
        country: 'Germany',
      },
      today,
    )

    expect(Object.keys(problems).sort()).toEqual(['concern', 'country', 'kind', 'name'])
  })
})

describe('a lead that became a customer', () => {
  const converted = { customerId: 'c' as CustomerId, stage: 'qualified' as const }
  const open = { customerId: null, stage: 'qualified' as const }

  it('does not change, is not deleted on its own and does not become a customer again', () => {
    expect(prospectChangeProblem(converted)).toContain('Geändert wird jetzt der Kunde')
    expect(prospectDeletionProblem(converted)).toContain('bleibt als Nachweis')
    expect(conversionProblem(converted)).toBe('Aus diesem Lead ist schon ein Kunde geworden.')
  })

  it('leaves an open lead free to change, to delete and to convert', () => {
    expect(prospectChangeProblem(open)).toBeNull()
    expect(prospectDeletionProblem(open)).toBeNull()
    expect(conversionProblem(open)).toBeNull()
  })

  it('makes no customer out of a dismissed lead', () => {
    expect(conversionProblem({ customerId: null, stage: 'dismissed' })).toContain('abgesagt')
  })
})

describe('the name of the site of a converted lead', () => {
  it('is the street and number, else the place, else the name', () => {
    const lead = {
      name: 'Brandt, Familie',
      street: 'Kastanienweg',
      houseNumber: '9',
      city: 'Edingen',
    }

    expect(siteDesignationOf(lead)).toBe('Kastanienweg 9')
    expect(siteDesignationOf({ ...lead, street: null, houseNumber: null })).toBe('Edingen')
    expect(siteDesignationOf({ ...lead, street: ' ', houseNumber: null, city: null })).toBe(
      'Brandt, Familie',
    )
  })
})

describe('the pipeline', () => {
  const customer = (n: number) => `customer-${String(n)}` as CustomerId
  let next = 0
  const doc = (
    values: Partial<PipelineDocument> & Pick<PipelineDocument, 'kind'>,
  ): PipelineDocument => ({
    id: `doc-${String(++next)}` as DocumentId,
    status: 'issued',
    customerId: customer(1),
    siteId: 'site-1' as SiteId,
    jobId: null,
    predecessorDocumentId: null,
    issuedAt: '2026-10-21T09:00:00Z',
    ...values,
  })
  const lead = (values: Partial<PipelineProspect>): PipelineProspect => ({
    id: `lead-${String(++next)}` as ProspectId,
    stage: 'new',
    lastContactOn: '2026-11-01' as IsoDate,
    customerId: null,
    convertedAt: null,
    ...values,
  })
  const of = (
    documents: readonly PipelineDocument[],
    jobs: readonly PipelineJob[] = [],
    prospects: readonly PipelineProspect[] = [],
  ) => pipelineOf({ prospects, documents, jobs, today })

  it('keeps an issued quote that nothing issued follows under "Angebot", from the day it was issued', () => {
    const quote = doc({ kind: 'quote' })
    const draft = doc({
      kind: 'order_confirmation',
      status: 'draft',
      issuedAt: null,
      predecessorDocumentId: quote.id,
    })
    const pipeline = of([quote, draft])

    expect(pipeline.offer).toEqual([
      expect.objectContaining({ headId: quote.id, shownId: quote.id, since: '2026-10-21' }),
    ])
    expect(pipeline.order).toEqual([])
  })

  it('takes a cost estimate as an offer and leaves a draft quote out', () => {
    const estimate = doc({ kind: 'cost_estimate' })
    const draft = doc({ kind: 'quote', status: 'draft', issuedAt: null })

    expect(of([estimate, draft]).offer.map((deal) => deal.headId)).toEqual([estimate.id])
  })

  it('moves an offer to "Auftrag" with an issued order confirmation or invoice after it', () => {
    const quote = doc({ kind: 'quote' })
    const confirmation = doc({
      kind: 'order_confirmation',
      predecessorDocumentId: quote.id,
      issuedAt: '2026-10-28T10:00:00Z',
    })
    const other = doc({ kind: 'quote', customerId: customer(2) })
    const progress = doc({
      kind: 'progress_invoice',
      predecessorDocumentId: other.id,
      customerId: customer(2),
    })
    const pipeline = of([quote, confirmation, other, progress])

    expect(pipeline.offer).toEqual([])
    // Oldest first: the progress invoice came on 21.10., the confirmation on 28.10.
    expect(pipeline.order).toEqual([
      expect.objectContaining({ headId: other.id, shownId: other.id, since: '2026-10-21' }),
      expect.objectContaining({ headId: quote.id, shownId: confirmation.id, since: '2026-10-28' }),
    ])
  })

  it('takes an order confirmation without an offer as an order', () => {
    const confirmation = doc({ kind: 'order_confirmation' })

    expect(of([confirmation]).order.map((deal) => deal.headId)).toEqual([confirmation.id])
  })

  it('closes a deal with its final invoice or its completed job, for the last 90 days', () => {
    const quote = doc({ kind: 'quote', jobId: 'job-1' as JobId })
    const confirmation = doc({ kind: 'order_confirmation', predecessorDocumentId: quote.id })
    const invoice = doc({
      kind: 'final_invoice',
      predecessorDocumentId: confirmation.id,
      issuedAt: '2026-10-22T08:00:00Z',
    })
    const older = doc({
      kind: 'order_confirmation',
      jobId: 'job-2' as JobId,
      customerId: customer(2),
    })
    const jobs: PipelineJob[] = [
      { id: 'job-1' as JobId, status: 'active', closedAt: null },
      { id: 'job-2' as JobId, status: 'completed', closedAt: '2026-08-01T12:00:00Z' },
    ]
    const pipeline = of([quote, confirmation, invoice, older], jobs)

    expect(pipeline.done).toEqual([
      expect.objectContaining({ headId: quote.id, shownId: invoice.id, since: '2026-10-22' }),
    ])
    // Closed before the 90 days, so in no column.
    expect(pipeline.order).toEqual([])
    expect(
      pipelineOf({ prospects: [], documents: [older], jobs, today, doneDays: 120 }).done,
    ).toHaveLength(1)
  })

  it('closes an offer a maintenance contract was made out of, on the day it was made', () => {
    const quote = doc({ kind: 'quote' })
    const pipeline = pipelineOf({
      prospects: [],
      documents: [quote],
      jobs: [],
      contracts: [{ quoteId: quote.id, since: '2026-10-30' as IsoDate }],
      today,
    })

    expect(pipeline.offer).toEqual([])
    expect(pipeline.done).toEqual([
      expect.objectContaining({ headId: quote.id, shownId: quote.id, since: '2026-10-30' }),
    ])
  })

  it('takes a cancelled job, a cancelled document and a cancelled successor out of the chain', () => {
    const quote = doc({ kind: 'quote', jobId: 'job-3' as JobId })
    const cancelledQuote = doc({ kind: 'quote', status: 'cancelled', customerId: customer(2) })
    const other = doc({ kind: 'quote', customerId: customer(3) })
    const cancelledInvoice = doc({
      kind: 'final_invoice',
      status: 'cancelled',
      predecessorDocumentId: other.id,
      customerId: customer(3),
    })
    const pipeline = of(
      [quote, cancelledQuote, other, cancelledInvoice],
      [{ id: 'job-3' as JobId, status: 'cancelled', closedAt: null }],
    )

    expect(pipeline.offer.map((deal) => deal.headId)).toEqual([other.id])
    expect(pipeline.done).toEqual([])
  })

  it('follows the invoice that replaced a cancelled one, not the cancelled one or its cancellation', () => {
    const quote = doc({ kind: 'quote' })
    const cancelled = doc({
      kind: 'final_invoice',
      status: 'cancelled',
      predecessorDocumentId: quote.id,
    })
    const cancellation = doc({
      kind: 'cancellation_invoice',
      predecessorDocumentId: cancelled.id,
      issuedAt: '2026-10-25T08:00:00Z',
    })
    const replacement = doc({
      kind: 'final_invoice',
      predecessorDocumentId: quote.id,
      issuedAt: '2026-10-26T08:00:00Z',
    })
    const pipeline = of([quote, cancelled, cancellation, replacement])

    expect(pipeline.done).toEqual([
      expect.objectContaining({ headId: quote.id, shownId: replacement.id, since: '2026-10-26' }),
    ])
    expect(pipeline.order).toEqual([])
  })

  it('shows the open leads by stage, a customer of a lead until it has an offer, and no dismissed lead', () => {
    const fresh = lead({ stage: 'new', lastContactOn: '2026-11-04' as IsoDate })
    const older = lead({ stage: 'new', lastContactOn: '2026-11-03' as IsoDate })
    const talking = lead({ stage: 'contacted' })
    const qualified = lead({ stage: 'qualified' })
    const dismissed = lead({ stage: 'dismissed' })
    const customerOnly = lead({
      stage: 'qualified',
      customerId: customer(7),
      convertedAt: '2026-10-30T09:00:00Z',
    })
    const withOffer = lead({
      stage: 'qualified',
      customerId: customer(8),
      convertedAt: '2026-10-30T09:00:00Z',
    })
    const offer = doc({ kind: 'quote', customerId: customer(8) })
    const pipeline = of(
      [offer],
      [],
      [qualified, dismissed, customerOnly, talking, older, withOffer, fresh],
    )

    expect(pipeline.lead.map((entry) => entry.prospectId)).toEqual([
      fresh.id,
      older.id,
      talking.id,
      qualified.id,
      customerOnly.id,
    ])
    expect(pipeline.offer.map((deal) => deal.customerId)).toEqual([customer(8)])
  })

  it('sorts offers and orders oldest first and the closed newest first', () => {
    const late = doc({ kind: 'quote', issuedAt: '2026-10-30T09:00:00Z' })
    const early = doc({ kind: 'quote', issuedAt: '2026-10-21T09:00:00Z' })

    expect(of([late, early]).offer.map((deal) => deal.headId)).toEqual([early.id, late.id])
  })
})
