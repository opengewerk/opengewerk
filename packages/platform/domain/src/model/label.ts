import type { SyncPolicy } from '../sync/policy.js'

/**
 * A label with a QR code: a sticker on a thing or at a door whose scan opens
 * the record it belongs to.
 *
 * What a label says is printed and stays, for years on a wall. So it carries
 * a random code of its own and not the id of its record: nobody guesses the
 * next address from one, and a label that is lost or stuck on the wrong thing
 * can be blocked and replaced. A blocked label opens nothing any more, in the
 * app or in the browser, and stays as a row so that the app can say so.
 *
 * What a label hangs on is the application's: its table carries these two
 * columns and beside them the keys of the application's own records.
 */
export interface Label {
  /** Sixteen characters of `labelCodeAlphabet`, stored without the hyphens. */
  readonly code: string
  /** When it was blocked, or null while it is valid. */
  readonly blockedAt: Date | null
}

/**
 * What a device may do with a label: read it, so that a scan opens a record
 * without a network and says so when the label is blocked. The server draws
 * the code, and blocking is a decision taken where it can be refused.
 */
export const labelPolicy: SyncPolicy = { create: false, change: 'never' }

/**
 * Crockford's base 32: the digits and the letters without I, L, O and U, which
 * read as 1, 1, 0 and V. A code copied from a scratched label by hand comes out
 * the same, see `labelCodeFromScan`.
 */
export const labelCodeAlphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/** Sixteen characters, 80 random bits: nothing anybody guesses. */
export const labelCodeLength = 16

/** The path of the address in the QR, in front of the code. */
export const labelPath = '/a/'

const codeShape = new RegExp(`^[${labelCodeAlphabet}]{${String(labelCodeLength)}}$`)

/** Whether a text is a code as stored: sixteen characters of the alphabet. */
export function isLabelCode(value: string): boolean {
  return codeShape.test(value)
}

/**
 * A code from sixteen random bytes' worth of choices, one character for each
 * five bits. The randomness comes from the caller, the server's own source,
 * because this package does no I/O.
 */
export function labelCodeFrom(random: Uint8Array): string {
  if (random.length < 10) {
    throw new RangeError('A label code needs 80 random bits, ten bytes.')
  }

  let bits = 0
  let value = 0
  let code = ''

  for (const byte of random.subarray(0, 10)) {
    value = (value << 8) | byte
    bits += 8

    while (bits >= 5) {
      bits -= 5
      code += labelCodeAlphabet.charAt((value >> bits) & 31)
    }

    value &= (1 << bits) - 1
  }

  return code
}

/** The code as a label prints it, in four groups: 7K2M-9QX4-TBA3-HW8P. */
export function printedLabelCode(code: string): string {
  return code.replaceAll(/(.{4})(?=.)/g, '$1-')
}

/** The address a label carries: the instance, then the code. */
export function labelAddress(origin: string, code: string): string {
  return `${withoutTrailingSlashes(origin)}${labelPath}${code}`
}

/**
 * The text without the slashes at its end. A loop and not `/\/+$/`: that
 * expression starts again at every slash of a long run of them and so takes
 * the square of its length, and what a scan reads comes from outside.
 */
function withoutTrailingSlashes(text: string): string {
  let end = text.length

  while (end > 0 && text.charAt(end - 1) === '/') {
    end -= 1
  }

  return text.slice(0, end)
}

/**
 * The code in whatever a scan read, or null when it is not a label.
 *
 * Only an address counts, because that is what a label carries: a bare string
 * of sixteen characters is as likely a serial number. Of the address only the
 * path counts, and the app reads the code whatever host is in front of it, so
 * that a label printed while the instance lived under another address still
 * opens its record. The code itself is read leniently, in lower case too and
 * with the letters Crockford reads as digits.
 */
export function labelCodeFromScan(text: string): string | null {
  // Taken apart by hand: this package knows neither the DOM nor Node, and so no URL.
  const address = /^https?:\/\/[^/?#\s]+(\/[^?#\s]*)?(?:[?#]\S*)?$/i.exec(text.trim())

  if (!address) {
    return null
  }

  const path = address[1] ?? ''
  const at = path.lastIndexOf(labelPath)

  if (at < 0) {
    return null
  }

  const code = withoutTrailingSlashes(path.slice(at + labelPath.length))
    .toUpperCase()
    .replaceAll('-', '')
    .replaceAll(/[IL]/g, '1')
    .replaceAll('O', '0')

  return isLabelCode(code) ? code : null
}

/** How a label is printed: one to a page on a label printer, or on a sheet A4. */
export type LabelFormat = 'roll' | 'sheet'

export interface LabelLayout {
  readonly widthMm: number
  readonly heightMm: number
  /** Labels across and down one page; a roll has one to a page. */
  readonly columns: number
  readonly rows: number
  /** The side of the QR with its quiet zone. */
  readonly qrMm: number
}

/**
 * The two formats. A label printer with die cut labels of 62 by 29 mm, as a
 * Brother QL takes them, and a sheet A4 with 3 by 8 labels of 70 by 37 mm and
 * no gaps, as Avery Zweckform 3474 and its equals have them.
 */
export const labelLayouts: Readonly<Record<LabelFormat, LabelLayout>> = {
  roll: { widthMm: 62, heightMm: 29, columns: 1, rows: 1, qrMm: 25 },
  sheet: { widthMm: 70, heightMm: 37, columns: 3, rows: 8, qrMm: 29 },
}

/** The most copies of one label a print makes. */
export const labelCountMax = 24

/**
 * Why a print cannot be made like this, as a sentence, or null when it can.
 * `start` is the first free field of a sheet that was used before, counted
 * row by row from the top left; a roll has none. `most` is the most labels
 * the print may make: `labelCountMax` copies of one label, or what an
 * application allows for a print of many different ones.
 */
export function labelPrintProblem(
  format: LabelFormat,
  count: number,
  start: number,
  most: number = labelCountMax,
): string | null {
  if (!Number.isInteger(count) || count < 1 || count > most) {
    return `Gedruckt werden 1 bis ${String(most)} Etiketten auf einmal.`
  }

  const layout = labelLayouts[format]
  const fields = layout.columns * layout.rows

  if (!Number.isInteger(start) || start < 1 || start > fields) {
    return fields === 1
      ? 'Ein Etikettendrucker beginnt immer beim ersten Etikett.'
      : `Ein Bogen hat die Felder 1 bis ${String(fields)}.`
  }

  return null
}
