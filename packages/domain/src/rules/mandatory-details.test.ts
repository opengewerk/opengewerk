import { describe, expect, it } from 'vitest'

import type { IssuerContent, LineContent, RecipientContent } from '../model/document-content.js'
import { cashAccountingNote, retentionNote, taxNotes } from '../model/document.js'
import { type ContentSources, documentContent, printedNotes } from './document-content.js'
import { detailsRegime, missingDetails } from './mandatory-details.js'
import { shippedRules } from './shipped.js'

/**
 * The check that stands between a draft and a number.
 *
 * What is tested here is the law as the three lists put it, and mostly the
 * borders between them, because that is where a wrong answer hides: a small
 * amount of exactly 250 euros, a reverse charge of 100, a small business in
 * December 2024 and one in January 2025. The messages are part of it. A
 * refusal that does not say what is missing sends somebody hunting through
 * four screens.
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

const recipient: RecipientContent = {
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
}

function position(position: number, netCents: number, designation = 'Unterverteilung setzen') {
  return {
    kind: 'item',
    position,
    designation,
    description: null,
    quantityMilli: 1000,
    unit: 'flat_rate',
    unitPriceCents: netCents,
    vatRate: 'standard',
    netCents,
  } satisfies LineContent
}

/** A final invoice of 1.000 euros net that has everything, unless told otherwise. */
function invoice(
  document: Partial<ContentSources['document']> = {},
  parts: {
    readonly lines?: readonly LineContent[]
    readonly issuer?: Partial<IssuerContent>
    readonly recipient?: Partial<RecipientContent>
    readonly cashAccounting?: boolean
  } = {},
) {
  return documentContent(rules, {
    document: {
      kind: 'final_invoice',
      number: null,
      documentDate: '2026-09-21',
      serviceFrom: '2026-09-01',
      serviceUntil: '2026-09-15',
      subject: null,
      introText: null,
      closingText: null,
      taxTreatment: 'standard',
      ...document,
    },
    lines: parts.lines ?? [position(1, 100000)],
    issuer: { ...issuer, ...parts.issuer },
    recipient: { ...recipient, ...parts.recipient },
    site: null,
    signature: null,
    cashAccounting: parts.cashAccounting ?? false,
    deductions: [],
    paymentTermDays: 14,
    instructions: [],
  })
}

function details(content: ReturnType<typeof invoice>) {
  return missingDetails(rules, content).map((entry) => entry.detail)
}

describe('an invoice with everything on it', () => {
  it('is missing nothing', () => {
    expect(missingDetails(rules, invoice())).toEqual([])
  })

  it('falls under the full list of section 14', () => {
    expect(detailsRegime(rules, invoice())).toBe('full')
  })
})

describe('a document that is not an invoice', () => {
  it('has no mandatory details, however empty it is', () => {
    const quote = invoice(
      { kind: 'quote', serviceFrom: null, serviceUntil: null },
      { lines: [], issuer: { name: '', street: null, taxNumber: null }, recipient: { city: null } },
    )

    expect(detailsRegime(rules, quote)).toBeNull()
    expect(missingDetails(rules, quote)).toEqual([])
  })
})

describe('the letterhead', () => {
  it('names the parts of the address that are missing, and the paragraph', () => {
    const [missing] = missingDetails(rules, invoice({}, { issuer: { street: ' ', city: null } }))

    expect(missing?.detail).toBe('issuer_address')
    expect(missing?.message).toBe(
      'Im Briefkopf ist die Anschrift des Betriebs unvollständig. ' +
        'Es fehlt: Straße und Ort (§ 14 Abs. 4 Nr. 1 UStG).',
    )
  })

  it('needs a tax number or a VAT id, and either one is enough', () => {
    expect(details(invoice({}, { issuer: { taxNumber: null, vatId: null } }))).toEqual([
      'issuer_tax_number',
    ])
    expect(details(invoice({}, { issuer: { taxNumber: null, vatId: 'DE123456789' } }))).toEqual([])
  })

  it('needs the name of the business', () => {
    expect(details(invoice({}, { issuer: { name: '' } }))).toEqual(['issuer_name'])
  })
})

describe('the customer', () => {
  it('needs a complete address on an invoice of the full list', () => {
    const [missing] = missingDetails(
      rules,
      invoice({}, { recipient: { street: null, postalCode: null, city: null } }),
    )

    expect(missing?.detail).toBe('recipient_address')
    expect(missing?.message).toContain('Straße, Postleitzahl und Ort')
  })

  it('may be anonymous on an invoice of a small amount', () => {
    // Section 33 UStDV asks for the issuer and not for the recipient, which
    // is what makes a cash sale at the door possible without a customer file.
    const small = invoice(
      { serviceFrom: null, serviceUntil: null },
      {
        lines: [position(1, 15000)],
        recipient: { name: '', street: null, postalCode: null, city: null },
        issuer: { taxNumber: null },
      },
    )

    expect(detailsRegime(rules, small)).toBe('small_amount')
    expect(missingDetails(rules, small)).toEqual([])
  })
})

