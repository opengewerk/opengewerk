import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib'

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

/**
 * The archive of the files, each deflated, in their order: what a workbook
 * is written as when a list goes out as a table
 * (opengewerk-haustechnik#138). The counterpart of `unzip`, with the same
 * zlib of Node and no package.
 *
 * The names are UTF-8 and marked as such. Every entry carries the same
 * moment, the first one ZIP can write, so that the same files give the same
 * bytes. Nothing is encrypted, and nothing needs ZIP64: an archive over
 * 4 GB or 65535 entries is refused, which no list of an office comes near.
 */
export function zipped(files: readonly ZipEntry[]): Uint8Array {
  const parts: Buffer[] = []
  const directory: Buffer[] = []
  let offset = 0

  if (files.length >= 0xffff) {
    throw new ZipRefused('Das Archiv hätte zu viele Dateien.')
  }

  for (const file of files) {
    const name = Buffer.from(file.path, 'utf-8')
    const packed = deflateRawSync(file.bytes)
    const checksum = crc32(file.bytes)
    // The 1st of January 1980 at midnight, as MS-DOS counts a day.
    const day = (1 << 5) | 1
    const head = Buffer.alloc(30)

    head.writeUInt32LE(localSignature, 0)
    head.writeUInt16LE(20, 4)
    head.writeUInt16LE(0x800, 6)
    head.writeUInt16LE(8, 8)
    head.writeUInt16LE(day, 12)
    head.writeUInt32LE(checksum, 14)
    head.writeUInt32LE(packed.length, 18)
    head.writeUInt32LE(file.bytes.length, 22)
    head.writeUInt16LE(name.length, 26)

    const listed = Buffer.alloc(46)

    listed.writeUInt32LE(centralSignature, 0)
    listed.writeUInt16LE(20, 4)
    listed.writeUInt16LE(20, 6)
    listed.writeUInt16LE(0x800, 8)
    listed.writeUInt16LE(8, 10)
    listed.writeUInt16LE(day, 14)
    listed.writeUInt32LE(checksum, 16)
    listed.writeUInt32LE(packed.length, 20)
    listed.writeUInt32LE(file.bytes.length, 24)
    listed.writeUInt16LE(name.length, 28)
    listed.writeUInt32LE(offset, 42)

    parts.push(head, name, packed)
    directory.push(listed, name)
    offset += head.length + name.length + packed.length

    if (offset > 0xffffffff) {
      throw new ZipRefused('Das Archiv wäre größer als 4 GB.')
    }
  }

  const listing = Buffer.concat(directory)
  const end = Buffer.alloc(22)

  end.writeUInt32LE(endSignature, 0)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(listing.length, 12)
  end.writeUInt32LE(offset, 16)

  return new Uint8Array(Buffer.concat([...parts, listing, end]))
}
