import type { Address } from '../model/address.js'
import type { DocumentKind } from '../model/document.js'
import { isInvoice } from '../model/document.js'
import type { DocumentContent } from '../model/document-content.js'
import type { RuleSet } from './rule.js'

/**
 * Which list of mandatory details an invoice has to satisfy.
 *
 * Three, because the law has three. The full list of section 14 (4) UStG is
 * the rule. Section 33 UStDV cuts it down for an invoice of a small amount,
 * and section 34a UStDV, since 2025, for an invoice of a business under the
 * small business rule. Both of the short lists leave out things a trade
 * business meets every day: an invoice of 180 euros for a cash sale needs no
 * address of the customer, and a small business needs no invoice number.
 */
export const detailsRegimes = ['full', 'small_amount', 'small_business'] as const

export type DetailsRegime = (typeof detailsRegimes)[number]

/** Everything the check can find missing, one key per statement it makes. */
export const mandatoryDetails = [
  'issuer_name',
  'issuer_address',
  'issuer_tax_number',
  'recipient_name',
  'recipient_address',
  'lines',
  'line_designation',
  'service_date',
  'corrected_invoice',
] as const

export type MandatoryDetail = (typeof mandatoryDetails)[number]

export interface MissingDetail {
  readonly detail: MandatoryDetail
  /**
   * German, and it names the paragraph. Whoever reads it has to go and fix
   * something, often in a different place than the document: the letterhead,
   * the customer. Knowing why it is required is what makes that worth doing.
   */
  readonly message: string
  /** The line it concerns, for a detail that belongs to one. */
  readonly position?: number
}

/**
 * The kinds that are written after the work is done, so the time of it is
 * known and has to be stated.
 *
 * Not the progress invoice. It is written while the work is still going on,
 * and for a payment on account section 14 (4) number 6 UStG asks for the day
 * the money arrived, and only when that is known and differs from the date of
 * the invoice. Not the two correcting kinds either: they refer to an invoice
 * that states it already, and naming that invoice is a requirement of its
 * own, `corrected_invoice` below.
 */
const servicedKinds: readonly DocumentKind[] = [
  'partial_invoice',
  'final_invoice',
  'recurring_invoice',
]

/** Where each requirement comes from, per regime. Null where it does not apply. */
const basis: Readonly<
  Record<
    DetailsRegime,
    {
      readonly issuer: string
      readonly recipient: string | null
      readonly taxNumber: string | null
      readonly lines: string
      readonly serviceDate: string | null
    }
  >
> = {
  full: {
    issuer: '§ 14 Abs. 4 Nr. 1 UStG',
    recipient: '§ 14 Abs. 4 Nr. 1 UStG',
    taxNumber: '§ 14 Abs. 4 Nr. 2 UStG',
    lines: '§ 14 Abs. 4 Nr. 5 UStG',
    serviceDate: '§ 14 Abs. 4 Nr. 6 UStG',
  },
  small_amount: {
    issuer: '§ 33 Satz 1 Nr. 1 UStDV',
    recipient: null,
    taxNumber: null,
    lines: '§ 33 Satz 1 Nr. 3 UStDV',
    serviceDate: null,
  },
  small_business: {
    issuer: '§ 34a Satz 1 Nr. 1 UStDV',
    recipient: '§ 34a Satz 1 Nr. 1 UStDV',
    taxNumber: '§ 34a Satz 1 Nr. 2 UStDV',
    lines: '§ 34a Satz 1 Nr. 4 UStDV',
    serviceDate: null,
  },
}

/**
 * The list an invoice has to satisfy, or null for a document that is not an
 * invoice at all.
 *
 * The order of the questions follows the law. A reverse charge never gets the
 * short list, section 33 sentence 3 UStDV rules it out. A small amount comes
 * next, and it comes before the small business rule on purpose: section 34a
 * sentence 2 leaves section 33 untouched, so a small business writing a small
 * invoice gets the shorter of the two.
 *
 * The small amount is measured on the gross total, as section 33 says, and on
 * its magnitude: a credit note of minus 120 euros is as small as an invoice of
 * 120. Both thresholds come from the rule package with the document date, so
 * an invoice from 2016 is measured against the 150 euros of 2016.
 */
export function detailsRegime(
  rules: RuleSet,
  content: Pick<DocumentContent, 'kind' | 'taxTreatment' | 'documentDate' | 'totals'>,
): DetailsRegime | null {
  if (!isInvoice(content.kind)) {
    return null
  }

  if (content.taxTreatment !== 'reverse_charge') {
    const limit = rules.valueAt('invoice.small_amount_limit', 'cents', content.documentDate)

    if (Math.abs(content.totals.grossCents) <= limit) {
      return 'small_amount'
    }
  }

  if (
    content.taxTreatment === 'small_business' &&
    rules.valueAt('invoice.small_business_simplified', 'flag', content.documentDate) === 1
  ) {
    return 'small_business'
  }

  return 'full'
}

