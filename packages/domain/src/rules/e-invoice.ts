import { isInvoice } from '../model/document.js'
import type { DocumentContent } from '../model/document-content.js'
import type { IsoDate } from '../model/identifier.js'
import { detailsRegime } from './mandatory-details.js'
import type { RuleSet } from './rule.js'

/**
 * How an invoice leaves the house: as an electronic invoice in the sense of
 * section 14 (1) UStG, structured and in the European standard EN 16931, or as
 * what the law calls a "sonstige Rechnung", which in this software is the PDF.
 */
export const invoiceFormats = ['e_invoice', 'pdf'] as const

export type InvoiceFormat = (typeof invoiceFormats)[number]

export interface FormatChoice {
  readonly format: InvoiceFormat
  /** Why, in one German sentence that names the paragraph. */
  readonly reason: string
}

/** The country code of a business in Germany, the only one the duty knows. */
const domestic = 'DE'

/** "31.12.2026", the way a German reads a date. */
function day(on: IsoDate): string {
  return `${on.slice(8, 10)}.${on.slice(5, 7)}.${on.slice(0, 4)}`
}

/** "800.000 Euro". A limit in the law is a round figure, so the cents stay out. */
function wholeEuros(cents: number): string {
  return `${String(Math.trunc(cents / 100)).replaceAll(/\B(?=(\d{3})+(?!\d))/g, '.')} Euro`
}

/**
 * Whether an exception of the rule package is in force on a day. Before 2025
 * there is no record, because there was no duty to make an exception from.
 */
function excepted(rules: RuleSet, key: string, on: IsoDate): boolean {
  return rules.at(key, on)?.value === 1
}

/**
 * The format an invoice goes out in, decided by who it goes to.
 *
 * Out of the recipient, and the recipient is the customer as the document
 * froze it: a business or not, in Germany or not. Nothing on the document
 * itself takes part, and that is the point of section 4.2 and of the issue that
 * built this. A switch on the invoice gets set wrong one day, and a customer
 * who is a business on the master record is a business on every invoice.
 *
 * The exceptions come after the recipient, in the order the law has them. A
 * small business may send every invoice as a PDF, section 34a sentence 4 UStDV,
 * and so may anybody for an invoice of a small amount, section 33 sentence 4
 * UStDV; a reverse charge never counts as one, which `detailsRegime` already
 * knows. The concept turns "may" into "does" for both: a business that is
 * allowed a PDF gets one, rather than a file it did not ask for.
 *
 * Whether the e-invoice is also required, and not merely the format of
 * choice, is a second question with a second answer: see `eInvoiceDuty`. Until
 * the end of 2027 the law lets most businesses send a PDF to another business,
 * and OpenGewerk still sends the e-invoice, because a business going live in
 * 2026 has to from 2028 on at the latest, and one that changes formats halfway
 * through has two kinds of invoices in its books.
 */
