import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { eInvoiceGaps, RuleError } from '@opengewerk/domain'
import { XmlDocument } from 'libxml2-wasm'
import { describe, expect, it } from 'vitest'

import { ciiInvoice } from './cii.js'
import { checkedCii, SchemaCheckError } from './cii-schema.js'
import {
  acrossTheChange,
  cancellation,
  cashAccounting,
  content,
  finalInvoice,
  item,
  photovoltaics,
  reverseCharge,
  samples,
  secondProgress,
  singleDay,
} from './test-samples.js'

/**
 * The writer of the e-invoice, on invoices that cover each of its branches.
 *
 * Every one of them is held against the schema here. The business rules of
 * EN 16931 and XRechnung are Schematron, which needs XSLT 2 and so a Java
 * process: the CI job "E-Rechnung gegen KoSIT und Mustang" runs this file
 * with `CII_SAMPLES_DIR` set, which writes the same invoices to disk, and
 * hands them to the validator of the KoSIT. The invoices themselves are in
 * `test-samples.ts`, which the test of the ZUGFeRD PDF prints as well.
 */

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

  /**
   * The zero rate for photovoltaics of section 12 (3) UStG (#127). A rate
   * and not an exemption: `Z` at zero, with no reason for an exemption
   * (BR-Z-10), next to the standard rated wallbox. As `S` at zero it would
   * break BR-S-05, which wants a standard rate above nothing.
   */
  it('writes the zero rate for photovoltaics as zero rated, next to the standard rate', () => {
    const xml = ciiInvoice(photovoltaics, 'xrechnung')
    const group = `${settlement}/ram:ApplicableTradeTax`
    const lineTax = '//ram:SpecifiedLineTradeSettlement/ram:ApplicableTradeTax'

    expect(read(xml, `${lineTax}/ram:CategoryCode`)).toEqual(['Z', 'Z', 'S'])
    expect(read(xml, `${lineTax}/ram:RateApplicablePercent`)).toEqual(['0', '0', '19'])
    expect(read(xml, `${group}/ram:CategoryCode`)).toEqual(['S', 'Z'])
    expect(read(xml, `${group}/ram:BasisAmount`)).toEqual(['890.00', '19300.00'])
    expect(read(xml, `${group}/ram:CalculatedAmount`)).toEqual(['169.10', '0.00'])
    expect(read(xml, `${group}/ram:ExemptionReason`)).toEqual([])
    expect(read(xml, `${group}/ram:ExemptionReasonCode`)).toEqual([])
  })

  it('says from 2028 that the tax is calculated on what is received, as a note of the invoice', () => {
    const notes = read(
      ciiInvoice(cashAccounting, 'xrechnung'),
      '//rsm:ExchangedDocument/ram:IncludedNote/ram:Content',
    )

    expect(notes).toContain('Versteuerung nach vereinnahmten Entgelten.')
    expect(
      read(
        ciiInvoice(finalInvoice, 'xrechnung'),
        '//rsm:ExchangedDocument/ram:IncludedNote/ram:Content',
      ),
    ).not.toContain('Versteuerung nach vereinnahmten Entgelten.')
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
      'Hiermit stornieren wir die Rechnung RE-2026-0003 vom 21.09.2026 in voller Höhe. ' +
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

  it('states when to pay, as the sentence of the PDF and as the day, BT-20 and BT-9', () => {
    const terms = `${settlement}/ram:SpecifiedTradePaymentTerms`
    const progress = ciiInvoice(secondProgress, 'xrechnung')

    expect(read(progress, `${terms}/ram:Description`)).toEqual([
      'Zahlbar ohne Abzug bis zum 17.08.2026.',
    ])
    expect(read(progress, `${terms}/ram:DueDateDateTime/udt:DateTimeString`)).toEqual(['20260817'])
    // Thirty days agreed with the general contractor, and an hour of fault
    // finding payable at once.
    expect(
      read(
        ciiInvoice(reverseCharge, 'xrechnung'),
        `${terms}/ram:DueDateDateTime/udt:DateTimeString`,
      ),
    ).toEqual(['20261021'])
    expect(read(ciiInvoice(singleDay, 'en16931'), `${terms}/ram:Description`)).toEqual([
      'Zahlbar sofort ohne Abzug.',
    ])
  })

  it('asks nothing of the customer where nothing is owed', () => {
    // The final invoice of the samples comes out below zero, because its
    // progress invoices billed more than the whole work, and a cancellation
    // gives back. A due date on either would ask for money nobody owes.
    expect(finalInvoice.billed.grossCents).toBeLessThan(0)

    for (const owedNothing of [finalInvoice, cancellation]) {
      expect(
        read(ciiInvoice(owedNothing, 'xrechnung'), `${settlement}/ram:SpecifiedTradePaymentTerms`),
      ).toEqual([])
    }
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
