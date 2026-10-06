import type { SyncPolicy } from '../sync/policy.js'
import { fileMediaType } from './file.js'
import type { Id, Synced } from './identifier.js'

/** The key of a file in the records of a tenant. */
export type AttachmentId = Id<'attachment'>

/** The key of one version of such a file. */
export type AttachmentVersionId = Id<'attachment-version'>

/**
 * The entities a device, a route and a screen talk about a file and its
 * versions as: the names of their tables, the same in every application.
 */
export const attachmentEntity = 'attachments'
export const attachmentVersionEntity = 'attachment_versions'

/**
 * A file in the records of a tenant, as every application keeps one
 * (opengewerk-haustechnik#97): what it is called, and through its versions
 * the bytes it stands for.
 *
 * What a file hangs on is the application's. One hangs it on the records it
 * works for, another on a place, a piece of equipment or a piece of work; each
 * adds the keys of its own records to this and says which they are
 * (`attachmentRules`). A file travels to devices, like what it hangs on, and
 * is marked as deleted and never removed.
 *
 * The bytes are not here and not on the versions either. They lie in the
 * content addressed store, and a version names them by their SHA-256.
 */
export interface AttachmentRecord extends Synced {
  readonly id: AttachmentId
  /** What it is called in a list, the name of the first file unless somebody changed it. */
  readonly title: string
}

/**
 * One version of a file. A new version is laid over the old ones and never
 * replaces them: what was once the basis of a decision stays readable. The
 * newest is the one with the highest id, since ids are UUIDv7 minted when the
 * version was made, on the device as much as on the server.
 *
 * Written once and never changed. The file behind it is found by tenant and
 * hash, so a version can only name bytes its own tenant has stored.
 */
export interface AttachmentVersion extends Synced {
  readonly id: AttachmentVersionId
  readonly attachmentId: AttachmentId
  /** SHA-256 of the contents, 64 characters of lower case hex. */
  readonly sha256: string
  /** The name the file had where it came from, `Schaltplan.pdf`. */
  readonly fileName: string
  /** What the device declared, as `fileMediaType` records it. */
  readonly mediaType: string
  readonly sizeBytes: number
  /** A small JPEG of a picture, for lists; null for anything else. */
  readonly previewSha256: string | null
  /**
   * Who stored it, written by the database from the request and by nothing
   * else: who and when is what the metadata of a file has to say.
   */
  readonly createdBy: string | null
}

/**
 * What a device may do with a version: make one, and nothing after that. Who
 * stored it is the server's to write. An application whose versions carry
 * columns of its own that the server works out adds them to `reserved`.
 */
export const attachmentVersionPolicy: SyncPolicy = {
  create: true,
  change: 'never',
  reserved: ['createdBy'],
}

/**
 * How a photo is made smaller before it goes anywhere. 2048 pixels on the
 * long edge still shows a type plate legibly, and a JPEG of that size at this
 * quality lands well under a megabyte. The original is kept only when
 * somebody asks for it.
 */
export const photoLongEdge = 2048
export const photoQuality = 0.8

/** The picture a list shows, and what a device keeps of other people's photos. */
export const previewLongEdge = 320
export const previewQuality = 0.7

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

/**
 * The name a new file gets in a list: the file's own, without the ending.
 * `untitled` is what one is called whose name says nothing.
 */
export function attachmentTitleOf(fileName: string, untitled = 'Datei'): string {
  const trimmed = fileName.trim()
  const dot = trimmed.lastIndexOf('.')
  const title = dot > 0 ? trimmed.slice(0, dot) : trimmed

  return title.length > 0 ? title : untitled
}

/** What an application says about the files in its records. */
export interface AttachmentSetup<Home extends string> {
  /**
   * The fields that name what a file hangs on, each the key of a record of
   * the application. A file names at least one of them, and may name several:
   * a photo taken at one record turns up at the records that one belongs to.
   */
  readonly homes: readonly [Home, ...Home[]]
  /** Whole sentences, because they name the application and its records. */
  readonly text: {
    /** To a file that hangs on none of its records. */
    readonly noHome: string
    /** To a version whose type is not the one a file is recorded as. */
    readonly mediaType: string
  }
}

/**
 * The rules of the files of one application: one object for its screens and
 * its sync, so that both read the same rule the same way and a device works
 * out the answer the server will give.
 */
export interface AttachmentRules<Home extends string = string> {
  /** The fields that name what a file hangs on. */
  readonly homes: readonly Home[]
  /**
   * Why a file has nowhere to hang, or null when it has somewhere. An empty
   * string counts as empty, the way a form hands over a field nobody filled
   * in. A screen takes the places from where it stands, so only a broken
   * client sends none; the check of the application in the database holds
   * the same rule.
   */
  homeProblem(attachment: Readonly<Partial<Record<Home, unknown>>>): string | null
  /** The places among these values that name a record, by field. */
  homesOf(values: Readonly<Partial<Record<Home, unknown>>>): Readonly<Partial<Record<Home, string>>>
  /** Why a type is not the one `fileMediaType` records, or null when it is. */
  mediaTypeProblem(mediaType: unknown): string | null
}

function named(value: unknown): value is string {
  return typeof value === 'string' && value !== ''
}

/**
 * The rules of the files of an application (ADR 0010), made once from what
 * only the application knows: which of its records a file hangs on, and its
 * two sentences.
 */
export function attachmentRules<const Home extends string>(
  setup: AttachmentSetup<Home>,
): AttachmentRules<Home> {
  const homes: readonly Home[] = [...setup.homes]

  if (new Set(homes).size !== homes.length) {
    throw new Error(`A file names each of the places it hangs on once: ${homes.join(', ')}`)
  }

  return {
    homes,
    homeProblem(attachment) {
      return homes.some((home) => {
        const value = attachment[home]

        return value !== null && value !== undefined && value !== ''
      })
        ? null
        : setup.text.noHome
    },
    homesOf(values) {
      return Object.fromEntries(
        homes.flatMap((home) => {
          const value = values[home]

          return named(value) ? [[home, value]] : []
        }),
      ) as Partial<Record<Home, string>>
    },
    mediaTypeProblem(mediaType) {
      return typeof mediaType === 'string' && fileMediaType(mediaType) === mediaType
        ? null
        : setup.text.mediaType
    },
  }
}
