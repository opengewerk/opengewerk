import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import type { DocumentKind } from '../model/document.js'
import type {
  DeductionContent,
  DocumentContent,
  IssuerContent,
  LineContent,
} from '../model/document-content.js'
import { cancellationOf } from './cancellation.js'
import { documentContent } from './document-content.js'
import { missingDetails } from './mandatory-details.js'
import { RuleError } from './rule.js'
import { shippedRules } from './shipped.js'
import { type VatRate, vatRates } from './tax.js'

/**
 * The cancellation of #74. What has to hold is that it takes back exactly what
 * the invoice billed, to the cent, including what a cumulative invoice
 * deducted, and that it says which invoice it takes back.
 */

const rules = shippedRules

const issuer: IssuerContent = {
  name: 'Elektro Nord GmbH',
  street: 'Hafenstraße',
  houseNumber: '12',
  postalCode: '20457',
  city: 'Hamburg',
  country: 'DE',
  phone: null,
  email: null,
  website: null,
  taxNumber: '22/815/08154',
  vatId: null,
  iban: null,
  bic: null,
  bankName: null,
  registerCourt: null,
  registerNumber: null,
  managingDirectors: null,
  logo: null,
}

function line(
  position: number,
  netCents: number,
  vatRate: VatRate = 'standard',
  quantityMilli = 1000,
): LineContent {
  return {
    kind: 'item',
    position,
    designation: `Position ${String(position)}`,
    description: null,
    quantityMilli,
    unit: 'piece',
    unitPriceCents: netCents,
    vatRate,
    netCents,
  }
}

function invoice(
  lines: readonly LineContent[],
  deductions: readonly DeductionContent[] = [],
  kind: DocumentKind = 'final_invoice',
): DocumentContent {
  return documentContent(rules, {
    document: {
      kind,
      number: 'RE-2026-0042',
      documentDate: '2026-09-18',
      serviceFrom: '2026-09-01',
      serviceUntil: '2026-09-15',
      subject: 'Unterverteilung Werkstatt',
      introText: 'Vielen Dank für Ihren Auftrag.',
      closingText: 'Mit freundlichen Grüßen',
      taxTreatment: 'standard',
    },
    lines,
    issuer,
    recipient: {
      name: 'Familie Berg',
      street: 'Lindenweg',
      houseNumber: '3',
      postalCode: '22301',
      city: 'Hamburg',
      country: 'DE',
      isBusiness: false,
      email: null,
      vatId: null,
      buyerReference: null,
    },
    site: null,
    signature: null,
    cashAccounting: false,
    deductions,
    paymentTermDays: 14,
    instructions: [],
  })
}

/** What a progress invoice billed, as a final invoice deducts it. */
function billedBy(progress: DocumentContent, number: string): DeductionContent {
  return {
    number,
    documentDate: progress.documentDate,
    taxTreatment: progress.taxTreatment,
    billed: progress.billed,
  }
}

const today = { number: 'RE-2026-0050', documentDate: '2026-09-21', issuer } as const

describe('a cancellation', () => {
  it('turns every figure round and names the invoice it takes back', () => {
    const progress = invoice([line(1, 40_000)], [], 'progress_invoice')
    const original = invoice(
      [line(1, 100_000), line(2, 20_000, 'reduced')],
      [billedBy(progress, 'RE-2026-0041')],
    )
    const storno = cancellationOf(original, { ...today, issuer: { ...issuer, city: 'Lübeck' } })

    expect(storno).toMatchObject({
      kind: 'cancellation_invoice',
      number: 'RE-2026-0050',
      documentDate: '2026-09-21',
      corrects: { kind: 'final_invoice', number: 'RE-2026-0042', documentDate: '2026-09-18' },
      // The work it concerns stays that invoice's work.
      serviceFrom: '2026-09-01',
      serviceUntil: '2026-09-15',
      subject: 'Unterverteilung Werkstatt',
      introText: null,
      closingText: null,
    })
    expect(storno.issuer.city).toBe('Lübeck')
    expect(storno.recipient).toEqual(original.recipient)
    expect(storno.notes).toEqual(original.notes)

    expect(
      storno.lines.map((one) => [one.quantityMilli, one.unitPriceCents, one.netCents]),
    ).toEqual([
      [-1000, 100_000, -100_000],
      [-1000, 20_000, -20_000],
    ])
    expect(storno.totals.grossCents).toBe(-original.totals.grossCents)
    expect(storno.deductions[0]?.number).toBe('RE-2026-0041')
    expect(storno.deductions[0]?.billed.grossCents).toBe(-progress.billed.grossCents)
    expect(storno.billed.grossCents).toBe(-original.billed.grossCents)

    // The invoice asked to be paid by a day. The cancellation asks for nothing,
    // and it does not carry the invoice's due date along as if it did.
    expect(original.paymentTerm).toEqual({ days: 14, dueOn: '2026-10-02' })
    expect(storno.paymentTerm).toBeNull()
  })

  it('takes back exactly what was billed, whatever the invoice and its deductions', () => {
    const amount = fc.integer({ min: -2_000_000, max: 20_000_000 })
    const rate: fc.Arbitrary<VatRate> = fc.constantFrom(...vatRates)
    const lines = fc.array(fc.tuple(amount, rate), { minLength: 1, maxLength: 8 })

    fc.assert(
      fc.property(lines, lines, (earlier, later) => {
        const progress = invoice(
          earlier.map(([net, which], index) => line(index + 1, net, which)),
          [],
          'progress_invoice',
        )
        const original = invoice(
          later.map(([net, which], index) => line(index + 1, net, which)),
          [billedBy(progress, 'RE-2026-0001')],
        )
        const storno = cancellationOf(original, today)

        for (const pick of [
          (content: DocumentContent) => content.billed.netCents,
          (content: DocumentContent) => content.billed.taxCents,
          (content: DocumentContent) => content.billed.grossCents,
          (content: DocumentContent) => content.totals.grossCents,
          (content: DocumentContent) => content.lines.reduce((sum, one) => sum + one.netCents, 0),
        ]) {
          expect(pick(original) + pick(storno)).toBe(0)
        }

        for (const [index, entry] of original.billed.byRate.entries()) {
          expect(entry.taxCents + (storno.billed.byRate[index]?.taxCents ?? 0)).toBe(0)
        }
      }),
    )
  })

  it('is made out of an issued invoice and out of nothing else', () => {
    const quote = invoice([line(1, 1000)], [], 'quote')
    const draft = { ...invoice([line(1, 1000)]), number: null }
    const cancellation = cancellationOf(invoice([line(1, 1000)]), today)

    expect(() => cancellationOf(quote, today)).toThrow(RuleError)
    expect(() => cancellationOf(draft, today)).toThrow(RuleError)
    // A cancellation of a cancellation would bring back an invoice that is in
    // the books as cancelled.
    expect(() => cancellationOf(cancellation, today)).toThrow(RuleError)
  })
})

describe('the mandatory details of a cancellation', () => {
  it('ask for the invoice it takes back, and not for the time of the work', () => {
    const storno = cancellationOf(invoice([line(1, 100_000)]), today)

    expect(missingDetails(rules, storno)).toEqual([])

    const unnamed = { ...storno, corrects: null, serviceFrom: null, serviceUntil: null }

    expect(missingDetails(rules, unnamed).map((one) => one.detail)).toEqual(['corrected_invoice'])
  })
})
