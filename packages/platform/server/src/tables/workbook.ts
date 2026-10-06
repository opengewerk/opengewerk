import { tableLimits, type TableSheet } from '@opengewerk/platform-domain'

import { unzip, ZipRefused } from '../files/zip.js'
import { SheetRows, tableBudget, TableRefused } from './limits.js'
import { readXml } from './xml.js'

/**
 * The sheets of a workbook (.xlsx), as Excel, LibreOffice and the programs
 * that export lists write it: an archive of XML parts.
 *
 * Read here and not by a package. The parts that matter are four, the
 * workbook with its sheets, the strings the cells share, the formats that
 * say which number is a day, and the sheets themselves; and what a package
 * adds to that is its own way of unpacking, without a limit (see
 * `files/zip.ts`). What is not read is said: the old binary format, a
 * workbook with a password. Charts, pictures and everything else in the
 * archive are never unpacked.
 *
 * Every cell becomes the text somebody reads in it. A day is written
 * 02.10.2026 and a time 14:30, a number with a decimal comma and without the
 * digits that only a binary fraction has, a share as 19 %, yes and no as
 * "ja" and "nein". A formula is the value it had when the file was saved.
 */
export function workbookSheets(bytes: Uint8Array): TableSheet[] {
  try {
    return sheetsOf(bytes)
  } catch (error) {
    throw error instanceof ZipRefused ? new TableRefused(error.message) : error
  }
}

const notAWorkbook =
  'Die Datei ist ein ZIP-Archiv, aber keine Arbeitsmappe (.xlsx). Speichern Sie die Tabelle als .xlsx oder .csv.'

const tooLarge = `Die Arbeitsmappe entpackt sich zu mehr als ${Math.floor(tableLimits.unpackedBytes / 1_000_000)} MB. Teilen Sie die Tabelle in mehrere Dateien.`

const workbookPath = 'xl/workbook.xml'
const relationsPath = 'xl/_rels/workbook.xml.rels'

function sheetsOf(bytes: Uint8Array): TableSheet[] {
  const first = partsOf(bytes, (path) => path === workbookPath || path === relationsPath)
  const workbook = first.get(workbookPath)
  const relations = first.get(relationsPath)

  if (workbook === undefined || relations === undefined) {
    throw new TableRefused(notAWorkbook)
  }

  const { sheets, from1904 } = workbookOf(workbook)
  const targets = relationsOf(relations)
  const shown = sheets
    .filter((sheet) => sheet.state !== 'hidden' && sheet.state !== 'veryHidden')
    .map((sheet) => ({ name: sheet.name, path: targets.byId.get(sheet.relation) }))
    .filter((sheet): sheet is { name: string; path: string } => sheet.path !== undefined)

  if (shown.length > tableLimits.sheets) {
    throw new TableRefused(
      `Die Arbeitsmappe hat mehr als ${tableLimits.sheets} Blätter. Speichern Sie die Blätter, die übernommen werden, in eine eigene Datei.`,
    )
  }

  const wanted = new Set([...shown.map((sheet) => sheet.path), targets.strings, targets.styles])
  const parts = partsOf(bytes, (path) => wanted.has(path))
  const shared = sharedStrings(parts.get(targets.strings) ?? '')
  const kinds = numberKinds(parts.get(targets.styles) ?? '')
  const budget = tableBudget()

  return shown.map((sheet) => ({
    name: sheet.name,
    rows: sheetRows(parts.get(sheet.path) ?? '', { shared, kinds, from1904 }, budget),
  }))
}

/** The parts of the archive that are asked for, as text. */
function partsOf(bytes: Uint8Array, wanted: (path: string) => boolean): Map<string, string> {
  const decoder = new TextDecoder('utf-8')

  return new Map(
    unzip(bytes, tableLimits.unpackedBytes, { wanted, tooLarge }).map((entry) => [
      entry.path,
      decoder.decode(entry.bytes),
    ]),
  )
}

interface WorkbookSheet {
  readonly name: string
  readonly relation: string
  readonly state: string
}

function workbookOf(xml: string): { sheets: WorkbookSheet[]; from1904: boolean } {
  const sheets: WorkbookSheet[] = []
  let from1904 = false

  readXml(xml, {
    open(name, attributes) {
      if (name === 'sheet') {
        // The relation is the one attribute under a prefix, `r:id` as most programs write it.
        const relation = Object.keys(attributes).find((key) => /:id$/i.test(key))

        sheets.push({
          name: attributes.name ?? '',
          relation: relation ? (attributes[relation] ?? '') : '',
          state: attributes.state ?? '',
        })
      } else if (name === 'workbookPr') {
        from1904 = attributes.date1904 === '1' || attributes.date1904 === 'true'
      }
    },
  })

  return { sheets, from1904 }
}

