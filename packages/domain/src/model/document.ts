import type {
  CustomerId,
  DocumentId,
  InstallationId,
  IsoDate,
  JobId,
  SiteId,
  Synced,
} from './identifier.js'

/**
 * The document types of section 4.2. Estimate and quote are separate on
 * purpose: a Kostenanschlag under section 649 BGB is an estimate the business
 * does not stand behind, and exceeding it substantially obliges it to tell the
 * customer before going on, while a quote is an offer at its prices. The
 * concept cited section 650 up to v2.5, which is where the Kostenanschlag
 * stood before the reform of 2018.
 */
export const documentKinds = [
  'cost_estimate',
  'quote',
  'order_confirmation',
  'delivery_note',
  /** Regiebericht, signed by the customer on site. */
  'time_and_material_report',
  /** Abschlagsrechnung, cumulative: total progress less what was billed. */
  'progress_invoice',
  'partial_invoice',
  'final_invoice',
  /** Gutschrift, a correction and not a deletion. */
  'credit_note',
  'cancellation_invoice',
  /** Dauerrechnung for maintenance contracts. */
  'recurring_invoice',
] as const

export type DocumentKind = (typeof documentKinds)[number]

/**
 * The kinds that are an invoice in the sense of section 14 UStG, and only
 * these have to carry its mandatory details. A quote or a delivery note is
 * business correspondence, not a claim for payment, and nobody deducts input
 * tax from one.
 *
 * The correcting kinds are in the list. A cancellation or a credit note goes
 * to the same recipient and ends up in the same books as the invoice it
 * corrects.
 */
export const invoiceKinds = [
  'progress_invoice',
  'partial_invoice',
  'final_invoice',
  'credit_note',
  'cancellation_invoice',
  'recurring_invoice',
] as const satisfies readonly DocumentKind[]

export function isInvoice(kind: DocumentKind): boolean {
  return (invoiceKinds as readonly DocumentKind[]).includes(kind)
}

/**
 * Which document may follow which, the chain of section 1.4 one link at a
 * time.
 *
 * An invoice follows whatever the work was agreed or recorded on: the quote,
 * the estimate, the order confirmation, the report. A progress invoice is
 * followed by the next one or by the final invoice, and that is how the
 * cumulative billing of section 4.2 is chained: each of them deducts what the
 * progress invoices before it in the chain billed.
 *
 * The report leads to the final invoice and to nothing else. It records work
 * that is done, and a progress invoice is for work that is still going on.
 *
 * The cancellation is not in the table. It is not written, it is made in one
 * step out of the invoice it cancels, and it has a route of its own. A kind
 * that is not in this table cannot be made from another one at all, which is
 * the point of writing it down: a chain that anything can be attached to is
 * not a chain.
 */
export const successorKinds: Readonly<Partial<Record<DocumentKind, readonly DocumentKind[]>>> = {
  quote: ['order_confirmation', 'progress_invoice', 'final_invoice'],
  cost_estimate: ['order_confirmation', 'progress_invoice', 'final_invoice'],
  order_confirmation: ['progress_invoice', 'final_invoice'],
  time_and_material_report: ['final_invoice'],
  progress_invoice: ['progress_invoice', 'final_invoice'],
}

/** The kinds that may follow a document of this kind. */
export function successorsOf(kind: DocumentKind): readonly DocumentKind[] {
  return successorKinds[kind] ?? []
}

/**
 * The kinds that take off what the progress invoices before them in the chain
 * billed: the next progress invoice and the final invoice.
 *
 * Section 4.2 wants the progress invoice cumulative, the total progress less
 * what was billed so far, and section 14 (5) UStG wants the same of the final
 * invoice. Written down once, because the server gathers the deductions for
 * exactly these kinds and the screens show them for exactly these.
 */
export const deductingKinds: readonly DocumentKind[] = ['progress_invoice', 'final_invoice']

export function deducts(kind: DocumentKind): boolean {
  return deductingKinds.includes(kind)
}

