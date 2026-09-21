import type { DocumentFileId, DocumentId, FileId, TenantId, TenantOwned } from './identifier.js'

/**
 * A file a business has put into the store, as far as the database knows it.
 *
 * The bytes are not here. ADR 0007 keeps them in a directory whose file names
 * are the SHA-256 of their contents, so the hash is both the address and the
 * proof: a file that was changed no longer sits under its own name, and
 * checking it is one comparison. What PostgreSQL holds is the part a query
 * needs and the part row level security can guard, namely which business the
 * file belongs to.
 *
 * That second part is the reason this row exists at all. The directory knows
 * nothing about businesses, and the same photo taken by two of them lies there
 * once. Whether somebody may read it is answered here, by the same policy as
 * every other table, and a hash nobody has a row for is not a way in.
 */
export interface StoredFile extends TenantOwned {
  readonly id: FileId
  /** SHA-256 of the contents, 64 characters of lower case hex. */
  readonly sha256: string
  readonly sizeBytes: number
  /** `application/pdf`, `image/png`. Decided when the file is stored. */
  readonly mediaType: string
}

/** What a SHA-256 in hex looks like, and the only shape the store accepts. */
export const sha256Pattern = /^[0-9a-f]{64}$/

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
