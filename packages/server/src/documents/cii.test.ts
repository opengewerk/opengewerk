import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  cancellationOf,
  type ContentSources,
  type DeductionContent,
  type DocumentContent,
  documentContent,
  type EInvoiceProfile,
  eInvoiceGaps,
  type IssuerContent,
  type LineContent,
  type RecipientContent,
  RuleError,
  shippedRules,
  type SiteContent,
} from '@opengewerk/domain'
import { XmlDocument } from 'libxml2-wasm'
import { describe, expect, it } from 'vitest'

import { ciiInvoice } from './cii.js'
import { checkedCii, SchemaCheckError } from './cii-schema.js'

/**
 * The writer of the e-invoice, on invoices that cover each of its branches.
 *
 * Every one of them is held against the schema here. The business rules of
 * EN 16931 and XRechnung are Schematron, which needs XSLT 2 and so a Java
 * process: the CI job "E-Rechnung gegen den KoSIT-Validator" runs this file
 * with `CII_SAMPLES_DIR` set, which writes the same invoices to disk, and
 * hands them to the validator of the KoSIT. A new branch in the writer gets a
 * new invoice here, or the validator never sees it.
 */

const issuer: IssuerContent = {
  name: 'Elektro Nord GmbH',
  street: 'Hafenstraße',
  houseNumber: '12',
  postalCode: '20457',
  city: 'Hamburg',
  country: 'DE',
  phone: '+49 40 1234567',
  email: 'rechnung@elektro-nord.example',
  website: 'www.elektro-nord.example',
  taxNumber: '22/815/08154',
  // Typed the way people type it. What goes out has neither the spaces nor
  // the lower case.
  vatId: 'de 123 456 789',
  iban: 'DE02 1203 0000 0000 2020 51',
  bic: 'BYLADEM1001',
  bankName: 'Deutsche Kreditbank',
  registerCourt: 'Amtsgericht Hamburg',
  registerNumber: 'HRB 12345',
  managingDirectors: 'Geschäftsführer: Max Nord',
  logo: null,
}

/** The least a business can have and still send an e-invoice under EN 16931. */
const plainIssuer: IssuerContent = {
  ...issuer,
  phone: null,
  email: null,
  website: null,
  iban: null,
  bic: null,
  bankName: null,
  registerCourt: null,
  registerNumber: null,
  vatId: 'DE123456789',
}

const recipient: RecipientContent = {
  name: 'Hausverwaltung Kramer GmbH',
  street: 'Mühlenkamp',
  houseNumber: '8',
  postalCode: '22303',
  city: 'Hamburg',
  country: 'DE',
  isBusiness: true,
  email: 'buchhaltung@kramer-hv.example',
  vatId: 'DE987654321',
  buyerReference: '04011000-12345-03',
}

const site: SiteContent = {
  designation: 'Wohnanlage Mühlenkamp 8',
  street: 'Mühlenkamp',
  houseNumber: '8',
  postalCode: '22303',
  city: 'Hamburg',
  country: 'DE',
}

let lastPosition = 0

function title(designation: string): LineContent {
  lastPosition += 1

  return {
    kind: 'title',
    position: lastPosition,
    designation,
    description: null,
    quantityMilli: 0,
    unit: 'flat_rate',
    unitPriceCents: 0,
    vatRate: 'standard',
    netCents: 0,
  }
}

function item(
  designation: string,
  quantityMilli: number,
  unitPriceCents: number,
  over: Partial<LineContent> = {},
): LineContent {
  lastPosition += 1
  const exact = quantityMilli * unitPriceCents

  return {
    kind: 'item',
    position: lastPosition,
    designation,
    description: null,
    quantityMilli,
    unit: 'piece',
    unitPriceCents,
    vatRate: 'standard',
    // Half away from zero, as `lineNetCents` rounds.
    netCents: Math.sign(exact) * Math.round(Math.abs(exact) / 1000),
    ...over,
  }
}

function content(
  document: Partial<ContentSources['document']>,
  parts: {
    readonly lines: readonly LineContent[]
    readonly issuer?: IssuerContent
    readonly recipient?: Partial<RecipientContent>
    readonly site?: SiteContent | null
    readonly deductions?: readonly DeductionContent[]
  },
): DocumentContent {
  return documentContent(shippedRules, {
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
    lines: parts.lines,
    issuer: parts.issuer ?? issuer,
    recipient: { ...recipient, ...parts.recipient },
    site: parts.site === undefined ? site : parts.site,
    signature: null,
    deductions: parts.deductions ?? [],
  })
}

