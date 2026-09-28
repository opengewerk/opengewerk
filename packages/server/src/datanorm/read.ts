import { type Catalogue, readCatalogue } from './catalogue.js'
import { charsetOf, type DatanormCharset, decodeDatanorm } from './charset.js'
import { isZip, unzip } from './zip.js'

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
}

const order: Readonly<Record<string, number>> = { A: 0, B: 0, D: 0, T: 0, P: 1, S: 2, R: 3 }

/** A line with anything but blanks on it. */
const filledLine = /[^\r\n]*\S[^\r\n]*/g

/** The first letter after the header, which says what the file holds. */
function kindOf(text: string): number | null {
  // The first two lines, found without splitting a whole catalogue.
  const found = new RegExp(filledLine)
  const head = found.exec(text)?.[0] ?? ''
  const first = found.exec(text)?.[0] ?? ''

  // The letter, then a blank or a separator: a readme that begins with "Viel
  // Erfolg" is no header.
  if (!/^V[ ;]/.test(head)) {
    return null
  }

  return order[first.charAt(0)] ?? 4
}

/**
 * Reads what was uploaded. `charset` overrides what the bytes are found to be
 * in, for the rare file that fools the count of its umlauts.
 */
export function readDelivery(
  delivered: readonly DeliveredFile[],
  charset?: DatanormCharset,
): ReadDelivery {
  const plain = delivered.flatMap((file) => (isZip(file.bytes) ? unzip(file.bytes) : [file]))
  const read: { name: string; charset: DatanormCharset; text: string; kind: number }[] = []
  const skipped: string[] = []

  for (const file of plain) {
    const used = charset ?? charsetOf(file.bytes)
    const text = decodeDatanorm(file.bytes, used)
    const kind = kindOf(text)

    if (kind === null) {
      skipped.push(file.name)
    } else {
      read.push({ name: file.name, charset: used, text, kind })
    }
  }

  read.sort((left, right) => left.kind - right.kind || left.name.localeCompare(right.name))

  return {
    catalogue: readCatalogue(read),
    files: read.map((file) => ({
      name: file.name,
      charset: file.charset,
      lines: file.text.match(filledLine)?.length ?? 0,
    })),
    skipped,
  }
}
