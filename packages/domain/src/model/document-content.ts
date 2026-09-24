import type { BilledAmount, DocumentTotals } from '../rules/invoice.js'
import type { VatRate } from '../rules/tax.js'
import type { Address } from './address.js'
import type { DocumentKind, TaxTreatment } from './document.js'
import type { LineKind, LineUnit } from './document-line.js'
import type { DocumentId, DocumentSnapshotId, FileId, IsoDate, TenantId } from './identifier.js'
import type { InstructionTemplate, WithdrawalVariant } from './instruction.js'

/**
 * Everything a document says, in one record, as it stood when it was issued.
 *
 * The reason it exists is time. A document draws on five places: its own head,
 * its lines, the customer, the site and the business's letterhead, and four of
 * those keep changing after the invoice has gone out. A customer moves, the
 * business changes its bank, a site is renamed. Asked again a year later, those
 * places describe a document nobody ever sent. So the moment a document is
 * issued, what it says is written down once, here, and nothing afterwards
 * reads the five places again for it.
 *
 * It is also what the check of the mandatory details looks at, and that order
 * is the point: the details are checked on exactly the record that gets
 * printed, not on a query that might have been assembled a little differently.
 *
 * Plain data and nothing else, so it can be stored as it is and read back by
 * a later version. `version` says which shape a stored record has, and
 * `currentContent` brings an older one up to the present shape before anybody
 * prints it, so the template only ever knows one.
 *
 * Version 2 added the titles among the lines and the two texts around them,
 * version 3 the signature, version 4 the progress invoices a document deducts
 * and the amount it bills after them, version 5 the invoice a cancellation
 * cancels, version 6 what an e-invoice needs to know about the recipient,
 * version 7 the payment term, version 8 the instructions that went with it,
 * version 9 the number of the job it belongs to.
 */
export const documentContentVersion = 9

export interface LogoContent {
  readonly fileId: FileId
  readonly sha256: string
  readonly mediaType: string
}

/** The business a document comes from, out of its letterhead. */
export interface IssuerContent extends Address {
  readonly name: string
  readonly phone: string | null
  readonly email: string | null
  readonly website: string | null
  readonly taxNumber: string | null
  readonly vatId: string | null
  readonly iban: string | null
  readonly bic: string | null
  readonly bankName: string | null
  readonly registerCourt: string | null
  readonly registerNumber: string | null
  readonly managingDirectors: string | null
  readonly logo: LogoContent | null
}

/** Who a document is addressed to. */
export interface RecipientContent extends Address {
  readonly name: string
  /**
   * A business for VAT purposes. Carried along because it decides one of the
   * printed sentences, and on reading a year later it has to be the answer of
   * the day the invoice was written. It also decides whether the invoice goes
   * out as an e-invoice, see `formatFor`.
   */
  readonly isBusiness: boolean
  /**
   * The three things an e-invoice says about its recipient that the paper
   * does not: where it is sent electronically, the VAT identification number
   * a reverse charge names, and the reference the buyer wants to find it by,
   * for a public authority its Leitweg-ID. Frozen with the rest, so that the
   * e-invoice made a year later is the one that could have gone out that day.
   * Null in every record written before version 6.
   */
  readonly email: string | null
  readonly vatId: string | null
  readonly buyerReference: string | null
}

/** The building the work was done on, when the document names one. */
export interface SiteContent extends Address {
  readonly designation: string
}

export interface LineContent {
  readonly kind: LineKind
  readonly position: number
  readonly designation: string
  readonly description: string | null
  readonly quantityMilli: number
  readonly unit: LineUnit
  readonly unitPriceCents: number
  readonly vatRate: VatRate
  readonly netCents: number
}

/**
 * The signature on a document, as far as it is printed: who, when, and the
 * picture. The device information stays with the signature itself and is not
 * printed; it answers a question somebody asks later, not one the customer
 * has.
 */
export interface SignatureContent {
  readonly signerName: string
  /** The moment, as an ISO string, the way JSON keeps it. */
  readonly signedAt: string
  readonly path: string
}