/** What an issued invoice deducts later on, out of what it froze. */
function deducted(invoice: DocumentContent): DeductionContent {
  if (invoice.number === null) {
    throw new Error('A deduction needs an issued invoice.')
  }

  return {
    number: invoice.number,
    documentDate: invoice.documentDate,
    taxTreatment: invoice.taxTreatment,
    billed: invoice.billed,
  }
}

const firstProgress = content(
  {
    kind: 'progress_invoice',
    number: 'RE-2026-0001',
    documentDate: '2026-07-01',
    serviceFrom: null,
    serviceUntil: null,
    subject: 'Abschlag Rohinstallation',
  },
  { lines: [item('Leistungsstand Rohinstallation', 1000, 500000, { unit: 'flat_rate' })] },
)

const secondProgress = content(
  {
    kind: 'progress_invoice',
    number: 'RE-2026-0002',
    documentDate: '2026-08-03',
    serviceFrom: null,
    serviceUntil: null,
  },
  {
    lines: [
      item('Leistungsstand Rohinstallation', 1000, 500000, { unit: 'flat_rate' }),
      item('Leistungsstand Unterverteilung', 1000, 312050, { unit: 'flat_rate' }),
    ],
    deductions: [deducted(firstProgress)],
  },
)

const finalInvoice = content(
  {
    number: 'RE-2026-0003',
    subject: 'Elektroinstallation Mühlenkamp 8',
    introText: 'Vielen Dank für Ihren Auftrag.',
  },
  {
    lines: [
      title('Erdgeschoss'),
      item('Unterverteilung setzen', 1000, 124000, { unit: 'flat_rate' }),
      item('Steckdosen tauschen', 12_000, 4550, { description: 'Schuko, reinweiß\nmit Rahmen' }),
      title('Material'),
      item('Kabel NYM-J 3x1,5', 150_500, 129, { unit: 'metre' }),
      item('Fachbuch Elektroinstallation', 1000, 3990, { vatRate: 'reduced' }),
      item('Montage "Küche" & Bad <innen>\u0007', 2500, 6800, { unit: 'hour' }),
      item('Nachlass Stammkunde', 1000, -5000, { unit: 'flat_rate' }),
    ],
    deductions: [deducted(firstProgress), deducted(secondProgress)],
  },
)

/**
 * A progress invoice of the second half of 2020, at sixteen percent, taken off
 * by a final invoice of 2021 at nineteen. The tax that was stated stays the
 * tax that is taken off, so the invoice shows two rates.
 */
const earlyProgress = content(
  {
    kind: 'progress_invoice',
    number: 'RE-2020-0017',
    documentDate: '2020-11-16',
    serviceFrom: null,
    serviceUntil: null,
  },
  { lines: [item('Abschlag Neubau', 1000, 100000, { unit: 'flat_rate' })] },
)

const acrossTheChange = content(
  {
    number: 'RE-2021-0004',
    documentDate: '2021-02-10',
    serviceFrom: '2021-02-01',
    serviceUntil: '2021-02-05',
  },
  {
    lines: [item('Elektroinstallation Neubau', 1000, 300000, { unit: 'flat_rate' })],
    deductions: [deducted(earlyProgress)],
  },
)

const reverseCharge = content(
  { number: 'RE-2026-0010', taxTreatment: 'reverse_charge', subject: 'Nachunternehmerleistung' },
  {
    lines: [
      item('Kabeltrasse montieren', 32_000, 6500, { unit: 'hour' }),
      item('Kabelrinne 100x60', 48_000, 1890, { unit: 'metre' }),
    ],
    recipient: { name: 'Bau Hansa GmbH', vatId: 'DE 111 222 333' },
  },
)

const cancellation = cancellationOf(finalInvoice, {
  number: 'RE-2026-0004',
  documentDate: '2026-10-05',
  issuer,
})

const singleDay = content(
  { number: 'RE-2026-0011', serviceFrom: '2026-09-18', serviceUntil: null },
  {
    lines: [item('Fehlersuche Beleuchtung', 4500, 7200, { unit: 'hour' })],
    issuer: plainIssuer,
    recipient: { email: null, buyerReference: null, vatId: null },
    site: { ...site, postalCode: null },
  },
)

