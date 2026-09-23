import { sha256Pattern } from './file.js'
import type {
  AttachmentId,
  AttachmentVersionId,
  CustomerId,
  InstallationId,
  JobId,
  SiteId,
  Synced,
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
 * The largest file a business can put into its records, known to the device
 * and the server alike, so that a file that is too large is turned away where
 * it is chosen and not after it has crossed a mobile network. 25 MB takes a
 * scanned plan or a long PDF; a video does not belong here.
 */
export const largestAttachmentBytes = 25_000_000

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

/**
 * The types a file is recorded as. Anything else is recorded as
 * `application/octet-stream` and not refused: a measuring device's export or
 * a CAD format nobody listed is still a file somebody needs to keep. The type
 * only decides how the file is handed out again, and the server decides that
 * by looking at the bytes, not at this list.
 */
export const attachmentMediaTypes = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/xml',
  'text/xml',
  'application/zip',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.spreadsheet',
  'image/vnd.dwg',
  'image/vnd.dxf',
  'application/octet-stream',
] as const

/**
 * The type a file is recorded as, from the one a browser declared. Lower case
 * and without parameters; a type outside the list becomes
 * `application/octet-stream`. Device and server both ask this, and a version
 * whose type is not what this answers is a mistake in the client.
 */
export function attachmentMediaType(declared: string): string {
  const essence = (declared.split(';')[0] ?? '').trim().toLowerCase()

  return (attachmentMediaTypes as readonly string[]).includes(essence)
    ? essence
    : 'application/octet-stream'
}

/** Why a type is not the one `attachmentMediaType` records, or null when it is. */
export function attachmentMediaTypeProblem(mediaType: unknown): string | null {
  return typeof mediaType === 'string' && attachmentMediaType(mediaType) === mediaType
    ? null
    : 'Der Typ der Datei ist nicht so angegeben, wie OpenGewerk ihn festhält.'
}

/** Why a value is not the SHA-256 a stored file is named by, or null when it is. */
export function fileHashProblem(hash: unknown): string | null {
  return typeof hash === 'string' && sha256Pattern.test(hash)
    ? null
    : 'Die Prüfsumme der Datei ist kein SHA-256 in Kleinbuchstaben.'
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

/** Why a file of this size cannot be kept, or null when it can. */
export function attachmentSizeProblem(sizeBytes: number): string | null {
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) {
    return 'Die Größe der Datei ist keine Zahl von Bytes.'
  }

  if (sizeBytes === 0) {
    return 'Die Datei ist leer.'
  }

  return sizeBytes > largestAttachmentBytes
    ? `Die Datei ist größer als ${String(largestAttachmentBytes / 1_000_000)} MB und lässt sich ` +
        'deshalb nicht ablegen. Ein Foto wird vor dem Ablegen verkleinert, ein Dokument ' +
        'lässt sich oft als PDF kleiner speichern.'
    : null
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