export function formatFor(
  rules: RuleSet,
  content: Pick<
    DocumentContent,
    'kind' | 'taxTreatment' | 'documentDate' | 'totals' | 'issuer' | 'recipient'
  >,
): FormatChoice {
  if (!isInvoice(content.kind)) {
    return { format: 'pdf', reason: 'Nur eine Rechnung wird als E-Rechnung ausgestellt.' }
  }

  // No route makes a credit note yet, and whether one is a correction of an
  // invoice (code 384, with the invoice it corrects) or a credit of its own
  // (code 381) is decided when there is one. Until then it is not guessed.
  if (content.kind === 'credit_note') {
    return {
      format: 'pdf',
      reason: 'Eine Gutschrift stellt OpenGewerk noch nicht als E-Rechnung aus.',
    }
  }

  if (!content.recipient.isBusiness) {
    return {
      format: 'pdf',
      reason:
        'Der Kunde ist kein Unternehmen. Die E-Rechnung ist nur zwischen Unternehmen ' +
        'vorgeschrieben (§ 14 Abs. 2 Satz 2 Nr. 1 UStG).',
    }
  }

  if (content.recipient.country !== domestic) {
    return {
      format: 'pdf',
      reason:
        'Der Kunde sitzt nicht im Inland. Die E-Rechnung ist nur vorgeschrieben, wenn beide ' +
        'Seiten im Inland ansässig sind (§ 14 Abs. 2 Satz 2 Nr. 1 UStG).',
    }
  }

  if (content.issuer.country !== domestic) {
    return {
      format: 'pdf',
      reason:
        'Der Betrieb sitzt laut Briefkopf nicht im Inland. Die E-Rechnung ist nur ' +
        'vorgeschrieben, wenn beide Seiten im Inland ansässig sind (§ 14 Abs. 2 Satz 2 Nr. 1 UStG).',
    }
  }

  if (
    content.taxTreatment === 'small_business' &&
    excepted(rules, 'e_invoice.small_business_exception', content.documentDate)
  ) {
    return {
      format: 'pdf',
      reason:
        'Als Kleinunternehmer darf der Betrieb jede Rechnung als PDF stellen (§ 34a Satz 4 UStDV).',
    }
  }

  if (
    detailsRegime(rules, content) === 'small_amount' &&
    excepted(rules, 'e_invoice.small_amount_exception', content.documentDate)
  ) {
    const limit = rules.valueAt('invoice.small_amount_limit', 'cents', content.documentDate)

    return {
      format: 'pdf',
      reason: `Eine Rechnung bis ${wholeEuros(limit)} darf immer als PDF gehen (§ 33 Satz 4 UStDV).`,
    }
  }

  return {
    format: 'e_invoice',
    reason:
      'Der Kunde ist ein Unternehmen im Inland, die Rechnung geht deshalb als E-Rechnung ' +
      '(§ 14 Abs. 2 Satz 2 Nr. 1 UStG).',
  }
}

/**
 * The day the work counts as done, for the question which rules it falls
 * under: the end of the period of the work, its only day, or, where nobody
 * entered one, the date of the invoice. The transition of section 27 (38) UStG
 * speaks of a supply that was carried out, not of an invoice that was written.
 */
export function supplyDateOf(
  content: Pick<DocumentContent, 'documentDate' | 'serviceFrom' | 'serviceUntil'>,
): IsoDate {
  return content.serviceUntil ?? content.serviceFrom ?? content.documentDate
}

export interface Duty {
  /**
   * The law requires the e-invoice. A PDF alone would not be a proper invoice,
   * so an invoice that cannot be made into one is not issued.
   */
  readonly required: boolean
  readonly reason: string
}

/**
 * Whether an invoice that goes out as an e-invoice has to, or merely does.
 *
 * Since 2025 the e-invoice is the rule between businesses in Germany. Section
 * 27 (38) UStG lets it in gently: a supply of 2025 or 2026 may still be invoiced
 * on paper or as a PDF until the end of 2026, and a supply of 2027 until the end
 * of 2027, the second only for a business whose total turnover the year before
 * was not above the limit. From 2028 on there is no way round it.
 *
 * Both halves of each transition count. It asks for the day of the supply and
 * for the invoice to be written within the same period, so work done in
 * December 2026 and invoiced in January 2027 falls under neither and needs the
 * e-invoice. That is what the paragraph says, and it is the stricter reading
 * besides, which is the one that is never wrong: an e-invoice is allowed where
 * a PDF would have been.
 *
 * The turnover is not a figure this software knows before the bookkeeping of
 * phase 3, so the business states it: `e_invoice.transition_claimed`, the
 * claim that it stayed under the limit. Without the claim the e-invoice is
 * required, for the same reason.
 */
