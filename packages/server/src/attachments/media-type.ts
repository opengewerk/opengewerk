import { attachmentMediaType } from '@opengewerk/domain'

/**
 * The types a browser may show in place, a picture or a PDF. Everything else
 * is handed out as a download, whatever it claims to be: a file somebody
 * uploaded is not a page this application should render.
 */
export const shownInPlace = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
] as const

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  return signature.every((byte, index) => bytes[offset + index] === byte)
}

/**
 * The type the bytes themselves show, for the ones shown in place, or null.
 * Read off the first bytes, the way every one of these formats announces
 * itself.
 */
export function recognisedMediaType(bytes: Uint8Array): (typeof shownInPlace)[number] | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    return 'image/jpeg'
  }

  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return 'image/png'
  }

  // RIFF, four bytes of length, WEBP.
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return 'image/webp'
  }

  // GIF87a or GIF89a.
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38]) && (bytes[4] === 0x37 || bytes[4] === 0x39)) {
    return 'image/gif'
  }

  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) {
    return 'application/pdf'
  }

  return null
}

/**
 * The type a stored file is recorded with (#77).
 *
 * What the bytes show wins over what the browser declared, for the types that
 * are shown in place. A declared type is taken otherwise, as far as
 * `attachmentMediaType` knows it, but never one of those: a file that says it
 * is a PNG and is not one would be put in front of a browser as a picture
 * because of a name. It is recorded as a plain byte stream instead and handed
 * out as a download.
 */
export function storedMediaType(bytes: Uint8Array, declared: string): string {
  const recognised = recognisedMediaType(bytes)

  if (recognised) {
    return recognised
  }

  const type = attachmentMediaType(declared)

  return (shownInPlace as readonly string[]).includes(type) ? 'application/octet-stream' : type
}