/**
 * A progress invoice an invoice takes off, as it was printed: its number and
 * date, so the customer can find it, and what it billed, net and tax per rate.
 *
 * The figures are copied out of that invoice's own snapshot and never worked
 * out again. That is what section 14 (5) UStG asks for, and it is what makes
 * the chain add up: see `billedAfter`.
 */
export interface DeductionContent {
  readonly number: string
  readonly documentDate: IsoDate
  readonly taxTreatment: TaxTreatment
  readonly billed: BilledAmount
}

/**
 * The invoice a cancellation cancels, as far as the cancellation names it:
 * what it was, its number and its date. Printed at the top of the
 * cancellation, because a cancellation that does not say which invoice it
 * takes back takes back nothing a reader can find.
 */
export interface CorrectionContent {
  readonly kind: DocumentKind
  readonly number: string
  readonly documentDate: IsoDate
}

/**
 * The payment term a document states, as it was printed.
 *
 * The days are the ones that applied: the document's own, or else the
 * business's setting on the document's date. An invoice adds the day payment
 * is due, counted from its date, and that day is what an e-invoice carries and
 * what the dunning of phase 3 will read; worked out again later, it would move
 * with every correction to the setting.
 */
export interface PaymentTermContent {
  /** Days after the document date. Zero is payable at once. */
  readonly days: number
  /**
   * The day the amount is due, on a document that asks for payment. Null on a
   * quote, an estimate or an order confirmation, which state the term of an
   * invoice that has no date yet.
   */
  readonly dueOn: IsoDate | null
}

/**
 * The shipped model an instruction follows, as far as a record of what went
 * out has to say: which one, which version of the law, and whether the
 * business changed its words. Whether a document carried the model or
 * something that only looks like it is a question somebody asks when a
 * customer withdraws a year later.
 */
export interface InstructionModelContent {
  readonly template: InstructionTemplate
  /** The version in force on the date of the document. */
  readonly validFrom: IsoDate
  readonly source: string
  /** The business had changed the words; the model's safe harbour does not cover them. */
  readonly changed: boolean
}

/**
 * An instruction as it went out with a document, in the words the customer
 * got, every placeholder filled in.
 *
 * The words are kept whole and not as a reference to the instruction or to
 * the package. Both change: the business edits its instructions, and the law
 * edits the model. What the customer was told is what the customer was told,
 * and the customer portal of phase 5 shows it from here.
 */
export interface InstructionContent {
  readonly title: string
  /** The words as printed, in the markup `instructionBlocks` reads. */
  readonly text: string
  /**
   * Printed in the document's PDF after the document, and so in its mail as
   * well; otherwise a sheet of its own, printed when it is needed.
   */
  readonly withDocument: boolean
  /** The shipped model it is or was changed from, or null for one the business wrote. */
  readonly model: InstructionModelContent | null
  /** The kind of contract its words were filled in for. */
  readonly variant: WithdrawalVariant
}