/**
 * The invoices a cancellation can be made out of. Not the two correcting
 * kinds: a cancellation of a cancellation would bring back an invoice that is
 * in the books as cancelled, and whoever wants to bill that work again writes
 * a new invoice, which says so.
 */
export const cancellableKinds: readonly DocumentKind[] = [
  'progress_invoice',
  'partial_invoice',
  'final_invoice',
  'recurring_invoice',
]

export function isCancellable(kind: DocumentKind): boolean {
  return cancellableKinds.includes(kind)
}

/**
 * The kinds that record what was done rather than what it costs, and are
 * printed without prices and totals.
 *
 * The report of #73 is the case. It is written on site, where nobody prices
 * anything, and signed for its hours and materials; the prices come with the
 * invoice made out of it. A report printed with a column of zero euros would
 * say something nobody meant.
 */
export const unpricedKinds: readonly DocumentKind[] = ['time_and_material_report']

export function showsPrices(kind: DocumentKind): boolean {
  return !unpricedKinds.includes(kind)
}

/**
 * A document is a draft until it is issued. From then on it is fixed: nothing
 * is deleted, a mistake is corrected by a cancellation or a credit note. That
 * is leading decision 4, GoBD by design.
 *
 * `signed` sits between the two, for a document a customer signs on site: the
 * report of #73. From the signature on it no longer changes, because the
 * customer signed exactly this; it has no number yet, because issuing is the
 * office's step and not the technician's. The office issues it later, and
 * that is the only step left to it.
 *
 * Enforced, not merely described. The number comes out of a counter under a
 * row lock, a trigger in the database refuses every later change to an issued
 * document, and the sync rules keep the three fields that make up the issuing
 * out of a device's reach. What is left here is the vocabulary those rules
 * are written in.
 */
export const documentStatuses = ['draft', 'signed', 'issued', 'cancelled'] as const

export type DocumentStatus = (typeof documentStatuses)[number]

/**
 * Why a document can no longer be changed, in the words the office reads, or
 * null while it is a draft and can.
 *
 * One sentence for the server's refusal and for the notice on the screen, so
 * that the two never say different things. The way forward depends on the
 * kind: an invoice is in the books and is corrected by a cancellation or a
 * credit note, while a quote that went out is simply followed by a new one,
 * because nothing was booked on it.
 */
export function whyFixed(document: {
  readonly kind: DocumentKind
  readonly status: DocumentStatus
}): string | null {
  switch (document.status) {
    case 'draft':
      return null
    case 'signed':
      return (
        'Der Beleg ist unterschrieben und wird nicht mehr geändert: unterschrieben wurde genau ' +
        'dieser Stand. Soll sich etwas ändern, entsteht dafür ein neuer Beleg.'
      )
    case 'cancelled':
      return (
        'Der Beleg ist storniert und wird nicht mehr geändert. Die Stornorechnung hebt ihn auf, ' +
        'beide bleiben in den Büchern.'
      )
    case 'issued':
      if (document.kind === 'cancellation_invoice') {
        return (
          'Die Stornorechnung ist festgeschrieben und wird nicht mehr geändert. Soll die Leistung ' +
          'wieder berechnet werden, entsteht dafür eine neue Rechnung.'
        )
      }

      return isInvoice(document.kind)
        ? 'Die Rechnung ist festgeschrieben und wird nicht mehr geändert. Korrigiert wird sie ' +
            'durch eine Stornorechnung oder eine Gutschrift.'
        : 'Der Beleg ist festgeschrieben und wird nicht mehr geändert: so, wie er ' +
            'festgeschrieben wurde, liegt er beim Kunden. Soll sich etwas ändern, entsteht dafür ein ' +
            'neuer Beleg.'
  }
}

/**
 * How a document is taxed. Three cases, and two of them show no tax at all.
 *
 * It is stored on the document rather than worked out on reading, and that is
 * the same decision as the one behind a stored line total. The treatment
 * follows from the customer and from what the business claims for itself, and
 * both of those change. An invoice that was issued under section 19 has to go
 * on saying so after the business grows out of it; asking the customer record
 * today would rewrite last year's invoice.
 *
 * `standard` is the default. Both others have to be chosen, because both are
 * a statement about the law that somebody is answerable for.
 */
