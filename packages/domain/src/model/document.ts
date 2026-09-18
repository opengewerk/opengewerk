import type {
  CustomerId,
  DocumentId,
  InstallationId,
  IsoDate,
  JobId,
  SiteId,
  TenantOwned,
} from './identifier.js'

/**
 * The document types of section 4.2. Estimate and quote are separate on
 * purpose: under section 650 BGB they carry different consequences.
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
 * A document is a draft until it is issued. From then on it is fixed: nothing
 * is deleted, a mistake is corrected by a cancellation or a credit note. That
 * is leading decision 4, GoBD by design. The mechanism that enforces it, the
 * number range and the write protection, arrives with its own issue; the model
 * only has to leave room for it.
 */
export const documentStatuses = ['draft', 'issued', 'cancelled'] as const

export type DocumentStatus = (typeof documentStatuses)[number]

export interface Document extends TenantOwned {
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
  /** When it was fixed. Null while it is a draft. */
  readonly issuedAt: Date | null
  readonly subject: string | null
}
