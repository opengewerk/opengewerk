import { type Catalogue, readCatalogue } from './catalogue.js'
import { charsetOf, type DatanormCharset, decodeDatanorm } from './charset.js'
import { deliveryTooLarge, isZip, largestUnpackedBytes, unzip, ZipRefused } from './zip.js'

/**
 * A delivery of a supplier as the office uploads it (#297): single files or a
 * ZIP archive with them, read into one catalogue. Which file is which follows
 * from what it holds, not from its name, since every wholesaler names its
 * files its own way: a DATANORM file begins with its header `V`, and the kind
 * of its first record after that sorts it, the articles before the prices
 * before the groups before the discounts. Anything else in an archive, a
 * letter as PDF or a readme, is named as left out.
 */

export interface DeliveredFile {
  readonly name: string
  readonly bytes: Uint8Array
}

export interface ReadDelivery {
  readonly catalogue: Catalogue
  /** Each file read, with the characters it was read in and its lines. */
  readonly files: readonly {
    readonly name: string
    readonly charset: DatanormCharset
    readonly lines: number
  }[]
  /** Files that are no DATANORM file. */
  readonly skipped: readonly string[]
  /** Files with long texts only, which are not read (decided on 28.09.2026). */
  readonly longTextFiles: readonly string[]
}

const order: Readonly<Record<string, number>> = { A: 0, B: 0, D: 0, T: 0, P: 1, S: 2, R: 3 }

/** Whether a line has anything but blanks on it. */
const filled = /\S/

/** The bytes enough for the header and the first record, in any of the charsets. */
const headBytes = 4096

/**
 * The end of a line and the letter of every kind of record that is read, the
 * same bytes in every charset; both line ends, as `filledLines` takes them.
 */
const recordsRead = ['A', 'B', 'D', 'P', 'S', 'R'].flatMap((letter) =>
  [0x0a, 0x0d].map((end) => Buffer.from([end, letter.charCodeAt(0), 0x3b])),
)

/**
 * Whether a file brings long texts and nothing else. One that begins with
 * them may still bring its articles after them; only a file without a single
 * other record is set aside. Searched in the bytes, without decoding them.
 */
function longTextsOnly(bytes: Uint8Array): boolean {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)

  return !recordsRead.some((start) => buffer.includes(start))
}

/**
 * The lines with anything but blanks on them, in order, at most `most`.
 *
 * Walked line by line. The pattern this replaces, a free run on either side of
 * the one character that is not blank, tried a long blank line again from
 * every position it could start at, and the time grew with the square of the
 * line: a file of one long line of blanks held the process for minutes.
 */
export function filledLines(text: string, most = Number.POSITIVE_INFINITY): string[] {
  const lines: string[] = []
  let start = 0

  while (start <= text.length && lines.length < most) {
    let end = start

    while (end < text.length && text.charCodeAt(end) !== 0x0a && text.charCodeAt(end) !== 0x0d) {
      end += 1
    }

    const line = text.slice(start, end)

    if (filled.test(line)) {
      lines.push(line)
    }

    start = end + 1
  }

  return lines
}

/** The first letter after the header, which says what the file holds; null for no DATANORM file. */
function leadOf(text: string): string | null {
  // The first two lines, found without splitting a whole catalogue.
  const [head = '', first = ''] = filledLines(text, 2)

  // The letter, then a blank or a separator: a readme that begins with "Viel
  // Erfolg" is no header.
  if (!/^V[ ;]/.test(head)) {
    return null
  }

  return first.charAt(0)
}

/**
 * Reads what was uploaded. `charset` overrides what the bytes are found to be
 * in, for the rare file that fools the count of its umlauts; `budget` is what
 * the delivery may unpack to, smaller only in a test.
 */
export function readDelivery(
  delivered: readonly DeliveredFile[],
  charset?: DatanormCharset,
  budget = largestUnpackedBytes,
): ReadDelivery {
  // One budget for the whole delivery, not one for each archive: a delivery
  // of twenty archives of 400 MB each would otherwise be held in memory as
  // eight gigabytes at once. `unzip` refuses before it inflates what would
  // pass what is left of it, and a file that came unpacked counts as well.
  let left = budget
  const plain: DeliveredFile[] = []

  for (const file of delivered) {
    for (const entry of isZip(file.bytes) ? unzip(file.bytes, left) : [file]) {
      left -= entry.bytes.length

      if (left < 0) {
        throw new ZipRefused(deliveryTooLarge)
      }

      plain.push(entry)
    }
  }

  const read: { name: string; charset: DatanormCharset; text: string; kind: number }[] = []
  const skipped: string[] = []
  const longTextFiles: string[] = []

  for (const file of plain) {
    // What the file holds, from its first lines, before the whole of it is
    // decoded, so that a file of long texts is set aside without being read.
    // The letters that decide are ASCII in every charset; only a byte order
    // mark of UTF-8 stands before them.
    const bom = file.bytes[0] === 0xef && file.bytes[1] === 0xbb && file.bytes[2] === 0xbf
    const lead = leadOf(decodeDatanorm(file.bytes.subarray(bom ? 3 : 0, headBytes), 'cp850'))

    if (lead === null) {
      skipped.push(file.name)
    } else if (lead === 'T' && longTextsOnly(file.bytes)) {
      // One supplier sends 555 MB of long texts, without umlauts and cut
      // mid-word, and none of it is taken over.
      longTextFiles.push(file.name)
    } else {
      const used = charset ?? charsetOf(file.bytes)
      const text = decodeDatanorm(file.bytes, used)

      read.push({ name: file.name, charset: used, text, kind: order[lead] ?? 4 })
    }
  }

  read.sort((left, right) => left.kind - right.kind || left.name.localeCompare(right.name))

  return {
    catalogue: readCatalogue(read),
    files: read.map((file) => ({
      name: file.name,
      charset: file.charset,
      lines: filledLines(file.text).length,
    })),
    skipped,
    longTextFiles,
  }
}