export function eInvoiceDuty(
  rules: RuleSet,
  content: Pick<DocumentContent, 'documentDate' | 'serviceFrom' | 'serviceUntil'>,
  transitionClaimed: boolean,
): Duty {
  const supplied = supplyDateOf(content)

  if (rules.valueAt('e_invoice.required', 'flag', supplied) === 0) {
    return {
      required: false,
      reason: 'Für eine Leistung vor 2025 gab es keine Pflicht zur E-Rechnung.',
    }
  }

  const duty = rules.at('e_invoice.required', supplied)
  const dutySource = duty?.source ?? '§ 14 Abs. 2 Satz 2 Nr. 1 UStG'
  const transition = rules.at('e_invoice.transition', supplied)

  if (transition?.value === 1 && transition.validUntil !== null) {
    const deadline = transition.validUntil

    if (content.documentDate > deadline) {
      return {
        required: true,
        reason:
          `Pflicht: der Übergang für diese Leistung galt nur für eine Rechnung, die bis zum ` +
          `${day(deadline)} ausgestellt wurde (${transition.source}).`,
      }
    }

    const limit = rules.at('e_invoice.transition_turnover_limit', supplied)

    if (limit === null) {
      return {
        required: false,
        reason:
          `Noch keine Pflicht: eine Rechnung, die bis zum ${day(deadline)} ausgestellt wird, darf ` +
          `für diese Leistung auch als PDF gehen, wenn der Kunde zustimmt (${transition.source}).`,
      }
    }

    if (transitionClaimed) {
      return {
        required: false,
        reason:
          `Noch keine Pflicht: nach Angabe des Betriebs lag sein Gesamtumsatz im Vorjahr nicht ` +
          `über ${wholeEuros(limit.value)}. Eine Rechnung, die bis zum ${day(deadline)} ausgestellt ` +
          `wird, darf dann auch als PDF gehen, wenn der Kunde zustimmt (${limit.source}).`,
      }
    }

    return {
      required: true,
      reason:
        `Pflicht: die Ausnahme für einen Gesamtumsatz im Vorjahr bis ${wholeEuros(limit.value)} ` +
        `hat der Betrieb nicht in Anspruch genommen (${limit.source}).`,
    }
  }

  return {
    required: true,
    reason: `Pflicht: eine Rechnung an ein Unternehmen im Inland ist als E-Rechnung auszustellen (${dutySource}).`,
  }
}

/**
 * The two shapes this software writes an e-invoice in. Both are the same
 * invoice in the syntax UN/CEFACT CII, and they differ in what they promise.
 *
 * `en16931` is the European standard itself, the core every e-invoice in the
 * sense of section 14 UStG meets, and the profile inside a ZUGFeRD PDF.
 * `xrechnung` is the German usage of it, which public authorities require and
 * which asks for more: a reference of the buyer, an electronic address on both
 * sides, a contact of the seller with telephone and e-mail, and how to pay.
 */
export const eInvoiceProfiles = ['en16931', 'xrechnung'] as const

export type EInvoiceProfile = (typeof eInvoiceProfiles)[number]

/** Everything the check can find missing for an e-invoice, one key per statement. */
export const eInvoiceDetails = [
  'issuer_identifier',
  'issuer_vat_id_format',
  'recipient_vat_id',
  'recipient_vat_id_format',
  'buyer_reference',
  'recipient_email',
  'issuer_email',
  'issuer_phone',
  'issuer_iban',
] as const

export type EInvoiceDetail = (typeof eInvoiceDetails)[number]

export interface EInvoiceGap {
  readonly detail: EInvoiceDetail
  /** German, and it names the rule of the standard the value is needed for. */
  readonly message: string
}

/**
 * What the office is told about the e-invoice of a document, by the server,
 * which alone holds what an issued invoice froze. Here and not in the server
 * because the screen reads the same shape.
 */
export interface EInvoiceStatus extends FormatChoice {
  /** Null for a document that goes out as a PDF: there is nothing to require. */
  readonly duty: Duty | null
  /** Whether the document has its number, and an e-invoice can be made of it now. */
  readonly issued: boolean
  /**
   * What each of the two forms would lack. The ZUGFeRD PDF carries the
   * standard itself, the XRechnung its German usage with the further demands
   * that has, so the second list holds the first.
   */
  readonly xrechnung: { readonly missing: readonly EInvoiceGap[] }
  readonly zugferd: { readonly missing: readonly EInvoiceGap[] }
}

/**
 * A VAT identification number the way the standard wants it: without the
 * spaces people type it with and in capitals. Used by the check and by the
 * writer alike, so that what was checked is what gets written.
 */
export function compactVatId(value: string): string {
  return value.replaceAll(/\s+/g, '').toUpperCase()
}

/**
 * Whether a VAT identification number starts with the two letters of its
 * country, which rule BR-CO-09 of EN 16931 checks. A number typed without its
 * prefix is still the right number to a person and a refused invoice to the
 * recipient's software.
 */
function carriesCountry(vatId: string): boolean {
  return /^[A-Z]{2}[0-9A-Z]/.test(compactVatId(vatId))
}