describe('the border of a small amount', () => {
  it('lies at 250 euros gross since 2017, and 250 euros still counts', () => {
    // 210,08 net and 19 percent make 249,995, which a merchant rounds to 250,00.
    const exactly = invoice({}, { lines: [position(1, 21008)] })
    expect(exactly.totals.grossCents).toBe(25000)
    expect(detailsRegime(rules, exactly)).toBe('small_amount')

    const above = invoice({}, { lines: [position(1, 21009)] })
    expect(above.totals.grossCents).toBe(25001)
    expect(detailsRegime(rules, above)).toBe('full')
  })

  it('was 150 euros before, and a document from 2016 is measured by it', () => {
    // 168,07 net is exactly 200,00 gross at 19 percent: small in 2017, not in 2016.
    const lines = [position(1, 16807)]

    expect(detailsRegime(rules, invoice({ documentDate: '2016-12-30' }, { lines }))).toBe('full')
    expect(detailsRegime(rules, invoice({ documentDate: '2017-01-02' }, { lines }))).toBe(
      'small_amount',
    )
  })

  it('is measured on the size, so a small credit note is small too', () => {
    const credit = invoice({ kind: 'credit_note' }, { lines: [position(1, -10000)] })

    expect(credit.totals.grossCents).toBe(-11900)
    expect(detailsRegime(rules, credit)).toBe('small_amount')
  })

  it('never applies to a reverse charge, whatever the amount', () => {
    // Section 33 sentence 3 UStDV. A construction firm gets the full list for
    // a hundred euros as well.
    const reversed = invoice(
      { taxTreatment: 'reverse_charge' },
      { lines: [position(1, 10000)], recipient: { isBusiness: true } },
    )

    expect(detailsRegime(rules, reversed)).toBe('full')
  })
})

describe('a small business', () => {
  const claimed = { taxTreatment: 'small_business' as const }

  it('writes the short list of section 34a since 2025, without a date of service', () => {
    const content = invoice({ ...claimed, serviceFrom: null, serviceUntil: null })

    expect(detailsRegime(rules, content)).toBe('small_business')
    expect(missingDetails(rules, content)).toEqual([])
  })

  it('still needs the customer and its own tax number under that list', () => {
    const content = invoice(claimed, {
      issuer: { taxNumber: null },
      recipient: { city: null },
    })

    expect(missingDetails(rules, content).map((entry) => entry.message)).toEqual([
      'Im Briefkopf fehlt die Steuernummer oder die Umsatzsteuer-Identifikationsnummer ' +
        '(§ 34a Satz 1 Nr. 2 UStDV).',
      'Die Anschrift des Kunden ist unvollständig. Es fehlt: Ort (§ 34a Satz 1 Nr. 1 UStDV).',
    ])
  })

  it('wrote the full list in 2024, when there was no short one yet', () => {
    const content = invoice({
      ...claimed,
      documentDate: '2024-12-30',
      serviceFrom: null,
      serviceUntil: null,
    })

    expect(detailsRegime(rules, content)).toBe('full')
    expect(details(content)).toEqual(['service_date'])
  })

  it('gets the list of a small amount when the invoice is small', () => {
    // Section 34a sentence 2 leaves section 33 untouched, so the shorter one wins.
    const content = invoice(claimed, { lines: [position(1, 20000)] })

    expect(detailsRegime(rules, content)).toBe('small_amount')
  })
})

describe('the date of the work', () => {
  it('is needed on a final invoice', () => {
    const [missing] = missingDetails(rules, invoice({ serviceFrom: null, serviceUntil: null }))

    expect(missing?.detail).toBe('service_date')
    expect(missing?.message).toContain('§ 14 Abs. 4 Nr. 6 UStG')
  })

  it('is not asked of a progress invoice, which is written while the work goes on', () => {
    const progress = invoice({ kind: 'progress_invoice', serviceFrom: null, serviceUntil: null })

    expect(missingDetails(rules, progress)).toEqual([])
  })
})