/** Where the parts lie that the workbook points to: its sheets by their relation, the strings, the formats. */
function relationsOf(xml: string): {
  byId: Map<string, string>
  strings: string
  styles: string
} {
  const byId = new Map<string, string>()
  let strings = 'xl/sharedStrings.xml'
  let styles = 'xl/styles.xml'

  readXml(xml, {
    open(name, attributes) {
      if (name !== 'Relationship' || attributes.TargetMode === 'External') {
        return
      }

      const path = partPath(attributes.Target ?? '')
      const type = attributes.Type ?? ''

      if (type.endsWith('/worksheet')) {
        byId.set(attributes.Id ?? '', path)
      } else if (type.endsWith('/sharedStrings')) {
        strings = path
      } else if (type.endsWith('/styles')) {
        styles = path
      }
    },
  })

  return { byId, strings, styles }
}

/** A target as the workbook names it, as the path in the archive: relative to `xl/`, or from the root. */
function partPath(target: string): string {
  const segments: string[] = []

  for (const segment of (target.startsWith('/') ? target : `xl/${target}`).split('/')) {
    if (segment === '..') {
      segments.pop()
    } else if (segment !== '' && segment !== '.') {
      segments.push(segment)
    }
  }

  return segments.join('/')
}

/** What a program writes for a character XML cannot hold: `_x000D_` for a carriage return. */
const escaped = /_x([0-9A-Fa-f]{4})_/g

const unescaped = (text: string) =>
  text.includes('_x')
    ? text.replace(escaped, (_whole, code: string) => String.fromCharCode(parseInt(code, 16)))
    : text

/**
 * The strings the cells point to, in their order. A string is the text of
 * its runs, one after the other; the reading aid some languages carry beside
 * a string (`rPh`) is no part of it.
 */
function sharedStrings(xml: string): string[] {
  const strings: string[] = []
  let current = ''
  let inText = false
  let aid = 0

  readXml(xml, {
    open(name, _attributes, closed) {
      if (name === 'si') {
        current = ''

        if (closed) {
          strings.push('')
        }
      } else if (name === 'rPh' && !closed) {
        aid += 1
      } else if (name === 't') {
        inText = !closed
      }
    },
    close(name) {
      if (name === 'si') {
        strings.push(unescaped(current))
      } else if (name === 'rPh') {
        aid -= 1
      } else if (name === 't') {
        inText = false
      }
    },
    text(text) {
      if (inText && aid === 0) {
        current += text
      }
    },
  })

  return strings
}

/** The formats a spreadsheet has built in that show a day or a time. */
const builtInDays = new Set([
  14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51,
  52, 53, 54, 55, 56, 57, 58,
])

/** The two a spreadsheet has built in for a share of a hundred. */
const builtInShares = new Set([9, 10])

/** What a number under a format is: a day or a time, a share of a hundred, or the number it is. */
type NumberKind = 'day' | 'share' | 'plain'

/**
 * What a format somebody wrote makes of a number, read from what is left of
 * it once everything is taken out that is text or a condition (what stands
 * in quotes, in brackets or behind a backslash): a day or a time where a
 * letter for day, month, year, hour or second is left, a share where a
 * percent sign is.
 */
function kindOfFormat(code: string): NumberKind {
  const bare = code
    .replace(/"[^"]*"/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\\./g, '')
    .replace(/[_*]./g, '')

  return /[dmyhs]/i.test(bare) ? 'day' : bare.includes('%') ? 'share' : 'plain'
}

/** For every format of a cell, by its number in the file, what a number under it is. */
function numberKinds(xml: string): NumberKind[] {
  const written = new Map<number, string>()
  const formats: number[] = []
  let inCellFormats = false

  readXml(xml, {
    open(name, attributes, closed) {
      if (name === 'numFmt') {
        written.set(Number(attributes.numFmtId), attributes.formatCode ?? '')
      } else if (name === 'cellXfs') {
        inCellFormats = !closed
      } else if (name === 'xf' && inCellFormats) {
        formats.push(Number(attributes.numFmtId ?? 0))
      }
    },
    close(name) {
      if (name === 'cellXfs') {
        inCellFormats = false
      }
    },
  })

  return formats.map((format) => {
    const code = written.get(format)

    return code !== undefined
      ? kindOfFormat(code)
      : builtInDays.has(format)
        ? 'day'
        : builtInShares.has(format)
          ? 'share'
          : 'plain'
  })
}

const two = (figure: number) => String(figure).padStart(2, '0')

const dayMilliseconds = 86_400_000

/**
 * A number as the day and time it counts. A spreadsheet counts days from the
 * end of 1899, and counts a 29 February 1900 that never was, so everything
 * before March 1900 lies a day later than the count says; a workbook from an
 * old Mac counts from 1904 instead. The part behind the comma is the time of
 * day. A count without a whole day is a time alone.
 */
