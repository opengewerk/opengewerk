import {
  compactVatId,
  type DeductionContent,
  type DocumentContent,
  type DocumentKind,
  type EInvoiceProfile,
  type IsoDate,
  type LineUnit,
  outlineRows,
  quantityFactor,
  RuleError,
  type TaxTreatment,
} from '@opengewerk/domain'

import { withoutUnwritable } from './characters.js'
import { documentTitle } from './template.js'

/**
 * An invoice as an e-invoice: UN/CEFACT Cross Industry Invoice, the syntax
 * both XRechnung and ZUGFeRD are written in, following EN 16931.
 *
 * Out of the content record and nothing else, the same one the PDF is printed
 * from. Two packagings of the same statements need the same statements, and
 * that is ADR 0007 in one sentence: the figures are the frozen ones, never
 * worked out again. A total here that differed from the PDF by a cent would be
 * two invoices under one number.
 *
 * Plain template strings, like the letterhead template, and for the same
 * reason: the escaping below is all a string needs to be safe, and a library
 * that builds a tree would be a dependency for a document of fixed shape. The
 * order of the elements is the order of the schema, which is strict about it;
 * `cii-schema.ts` holds every result against that schema before it leaves.
 *
 * Nothing is written that is empty. The rules of XRechnung refuse an empty
 * element, and a value nobody entered is left out rather than sent as nothing.
 */

const namespaces =
  'xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" ' +
  'xmlns:qdt="urn:un:unece:uncefact:data:standard:QualifiedDataType:100" ' +
  'xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" ' +
  'xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100"'

/**
 * What the file says it conforms to, BT-24. The XRechnung identifier names the
 * standard and the German usage on top of it; a validator picks its rules by
 * this string and nothing else.
 */
const guidelines: Readonly<Record<EInvoiceProfile, string>> = {
  en16931: 'urn:cen.eu:en16931:2017',
  xrechnung: 'urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0',
}

/**
 * The business process, BT-23. XRechnung requires one, and this is the one for
 * a plain invoice that every validator knows.
 */
const businessProcess = 'urn:fdc:peppol.eu:2017:poacc:billing:01:1.0'

/**
 * The units of recommendation 20 of UN/ECE, and 21 with its X for the package.
 * The list is closed on both sides, so a unit is a lookup and never a guess.
 */
const unitCodes: Readonly<Record<LineUnit, string>> = {
  piece: 'H87',
  hour: 'HUR',
  day: 'DAY',
  metre: 'MTR',
  square_metre: 'MTK',
  cubic_metre: 'MTQ',
  kilogram: 'KGM',
  litre: 'LTR',
  package: 'XPK',
  flat_rate: 'LS',
}

/** One, the unit of a deduction, which is counted once and priced as a whole. */
const unitOne = 'C62'

/**
 * The document type, BT-3, from the list XRechnung allows.
 *
 * A progress invoice and the final invoice after it are the two codes for
 * building work, 875 and 877: the concept writes progress invoices
 * cumulatively, which is what the KoSIT asks of invoices for construction. A
 * final invoice that followed no progress invoice is an ordinary invoice.
 *
 * A cancellation is a correction of the invoice it names, 384, and not a
 * credit note: the KoSIT keeps 381 for a credit given independently of any
 * invoice. The quantities carry the minus sign, the prices never do, which is
 * exactly how a cancellation is mirrored here in the first place.
 */
function typeCode(content: DocumentContent): string {
  const codes: Readonly<Partial<Record<DocumentKind, string>>> = {
    progress_invoice: '875',
    partial_invoice: '326',
    final_invoice: content.deductions.length > 0 ? '877' : '380',
    recurring_invoice: '380',
    cancellation_invoice: '384',
  }
  const code = codes[content.kind]

  if (code === undefined) {
    throw new RuleError(
      `Eine ${documentTitle(content.kind)} wird nicht als E-Rechnung ausgestellt.`,
    )
  }

  return code
}

