import { fileMediaType } from '@opengewerk/platform-domain'

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

/**
 * The types the server knows by their bytes: the ones shown in place, and the
 * photos of a phone a browser does not show, HEIC and HEIF. A file recorded
 * as one of them is one, whatever was declared for it.
 *
 * The other types of `fileMediaTypes` are taken as declared. Each of them is
 * handed out as a download and nothing more: no route treats one as a promise
 * about its contents, and whatever reads such a file, an import of a table,
 * reads the bytes and refuses what it cannot make sense of. Most of them could
 * not be told by their bytes anyway. A text, a CSV, XML or a DXF drawing has no
 * signature, and a document of an office suite only shows that it is a ZIP
 * or an OLE container, not which document is in it.
 */
export const recognisedByContent = [...shownInPlace, 'image/heic', 'image/heif'] as const

/** One of the types the server knows by their bytes. */
export type RecognisedMediaType = (typeof recognisedByContent)[number]

/**
 * The brands of a HEIF file whose pictures are coded with HEVC, still or as a
 * sequence: what makes it a HEIC.
 */
const heicBrands = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'hevm', 'hevs'])

/**
 * The brands every HEIF file carries, whatever its pictures are coded with:
 * `mif1` or `mif2` for a still picture, `msf1` for a sequence.
 */
const heifBrands = new Set(['mif1', 'msf1', 'mif2'])

/** Longer than any `ftyp` box a picture comes with; a larger one is not looked into. */
const largestTypeBox = 4096

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  return signature.every((byte, index) => bytes[offset + index] === byte)
}

/**
 * The brands of an ISO base media file, or null for any other file. Such a
 * file begins with its `ftyp` box: four bytes of size, the type, the major
 * brand, four bytes of minor version, and the compatible brands up to the end
 * of the box.
 */
function brandsOf(bytes: Uint8Array): readonly string[] | null {
  if (bytes.byteLength < 16 || !startsWith(bytes, [0x66, 0x74, 0x79, 0x70], 4)) {
    return null
  }

  const size = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0)

  if (size < 16 || size > bytes.byteLength || size > largestTypeBox || size % 4 !== 0) {
    return null
  }

  const brand = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4))
  const brands = [brand(8)]

  for (let at = 16; at < size; at += 4) {
    brands.push(brand(at))
  }

  return brands
}

/**
 * The type the bytes themselves show, for the types the server knows by their
 * bytes, or null. Read off the first bytes, the way every one of these
 * formats announces itself; for HEIC and HEIF that is the `ftyp` box.
 */
export function recognisedMediaType(bytes: Uint8Array): RecognisedMediaType | null {
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

  const brands = brandsOf(bytes)

  if (brands?.some((brand) => heicBrands.has(brand))) {
    return 'image/heic'
  }

  if (brands?.some((brand) => heifBrands.has(brand))) {
    return 'image/heif'
  }

  return null
}

/**
 * The type a stored file is recorded with (#77).
 *
 * What the bytes show wins over what the browser declared, for the types the
 * server knows by their bytes. A declared type is taken otherwise, as far as
 * `fileMediaType` knows it, but never one of those: a file that says it is a
 * PNG and is not one would be put in front of a browser as a picture because
 * of a name, and one that says it is a HEIC and is not one would pass every
 * route that takes only a photo. It is recorded as a plain byte stream
 * instead and handed out as a download, and a route that takes only a picture
 * refuses it.
 */
export function storedMediaType(bytes: Uint8Array, declared: string): string {
  const recognised = recognisedMediaType(bytes)

  if (recognised) {
    return recognised
  }

  const type = fileMediaType(declared)

  return (recognisedByContent as readonly string[]).includes(type)
    ? 'application/octet-stream'
    : type
}

/**
 * The value of `Content-Disposition` for a file: in place for what a browser
 * shows safely, as a download for everything else, with the name it had.
 *
 * The name twice, as RFC 6266 asks: once in plain ASCII for whatever reads
 * only that, with everything else replaced, and once in full as UTF-8. A name
 * from a device never gets into the header unescaped, so a quote or a line
 * break in it cannot end the header early.
 */
export function dispositionFor(mediaType: string, fileName: string): string {
  const kind = (shownInPlace as readonly string[]).includes(mediaType) ? 'inline' : 'attachment'
  const ascii = fileName.replace(/[^\x20-\x7e]|["\\]/g, '_')
  const encoded = encodeURIComponent(fileName).replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  )

  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encoded}`
}
