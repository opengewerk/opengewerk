import { type IsoDate, type PriceBase } from '@opengewerk/domain'

/**
 * The records of a DATANORM 4 file (#297), one per line, as the descriptions
 * of Haufe-Lexware and Phoenix Contact give them and real files write them:
 * a letter for the kind of record, then the fields, separated by semicolons.
 * Only the header, `V`, keeps the fixed columns of the older versions.
 *
 * A file without separators is DATANORM 3 or older, and those are not read:
 * the columns of their text and price records are in none of the sources, and
 * a field is not guessed (decided on 28.09.2026). Neither is DATANORM 5 (#455).
 *
 * What a record cannot be read as is a problem of its line, in words, and the
 * rest of the file is read all the same: one broken line of a hundred thousand
 * should not cost the other lines.
 */

/** N, A and L: a new article, a change of one, and one to delete. */
export type Processing = 'new' | 'change' | 'delete'

/** 1 and 2 of the price flag: the list price, before discount, and a net price. */
export type PriceKind = 'list' | 'net'

export interface Header {
  readonly line: number
  /** The day the header names, which some suppliers mean as made and some as valid. */
  readonly date: IsoDate | null
  /** The three texts of the header, for whoever wants to know who made the file. */
  readonly info: string
  readonly version: string
  readonly currency: string
}

export interface ArticleRecord {
  readonly kind: 'article'
  readonly line: number
  readonly processing: Processing
  readonly number: string
  readonly shortText1: string
  readonly shortText2: string
  readonly price: {
    readonly kind: PriceKind
    readonly cents: number
    readonly priceBase: PriceBase
  } | null
  readonly unit: string
  readonly discountGroup: string
  readonly mainGroup: string
  readonly longTextKey: string
}

export interface ExtraRecord {
  readonly kind: 'extra'
  readonly line: number
  readonly processing: Processing
  readonly number: string
  readonly ean: string
  readonly group: string
}

export interface TextRecord {
  readonly kind: 'dimension' | 'long-text'
  readonly line: number
  readonly processing: Processing
  /** The article for a dimension text, the key for a long text. */
  readonly key: string
  readonly lines: readonly { readonly index: number; readonly text: string }[]
}

export interface PriceChange {
  readonly number: string
  readonly kind: PriceKind
  readonly cents: number
}

export interface PriceRecord {
  readonly kind: 'prices'
  readonly line: number
  readonly changes: readonly PriceChange[]
}

export interface GroupRecord {
  readonly kind: 'group'
  readonly line: number
  readonly mainGroup: string
  /** Empty for a main group, which names itself. */
  readonly group: string
  readonly name: string
}

export interface DiscountRecord {
  readonly kind: 'discount'
  readonly line: number
  readonly discountGroup: string
  readonly name: string
}

/**
 * A kind of record this import does not take over, such as the surcharges of
 * `Z`: counted per letter and named once, not once per line.
 */
export interface IgnoredRecord {
  readonly kind: 'ignored'
  readonly line: number
  readonly letter: string
}

export type DatanormRecord =
  | ArticleRecord
  | ExtraRecord
  | TextRecord
  | PriceRecord
  | GroupRecord
  | DiscountRecord
  | IgnoredRecord

export interface LineProblem {
  readonly line: number
  readonly reason: string
}

const processingOf: Readonly<Record<string, Processing>> = { N: 'new', A: 'change', L: 'delete' }

/** Preiseinheit 0 to 3 of DATANORM 4: a price for 1, 10, 100 or 1000 units. */
const priceBaseOf: Readonly<Record<string, PriceBase>> = { '0': 1, '1': 10, '2': 100, '3': 1000 }

const priceKindOf: Readonly<Record<string, PriceKind>> = { '1': 'list', '2': 'net' }

/**
 * A price as DATANORM 4 writes it: digits whose last two are the cents. Some
 * writers put a comma or a point in anyway, and those count as the decimal
 * separator. Null for anything else.
 */
export function centsOf(value: string): number | null {
  const text = value.trim()

  if (/^\d+$/.test(text)) {
    return Number(text)
  }

  const decimal = /^(\d+)[,.](\d{1,2})$/.exec(text)

  if (!decimal) {
    return null
  }

  return Number(decimal[1]) * 100 + Number((decimal[2] ?? '').padEnd(2, '0'))
}

/** DDMMYY as a day, the century from the year: 80 and later are the 1900s. */
function dayOf(text: string): IsoDate | null {
  const found = /^(\d{2})(\d{2})(\d{2})$/.exec(text.trim())

  if (!found) {
    return null
  }

  const [, day, month, shortYear] = found
  const year = Number(shortYear) >= 80 ? `19${shortYear ?? ''}` : `20${shortYear ?? ''}`
  const iso = `${year}-${month ?? ''}-${day ?? ''}`
  const parsed = new Date(`${iso}T00:00:00Z`)

  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(iso)
    ? (iso as IsoDate)
    : null
}

/**
 * The header. In fixed columns it is the letter, a blank, the day, three texts
 * of 40, 40 and 35 characters, the version and the currency. A header written
 * with separators after all is searched for the same things instead.
 */
