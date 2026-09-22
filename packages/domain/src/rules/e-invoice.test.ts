import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import type { IsoDate } from '../model/identifier.js'
import type { IssuerContent, LineContent, RecipientContent } from '../model/document-content.js'
import { type ContentSources, documentContent } from './document-content.js'
import { compactVatId, eInvoiceDuty, eInvoiceGaps, formatFor, supplyDateOf } from './e-invoice.js'
import { shippedRules } from './shipped.js'

/**
 * Which invoice goes out as an e-invoice, whether it has to, and what it
 * would lack.
 *
 * The borders again, because that is where the law is: a customer who is a
 * business and one who is not, an invoice of 250 euros and one of 251, work
 * done in December 2026 and invoiced in January 2027. The first test is the
 * one the issue asked for by name. It changes the customer and nothing else,
 * and the format follows.
 */

const rules = shippedRules

const issuer: IssuerContent = {
  name: 'Elektro Nord GmbH',
  street: 'Hafenstraße',
  houseNumber: '12',
  postalCode: '20457',
  city: 'Hamburg',
  country: 'DE',
  phone: '040 123456',
  email: 'rechnung@elektro-nord.de',
  website: null,
  taxNumber: '22/815/08154',
  vatId: 'DE123456789',
  iban: 'DE02120300000000202051',
  bic: null,
  bankName: null,
  registerCourt: null,
  registerNumber: null,
  managingDirectors: null,
  logo: null,
}

const business: RecipientContent = {
  name: 'Hausverwaltung Kramer GmbH',
  street: 'Mühlenkamp',
  houseNumber: '8',
  postalCode: '22303',
  city: 'Hamburg',
  country: 'DE',
  isBusiness: true,
  email: 'buchhaltung@kramer-hv.de',
  vatId: 'DE987654321',
  buyerReference: 'KST-4711',
}

function position(netCents: number): LineContent {
  return {
    kind: 'item',
    position: 1,
    designation: 'Unterverteilung setzen',
    description: null,
    quantityMilli: 1000,
    unit: 'flat_rate',
    unitPriceCents: netCents,
    vatRate: 'standard',
    netCents,
  }
}

/** A final invoice of 1.000 euros net to a business in Hamburg, unless told otherwise. */
function invoice(
  document: Partial<ContentSources['document']> = {},
  parts: {
    readonly netCents?: number
    readonly issuer?: Partial<IssuerContent>
    readonly recipient?: Partial<RecipientContent>
  } = {},
) {
  return documentContent(rules, {
    document: {
      kind: 'final_invoice',
      number: 'RE-2026-0001',
      documentDate: '2026-09-21',
      serviceFrom: '2026-09-01',
      serviceUntil: '2026-09-15',
      subject: null,
      introText: null,
      closingText: null,
      taxTreatment: 'standard',
      ...document,
    },
    lines: [position(parts.netCents ?? 100000)],
    issuer: { ...issuer, ...parts.issuer },
    recipient: { ...business, ...parts.recipient },
    site: null,
    signature: null,
    cashAccounting: false,
    deductions: [],
  })
}