/** XML escaping for anything a person typed. */
function escaped(value: string): string {
  return withoutUnwritable(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function present(value: string | null | undefined): value is string {
  return value !== null && value !== undefined && value.trim() !== ''
}

/** An element with a text, or nothing at all when there is no text. */
function element(name: string, value: string | null | undefined, attributes = ''): string {
  return present(value) ? `<${name}${attributes}>${escaped(value.trim())}</${name}>` : ''
}

/** Cents as the decimal the standard counts in: 1234.56, -0.05, 0.00. */
function amount(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const whole = Math.abs(cents)

  return `${sign}${String(Math.trunc(whole / 100))}.${String(whole % 100).padStart(2, '0')}`
}

/** Thousandths as a decimal without the zeros nobody wrote: 1.5, 2, -0.125. */
function quantity(milli: number): string {
  const sign = milli < 0 ? '-' : ''
  const whole = Math.abs(milli)
  const fraction = String(whole % quantityFactor)
    .padStart(3, '0')
    .replace(/0+$/, '')

  return `${sign}${String(Math.trunc(whole / quantityFactor))}${fraction ? `.${fraction}` : ''}`
}

/** Basis points as the percentage the standard wants: 19, 7, 16, 5.5. */
function percent(basisPoints: number): string {
  return basisPoints % 100 === 0
    ? String(basisPoints / 100)
    : (basisPoints / 100).toFixed(2).replace(/0$/, '')
}

/** A date in format 102 of UN/EDIFACT, the only one the standard takes: 20260921. */
function date(on: IsoDate, prefix: 'udt' | 'qdt' = 'udt'): string {
  return `<${prefix}:DateTimeString format="102">${on.replaceAll('-', '')}</${prefix}:DateTimeString>`
}

function day(on: IsoDate): string {
  return `${on.slice(8, 10)}.${on.slice(5, 7)}.${on.slice(0, 4)}`
}

/** A VAT category, and the rate that goes with it. */
interface Category {
  readonly code: 'S' | 'AE'
  readonly basisPoints: number
}

/**
 * The category of the whole document. Standard rated with the rate of the
 * line, or reverse charge at zero; section 19 never gets here, see
 * `formatFor`, and is refused rather than written in a way nobody checked.
 */
function categoryOf(treatment: TaxTreatment, basisPoints: number): Category {
  switch (treatment) {
    case 'standard':
      return { code: 'S', basisPoints }
    case 'reverse_charge':
      return { code: 'AE', basisPoints: 0 }
    case 'small_business':
      throw new RuleError('Eine Rechnung nach § 19 UStG wird nicht als E-Rechnung ausgestellt.')
  }
}

function lineTax(category: Category): string {
  return (
    '<ram:ApplicableTradeTax><ram:TypeCode>VAT</ram:TypeCode>' +
    `<ram:CategoryCode>${category.code}</ram:CategoryCode>` +
    `<ram:RateApplicablePercent>${percent(category.basisPoints)}</ram:RateApplicablePercent>` +
    '</ram:ApplicableTradeTax>'
  )
}

/** One line of the e-invoice, whatever it came from. */
interface Line {
  readonly id: string
  readonly name: string
  readonly description: string | null
  readonly quantityMilli: number
  readonly unitCode: string
  readonly priceCents: number
  readonly totalCents: number
  readonly category: Category
}

function lineItem(line: Line): string {
  return (
    '<ram:IncludedSupplyChainTradeLineItem>' +
    `<ram:AssociatedDocumentLineDocument>${element('ram:LineID', line.id)}</ram:AssociatedDocumentLineDocument>` +
    `<ram:SpecifiedTradeProduct>${element('ram:Name', line.name)}${element('ram:Description', line.description)}</ram:SpecifiedTradeProduct>` +
    '<ram:SpecifiedLineTradeAgreement><ram:NetPriceProductTradePrice>' +
    `<ram:ChargeAmount>${amount(line.priceCents)}</ram:ChargeAmount>` +
    '</ram:NetPriceProductTradePrice></ram:SpecifiedLineTradeAgreement>' +
    '<ram:SpecifiedLineTradeDelivery>' +
    `<ram:BilledQuantity unitCode="${line.unitCode}">${quantity(line.quantityMilli)}</ram:BilledQuantity>` +
    '</ram:SpecifiedLineTradeDelivery>' +
    `<ram:SpecifiedLineTradeSettlement>${lineTax(line.category)}` +
    '<ram:SpecifiedTradeSettlementLineMonetarySummation>' +
    `<ram:LineTotalAmount>${amount(line.totalCents)}</ram:LineTotalAmount>` +
    '</ram:SpecifiedTradeSettlementLineMonetarySummation></ram:SpecifiedLineTradeSettlement>' +
    '</ram:IncludedSupplyChainTradeLineItem>'
  )
}

/**
 * The positions, numbered as the PDF numbers them, 1.1 under title 1, so a
 * person holding both finds the same line under the same number. Titles
 * themselves are no line of an invoice: they carry no amount, and a line
 * without one is something the standard does not have.
 *
 * A price is never negative in the standard, rule BR-27. A position typed with
 * a negative price, a discount written as a line, turns its quantity round
 * instead; quantity times price, and so the line total, stays what it was.
 */
function positions(content: DocumentContent, rates: ReadonlyMap<string, number>): Line[] {
  return outlineRows(content.lines).flatMap((row) => {
    if (row.row !== 'item') {
      return []
    }

    const { line } = row
    const turned = line.unitPriceCents < 0

    return [
      {
        id: row.number,
        name: line.designation,
        description: line.description,
        quantityMilli: turned ? -line.quantityMilli : line.quantityMilli,
        unitCode: unitCodes[line.unit],
        priceCents: Math.abs(line.unitPriceCents),
        totalCents: line.netCents,
        category: categoryOf(content.taxTreatment, rates.get(line.vatRate) ?? 0),
      },
    ]
  })
}

/**
 * The progress invoices a document takes off, as lines with a negative
 * quantity, one per rate they were taxed at.
 *
 * Lines and not allowances on the document. An allowance in the standard is a
 * reduction of the price, and a progress invoice taken off is none: it is what
 * was billed already, and section 14 (5) UStG wants it deducted with its tax.
 * A line of minus one at the net amount, taxed at the rate it was taxed at, is
 * that sentence in the standard's own terms, and the test suite of the KoSIT
 * corrects in the same way. It also keeps the deduction at its own rate: should
 * the rate have changed in between, the invoice shows two rates, and each tax
 * stays the tax that was stated.
 *
 * On a cancellation the deductions are given back, so the line is plus one.
 */
function deductionLines(content: DocumentContent): Line[] {
  const returning = content.kind === 'cancellation_invoice'
  const label = returning
    ? 'Zurückgenommener Abzug der Abschlagsrechnung'
    : 'Abzüglich Abschlagsrechnung'

  return content.deductions
    .flatMap((deduction: DeductionContent) => {
      const name = `${label} ${deduction.number} vom ${day(deduction.documentDate)}`
      const parts =
        content.taxTreatment === 'standard'
          ? deduction.billed.byRate.map((entry) => ({
              netCents: entry.netCents,
              basisPoints: entry.basisPoints,
            }))
          : [{ netCents: deduction.billed.netCents, basisPoints: 0 }]

      return parts
        .filter((part) => part.netCents !== 0)
        .map((part) => ({
          name: parts.length > 1 ? `${name}, Anteil zu ${percent(part.basisPoints)} %` : name,
          description: null,
          quantityMilli: (part.netCents > 0 ? -1 : 1) * quantityFactor,
          unitCode: unitOne,
          priceCents: Math.abs(part.netCents),
          totalCents: -part.netCents,
          category: categoryOf(content.taxTreatment, part.basisPoints),
        }))
    })
    .map((line, index) => ({ ...line, id: `A${String(index + 1)}` }))
}

/** One group of the VAT breakdown, BG-23. */
interface Breakdown {
  readonly category: Category
  netCents: number
  taxCents: number
}

/**
 * The VAT breakdown, one group per category and rate, out of the frozen
 * figures: the totals of the work at their rates, less every deduction at its
 * own. Summed up by the same key the lines are grouped by, so the basis of a
 * group is exactly the sum of its lines, which is rule BR-S-08, and its tax is
 * the one the PDF states.
 */
function breakdown(content: DocumentContent): Breakdown[] {
  const groups = new Map<string, Breakdown>()

  function add(category: Category, netCents: number, taxCents: number) {
    const key = `${category.code}:${String(category.basisPoints)}`
    const group = groups.get(key) ?? { category, netCents: 0, taxCents: 0 }

    group.netCents += netCents
    group.taxCents += taxCents
    groups.set(key, group)
  }

  if (content.taxTreatment === 'standard') {
    for (const entry of content.totals.byRate) {
      add(categoryOf('standard', entry.basisPoints), entry.netCents, entry.taxCents)
    }

    for (const deduction of content.deductions) {
      for (const entry of deduction.billed.byRate) {
        add(categoryOf('standard', entry.basisPoints), -entry.netCents, -entry.taxCents)
      }
    }
  } else {
    const category = categoryOf(content.taxTreatment, 0)

    add(category, content.totals.netCents, 0)

    for (const deduction of content.deductions) {
      add(category, -deduction.billed.netCents, 0)
    }
  }

  return [...groups.values()].sort((left, right) =>
    left.category.code === right.category.code
      ? right.category.basisPoints - left.category.basisPoints
      : left.category.code.localeCompare(right.category.code),
  )
}

/**
 * A group of the breakdown. Under the reverse charge the standard wants the
 * reason, as a code and in words, and the words are the sentence the PDF
 * prints, which section 14a (5) UStG requires.
 */
function headerTax(group: Breakdown, content: DocumentContent): string {
  const reverse = group.category.code === 'AE'

  return (
    '<ram:ApplicableTradeTax>' +
    `<ram:CalculatedAmount>${amount(group.taxCents)}</ram:CalculatedAmount>` +
    '<ram:TypeCode>VAT</ram:TypeCode>' +
    (reverse ? element('ram:ExemptionReason', content.totals.taxNote) : '') +
    `<ram:BasisAmount>${amount(group.netCents)}</ram:BasisAmount>` +
    `<ram:CategoryCode>${group.category.code}</ram:CategoryCode>` +
    (reverse ? '<ram:ExemptionReasonCode>VATEX-EU-AE</ram:ExemptionReasonCode>' : '') +
    `<ram:RateApplicablePercent>${percent(group.category.basisPoints)}</ram:RateApplicablePercent>` +
    '</ram:ApplicableTradeTax>'
  )
}

/** Street and house number on one line, the way the address field prints them. */
function streetLine(street: string | null, houseNumber: string | null): string | null {
  const joined = [street, houseNumber].filter(present).join(' ')

  return joined === '' ? null : joined
}

function postalAddress(address: {
  readonly street: string | null
  readonly houseNumber: string | null
  readonly postalCode: string | null
  readonly city: string | null
  readonly country: string
}): string {
  return (
    '<ram:PostalTradeAddress>' +
    element('ram:PostcodeCode', address.postalCode) +
    element('ram:LineOne', streetLine(address.street, address.houseNumber)) +
    element('ram:CityName', address.city) +
    element('ram:CountryID', address.country) +
    '</ram:PostalTradeAddress>'
  )
}

/** An e-mail address as an electronic address, BT-34 and BT-49, scheme EM. */
function electronicAddress(email: string | null): string {
  return present(email)
    ? `<ram:URIUniversalCommunication>${element('ram:URIID', email, ' schemeID="EM"')}</ram:URIUniversalCommunication>`
    : ''
}

function vatRegistration(vatId: string | null): string {
  return present(vatId)
    ? `<ram:SpecifiedTaxRegistration>${element('ram:ID', compactVatId(vatId), ' schemeID="VA"')}</ram:SpecifiedTaxRegistration>`
    : ''
}

/**
 * The seller, BG-4. The register entry is the identifier the standard asks
 * for where there is no VAT identification number, rule BR-CO-26, and a court
 * belongs to it: HRB 12345 exists at every register court in the country.
 *
 * The contact, BG-6, is the business itself. XRechnung wants a contact point,
 * and the letterhead holds the telephone and the e-mail of the business, not
 * of a person; the contact point is then the business, by its name.
 */
function seller(content: DocumentContent): string {
  const { issuer } = content
  const register = present(issuer.registerNumber)
    ? [issuer.registerCourt, issuer.registerNumber].filter(present).join(' ')
    : null
  const contact =
    present(issuer.phone) || present(issuer.email)
      ? '<ram:DefinedTradeContact>' +
        element('ram:PersonName', issuer.name) +
        (present(issuer.phone)
          ? `<ram:TelephoneUniversalCommunication>${element('ram:CompleteNumber', issuer.phone)}</ram:TelephoneUniversalCommunication>`
          : '') +
        (present(issuer.email)
          ? `<ram:EmailURIUniversalCommunication>${element('ram:URIID', issuer.email)}</ram:EmailURIUniversalCommunication>`
          : '') +
        '</ram:DefinedTradeContact>'
      : ''

  return (
    '<ram:SellerTradeParty>' +
    element('ram:Name', issuer.name) +
    (register
      ? `<ram:SpecifiedLegalOrganization>${element('ram:ID', register)}</ram:SpecifiedLegalOrganization>`
      : '') +
    contact +
    postalAddress(issuer) +
    electronicAddress(issuer.email) +
    vatRegistration(issuer.vatId) +
    (present(issuer.taxNumber)
      ? `<ram:SpecifiedTaxRegistration>${element('ram:ID', issuer.taxNumber, ' schemeID="FC"')}</ram:SpecifiedTaxRegistration>`
      : '') +
    '</ram:SellerTradeParty>'
  )
}

function buyer(content: DocumentContent): string {
  const { recipient } = content

  return (
    '<ram:BuyerTradeParty>' +
    element('ram:Name', recipient.name) +
    postalAddress(recipient) +
    electronicAddress(recipient.email) +
    vatRegistration(recipient.vatId) +
    '</ram:BuyerTradeParty>'
  )
}

/**
 * Where and when the work was done. The site is the place of delivery, BG-15,
 * as soon as its address is complete enough for XRechnung, which wants town and
 * postal code; a single day of work is the actual delivery date, BT-72, and a
 * period is the invoicing period further down.
 */
function delivery(content: DocumentContent): string {
  const { site } = content
  const place =
    site !== null && present(site.postalCode) && present(site.city)
      ? `<ram:ShipToTradeParty>${element('ram:Name', site.designation)}${postalAddress(site)}</ram:ShipToTradeParty>`
      : ''
  const singleDay =
    content.serviceFrom === null || content.serviceUntil === null
      ? (content.serviceFrom ?? content.serviceUntil)
      : null
  const delivered =
    singleDay !== null
      ? `<ram:ActualDeliverySupplyChainEvent><ram:OccurrenceDateTime>${date(singleDay)}</ram:OccurrenceDateTime></ram:ActualDeliverySupplyChainEvent>`
      : ''

  return `<ram:ApplicableHeaderTradeDelivery>${place}${delivered}</ram:ApplicableHeaderTradeDelivery>`
}

/** How to pay, BG-16: a SEPA credit transfer to the account in the letterhead. */
function paymentMeans(content: DocumentContent): string {
  const { issuer } = content

  if (!present(issuer.iban)) {
    return ''
  }

  return (
    '<ram:SpecifiedTradeSettlementPaymentMeans><ram:TypeCode>58</ram:TypeCode>' +
    `<ram:PayeePartyCreditorFinancialAccount>${element('ram:IBANID', issuer.iban.replaceAll(/\s+/g, '').toUpperCase())}</ram:PayeePartyCreditorFinancialAccount>` +
    (present(issuer.bic)
      ? `<ram:PayeeSpecifiedCreditorFinancialInstitution>${element('ram:BICID', issuer.bic.replaceAll(/\s+/g, '').toUpperCase())}</ram:PayeeSpecifiedCreditorFinancialInstitution>`
      : '') +
    '</ram:SpecifiedTradeSettlementPaymentMeans>'
  )
}

/**
 * The notes of the document, BG-1: the subject, the sentence a cancellation
 * opens with, and the sentences the law requires under the totals. The letter
 * around the lines stays in the PDF, it is a letter and no statement of the
 * invoice.
 */
function notes(content: DocumentContent): string {
  const sentences = [
    content.subject,
    content.corrects
      ? `Hiermit stornieren wir die ${documentTitle(content.corrects.kind)} ` +
        `${content.corrects.number} vom ${day(content.corrects.documentDate)} in voller Höhe. ` +
        'Die Beträge sind die dieser Rechnung mit umgekehrtem Vorzeichen.'
      : null,
    ...content.notes,
  ]

  return sentences
    .filter(present)
    .map((sentence) => `<ram:IncludedNote>${element('ram:Content', sentence)}</ram:IncludedNote>`)
    .join('')
}

/**
 * The invoice a cancellation takes back, BG-3. The syntax holds one reference,
 * which is all a cancellation has; the progress invoices a final invoice takes
 * off are named by their lines instead.
 */
function precedingInvoice(content: DocumentContent): string {
  const { corrects } = content

  return corrects
    ? '<ram:InvoiceReferencedDocument>' +
        element('ram:IssuerAssignedID', corrects.number) +
        `<ram:FormattedIssueDateTime>${date(corrects.documentDate, 'qdt')}</ram:FormattedIssueDateTime>` +
        '</ram:InvoiceReferencedDocument>'
    : ''
}

/**
 * The e-invoice of an issued invoice, as a string of XML in UTF-8.
 *
 * Refuses what is not one: a document without a number has not been issued,
 * and an e-invoice without its number would be an invoice nobody can book.
 * Whether a document should go out as an e-invoice at all is `formatFor`,
 * whether it lacks something is `eInvoiceGaps`; both are asked before this.
 */
export function ciiInvoice(content: DocumentContent, profile: EInvoiceProfile): string {
  if (content.number === null) {
    throw new RuleError('Eine E-Rechnung gibt es erst für eine festgeschriebene Rechnung.')
  }

  const code = typeCode(content)
  const rates = new Map(content.totals.byRate.map((entry) => [entry.rate, entry.basisPoints]))
  const lines = [...positions(content, rates), ...deductionLines(content)]
  const groups = breakdown(content)
  const lineTotal = lines.reduce((sum, line) => sum + line.totalCents, 0)
  const taxTotal = groups.reduce((sum, group) => sum + group.taxCents, 0)

  // The frozen figures and the ones written here have to be the same figures.
  // They are by construction, and this is where a slip in the construction
  // would show before a recipient's validator shows it.
  if (lineTotal !== content.billed.netCents || taxTotal !== content.billed.taxCents) {
    throw new Error(
      `The e-invoice of ${content.number} does not add up to what it froze: ` +
        `${String(lineTotal)}/${String(taxTotal)} against ` +
        `${String(content.billed.netCents)}/${String(content.billed.taxCents)}.`,
    )
  }

  const period =
    content.serviceFrom !== null && content.serviceUntil !== null
      ? `<ram:BillingSpecifiedPeriod><ram:StartDateTime>${date(content.serviceFrom)}</ram:StartDateTime>` +
        `<ram:EndDateTime>${date(content.serviceUntil)}</ram:EndDateTime></ram:BillingSpecifiedPeriod>`
      : ''

  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    `<rsm:CrossIndustryInvoice ${namespaces}>` +
    '<rsm:ExchangedDocumentContext>' +
    `<ram:BusinessProcessSpecifiedDocumentContextParameter><ram:ID>${businessProcess}</ram:ID></ram:BusinessProcessSpecifiedDocumentContextParameter>` +
    `<ram:GuidelineSpecifiedDocumentContextParameter><ram:ID>${guidelines[profile]}</ram:ID></ram:GuidelineSpecifiedDocumentContextParameter>` +
    '</rsm:ExchangedDocumentContext>' +
    '<rsm:ExchangedDocument>' +
    element('ram:ID', content.number) +
    `<ram:TypeCode>${code}</ram:TypeCode>` +
    `<ram:IssueDateTime>${date(content.documentDate)}</ram:IssueDateTime>` +
    notes(content) +
    '</rsm:ExchangedDocument>' +
    '<rsm:SupplyChainTradeTransaction>' +
    lines.map(lineItem).join('') +
    '<ram:ApplicableHeaderTradeAgreement>' +
    element('ram:BuyerReference', content.recipient.buyerReference) +
    seller(content) +
    buyer(content) +
    '</ram:ApplicableHeaderTradeAgreement>' +
    delivery(content) +
    '<ram:ApplicableHeaderTradeSettlement>' +
    '<ram:InvoiceCurrencyCode>EUR</ram:InvoiceCurrencyCode>' +
    paymentMeans(content) +
    groups.map((group) => headerTax(group, content)).join('') +
    period +
    '<ram:SpecifiedTradeSettlementHeaderMonetarySummation>' +
    `<ram:LineTotalAmount>${amount(lineTotal)}</ram:LineTotalAmount>` +
    `<ram:TaxBasisTotalAmount>${amount(lineTotal)}</ram:TaxBasisTotalAmount>` +
    `<ram:TaxTotalAmount currencyID="EUR">${amount(taxTotal)}</ram:TaxTotalAmount>` +
    `<ram:GrandTotalAmount>${amount(content.billed.grossCents)}</ram:GrandTotalAmount>` +
    `<ram:DuePayableAmount>${amount(content.billed.grossCents)}</ram:DuePayableAmount>` +
    '</ram:SpecifiedTradeSettlementHeaderMonetarySummation>' +
    precedingInvoice(content) +
    '</ram:ApplicableHeaderTradeSettlement>' +
    '</rsm:SupplyChainTradeTransaction>' +
    '</rsm:CrossIndustryInvoice>\n'
  )
}