function blank(value: string | null): boolean {
  return value === null || value.trim() === ''
}

/**
 * What an e-invoice would lack, each with a sentence that says what and why.
 * Empty when nothing is missing.
 *
 * The mandatory details of section 14 (4) UStG are not repeated here, because
 * `missingDetails` checks them before any invoice is issued, and an invoice
 * that goes out as an e-invoice is always one with the full list. What is left
 * is what the standard asks for beyond the law, each item under the rule of
 * the standard it comes from, because that is what a recipient's validator
 * reports when it refuses the file.
 *
 * Every value is read from the content the invoice froze, so an e-invoice
 * never says something the PDF does not.
 */
export function eInvoiceGaps(
  content: Pick<DocumentContent, 'taxTreatment' | 'issuer' | 'recipient'>,
  profile: EInvoiceProfile,
): readonly EInvoiceGap[] {
  const { issuer, recipient } = content
  const gaps: EInvoiceGap[] = []

  // The tax number identifies a business to its tax office and to nobody
  // else, so the standard wants one of the identifiers that work across
  // borders: the VAT identification number or the entry in the register.
  if (blank(issuer.vatId) && blank(issuer.registerNumber)) {
    gaps.push({
      detail: 'issuer_identifier',
      message:
        'Im Briefkopf fehlt die Umsatzsteuer-Identifikationsnummer oder die ' +
        'Handelsregisternummer. Die Steuernummer allein genügt der Norm nicht (EN 16931, BR-CO-26).',
    })
  }

  if (issuer.vatId !== null && !blank(issuer.vatId) && !carriesCountry(issuer.vatId)) {
    gaps.push({
      detail: 'issuer_vat_id_format',
      message:
        'Die Umsatzsteuer-Identifikationsnummer im Briefkopf beginnt nicht mit dem ' +
        'Länderkürzel, etwa DE (EN 16931, BR-CO-09).',
    })
  }

  if (content.taxTreatment === 'reverse_charge' && blank(recipient.vatId)) {
    gaps.push({
      detail: 'recipient_vat_id',
      message:
        'Bei Steuerschuldnerschaft des Leistungsempfängers braucht die E-Rechnung die ' +
        'Umsatzsteuer-Identifikationsnummer des Kunden (EN 16931, BR-AE-02).',
    })
  }

  if (recipient.vatId !== null && !blank(recipient.vatId) && !carriesCountry(recipient.vatId)) {
    gaps.push({
      detail: 'recipient_vat_id_format',
      message:
        'Die Umsatzsteuer-Identifikationsnummer des Kunden beginnt nicht mit dem Länderkürzel, ' +
        'etwa DE (EN 16931, BR-CO-09).',
    })
  }

  if (profile === 'xrechnung') {
    if (blank(recipient.buyerReference)) {
      gaps.push({
        detail: 'buyer_reference',
        message:
          'Für die XRechnung fehlt die Käuferreferenz des Kunden, bei einer Behörde ihre ' +
          'Leitweg-ID (XRechnung, BR-DE-15).',
      })
    }

    if (blank(recipient.email)) {
      gaps.push({
        detail: 'recipient_email',
        message:
          'Für die XRechnung fehlt die E-Mail-Adresse des Kunden, sie ist seine elektronische ' +
          'Adresse (XRechnung, PEPPOL-EN16931-R010).',
      })
    }

    if (blank(issuer.email)) {
      gaps.push({
        detail: 'issuer_email',
        message: 'Für die XRechnung fehlt die E-Mail-Adresse im Briefkopf (XRechnung, BR-DE-7).',
      })
    }

    if (blank(issuer.phone)) {
      gaps.push({
        detail: 'issuer_phone',
        message: 'Für die XRechnung fehlt die Telefonnummer im Briefkopf (XRechnung, BR-DE-6).',
      })
    }

    if (blank(issuer.iban)) {
      gaps.push({
        detail: 'issuer_iban',
        message:
          'Für die XRechnung fehlt die Bankverbindung im Briefkopf. Sie verlangt eine Angabe, ' +
          'wie bezahlt wird (XRechnung, BR-DE-1).',
      })
    }
  }

  return gaps
}