describe('the lines', () => {
  it('have to be there', () => {
    expect(details(invoice({}, { lines: [] }))).toContain('lines')
  })

  it('do not count a title as a position', () => {
    const onlyTitles = invoice({}, { lines: [{ ...position(1, 0, 'Erdgeschoss'), kind: 'title' }] })

    expect(details(onlyTitles)).toContain('lines')
  })

  it('each need a designation, and the message says which one', () => {
    const content = invoice({}, { lines: [position(1, 50000), position(2, 50000, '  ')] })
    const [missing] = missingDetails(rules, content)

    expect(missing).toEqual({
      detail: 'line_designation',
      position: 2,
      message: 'Position 2 hat keine Bezeichnung (§ 14 Abs. 4 Nr. 5 UStG).',
    })
  })
})

describe('every message', () => {
  it('names the paragraph it comes from', () => {
    const empty = invoice(
      { serviceFrom: null, serviceUntil: null },
      {
        lines: [position(1, 100000, '')],
        issuer: { name: '', street: null, taxNumber: null },
        recipient: { name: '', city: null },
      },
    )
    const messages = missingDetails(rules, empty).map((entry) => entry.message)

    expect(messages.length).toBe(7)

    for (const message of messages) {
      expect(message).toMatch(/§ \d+/)
    }
  })
})

describe('the printed notes', () => {
  it('carry the reason there is no tax, on any kind of document', () => {
    expect(
      printedNotes({
        kind: 'quote',
        taxTreatment: 'small_business',
        recipientIsBusiness: false,
        statesCashAccounting: false,
      }),
    ).toEqual([taxNotes.small_business])
  })

  it('tell a private customer to keep an invoice, and nobody else', () => {
    expect(
      printedNotes({
        kind: 'final_invoice',
        taxTreatment: 'standard',
        recipientIsBusiness: false,
        statesCashAccounting: false,
      }),
    ).toEqual([retentionNote])
    expect(
      printedNotes({
        kind: 'final_invoice',
        taxTreatment: 'standard',
        recipientIsBusiness: true,
        statesCashAccounting: false,
      }),
    ).toEqual([])
    expect(
      printedNotes({
        kind: 'quote',
        taxTreatment: 'standard',
        recipientIsBusiness: false,
        statesCashAccounting: false,
      }),
    ).toEqual([])
  })

  it('leave the retention out under section 19, where no taxable supply exists', () => {
    expect(
      printedNotes({
        kind: 'final_invoice',
        taxTreatment: 'small_business',
        recipientIsBusiness: false,
        statesCashAccounting: false,
      }),
    ).toEqual([taxNotes.small_business])
  })

  it('say from 2028 that the business pays its tax on what it receives, before the retention', () => {
    const permitted = { cashAccounting: true }

    expect(invoice({ documentDate: '2028-01-03' }, permitted).notes).toEqual([
      cashAccountingNote,
      retentionNote,
    ])
    expect(invoice({ documentDate: '2027-12-31' }, permitted).notes).toEqual([retentionNote])
    expect(invoice({ documentDate: '2028-01-03' }).notes).toEqual([retentionNote])
  })

  it('leave that statement off a document that shows no tax, or a quote', () => {
    const permitted = { cashAccounting: true }

    for (const taxTreatment of ['small_business', 'reverse_charge'] as const) {
      expect(invoice({ documentDate: '2028-01-03', taxTreatment }, permitted).notes).not.toContain(
        cashAccountingNote,
      )
    }

    expect(invoice({ documentDate: '2028-01-03', kind: 'quote' }, permitted).notes).not.toContain(
      cashAccountingNote,
    )
  })
})

describe('the content record', () => {
  it('survives being stored as JSON and read back unchanged', () => {
    // It goes into a jsonb column and is read by a later version. A Date or an
    // undefined would come back as something else, and the record that was
    // checked would no longer be the record that is printed.
    const content = invoice({ subject: 'Zählerschrank erneuert' })

    expect(JSON.parse(JSON.stringify(content))).toEqual(content)
  })

  it('keeps the lines in the order of their position and nothing of the row but the line', () => {
    const rows = [
      { ...position(2, 20000, 'Zweite'), id: 'b', tenantId: 't', version: 3 },
      { ...position(1, 10000, 'Erste'), id: 'a', tenantId: 't', version: 1 },
    ]
    const content = invoice({}, { lines: rows })

    expect(content.lines.map((line) => line.designation)).toEqual(['Erste', 'Zweite'])
    expect(Object.keys(content.lines[0] ?? {}).sort()).toEqual(
      [
        'description',
        'designation',
        'kind',
        'netCents',
        'position',
        'quantityMilli',
        'unit',
        'unitPriceCents',
        'vatRate',
      ].sort(),
    )
  })

  it('adds up by the rules of the document date', () => {
    // The second half of 2020 had sixteen percent.
    expect(invoice({ documentDate: '2020-08-14' }).totals.taxCents).toBe(16000)
    expect(invoice({ documentDate: '2026-09-21' }).totals.taxCents).toBe(19000)
  })
})
