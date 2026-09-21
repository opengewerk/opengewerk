import type { LineKind, LineUnit } from './document-line.js'
import type { DocumentId, DocumentSignatureId, Synced } from './identifier.js'

/**
 * The box a signature is drawn in, in units of its own. The pad on a device
 * keeps this aspect ratio whatever the screen, and every point is stored in
 * these units, so a signature drawn on a phone and one drawn on a tablet print
 * at the same size.
 */
export const signatureBox = { width: 1000, height: 400 } as const

/** Long enough for a signature drawn slowly, short enough for one transmission. */
export const longestSignaturePath = 40_000

/**
 * Moves and lines in whole units: `M12,40L15,41L19,43M300,80L...`. Every group
 * starts with its own letter, so the pattern cannot backtrack its way into
 * trouble on a long string.
 */
const pathShape = /^(M\d{1,4},\d{1,4}(L\d{1,4},\d{1,4})*)+$/

/**
 * Whether a string is a signature as this system draws one: moves and lines
 * in whole units, inside the box, and nothing else.
 *
 * The strictness is the security of it. The path goes into an SVG on the
 * office screen and into the page the renderer prints, and a string that can
 * only hold M, L, digits and commas cannot carry anything else into either.
 * The database holds the same pattern in a check.
 */
export function signaturePathIsValid(path: string): boolean {
  if (path.length === 0 || path.length > longestSignaturePath || !pathShape.test(path)) {
    return false
  }

  for (const point of path.matchAll(/(\d+),(\d+)/g)) {
    if (Number(point[1]) > signatureBox.width || Number(point[2]) > signatureBox.height) {
      return false
    }
  }

  return true
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
  const text = JSON.stringify([content.introText, lines])

  // FNV-1a over UTF-16 code units. `Math.imul` keeps the multiplication in
  // thirty-two bits, which is what makes the result the same in every engine.
  let hash = 0x811c9dc5

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }

  return `fnv1a32:${hash.toString(16).padStart(8, '0')}:${String(text.length)}`
}