describe('the format of an invoice', () => {
  it('comes from the customer and from nothing on the document', () => {
    // The same document twice, with the one difference in the master data.
    expect(formatFor(rules, invoice()).format).toBe('e_invoice')
    expect(formatFor(rules, invoice({}, { recipient: { isBusiness: false } })).format).toBe('pdf')

    // And everything the document itself carries leaves it where it is.
    for (const document of [
      { subject: 'Elektroinstallation Neubau', introText: 'Vielen Dank.' },
      { kind: 'progress_invoice' as const, serviceFrom: null, serviceUntil: null },
      { documentDate: '2028-02-01' as IsoDate, number: null },
    ]) {
      expect(formatFor(rules, invoice(document)).format).toBe('e_invoice')
      expect(formatFor(rules, invoice(document, { recipient: { isBusiness: false } })).format).toBe(
        'pdf',
      )
    }
  })

  it('says why, with the paragraph', () => {
    expect(formatFor(rules, invoice()).reason).toContain('§ 14 Abs. 2 Satz 2 Nr. 1 UStG')
    expect(formatFor(rules, invoice({}, { recipient: { isBusiness: false } })).reason).toContain(
      'kein Unternehmen',
    )
  })

  it('is a PDF for a customer abroad, and for a business that is not in Germany itself', () => {
    expect(formatFor(rules, invoice({}, { recipient: { country: 'AT' } }))).toMatchObject({
      format: 'pdf',
      reason: expect.stringContaining('nicht im Inland') as unknown,
    })
    expect(formatFor(rules, invoice({}, { issuer: { country: 'AT' } })).format).toBe('pdf')
  })

  it('is a PDF under the small business rule, which may send every invoice as one', () => {
    const choice = formatFor(rules, invoice({ taxTreatment: 'small_business' }))

    expect(choice).toMatchObject({ format: 'pdf' })
    expect(choice.reason).toContain('§ 34a Satz 4 UStDV')
    // A PDF needs the customer's consent, paper does not; the letter of the
    // ministry of 15 October 2025 says so at margin number 22.
    expect(choice.reason).toContain('§ 14 Abs. 1 Satz 5 UStG')
  })

  it('is a PDF up to 250 euros, and an e-invoice from one cent more', () => {
    // 210,08 net and 39,92 tax: exactly 250,00, the last amount that is small.
    const small = formatFor(rules, invoice({}, { netCents: 21008 }))

    expect(small.format).toBe('pdf')
    expect(small.reason).toBe(
      'Eine Rechnung bis 250 Euro darf immer als PDF gehen, wenn der Kunde zustimmt, sonst auf ' +
        'Papier (§ 33 Satz 4 UStDV, § 14 Abs. 1 Satz 5 UStG).',
    )
    expect(formatFor(rules, invoice({}, { netCents: 21009 })).format).toBe('e_invoice')
  })

  it('is an e-invoice for a small reverse charge, which never counts as a small amount', () => {
    expect(
      formatFor(rules, invoice({ taxTreatment: 'reverse_charge' }, { netCents: 10000 })).format,
    ).toBe('e_invoice')
  })

  it('is a PDF for everything that is not an invoice', () => {
    expect(formatFor(rules, invoice({ kind: 'quote' })).format).toBe('pdf')
    expect(formatFor(rules, invoice({ kind: 'time_and_material_report' })).format).toBe('pdf')
  })
})

describe('the duty', () => {
  function duty(supplied: IsoDate, written: IsoDate, claimed = false) {
    return eInvoiceDuty(
      rules,
      { documentDate: written, serviceFrom: null, serviceUntil: supplied },
      claimed,
    )
  }

  it('did not exist for work done before 2025', () => {
    expect(duty('2024-12-20', '2025-01-10').required).toBe(false)
  })

  it('waits for work of 2025 and 2026 that is invoiced by the end of 2026', () => {
    const waiting = duty('2026-09-15', '2026-09-21')

    expect(waiting.required).toBe(false)
    expect(waiting.reason).toContain('31.12.2026')
    expect(waiting.reason).toContain('§ 27 Abs. 38 Satz 1 Nr. 1 UStG')
  })

  it('catches work of December 2026 that is invoiced in January 2027, claim or not', () => {
    // Neither transition covers it: the first ends with 2026 for the invoice,
    // the second begins with 2027 for the work.
    expect(duty('2026-12-15', '2027-01-10').required).toBe(true)
    expect(duty('2026-12-15', '2027-01-10', true).required).toBe(true)
    expect(duty('2026-12-15', '2027-01-10').reason).toContain('31.12.2026')
  })

  it('waits in 2027 only for a business that claims to have stayed under the limit', () => {
    expect(duty('2027-03-10', '2027-03-15', true)).toMatchObject({ required: false })
    expect(duty('2027-03-10', '2027-03-15', true).reason).toContain('800.000 Euro')

    const required = duty('2027-03-10', '2027-03-15')

    expect(required.required).toBe(true)
    expect(required.reason).toContain('§ 27 Abs. 38 Satz 1 Nr. 2 UStG')
  })

  it('is there from 2028 on for everybody', () => {
    expect(duty('2028-01-10', '2028-01-12').required).toBe(true)
    expect(duty('2028-01-10', '2028-01-12', true).required).toBe(true)
    expect(duty('2028-01-10', '2028-01-12').reason).toContain('§ 14 Abs. 2 Satz 2 Nr. 1 UStG')
  })

  it('looks at the end of the work, and at the invoice date where no work date was entered', () => {
    expect(
      supplyDateOf({
        documentDate: '2027-02-01',
        serviceFrom: '2026-11-02',
        serviceUntil: '2027-01-20',
      }),
    ).toBe('2027-01-20')
    expect(
      supplyDateOf({ documentDate: '2027-02-01', serviceFrom: '2026-11-02', serviceUntil: null }),
    ).toBe('2026-11-02')
    expect(
      supplyDateOf({ documentDate: '2027-02-01', serviceFrom: null, serviceUntil: null }),
    ).toBe('2027-02-01')
  })

  it('can only be relaxed by the claim, never made stricter', () => {
    const day = fc
      .integer({ min: 0, max: 5 * 366 })
      .map(
        (offset) =>
          new Date(Date.UTC(2024, 6, 1) + offset * 86_400_000)
            .toISOString()
            .slice(0, 10) as IsoDate,
      )

    fc.assert(
      fc.property(day, fc.integer({ min: 0, max: 400 }), (supplied, delay) => {
        const written = new Date(Date.parse(supplied) + delay * 86_400_000)
          .toISOString()
          .slice(0, 10) as IsoDate
        const without = duty(supplied, written).required
        const withClaim = duty(supplied, written, true).required

        // Claiming can take the duty away, never add one, and before 2025 and
        // after 2027 it changes nothing at all.
        expect(withClaim && !without).toBe(false)

        if (supplied < '2025-01-01' || supplied >= '2028-01-01') {
          expect(withClaim).toBe(without)
        }
      }),
    )
  })
})

