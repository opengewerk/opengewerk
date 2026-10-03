import type { FileId, TenantOwned } from './identifier.js'

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
 * The largest file the store takes, known to the device and the server alike,
 * so that a file that is too large is turned away where it is chosen and not
 * after it has crossed a mobile network. 25 MB takes a scanned plan or a long
 * PDF; a video does not belong in the store.
 */
export const largestFileBytes = 25_000_000

/**
 * The types a file is recorded as. Anything else is recorded as
 * `application/octet-stream` and not refused: a measuring device's export or
 * a CAD format nobody listed is still a file somebody needs to keep. The type
 * only decides how the file is handed out again, and the server decides that
 * by looking at the bytes, not at this list.
 */
export const fileMediaTypes = [
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
 * `application/octet-stream`. Device and server both ask this, and a record
 * whose type is not what this answers is a mistake in the client.
 */
export function fileMediaType(declared: string): string {
  const essence = (declared.split(';')[0] ?? '').trim().toLowerCase()

  return (fileMediaTypes as readonly string[]).includes(essence)
    ? essence
    : 'application/octet-stream'
}

/** Why a value is not the SHA-256 a stored file is named by, or null when it is. */
export function fileHashProblem(hash: unknown): string | null {
  return typeof hash === 'string' && sha256Pattern.test(hash)
    ? null
    : 'Die Prüfsumme der Datei ist kein SHA-256 in Kleinbuchstaben.'
}

/** Why a file of this size cannot be kept, or null when it can. */
export function fileSizeProblem(sizeBytes: number): string | null {
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) {
    return 'Die Größe der Datei ist keine Zahl von Bytes.'
  }

  if (sizeBytes === 0) {
    return 'Die Datei ist leer.'
  }

  return sizeBytes > largestFileBytes
    ? `Die Datei ist größer als ${String(largestFileBytes / 1_000_000)} MB und lässt sich ` +
        'deshalb nicht ablegen. Ein Foto wird vor dem Ablegen verkleinert, ein Dokument ' +
        'lässt sich oft als PDF kleiner speichern.'
    : null
}
