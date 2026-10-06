import { crc32, inflateRawSync } from 'node:zlib'

/**
 * The files of a ZIP archive: what a supplier packs a delivery into, and what
 * a workbook of a spreadsheet is underneath. Stored and deflated entries, the
 * two every packer writes, read with the zlib of Node rather than one more
 * package. ZIP64, encryption and other methods are refused in words.
 *
 * An archive is a few megabytes and can unpack to a thousand times that, so
 * every entry and the whole are held to a limit before and while they unpack,
 * and each entry has to match its checksum. A reader that leaves that to a
 * package has no limit: a workbook of 300 kilobytes that unpacks to 300
 * megabytes kept one of them busy for a minute and a gigabyte
 * (opengewerk-haustechnik#100).
 */

export interface ZipEntry {
  /** Where the file lies in the archive, with its folders: `xl/workbook.xml`. */
  readonly path: string
  readonly bytes: Uint8Array
}

export class ZipRefused extends Error {}

export interface UnzipOptions {
  /** Which entries are unpacked at all. The others cost nothing and count for nothing. */
  readonly wanted?: (path: string) => boolean
  /** What to say about an archive over the limit, for a caller that names the limit its own way. */
  readonly tooLarge?: string
}

const endSignature = 0x06054b50
const centralSignature = 0x02014b50
const localSignature = 0x04034b50

/** Whether the bytes begin like a ZIP archive. */
export function isZip(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true) === localSignature
  )
}

/**
 * The entries of an archive that are files, in the order of its directory,
 * and of them the ones that are wanted. `limit` is the most they may unpack
 * to together, in bytes.
 */
export function unzip(bytes: Uint8Array, limit: number, options: UnzipOptions = {}): ZipEntry[] {
  const wanted = options.wanted ?? (() => true)
  const tooLarge =
    options.tooLarge ?? `Das Archiv entpackt sich zu mehr als ${Math.floor(limit / 1_000_000)} MB.`
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const u16 = (at: number) => view.getUint16(at, true)
  const u32 = (at: number) => view.getUint32(at, true)

  // The directory's end sits in the last 22 bytes, or before a comment of up
  // to 65535 bytes.
  let end = -1

  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 22 - 65535); at -= 1) {
    if (u32(at) === endSignature) {
      end = at
      break
    }
  }

  if (end < 0) {
    throw new ZipRefused('Die Datei ist kein vollständiges ZIP-Archiv.')
  }

  const count = u16(end + 10)
  let at = u32(end + 16)

  if (count === 0xffff || at === 0xffffffff) {
    throw new ZipRefused(
      'Das Archiv ist ein ZIP64-Archiv. Bitte die Dateien einzeln oder als kleineres ZIP hochladen.',
    )
  }

  const entries: ZipEntry[] = []
  let total = 0

  for (let index = 0; index < count; index += 1) {
    if (at + 46 > bytes.length || u32(at) !== centralSignature) {
      throw new ZipRefused('Das Verzeichnis des Archivs ist beschädigt.')
    }

    const flags = u16(at + 8)
    const method = u16(at + 10)
    const checksum = u32(at + 16)
    const packed = u32(at + 20)
    const size = u32(at + 24)
    const nameLength = u16(at + 28)
    const nextAt = at + 46 + nameLength + u16(at + 30) + u16(at + 32)
    const local = u32(at + 42)
    const path = new TextDecoder(flags & 0x800 ? 'utf-8' : 'latin1').decode(
      bytes.subarray(at + 46, at + 46 + nameLength),
    )

    at = nextAt

    if (path.endsWith('/') || !wanted(path)) {
      continue
    }

    if (flags & 0x1) {
      throw new ZipRefused(`${path} ist verschlüsselt. Bitte ohne Kennwort packen.`)
    }

    if (method !== 0 && method !== 8) {
      throw new ZipRefused(`${path} ist mit einem Verfahren gepackt, das hier nicht gelesen wird.`)
    }

    total += size

    if (size > limit || total > limit) {
      throw new ZipRefused(tooLarge)
    }

    if (local + 30 > bytes.length || u32(local) !== localSignature) {
      throw new ZipRefused(`${path} ist im Archiv beschädigt.`)
    }

    const start = local + 30 + u16(local + 26) + u16(local + 28)
    const data = bytes.subarray(start, start + packed)
    let unpacked: Uint8Array

    try {
      // Never more than the directory says: a bomb that claims less stops here.
      unpacked =
        method === 0
          ? data
          : new Uint8Array(inflateRawSync(data, { maxOutputLength: Math.max(size, 1) }))
    } catch {
      throw new ZipRefused(`${path} ist im Archiv beschädigt.`)
    }

    if (unpacked.length !== size || crc32(unpacked) !== checksum) {
      throw new ZipRefused(`${path} ist im Archiv beschädigt.`)
    }

    entries.push({ path, bytes: unpacked })
  }

  return entries
}
