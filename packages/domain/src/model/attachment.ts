import { fileMediaType } from '@opengewerk/platform-domain'
import type { Synced } from '@opengewerk/platform-domain'
import type {
  AttachmentId,
  AttachmentVersionId,
  CustomerId,
  InstallationId,
  JobId,
  SiteId,
} from './identifier.js'

/**
 * A file in the business's records, hung on what it is about (#77, 4.10).
 *
 * A customer, a site, an installation and a job, any of them and at least one.
 * The links are independent, like a task's: a wiring diagram taken at a job
 * carries the job and, with it, the installation, the site and the customer,
 * so it turns up wherever somebody looks for it later. One hung on a customer
 * carries only the customer.
 *
 * The bytes are not here and not on this row's versions either. They lie in
 * the content addressed store from ADR 0007, and a version names them by
 * their SHA-256.
 */
export interface Attachment extends Synced {
  readonly id: AttachmentId
  readonly customerId: CustomerId | null
  readonly siteId: SiteId | null
  readonly installationId: InstallationId | null
  readonly jobId: JobId | null
  /** What it is called in a list, the name of the first file unless somebody changed it. */
  readonly title: string
}

/**
 * One version of an attachment. A new version is laid over the old ones and
 * never replaces them: what was once the basis of a decision stays readable,
 * the same argument as with a cancellation. The newest is the one with the
 * highest id, since ids are UUIDv7 minted when the version was made, on the
 * device as much as on the server.
 *
 * Written once and never changed. The file behind it is found by business and
 * hash, so a version can only name bytes its own business has stored.
 */
export interface AttachmentVersion extends Synced {
  readonly id: AttachmentVersionId
  readonly attachmentId: AttachmentId
  /** SHA-256 of the contents, 64 characters of lower case hex. */
  readonly sha256: string
  /** The name the file had where it came from, `Schaltplan.pdf`. */
  readonly fileName: string
  /** What the device declared, as `attachmentMediaType` has it. */
  readonly mediaType: string
  readonly sizeBytes: number
  /** A small JPEG of a picture, for lists; null for anything else. */
  readonly previewSha256: string | null
  /**
   * Who stored it, written by the database from the request and by nothing
   * else, as ADR 0007 asks of the metadata: who and when.
   */
  readonly createdBy: string | null
}

/**
 * How a photo is made smaller before it goes anywhere (ADR 0007: "unter 1 MB
 * pro Foto, Original optional behalten"). 2048 pixels on the long edge still
 * shows a type plate legibly, and a JPEG of that size at this quality lands
 * well under a megabyte. The original is kept only when somebody asks for it.
 */
export const photoLongEdge = 2048
export const photoQuality = 0.8

/** The picture a list shows, and what a device keeps of other people's photos. */
export const previewLongEdge = 320
export const previewQuality = 0.7

/** Why a type is not the one `fileMediaType` records, or null when it is. */
export function attachmentMediaTypeProblem(mediaType: unknown): string | null {
  return typeof mediaType === 'string' && fileMediaType(mediaType) === mediaType
    ? null
    : 'Der Typ der Datei ist nicht so angegeben, wie OpenGewerk ihn festhält.'
}

/**
 * Pictures a browser can decode, and so draw a preview of. HEIC is not among
 * them although it is a picture: most browsers cannot decode it, and a file
 * that cannot be decoded is kept as it is, without a preview.
 */
export function isPicture(mediaType: string): boolean {
  return ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(mediaType)
}

/**
 * Photos, which a device makes smaller before they go anywhere unless somebody
 * keeps the original. Not a PNG: that is a screenshot or a plan far more often
 * than a photo, and turning it into a JPEG blurs exactly the lines somebody
 * wants to read.
 */
export function isPhoto(mediaType: string): boolean {
  return ['image/jpeg', 'image/webp'].includes(mediaType)
}

/** The four places a file can hang on. */
export const attachmentHomes = ['customerId', 'siteId', 'installationId', 'jobId'] as const

function named(value: unknown): boolean {
  return value !== null && value !== undefined && value !== ''
}

/**
 * Why an attachment has nowhere to hang, or null when it has somewhere. A form
 * takes its places from the screen it stands on, so only a broken client sends
 * none; the check in the database holds the same rule.
 */
export function attachmentHomeProblem(attachment: {
  readonly customerId?: unknown
  readonly siteId?: unknown
  readonly installationId?: unknown
  readonly jobId?: unknown
}): string | null {
  return attachmentHomes.some((home) => named(attachment[home]))
    ? null
    : 'Eine Datei hängt an einem Kunden, einem Objekt, einer Anlage oder einem Auftrag.'
}

/** The name a new attachment gets: the file's, without the ending. */
export function attachmentTitleOf(fileName: string): string {
  const trimmed = fileName.trim()
  const dot = trimmed.lastIndexOf('.')
  const title = dot > 0 ? trimmed.slice(0, dot) : trimmed

  return title.length > 0 ? title : 'Datei'
}