const samples: readonly {
  readonly name: string
  readonly profile: EInvoiceProfile
  readonly content: DocumentContent
}[] = [
  { name: 'final-invoice-xrechnung', profile: 'xrechnung', content: finalInvoice },
  { name: 'final-invoice-en16931', profile: 'en16931', content: finalInvoice },
  { name: 'progress-invoice-xrechnung', profile: 'xrechnung', content: secondProgress },
  { name: 'first-progress-invoice-en16931', profile: 'en16931', content: firstProgress },
  { name: 'rate-change-xrechnung', profile: 'xrechnung', content: acrossTheChange },
  { name: 'reverse-charge-xrechnung', profile: 'xrechnung', content: reverseCharge },
  { name: 'cancellation-xrechnung', profile: 'xrechnung', content: cancellation },
  { name: 'cancellation-en16931', profile: 'en16931', content: cancellation },
  { name: 'single-day-plain-en16931', profile: 'en16931', content: singleDay },
]

const namespaces = {
  rsm: 'urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100',
  ram: 'urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100',
  udt: 'urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100',
  qdt: 'urn:un:unece:uncefact:data:standard:QualifiedDataType:100',
}

/** The text of every node an expression finds, in document order. */
function read(xml: string, xpath: string): string[] {
  const document = XmlDocument.fromString(xml)

  try {
    return document.find(xpath, namespaces).map((node) => node.content)
  } finally {
    document.dispose()
  }
}

const settlement = '//ram:ApplicableHeaderTradeSettlement'
const summation = `${settlement}/ram:SpecifiedTradeSettlementHeaderMonetarySummation`

describe('the e-invoices the writer produces', () => {
  it('need nothing their profile would lack', () => {
    for (const sample of samples) {
      expect({ [sample.name]: eInvoiceGaps(sample.content, sample.profile) }).toEqual({
        [sample.name]: [],
      })
    }
  })

  it('pass the schema, every one of them', () => {
    const folder = process.env['CII_SAMPLES_DIR']

    if (folder) {
      mkdirSync(folder, { recursive: true })
    }

    for (const sample of samples) {
      const checked = checkedCii(ciiInvoice(sample.content, sample.profile))

      // What is stored is what was checked, indented, and still the same
      // document: the schema accepts it a second time.
      expect(checked.split(/\r?\n/).length).toBeGreaterThan(50)
      expect(checkedCii(checked)).toBe(checked)

      if (folder) {
        writeFileSync(join(folder, `${sample.name}.xml`), checked, 'utf8')
      }
    }
  })
})