describe('what an e-invoice would lack', () => {
  it('is nothing for an invoice with everything', () => {
    expect(eInvoiceGaps(invoice(), 'en16931')).toEqual([])
    expect(eInvoiceGaps(invoice(), 'xrechnung')).toEqual([])
  })

  it('is an identifier that works across borders, the tax number alone is not one', () => {
    const onlyTaxNumber = invoice({}, { issuer: { vatId: null, registerNumber: null } })

    expect(eInvoiceGaps(onlyTaxNumber, 'en16931').map((gap) => gap.detail)).toEqual([
      'issuer_identifier',
    ])
    expect(eInvoiceGaps(onlyTaxNumber, 'en16931')[0]?.message).toContain('BR-CO-26')

    // The entry in the commercial register is enough on its own.
    expect(
      eInvoiceGaps(
        invoice({}, { issuer: { vatId: null, registerNumber: 'HRB 12345' } }),
        'en16931',
      ),
    ).toEqual([])
  })

  it('wants the country in front of a VAT identification number, and forgives the spaces', () => {
    expect(
      eInvoiceGaps(invoice({}, { issuer: { vatId: '123456789' } }), 'en16931').map(
        (gap) => gap.detail,
      ),
    ).toEqual(['issuer_vat_id_format'])
    expect(
      eInvoiceGaps(invoice({}, { recipient: { vatId: '987654321' } }), 'en16931').map(
        (gap) => gap.detail,
      ),
    ).toEqual(['recipient_vat_id_format'])
    expect(eInvoiceGaps(invoice({}, { issuer: { vatId: 'de 123 456 789' } }), 'en16931')).toEqual(
      [],
    )
    expect(compactVatId('de 123 456 789')).toBe('DE123456789')
  })

  it('is the VAT identification number of the customer under a reverse charge', () => {
    const reverse = invoice({ taxTreatment: 'reverse_charge' }, { recipient: { vatId: null } })

    expect(eInvoiceGaps(reverse, 'en16931').map((gap) => gap.detail)).toEqual(['recipient_vat_id'])
    // Without the reverse charge nobody needs it.
    expect(eInvoiceGaps(invoice({}, { recipient: { vatId: null } }), 'en16931')).toEqual([])
  })

  it('is more for an XRechnung than for the standard, each with its rule', () => {
    const bare = invoice(
      {},
      {
        issuer: { email: null, phone: null, iban: null },
        recipient: { email: null, buyerReference: null },
      },
    )

    expect(eInvoiceGaps(bare, 'en16931')).toEqual([])

    const gaps = eInvoiceGaps(bare, 'xrechnung')

    expect(gaps.map((gap) => gap.detail)).toEqual([
      'buyer_reference',
      'recipient_email',
      'issuer_email',
      'issuer_phone',
      'issuer_iban',
    ])
    expect(gaps.map((gap) => /\((XRechnung|EN 16931), [\w-]+\)\.$/.test(gap.message))).toEqual(
      gaps.map(() => true),
    )
  })
})

describe('the package', () => {
  it('holds the limit of 2027 and no limit for the years before', () => {
    expect(rules.at('e_invoice.transition_turnover_limit', '2026-06-01')).toBeNull()
    expect(rules.valueAt('e_invoice.transition_turnover_limit', 'cents', '2027-06-01')).toBe(
      80_000_000,
    )
    expect(rules.at('e_invoice.transition_turnover_limit', '2028-01-01')).toBeNull()
  })

  it('answers the duty and the transition for every day from 2007 on', () => {
    for (const on of [
      '2007-01-01',
      '2024-12-31',
      '2025-01-01',
      '2026-12-31',
      '2027-12-31',
      '2040-01-01',
    ] as const) {
      expect(() => rules.valueAt('e_invoice.required', 'flag', on)).not.toThrow()
      expect(() => rules.valueAt('e_invoice.transition', 'flag', on)).not.toThrow()
    }
  })
})
