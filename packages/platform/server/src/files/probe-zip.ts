import { constants, crc32, deflateRawSync } from 'node:zlib'

/**
 * An archive written for a test: the ZIP a packer writes, with stored and
 * deflated entries, and on request one no honest packer writes, whose
 * directory says something else than its data holds. What reads archives
 * here is held against these (`zip.ts`, and the workbook of a spreadsheet on
 * top of it).
 */

/** What an entry holds, packed ahead: for one that is too large to ever hold unpacked. */
export interface PackedContent {
  readonly packed: Uint8Array
  readonly size: number
  readonly checksum: number
}

export interface ProbeZipEntry {
  /** Where the file lies in the archive, with its folders; a folder itself ends with a slash. */
  readonly path: string
  readonly bytes: Uint8Array | string | PackedContent
  /** Stored as it is instead of deflated. */
  readonly stored?: boolean
  /** The sizes and the checksum behind the data and not in front of it, as a packer writes that cannot go back. */
  readonly streamed?: boolean
  /** The name in the old encoding of one byte a character, without the mark for UTF-8. */
  readonly legacyName?: boolean
  /** What the archive says in place of what is true: one that is damaged, lies or is not read. */
  readonly says?: {
    readonly method?: number
    readonly flags?: number
    readonly checksum?: number
    readonly size?: number
  }
}

const bytesOf = (content: Uint8Array | string) =>
  typeof content === 'string' ? Buffer.from(content, 'utf-8') : content

/** A piece of content, or one that is written a number of times over. */
export type ContentPart =
  Uint8Array | string | { readonly piece: Uint8Array | string; readonly times: number }

/**
 * Content put together from parts and deflated part by part, so that a
 * gigabyte of one repeated megabyte costs the megabyte: each part ends on a
 * block that is not the last, and blocks may follow one another.
 */
export function packedOf(...parts: readonly ContentPart[]): PackedContent {
  const blocks: Uint8Array[] = []
  let size = 0
  let checksum = 0

  for (const part of parts) {
    const repeated = typeof part === 'object' && 'piece' in part
    const bytes = bytesOf(repeated ? part.piece : part)
    const times = repeated ? part.times : 1
    const block = deflateRawSync(bytes, { finishFlush: constants.Z_SYNC_FLUSH })

    for (let round = 0; round < times; round += 1) {
      blocks.push(block)
      checksum = crc32(bytes, checksum)
    }

    size += bytes.length * times
  }

  // An empty block that says it is the last.
  blocks.push(deflateRawSync(Buffer.alloc(0)))

  return { packed: Buffer.concat(blocks), size, checksum }
}

/** The archive of the entries, in their order, with a comment at its end where one is given. */
export function zipOf(entries: readonly ProbeZipEntry[], comment = ''): Uint8Array {
  const files: Buffer[] = []
  const directory: Buffer[] = []
  let offset = 0

  for (const entry of entries) {
    const ahead = typeof entry.bytes === 'object' && 'packed' in entry.bytes ? entry.bytes : null
    const plain = ahead ? null : bytesOf(entry.bytes as Uint8Array | string)
    const method = entry.says?.method ?? (entry.stored && plain ? 0 : 8)
    const data = ahead ? ahead.packed : entry.stored && plain ? plain : deflateRawSync(plain ?? '')
    const checksum = entry.says?.checksum ?? ahead?.checksum ?? crc32(plain ?? '')
    const size = entry.says?.size ?? ahead?.size ?? plain?.length ?? 0
    const name = Buffer.from(entry.path, entry.legacyName ? 'latin1' : 'utf-8')
    const flags =
      entry.says?.flags ??
      (entry.legacyName || name.length === entry.path.length ? 0 : 0x800) |
        (entry.streamed ? 0x8 : 0)

    const local = Buffer.alloc(30)

    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(flags, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt32LE(entry.streamed ? 0 : checksum, 14)
    local.writeUInt32LE(entry.streamed ? 0 : data.length, 18)
    local.writeUInt32LE(entry.streamed ? 0 : size, 22)
    local.writeUInt16LE(name.length, 26)

    const descriptor = Buffer.alloc(entry.streamed ? 16 : 0)

    if (entry.streamed) {
      descriptor.writeUInt32LE(0x08074b50, 0)
      descriptor.writeUInt32LE(checksum, 4)
      descriptor.writeUInt32LE(data.length, 8)
      descriptor.writeUInt32LE(size, 12)
    }

    const central = Buffer.alloc(46)

    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(flags, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt32LE(checksum, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(size, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)

    files.push(local, name, Buffer.from(data.buffer, data.byteOffset, data.byteLength), descriptor)
    directory.push(central, name)
    offset += local.length + name.length + data.length + descriptor.length
  }

  const listed = Buffer.concat(directory)
  const remark = Buffer.from(comment, 'latin1')
  const end = Buffer.alloc(22)

  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(listed.length, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(remark.length, 20)

  // A copy that begins at the beginning of its memory, as the bytes of a request do.
  return new Uint8Array(Buffer.concat([...files, listed, end, remark]))
}
