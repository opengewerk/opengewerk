import type { LineKind, LineUnit } from './document-line.js'
import type { Synced } from '@opengewerk/platform-domain'
import type { DocumentId, DocumentSignatureId } from './identifier.js'

// The name typed in under a signature and its length, which the check
// `document_signatures_signer_named` holds, are the foundation's since
// opengewerk-haustechnik#28 (`signerNameProblem`, `longestSignerName`): a form
// of any application asks the same.

/** What a browser says about itself, as much as `document_signatures_device_info_short` keeps. */
export const longestDeviceInfo = 500

/**
 * What is wrong with the device information of a signature, or null when
 * nothing is. The form cuts what the browser says to the length the table
 * keeps, so only a client that does not ever meets this.
 */
export function deviceInfoProblem(info: unknown): string | null {
  return typeof info === 'string' && info.length > longestDeviceInfo
    ? `Die Angabe zum Gerät hat höchstens ${String(longestDeviceInfo)} Zeichen.`
    : null
}

/**
 * A signature on a document, captured on the device it was given on.
 *
 * Section 4.10 calls this a simple electronic signature with a timestamp and
 * device information, and that is all it is: the picture, when it was made,
 * on which device, and the name of whoever signed. Not more, because more
 * would promise an evidential weight a simple signature does not carry.
 *
 * Written once and never changed. It travels like any record a technician
 * makes, through the outbox, because it is made in a cellar; and from the
 * moment it lands, the document it belongs to is `signed` and changes no
 * further.
 */
export interface DocumentSignature extends Synced {
  readonly id: DocumentSignatureId
  readonly documentId: DocumentId
  /**
   * Typed on the device, never taken from the customer record. On a building
   * site the person who signs is often not the customer but whoever was there.
   */
  readonly signerName: string
  /** The device's clock at the moment the signature was confirmed. */
  readonly signedAt: Date
  /** What the browser says about itself, the "device information" of 4.10. */
  readonly deviceInfo: string | null
  /** The picture, as a path in the units of `signatureBox`. */
  readonly path: string
  /** What the signature is about, see `signedContentFingerprint`. */
  readonly contentFingerprint: string
}

/** What a customer sees on the device before signing, and so what a signature is about. */
export interface SignedContent {
  readonly introText: string | null
  /**
   * The values of the fields the business gives its reports (#78), as the
   * JSON text the report carries. Absent or empty on a report without them,
   * and then left out of the fingerprint, so that a report signed before
   * there were fields keeps the fingerprint it was signed with.
   */
  readonly fields?: string | null
  readonly lines: readonly {
    readonly id: string
    readonly position: number
    readonly kind: LineKind
    readonly designation: string
    readonly description: string | null
    readonly quantityMilli: number
    readonly unit: LineUnit
  }[]
}

/**
 * A short mark of what was signed, worked out the same way on the device and
 * on the server.
 *
 * The device computes it from what it shows while the customer signs, and
 * sends it along. The server computes it again when the signature arrives,
 * from what it holds, and refuses the signature when the two differ: a line
 * added in the office while the customer was signing on site would otherwise
 * end up under a signature for a page it was never on.
 *
 * It detects a change, it does not prove anything, and it is not meant to.
 * A hash of thirty-two bits with the length of the text beside it is plenty to
 * notice an accident, and nobody should read more into a simple signature than
 * that. Prices stay out, because the device does not show any, and so does
 * everything the office adds later to make an invoice of it.
 */
export function signedContentFingerprint(content: SignedContent): string {
  const lines = [...content.lines]
    .sort((left, right) => left.position - right.position || left.id.localeCompare(right.id))
    .map((line) => [line.kind, line.designation, line.description, line.quantityMilli, line.unit])
  const fields = content.fields === '{}' ? null : (content.fields ?? null)
  const text = JSON.stringify(
    fields === null ? [content.introText, lines] : [content.introText, lines, fields],
  )

  // FNV-1a over UTF-16 code units. `Math.imul` keeps the multiplication in
  // thirty-two bits, which is what makes the result the same in every engine.
  let hash = 0x811c9dc5

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }

  return `fnv1a32:${hash.toString(16).padStart(8, '0')}:${String(text.length)}`
}