export interface DocumentContent {
  readonly version: typeof documentContentVersion
  readonly kind: DocumentKind
  /** Null only for a draft that is being looked at before it is issued. */
  readonly number: string | null
  readonly documentDate: IsoDate
  readonly serviceFrom: IsoDate | null
  readonly serviceUntil: IsoDate | null
  readonly subject: string | null
  /** The paragraph above the lines. */
  readonly introText: string | null
  /** The paragraph at the end, after the totals and the notes. */
  readonly closingText: string | null
  readonly taxTreatment: TaxTreatment
  readonly issuer: IssuerContent
  readonly recipient: RecipientContent
  readonly site: SiteContent | null
  /** In the order they are printed, which is the order of their position. */
  readonly lines: readonly LineContent[]
  /**
   * Stored with the rest rather than worked out again when the document is
   * read. They follow from the lines and the rules of the document date, and
   * they are the figures the customer saw; a correction to a rule package
   * later must not change a document that has already gone out.
   */
  readonly totals: DocumentTotals
  /** The sentences under the totals, each one required by some paragraph. */
  readonly notes: readonly string[]
  /** Null for every document nobody signed, which is nearly all of them. */
  readonly signature: SignatureContent | null
  /**
   * The earlier progress invoices of the chain that this one takes off, oldest
   * first. Empty for every document that deducts nothing.
   */
  readonly deductions: readonly DeductionContent[]
  /**
   * What this document asks to be paid: the totals less the deductions. The
   * same figures as the totals whenever nothing is deducted.
   */
  readonly billed: BilledAmount
  /** The invoice this one cancels. Null for everything but a cancellation. */
  readonly corrects: CorrectionContent | null
  /**
   * When the customer has to pay. Null for every kind that states no term, see
   * `statesPaymentTerm`, and for an invoice that asks for nothing because the
   * progress invoices before it billed all of it.
   */
  readonly paymentTerm: PaymentTermContent | null
  /**
   * The instructions that went with the document, in the order they are
   * printed. Empty for every document that carried none, and for every
   * document issued before version 8.
   */
  readonly instructions: readonly InstructionContent[]
  /**
   * The number of the job the document belongs to (#145), the one the
   * customer names on the phone. Null for a document without a job, for one
   * whose job was created before jobs had numbers, and for every document
   * issued before version 9.
   */
  readonly jobNumber: string | null
}

/** The eighth shape, from #110: the instructions, and no job number yet. */
export interface DocumentContentV8 extends Omit<DocumentContent, 'version' | 'jobNumber'> {
  readonly version: 8
}

/** The seventh shape, from #106: the payment term, and no instructions yet. */
export interface DocumentContentV7 extends Omit<DocumentContentV8, 'version' | 'instructions'> {
  readonly version: 7
}

/** The sixth shape, from #75: the e-invoice details of the recipient, no payment term yet. */
export interface DocumentContentV6 extends Omit<DocumentContentV7, 'version' | 'paymentTerm'> {
  readonly version: 6
}

/** The fifth shape, from #74: the cancellation, and a recipient without e-invoice details. */
export interface DocumentContentV5 extends Omit<DocumentContentV6, 'version' | 'recipient'> {
  readonly version: 5
  readonly recipient: Omit<RecipientContent, 'email' | 'vatId' | 'buyerReference'>
}

/** The fourth shape, from #74: deductions and the billed amount, no cancellation yet. */
export interface DocumentContentV4 extends Omit<DocumentContentV5, 'version' | 'corrects'> {
  readonly version: 4
}

/** The third shape, from #73: the signature, and nothing deducted yet. */
export interface DocumentContentV3 extends Omit<
  DocumentContentV4,
  'version' | 'deductions' | 'billed'
> {
  readonly version: 3
}

/** The second shape, from #72: titles and texts, and no signature yet. */
export interface DocumentContentV2 extends Omit<DocumentContentV3, 'version' | 'signature'> {
  readonly version: 2
}

/**
 * The first shape, from #71: no titles among the lines and no texts around
 * them. Records in it exist on every installation that issued a document
 * before version 2, and they are never rewritten, only read.
 */
export interface DocumentContentV1 extends Omit<
  DocumentContentV2,
  'version' | 'introText' | 'closingText' | 'lines'
> {
  readonly version: 1
  readonly lines: readonly Omit<LineContent, 'kind'>[]
}

/** Any shape a snapshot may have been written in. */
export type StoredDocumentContent =
  | DocumentContent
  | DocumentContentV8
  | DocumentContentV7
  | DocumentContentV6
  | DocumentContentV5
  | DocumentContentV4
  | DocumentContentV3
  | DocumentContentV2
  | DocumentContentV1

/**
 * The content of a document, written once, when it is issued.
 *
 * No `updatedAt`, because there is no update. The application may insert a
 * row and read it and nothing else, and a trigger refuses a change from any
 * other role too: a record of what was sent that can be edited afterwards is
 * a draft with a longer name.
 */
export interface DocumentSnapshot {
  readonly id: DocumentSnapshotId
  readonly tenantId: TenantId
  readonly documentId: DocumentId
  readonly content: StoredDocumentContent
  readonly createdAt: Date
}
