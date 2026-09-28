import { crc32, deflateRawSync } from 'node:zlib'

/**
 * Files as a wholesaler delivers them (#297), made up for the tests: the data
 * of a real wholesaler stands under its licence and does not go into the
 * repository. A real file is checked by hand against the importer.
 */

/** The bytes of the German letters in CP850, which is what DOS wrote. */
const cp850Of: Readonly<Record<string, number>> = {
  ä: 0x84,
  ö: 0x94,
  ü: 0x81,
  Ä: 0x8e,
  Ö: 0x99,
  Ü: 0x9a,
  ß: 0xe1,
  é: 0x82,
  '²': 0xfd,
  '³': 0xfc,
  '×': 0x9e,
  '°': 0xf8,
  Ø: 0x9d,
}

/** Text in CP850, with CR LF between the lines as DOS ends them. */
export function cp850(lines: readonly string[]): Uint8Array {
  const text = lines.join('\r\n') + '\r\n'

  return Uint8Array.from(
    [...text].map((character) => {
      const code = character.charCodeAt(0)

      return code < 0x80 ? code : (cp850Of[character] ?? 0x3f)
    }),
  )
}

/** Text in Windows-1252, where the German letters are those of Latin-1. */
export function windows1252(lines: readonly string[]): Uint8Array {
  return Uint8Array.from(
    [...(lines.join('\r\n') + '\r\n')].map((character) => character.charCodeAt(0)),
  )
}

/**
 * The header of a DATANORM 4 file in its fixed columns: the letter, a blank,
 * the day, three texts of 40, 40 and 35 characters, the version, the currency.
 */
export function header(day = '010926', version = '04'): string {
  return (
    'V ' +
    day +
    'Elektro-Großhandel Hansa'.padEnd(40) +
    'DATANORM Export'.padEnd(40) +
    'Preise in EUR'.padEnd(35) +
    version +
    'EUR'
  )
}

/** A ZIP archive of the entries, deflated, as a packer writes one. */
export function zipOf(entries: readonly { readonly name: string; readonly bytes: Uint8Array }[]) {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'latin1')
    const packed = deflateRawSync(entry.bytes)
    const checksum = crc32(entry.bytes)
    const local = Buffer.alloc(30)

    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(8, 8)
    local.writeUInt32LE(checksum, 14)
    local.writeUInt32LE(packed.length, 18)
    local.writeUInt32LE(entry.bytes.length, 22)
    local.writeUInt16LE(name.length, 26)

    const central = Buffer.alloc(46)

    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(8, 10)
    central.writeUInt32LE(checksum, 16)
    central.writeUInt32LE(packed.length, 20)
    central.writeUInt32LE(entry.bytes.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)

    locals.push(local, name, packed)
    centrals.push(central, name)
    offset += local.length + name.length + packed.length
  }

  const directory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)

  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)

  return new Uint8Array(Buffer.concat([...locals, directory, end]))
}
