import type { FileId, TenantId } from '@opengewerk/platform-domain'
import type { DocumentFileId, DocumentId } from './identifier.js'

/**
 * What a file is to a document: the PDF, and since #75 the two forms an
 * e-invoice goes out in, the XRechnung as XML of its own and the ZUGFeRD PDF
 * with the XML inside. More purposes on the same document and not columns
 * somebody had to add, which is why the table was built this way.
 */
export const documentFilePurposes = ['pdf', 'xrechnung', 'zugferd'] as const

export type DocumentFilePurpose = (typeof documentFilePurposes)[number]

/**
 * A file that belongs to an issued document, one per purpose.
 *
 * Written the first time somebody asks for it and never again. The PDF of an
 * invoice is rendered once, and every later request gets the same bytes back
 * instead of a fresh rendering: Chromium does not lay out a page identically
 * twice, and a document that looks a little different each time it is opened
 * is not the document that was sent.
 */
export interface DocumentFile {
  readonly id: DocumentFileId
  readonly tenantId: TenantId
  readonly documentId: DocumentId
  readonly purpose: DocumentFilePurpose
  readonly fileId: FileId
  readonly createdAt: Date
}