function blank(value: string | null): boolean {
  return value === null || value.trim() === ''
}

/**
 * The parts of an address that are missing, named the way a person names them.
 *
 * Street, postal code and town. Not the house number: it is often written into
 * the street, and a post office box has none. Not the country either, which is
 * never empty.
 */
function missingParts(address: Address): readonly string[] {
  return [
    blank(address.street) ? 'Straße' : null,
    blank(address.postalCode) ? 'Postleitzahl' : null,
    blank(address.city) ? 'Ort' : null,
  ].filter((part): part is string => part !== null)
}

/** "Straße", "Straße und Ort", "Straße, Postleitzahl und Ort". */
function inWords(parts: readonly string[]): string {
  if (parts.length <= 1) {
    return parts.join('')
  }

  return `${parts.slice(0, -1).join(', ')} und ${parts.at(-1) ?? ''}`
}

/**
 * What an invoice is missing before it may be issued, each with a sentence
 * that says what and why. Empty when nothing is missing, and always empty for
 * a document that is not an invoice.
 *
 * Checked on the content record, the one that also gets printed and stored,
 * so that what was checked and what went out are the same thing.
 *
 * Some of the list never shows up here, because it cannot be missing: the
 * date of issue is a required column, the number is handed out by the issuing
 * itself, and the totals and the tax sentence are worked out and not typed.
 * What is left is what somebody has to enter, which is exactly what a message
 * is useful for.
 */
export function missingDetails(rules: RuleSet, content: DocumentContent): readonly MissingDetail[] {
  const regime = detailsRegime(rules, content)

  if (regime === null) {
    return []
  }

  const cited = basis[regime]
  const missing: MissingDetail[] = []

  if (blank(content.issuer.name)) {
    missing.push({
      detail: 'issuer_name',
      message: `Im Briefkopf fehlt der Name des Betriebs (${cited.issuer}).`,
    })
  }

  const issuerGaps = missingParts(content.issuer)

  if (issuerGaps.length > 0) {
    missing.push({
      detail: 'issuer_address',
      message:
        `Im Briefkopf ist die Anschrift des Betriebs unvollständig. ` +
        `Es fehlt: ${inWords(issuerGaps)} (${cited.issuer}).`,
    })
  }

  if (cited.taxNumber !== null && blank(content.issuer.taxNumber) && blank(content.issuer.vatId)) {
    missing.push({
      detail: 'issuer_tax_number',
      message:
        'Im Briefkopf fehlt die Steuernummer oder die Umsatzsteuer-Identifikationsnummer ' +
        `(${cited.taxNumber}).`,
    })
  }

  if (cited.recipient !== null) {
    if (blank(content.recipient.name)) {
      missing.push({
        detail: 'recipient_name',
        message: `Der Kunde hat keinen Namen (${cited.recipient}).`,
      })
    }

    const recipientGaps = missingParts(content.recipient)

    if (recipientGaps.length > 0) {
      missing.push({
        detail: 'recipient_address',
        message:
          `Die Anschrift des Kunden ist unvollständig. ` +
          `Es fehlt: ${inWords(recipientGaps)} (${cited.recipient}).`,
      })
    }
  }

  // Titles do not count. A document of three headings and no position says
  // nothing about the quantity and the kind of the work, which is what the
  // paragraph asks for.
  if (!content.lines.some((line) => line.kind === 'item')) {
    missing.push({
      detail: 'lines',
      message:
        'Der Beleg hat keine Position. Menge und Art der Leistung gehören auf die Rechnung ' +
        `(${cited.lines}).`,
    })
  }

  for (const line of content.lines) {
    if (blank(line.designation)) {
      missing.push({
        detail: 'line_designation',
        position: line.position,
        message: `Position ${String(line.position)} hat keine Bezeichnung (${cited.lines}).`,
      })
    }
  }

  // In every regime: a cancellation that does not name the invoice it takes
  // back cannot be matched to it, and section 31 (5) UStDV wants a correcting
  // document to refer to its invoice specifically and unambiguously. The route
  // that makes a cancellation always names it; this is the net under it.
  if (content.kind === 'cancellation_invoice' && content.corrects === null) {
    missing.push({
      detail: 'corrected_invoice',
      message: 'Die Stornorechnung nennt die Rechnung nicht, die sie aufhebt (§ 31 Abs. 5 UStDV).',
    })
  }

  if (
    cited.serviceDate !== null &&
    servicedKinds.includes(content.kind) &&
    content.serviceFrom === null
  ) {
    missing.push({
      detail: 'service_date',
      message:
        'Der Leistungszeitraum fehlt, also wann die Arbeit erbracht wurde ' +
        `(${cited.serviceDate}).`,
    })
  }

  return missing
}