function dayText(count: number, from1904: boolean): string {
  // A time a breath before midnight rounds to the next day, not to an hour 24.
  const rounded = Math.round((count - Math.floor(count)) * 86_400)
  const whole = Math.floor(count) + (rounded === 86_400 ? 1 : 0)
  const seconds = rounded === 86_400 ? 0 : rounded
  const time =
    seconds === 0
      ? ''
      : `${two(Math.floor(seconds / 3600) % 24)}:${two(Math.floor(seconds / 60) % 60)}` +
        (seconds % 60 === 0 ? '' : `:${two(seconds % 60)}`)

  if (whole < 1 && (time !== '' || !from1904)) {
    return time === '' ? '00:00' : time
  }

  const start = from1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, whole < 61 ? 31 : 30)
  const day = new Date(start + whole * dayMilliseconds)
  const written = `${two(day.getUTCDate())}.${two(day.getUTCMonth() + 1)}.${String(day.getUTCFullYear()).padStart(4, '0')}`

  return time === '' ? written : `${written} ${time}`
}

/**
 * A number as somebody reads it: with a decimal comma, and to fifteen digits,
 * which is all a spreadsheet keeps. 0.1 + 0.2 is written 0,3 and not with the
 * seventeen digits its binary fraction has.
 */
function numberText(raw: string): string {
  const number = Number(raw)

  if (raw.trim() === '' || !Number.isFinite(number)) {
    return raw
  }

  if (Number.isInteger(number)) {
    return Math.abs(number) < 1e15 ? String(number) : raw
  }

  return String(Number(number.toPrecision(15))).replace('.', ',')
}

/** The place of a column from the reference of a cell: `C5` is the third, counted from 0. Or -1. */
function columnOf(reference: string): number {
  let column = 0
  let at = 0

  for (; at < reference.length; at += 1) {
    const letter = reference.charCodeAt(at) & ~0x20

    if (letter < 65 || letter > 90) {
      break
    }

    column = column * 26 + (letter - 64)
  }

  return at === 0 ? -1 : column - 1
}

interface Reading {
  readonly shared: readonly string[]
  readonly kinds: readonly NumberKind[]
  readonly from1904: boolean
}

function sheetRows(
  xml: string,
  reading: Reading,
  budget: { cells: number; characters: number },
): string[][] {
  const sheet = new SheetRows(budget)
  let row = -1
  let column = -1
  let type = ''
  let format = 0
  let value = ''
  let inline = ''
  let inValue = false
  let inInline = false
  let inText = false
  let aid = 0

  const put = () => {
    sheet.put(row, column, textOf(type, format, value, inline, reading))
  }

  readXml(xml, {
    open(name, attributes, closed) {
      if (name === 'row') {
        const numbered = Number(attributes.r)

        row = Number.isInteger(numbered) && numbered > 0 ? numbered - 1 : row + 1
        column = -1
      } else if (name === 'c') {
        const placed = columnOf(attributes.r ?? '')

        column = placed < 0 ? column + 1 : placed
        type = attributes.t ?? ''
        format = Number(attributes.s ?? 0)
        value = ''
        inline = ''
      } else if (name === 'v') {
        inValue = !closed
      } else if (name === 'is') {
        inInline = !closed
      } else if (name === 'rPh' && !closed) {
        aid += 1
      } else if (name === 't') {
        inText = !closed
      }
    },
    close(name) {
      if (name === 'c') {
        put()
      } else if (name === 'v') {
        inValue = false
      } else if (name === 'is') {
        inInline = false
      } else if (name === 'rPh') {
        aid -= 1
      } else if (name === 't') {
        inText = false
      }
    },
    text(text) {
      if (inValue) {
        value += text
      } else if (inInline && inText && aid === 0) {
        inline += text
      }
    },
  })

  return sheet.rows
}

/** What a cell shows, from its kind, its format and what the file holds for it. */
function textOf(type: string, format: number, value: string, inline: string, reading: Reading) {
  switch (type) {
    case 's':
      return value.trim() === '' ? '' : (reading.shared[Number(value)] ?? '')
    case 'inlineStr':
      return unescaped(inline)
    case 'str':
      return unescaped(value)
    case 'b':
      return value.trim() === '1' ? 'ja' : 'nein'
    case 'e':
      return ''
    case 'd': {
      // A day written out, as a few programs do: 2026-10-02 or with a time behind it.
      const written = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}:\d{2}))?/.exec(value.trim())

      return written
        ? `${written[3]}.${written[2]}.${written[1]}` +
            (written[4] && written[4] !== '00:00' ? ` ${written[4]}` : '')
        : value
    }
    default: {
      const kind = reading.kinds[format] ?? 'plain'

      if (kind === 'plain' || value.trim() === '' || !Number.isFinite(Number(value))) {
        return numberText(value)
      }

      // A share is kept as a part of one and shown as so many of a hundred.
      return kind === 'day'
        ? dayText(Number(value), reading.from1904)
        : `${numberText(String(Number((Number(value) * 100).toPrecision(15))))} %`
    }
  }
}
