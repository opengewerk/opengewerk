import type { DocumentTotals } from '../rules/invoice.js'
import type { VatRate } from '../rules/tax.js'
import type { Address } from './address.js'
import type { DocumentKind, TaxTreatment } from './document.js'
import type { LineKind, LineUnit } from './document-line.js'
import type { DocumentId, DocumentSnapshotId, FileId, IsoDate, TenantId } from './identifier.js'

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
 * version 3 the signature.
 */
export const documentContentVersion = 3

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
   * the day the invoice was written.
   */
  readonly isBusiness: boolean
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
}

/** The second shape, from #72: titles and texts, and no signature yet. */
export interface DocumentContentV2 extends Omit<DocumentContent, 'version' | 'signature'> {
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
export type StoredDocumentContent = DocumentContent | DocumentContentV2 | DocumentContentV1

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