export function headerOf(text: string, line: number): Header {
  if (!text.includes(';')) {
    const at = (from: number, to: number) => text.slice(from - 1, to).trim()

    return {
      line,
      date: dayOf(at(3, 8)),
      info: [at(9, 48), at(49, 88), at(89, 123)].filter(Boolean).join(' '),
      version: at(124, 125),
      currency: at(126, 128),
    }
  }

  const fields = text.split(';').map((field) => field.trim())

  return {
    line,
    date: dayOf(fields.find((field) => /^\d{6}$/.test(field)) ?? ''),
    info: fields
      .slice(1)
      .filter((field) => field.length > 3)
      .join(' '),
    version: fields.find((field) => /^0\d$/.test(field)) ?? '',
    currency: [...fields].reverse().find((field) => /^[A-Z]{3}$/.test(field)) ?? '',
  }
}

/**
 * The text lines of a dimension or long text record: a line number, then the
 * text. The descriptions put a flag and a key between them, F for free text,
 * and their examples sometimes leave one of the two out; so after a number,
 * empty fields and single flags are passed over, and the next field is the
 * text. A flag that inserts another text block, T or E, is not followed.
 */
function textLines(fields: readonly string[], from: number) {
  const lines: { index: number; text: string }[] = []
  let at = from

  while (at < fields.length) {
    const number = fields[at] ?? ''

    if (!/^\d{1,2}$/.test(number)) {
      at += 1
      continue
    }

    let next = at + 1

    while (next < fields.length && /^[FTE]?$/.test(fields[next] ?? '')) {
      next += 1
    }

    const text = fields[next] ?? ''

    if (next < fields.length && !/^\d{1,2}$/.test(text)) {
      lines.push({ index: Number(number), text })
      at = next + 1
    } else {
      at = next
    }
  }

  return lines
}

/** One line of a DATANORM 4 file as a record, or the reason it is none. */
export function recordOf(text: string, line: number): DatanormRecord | LineProblem | null {
  const kind = text.charAt(0)

  if (text.trim() === '') {
    return null
  }

  if (!text.includes(';')) {
    return {
      line,
      reason:
        'Kein Trennzeichen. So schreibt DATANORM 3 oder älter, gelesen wird DATANORM 4 mit Semikolon.',
    }
  }

  // Fields as written, without the blanks some writers pad them with.
  const fields = text.split(';').map((field) => field.trim())
  const field = (index: number) => fields[index] ?? ''
  const processing = processingOf[field(1)]

  switch (kind) {
    case 'A': {
      if (!processing) {
        return { line, reason: `Unbekanntes Verarbeitungskennzeichen "${field(1)}".` }
      }

      const number = field(2)

      if (number === '') {
        return { line, reason: 'Ein Artikel ohne Artikelnummer.' }
      }

      const kindOfPrice = priceKindOf[field(6)]
      const cents = centsOf(field(9))
      const base = priceBaseOf[field(7) === '' ? '0' : field(7)]

      if (field(9) !== '' && (cents === null || !kindOfPrice || !base)) {
        return { line, reason: `Der Preis von ${number} ist nicht zu lesen.` }
      }

      return {
        kind: 'article',
        line,
        processing,
        number,
        shortText1: field(4),
        shortText2: field(5),
        price:
          cents !== null && kindOfPrice && base
            ? { kind: kindOfPrice, cents, priceBase: base }
            : null,
        unit: field(8),
        discountGroup: field(10),
        mainGroup: field(11),
        longTextKey: field(12),
      }
    }

    case 'B':
      if (!processing || field(2) === '') {
        return { line, reason: 'Ein zweiter Satz eines Artikels ohne Artikelnummer.' }
      }

      return {
        kind: 'extra',
        line,
        processing,
        number: field(2),
        ean: field(9),
        group: field(11),
      }

    case 'D':
    case 'T':
      if (!processing || field(2) === '') {
        return {
          line,
          reason:
            kind === 'D'
              ? 'Ein Dimensionstext ohne Artikelnummer.'
              : 'Ein Langtext ohne Schlüssel.',
        }
      }

      return {
        kind: kind === 'D' ? 'dimension' : 'long-text',
        line,
        processing,
        key: field(2),
        lines: textLines(fields, 3),
      }

    case 'P': {
      // Up to three articles in one record, nine fields each: the number, the
      // price flag, the price and three discounts, which come with purchasing
      // and costing in Phase 4.
      const changes: PriceChange[] = []

      for (let at = 2; at + 2 < fields.length; at += 9) {
        const number = field(at)

        if (number === '') {
          continue
        }

        const kindOfPrice = priceKindOf[field(at + 1)]
        const cents = centsOf(field(at + 2))

        // The factory price, 3, is left out: it is neither list nor net.
        if (field(at + 1) === '3') {
          continue
        }

        if (!kindOfPrice || cents === null) {
          return { line, reason: `Der neue Preis von ${number} ist nicht zu lesen.` }
        }

        changes.push({ number, kind: kindOfPrice, cents })
      }

      return { kind: 'prices', line, changes }
    }

    case 'S':
      return field(2) === ''
        ? { line, reason: 'Eine Warengruppe ohne Hauptwarengruppe.' }
        : field(4) === ''
          ? { kind: 'group', line, mainGroup: field(2), group: '', name: field(3) }
          : { kind: 'group', line, mainGroup: field(2), group: field(4), name: field(5) }

    case 'R':
      return field(2) === ''
        ? { line, reason: 'Ein Rabattsatz ohne Rabattgruppe.' }
        : { kind: 'discount', line, discountGroup: field(2), name: field(5) }

    default:
      return { kind: 'ignored', line, letter: kind }
  }
}