describe('an e-invoice', () => {
  it('says which usage it follows, and nothing else differs between the two', () => {
    const xrechnung = ciiInvoice(finalInvoice, 'xrechnung')
    const en16931 = ciiInvoice(finalInvoice, 'en16931')
    const guideline = '//ram:GuidelineSpecifiedDocumentContextParameter/ram:ID'

    expect(read(xrechnung, guideline)).toEqual([
      'urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0',
    ])
    expect(read(en16931, guideline)).toEqual(['urn:cen.eu:en16931:2017'])
    expect(en16931.replace('urn:cen.eu:en16931:2017<', '')).toBe(
      xrechnung.replace(
        'urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0<',
        '',
      ),
    )
  })

  it('states the figures the invoice froze, to the cent', () => {
    const xml = ciiInvoice(finalInvoice, 'xrechnung')

    expect(read(xml, `${summation}/ram:TaxTotalAmount`)).toEqual([
      (finalInvoice.billed.taxCents / 100).toFixed(2),
    ])
    expect(read(xml, `${summation}/ram:DuePayableAmount`)).toEqual([
      (finalInvoice.billed.grossCents / 100).toFixed(2),
    ])
    expect(read(xml, `${summation}/ram:LineTotalAmount`)).toEqual([
      (finalInvoice.billed.netCents / 100).toFixed(2),
    ])
  })

  it('numbers its lines the way the PDF does, and leaves the titles out', () => {
    const xml = ciiInvoice(finalInvoice, 'xrechnung')

    expect(read(xml, '//ram:AssociatedDocumentLineDocument/ram:LineID')).toEqual([
      '1.1',
      '1.2',
      '2.1',
      '2.2',
      '2.3',
      '2.4',
      'A1',
      'A2',
    ])
  })

  it('takes the progress invoices off as lines of minus one, each at its own rate', () => {
    const xml = ciiInvoice(finalInvoice, 'xrechnung')
    const deduction =
      "//ram:IncludedSupplyChainTradeLineItem[ram:AssociatedDocumentLineDocument/ram:LineID='A1']"

    expect(read(xml, `${deduction}//ram:Name`)).toEqual([
      'Abzüglich Abschlagsrechnung RE-2026-0001 vom 01.07.2026',
    ])
    expect(read(xml, `${deduction}//ram:BilledQuantity`)).toEqual(['-1'])
    expect(read(xml, `${deduction}//ram:ChargeAmount`)).toEqual(['5000.00'])
    expect(read(xml, `${deduction}//ram:LineTotalAmount`)).toEqual(['-5000.00'])

    // The final invoice after progress invoices is the one of building work.
    expect(read(xml, '//rsm:ExchangedDocument/ram:TypeCode')).toEqual(['877'])
    expect(
      read(ciiInvoice(secondProgress, 'xrechnung'), '//rsm:ExchangedDocument/ram:TypeCode'),
    ).toEqual(['875'])
  })

  it('keeps a tax that was stated at an old rate at that rate', () => {
    const xml = ciiInvoice(acrossTheChange, 'xrechnung')

    expect(read(xml, `${settlement}/ram:ApplicableTradeTax/ram:RateApplicablePercent`)).toEqual([
      '19',
      '16',
    ])
    expect(read(xml, `${settlement}/ram:ApplicableTradeTax/ram:CalculatedAmount`)).toEqual([
      '570.00',
      '-160.00',
    ])
    expect(read(xml, `${summation}/ram:TaxTotalAmount`)).toEqual(['410.00'])
  })

  it('never writes a negative price, and turns the quantity round instead', () => {
    const xml = ciiInvoice(finalInvoice, 'xrechnung')
    const discount =
      "//ram:IncludedSupplyChainTradeLineItem[ram:AssociatedDocumentLineDocument/ram:LineID='2.4']"

    expect(read(xml, `${discount}//ram:ChargeAmount`)).toEqual(['50.00'])
    expect(read(xml, `${discount}//ram:BilledQuantity`)).toEqual(['-1'])
    expect(read(xml, `${discount}//ram:LineTotalAmount`)).toEqual(['-50.00'])
  })

  it('carries what a person typed as text, escaped, and drops what XML cannot hold', () => {
    const xml = ciiInvoice(finalInvoice, 'xrechnung')

    expect(xml).toContain('Montage &quot;Küche&quot; &amp; Bad &lt;innen&gt;</ram:Name>')
    expect(xml).not.toContain('\u0007')
    expect(
      read(xml, "//ram:SpecifiedTradeProduct[ram:Name='Steckdosen tauschen']/ram:Description"),
    ).toEqual(['Schuko, reinweiß\nmit Rahmen'])
  })

  it('writes identifiers the way the standard wants them', () => {
    const xml = ciiInvoice(finalInvoice, 'xrechnung')

    expect(
      read(xml, "//ram:SellerTradeParty/ram:SpecifiedTaxRegistration/ram:ID[@schemeID='VA']"),
    ).toEqual(['DE123456789'])
    expect(
      read(xml, "//ram:SellerTradeParty/ram:SpecifiedTaxRegistration/ram:ID[@schemeID='FC']"),
    ).toEqual(['22/815/08154'])
    expect(read(xml, '//ram:SellerTradeParty/ram:SpecifiedLegalOrganization/ram:ID')).toEqual([
      'Amtsgericht Hamburg HRB 12345',
    ])
    expect(read(xml, '//ram:PayeePartyCreditorFinancialAccount/ram:IBANID')).toEqual([
      'DE02120300000000202051',
    ])
    expect(
      read(xml, "//ram:BuyerTradeParty/ram:URIUniversalCommunication/ram:URIID[@schemeID='EM']"),
    ).toEqual(['buchhaltung@kramer-hv.example'])
    expect(read(xml, '//ram:ApplicableHeaderTradeAgreement/ram:BuyerReference')).toEqual([
      '04011000-12345-03',
    ])
  })

  it('says under a reverse charge why there is no tax, in the words of the PDF', () => {
    const xml = ciiInvoice(reverseCharge, 'xrechnung')
    const group = `${settlement}/ram:ApplicableTradeTax`

    expect(read(xml, `${group}/ram:CategoryCode`)).toEqual(['AE'])
    expect(read(xml, `${group}/ram:CalculatedAmount`)).toEqual(['0.00'])
    expect(read(xml, `${group}/ram:ExemptionReasonCode`)).toEqual(['VATEX-EU-AE'])
    expect(read(xml, `${group}/ram:ExemptionReason`)).toEqual([
      'Steuerschuldnerschaft des Leistungsempfängers gemäß § 13b UStG.',
    ])
    expect(
      read(xml, "//ram:BuyerTradeParty/ram:SpecifiedTaxRegistration/ram:ID[@schemeID='VA']"),
    ).toEqual(['DE111222333'])
  })

  it('makes a cancellation a correction of the invoice it names, with the quantities turned round', () => {
    const xml = ciiInvoice(cancellation, 'xrechnung')

    expect(read(xml, '//rsm:ExchangedDocument/ram:TypeCode')).toEqual(['384'])
    expect(read(xml, `${settlement}/ram:InvoiceReferencedDocument/ram:IssuerAssignedID`)).toEqual([
      'RE-2026-0003',
    ])
    expect(read(xml, `${settlement}/ram:InvoiceReferencedDocument//qdt:DateTimeString`)).toEqual([
      '20260921',
    ])
    expect(read(xml, `${summation}/ram:DuePayableAmount`)).toEqual([
      (cancellation.billed.grossCents / 100).toFixed(2),
    ])
    expect(cancellation.billed.grossCents).toBe(-finalInvoice.billed.grossCents)

    // Prices stay what they were, quantities change sign, and the progress
    // invoices the final invoice took off come back as lines of plus one.
    const first =
      "//ram:IncludedSupplyChainTradeLineItem[ram:AssociatedDocumentLineDocument/ram:LineID='1.1']"
    const returned =
      "//ram:IncludedSupplyChainTradeLineItem[ram:AssociatedDocumentLineDocument/ram:LineID='A1']"

    expect(read(xml, `${first}//ram:ChargeAmount`)).toEqual(['1240.00'])
    expect(read(xml, `${first}//ram:BilledQuantity`)).toEqual(['-1'])
    expect(read(xml, `${returned}//ram:Name`)).toEqual([
      'Zurückgenommener Abzug der Abschlagsrechnung RE-2026-0001 vom 01.07.2026',
    ])
    expect(read(xml, `${returned}//ram:BilledQuantity`)).toEqual(['1'])
    expect(read(xml, `${returned}//ram:LineTotalAmount`)).toEqual(['5000.00'])
    expect(read(xml, '//rsm:ExchangedDocument/ram:IncludedNote/ram:Content')).toContain(
      'Hiermit stornieren wir die Schlussrechnung RE-2026-0003 vom 21.09.2026 in voller Höhe. ' +
        'Die Beträge sind die dieser Rechnung mit umgekehrtem Vorzeichen.',
    )
  })

  it('states a single day of work as the day of delivery, and a period as the period', () => {
    expect(
      read(
        ciiInvoice(singleDay, 'en16931'),
        '//ram:ActualDeliverySupplyChainEvent//udt:DateTimeString',
      ),
    ).toEqual(['20260918'])
    expect(
      read(
        ciiInvoice(finalInvoice, 'en16931'),
        `${settlement}/ram:BillingSpecifiedPeriod//udt:DateTimeString`,
      ),
    ).toEqual(['20260901', '20260915'])
  })

  it('names the site as the place of delivery only with a town and a postal code', () => {
    expect(read(ciiInvoice(finalInvoice, 'en16931'), '//ram:ShipToTradeParty/ram:Name')).toEqual([
      'Wohnanlage Mühlenkamp 8',
    ])
    expect(read(ciiInvoice(singleDay, 'en16931'), '//ram:ShipToTradeParty')).toEqual([])
  })

  it('is refused for what is not an issued invoice this software can write as one', () => {
    expect(() => ciiInvoice({ ...finalInvoice, number: null }, 'xrechnung')).toThrow(RuleError)
    expect(() => ciiInvoice({ ...finalInvoice, kind: 'credit_note' }, 'xrechnung')).toThrow(
      RuleError,
    )
    expect(() =>
      ciiInvoice(
        content({ taxTreatment: 'small_business' }, { lines: [item('Leuchte', 1000, 9900)] }),
        'en16931',
      ),
    ).toThrow(RuleError)
  })
})

describe('the check against the schema', () => {
  it('refuses a file the schema refuses, and says where', () => {
    const broken = ciiInvoice(finalInvoice, 'xrechnung').replace(
      '<ram:TypeCode>877</ram:TypeCode>',
      '<ram:DocumentKind>877</ram:DocumentKind>',
    )

    expect(() => checkedCii(broken)).toThrow(SchemaCheckError)
    expect(() => checkedCii(broken)).toThrow(/Zeile 2: .*DocumentKind/)
  })

  it('refuses what is not XML at all', () => {
    expect(() => checkedCii('<rsm:CrossIndustryInvoice>')).toThrow(SchemaCheckError)
  })
})