export const taxTreatments = [
  /** Umsatzsteuer wird ausgewiesen. */
  'standard',
  /** Kleinunternehmer nach § 19 UStG, keine Umsatzsteuer. */
  'small_business',
  /** Bauleistung nach § 13b UStG, der Empfänger schuldet die Steuer. */
  'reverse_charge',
] as const

export type TaxTreatment = (typeof taxTreatments)[number]

/**
 * The sentence a document has to carry when it shows no tax.
 *
 * German, because it is printed and read by a person, and required by law in
 * both cases: section 14 (4) number 8 UStG for the reverse charge, section 14
 * (4) UStG together with section 19 for the small business.
 *
 * Not in a rule package, although they are legal wordings. The packages hold
 * numbers with a unit and a period of validity, and `RuleRecord.value` is a
 * number; a sentence has no unit and nothing to add up. Should a wording ever
 * need a validity period of its own, the engine needs a text valued record
 * first, and that is a larger change than a text belongs in.
 */
export const taxNotes: Readonly<Record<TaxTreatment, string | null>> = {
  standard: null,
  small_business: 'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.',
  reverse_charge: 'Steuerschuldnerschaft des Leistungsempfängers gemäß § 13b UStG.',
}

/**
 * The sentence an invoice to a private person has to carry, section 14 (4)
 * number 9 UStG: whoever receives work on a building for themselves must keep
 * the invoice for two years, and has to be told so on it.
 *
 * Written as a general statement rather than addressed to "you, the private
 * customer". The administration accepts a general note, and a trade business
 * cannot know whether a customer it recorded as private uses the work for a
 * business after all; a sentence that holds in both cases is right in both.
 * The same reasoning as for `taxNotes` keeps it here and not in a package.
 */
export const retentionNote =
  'Wer diese Leistung als Privatperson bezieht, ist gesetzlich verpflichtet, die Rechnung ' +
  'zwei Jahre lang aufzubewahren (§ 14b Abs. 1 Satz 5 UStG).'

export interface Document extends Synced {
  readonly id: DocumentId
  readonly customerId: CustomerId
  readonly jobId: JobId | null
  readonly siteId: SiteId | null
  readonly installationId: InstallationId | null
  /**
   * The document this one follows in the chain: quote, order confirmation,
   * delivery note, invoice. Lets the quantity comparison walk the chain
   * instead of guessing from dates.
   */
  readonly predecessorDocumentId: DocumentId | null
  readonly kind: DocumentKind
  readonly status: DocumentStatus
  /** Null while the document is a draft, assigned when it is issued. */
  readonly number: string | null
  readonly documentDate: IsoDate
  /**
   * When the work was done, section 14 (4) number 6 UStG. Not the document
   * date: an invoice written on the first of the month is usually for work in
   * the month before, and a tax audit reads the two as different statements.
   *
   * A period rather than a day, because work on a building takes weeks.
   * `serviceUntil` stays empty for a single day. Both are empty until somebody
   * enters them, and an invoice that needs them cannot be issued without them.
   */
  readonly serviceFrom: IsoDate | null
  readonly serviceUntil: IsoDate | null
  /** When it was fixed. Null while it is a draft. */
  readonly issuedAt: Date | null
  readonly subject: string | null
  /**
   * The paragraph above the lines and the one below them. Free text, usually
   * taken from a text snippet and adapted: "Vielen Dank für Ihre Anfrage" and
   * "Wir freuen uns auf Ihren Auftrag". Printed as written, line breaks kept.
   */
  readonly introText: string | null
  readonly closingText: string | null
  /**
   * How this document is taxed, decided when it is written and frozen when it
   * is issued. `treatmentFor` works out what it should be from the customer
   * and the tenant's own parameters; this column is where that answer is kept.
   */
  readonly taxTreatment: TaxTreatment
}
