import { BadRequestException, StreamableFile, UnprocessableEntityException } from '@nestjs/common'
import {
  columnLetters,
  type IsoDate,
  outgoingTableRows,
  tooLongForATable,
} from '@opengewerk/platform-domain'

import { dispositionFor } from '../files/media-type.js'
import { zipped } from '../files/zip.js'

/**
 * A list of the office as a table to take away (opengewerk-haustechnik#138):
 * what its filter shows, in its order, under its columns, as a workbook
 * (.xlsx) or as text with separated values (.csv). The route of a list
 * reads its rows the way the list does, under the rights and in the areas of
 * the person asking, and hands them in here; nothing in here reads a record.
 *
 * Both formats are written without a package, as the tables that come in
 * are read (`read.ts`, `workbook.ts`). A workbook is a few parts of XML in a
 * ZIP archive, and the writer needs four kinds of cell and a header. What
 * the reader takes for a day, a number and text is what is written, so that
 * a list that went out can come back in.
 *
 * A value that begins like a formula is never run as one by a spreadsheet:
 * in the workbook every text is a cell of text, marked to stay one when
 * somebody edits it, and in the text file it begins with an apostrophe,
 * as OWASP recommends against "CSV injection".
 */

/** A cell of a table that goes out: text, a number, a day, or nothing. */
export type TableCell = string | number | { readonly day: IsoDate } | null

export interface OutgoingTable {
  /** What the list is called: the name of the sheet, and of the file. */
  readonly name: string
  readonly columns: readonly string[]
  /** Each as long as the columns; a missing cell is an empty one. */
  readonly rows: readonly (readonly TableCell[])[]
}

/** The two formats a list goes out in, as the address names them. */
export const tableFormats = ['xlsx', 'csv'] as const

export type TableFormat = (typeof tableFormats)[number]

/** The format the address of a table asks for, or the refusal. */
export function tableFormatOf(query: Readonly<Record<string, unknown>>): TableFormat {
  const format = query['format']

  if (typeof format !== 'string' || !(tableFormats as readonly string[]).includes(format)) {
    throw new BadRequestException('Eine Tabelle gibt es als xlsx oder als csv.')
  }

  return format as TableFormat
}

/** The type of each format, as the answer names it. */
export const tableMediaTypes: Readonly<Record<TableFormat, string>> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv; charset=utf-8',
}

/**
 * Refuses a list that is longer than a table goes out with
 * (`outgoingTableRows`), in the sentence for whoever asked. A route that
 * reads its rows asks as soon as it knows how many there are, so that it
 * reads no further, and `tableAnswer` asks for every table before it is
 * written.
 */
export function refuseOverlongTable(rows: number): void {
  if (rows > outgoingTableRows) {
    throw new UnprocessableEntityException(tooLongForATable)
  }
}

/**
 * The table as the answer of a route: a file to save, named after the list
 * and the day it was taken, "Anlagen 2026-10-11.xlsx". The route says
 * `Cache-Control: no-store`, as for every file it hands out.
 *
 * @throws UnprocessableEntityException for a list longer than a table goes out with
 */
export function tableAnswer(
  table: OutgoingTable,
  format: TableFormat,
  day: IsoDate,
): StreamableFile {
  refuseOverlongTable(table.rows.length)

  const bytes = format === 'xlsx' ? tableAsWorkbook(table) : tableAsCsv(table)
  const type = tableMediaTypes[format]

  return new StreamableFile(Buffer.from(bytes), {
    type,
    disposition: dispositionFor(type, `${fileNameOf(table.name)} ${day}.${format}`),
    length: bytes.byteLength,
  })
}

/** A name a file may carry on every system: without the characters Windows refuses. */
function fileNameOf(name: string): string {
  // eslint-disable-next-line no-control-regex
  const plain = name.replace(/[\u0000-\u001f<>:"/\\|?*]+/g, ' ').trim()

  return plain === '' ? 'Tabelle' : plain
}

/**
 * Whether a spreadsheet would read the text as a formula: it begins with an
 * equals sign, a plus, a minus or an at sign, or with a tab or a carriage
 * return, which some programs pass over before they read the rest.
 */
export function readAsFormula(text: string): boolean {
  return /^[=+\-@\t\r]/.test(text)
}

/** The most characters a cell of a workbook holds; a longer text would break the file. */
const cellLength = 32_767

/** A day as somebody writes it in Germany, and as the reader reads it: 02.10.2026. */
function writtenDay(day: IsoDate): string {
  const [year, month, date] = day.split('-')

  return `${date ?? ''}.${month ?? ''}.${year ?? ''}`
}

/** A number as a German spreadsheet reads it: with a decimal comma and no thousands. */
function writtenNumber(number: number): string {
  return Number.isFinite(number) ? String(number).replace('.', ',') : ''
}

const isDay = (cell: TableCell): cell is { readonly day: IsoDate } =>
  cell !== null && typeof cell === 'object'

// --- Text with separated values -----------------------------------------------------------

/** The mark a text in UTF-8 begins with, for a program that would guess otherwise. */
const byteOrderMark = String.fromCharCode(0xfeff)

/**
 * The table as a file of separated values, for a German spreadsheet to open
 * without asking: UTF-8 with the mark at its beginning, by which Excel knows
 * the umlauts, the semicolon between the values, because the comma is the
 * decimal one, and a line break of Windows after every row. A number has its
 * decimal comma and a day is written 02.10.2026, which both read as what
 * they are. A value is quoted where it holds a semicolon, a quote or a line
 * break, and a quote inside it is written twice.
 *
 * What the format cannot say is that a text of digits is text: a list
 * opened in Excel shows "00123" as 123. The workbook keeps it.
 */
export function tableAsCsv(table: OutgoingTable): Uint8Array {
  const lines = [table.columns, ...table.rows].map((row, index) =>
    table.columns
      .map((_, column) => {
        const cell = row[column] ?? null

        return index === 0 ? textValue(String(cell ?? '')) : csvValue(cell)
      })
      .join(';'),
  )

  return new TextEncoder().encode(`${byteOrderMark}${lines.join('\r\n')}\r\n`)
}

function csvValue(cell: TableCell): string {
  if (cell === null) {
    return ''
  }

  if (typeof cell === 'number') {
    return writtenNumber(cell)
  }

  return isDay(cell) ? writtenDay(cell.day) : textValue(cell)
}

function textValue(text: string): string {
  // The apostrophe tells a spreadsheet that what follows is text.
  const safe = readAsFormula(text) ? `'${text}` : text

  // In quotes as well where a comma or a tab stands in it, not only the
  // semicolon this file is separated by: a program that takes the comma or
  // the tab for the separator would otherwise begin a cell in the middle of
  // the value, and with it a formula that stands there.
  return /[;,\t"\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

// --- Workbook -------------------------------------------------------------------------------

/** The namespace every part of a workbook is written in. */
const sheetNamespace = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const relationNamespace = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const packageRelations = 'http://schemas.openxmlformats.org/package/2006/relationships'
const declaration = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'

/**
 * The formats of a cell, by their place in `styles.xml`: nothing, the bold
 * header, a text marked to stay text when somebody edits it, and a day.
 */
const styles = { plain: 0, header: 1, text: 2, day: 3 } as const

/**
 * Whether XML may not hold the character at all: a control character other
 * than the tab and the two line breaks, half of a pair of surrogates, and the
 * two that are no characters, 0xFFFE and 0xFFFF.
 */
function forbiddenInXml(code: number): boolean {
  return (
    (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) ||
    (code >= 0xd800 && code <= 0xdfff) ||
    code === 0xfffe ||
    code === 0xffff
  )
}

/** Text as XML holds it: the five characters escaped, and the ones XML may not hold left out. */
function xml(text: string): string {
  return Array.from(text)
    .filter((character) => !forbiddenInXml(character.codePointAt(0) ?? 0))
    .join('')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * The name of the sheet: at most 31 characters, none of those a workbook
 * keeps for itself, and no apostrophe at either end, which a workbook does
 * not take there. Cut by hand and not with an expression that looks for the
 * end of a run, which takes long on a name that is nothing but apostrophes.
 */
function sheetNameOf(name: string): string {
  const spaced = name
    .slice(0, 200)
    .replace(/[\\/?*[\]:]+/g, ' ')
    .replace(/\s+/g, ' ')
  let start = 0
  let end = spaced.length

  while (start < end && (spaced[start] === "'" || spaced[start] === ' ')) {
    start += 1
  }

  while (end > start && (spaced[end - 1] === "'" || spaced[end - 1] === ' ')) {
    end -= 1
  }

  const plain = spaced.slice(start, end).slice(0, 31).trim()

  return plain === '' ? 'Tabelle' : plain
}

/** The count of a spreadsheet for a day: days since the end of 1899, as Excel counts them. */
function dayCount(day: IsoDate): number {
  const [year, month, date] = day.split('-').map(Number)

  // From March 1900 on the count is one more than the days since 1899-12-31,
  // for the 29th of February 1900 a spreadsheet counts and the calendar has not.
  return (Date.UTC(year ?? 0, (month ?? 1) - 1, date ?? 1) - Date.UTC(1899, 11, 30)) / 86_400_000
}

function workbookCell(cell: TableCell, at: string): string {
  if (cell === null || cell === '') {
    return ''
  }

  if (typeof cell === 'number') {
    return Number.isFinite(cell) ? `<c r="${at}"><v>${String(cell)}</v></c>` : ''
  }

  if (isDay(cell)) {
    return `<c r="${at}" s="${String(styles.day)}"><v>${String(dayCount(cell.day))}</v></c>`
  }

  return textCell(cell, at, styles.text)
}

function textCell(text: string, at: string, style: number): string {
  return (
    `<c r="${at}" s="${String(style)}" t="inlineStr"><is><t xml:space="preserve">` +
    `${xml(text.slice(0, cellLength))}</t></is></c>`
  )
}

/** How wide a column is drawn, in characters: as its longest value, within bounds. */
function columnWidth(table: OutgoingTable, column: number): number {
  const lengths = [table.columns, ...table.rows].map((row) => {
    const cell = row[column] ?? null

    return cell === null
      ? 0
      : typeof cell === 'number'
        ? writtenNumber(cell).length
        : isDay(cell)
          ? 10
          : cell.length
  })

  return Math.min(60, Math.max(8, ...lengths) + 2)
}

/**
 * The table as a workbook of one sheet: the header in bold and held in place
 * while the rows scroll, a filter on every column, each column as wide as
 * its values. Text is a cell of text and never a formula, a number a number,
 * a day a day shown 02.10.2026.
 */
export function tableAsWorkbook(table: OutgoingTable): Uint8Array {
  const width = Math.max(1, table.columns.length)
  const last = `${columnLetters(width - 1)}${String(table.rows.length + 1)}`
  const name = sheetNameOf(table.name)
  const header = `<row r="1">${table.columns
    .map((column, index) => textCell(column, `${columnLetters(index)}1`, styles.header))
    .join('')}</row>`
  const rows = table.rows.map((row, index) => {
    const line = String(index + 2)

    return `<row r="${line}">${table.columns
      .map((_, column) => workbookCell(row[column] ?? null, `${columnLetters(column)}${line}`))
      .join('')}</row>`
  })
  const columns = table.columns
    .map((_, index) => {
      const at = String(index + 1)

      return `<col min="${at}" max="${at}" width="${String(columnWidth(table, index))}" customWidth="1"/>`
    })
    .join('')

  const sheet =
    `${declaration}<worksheet xmlns="${sheetNamespace}" xmlns:r="${relationNamespace}">` +
    '<sheetViews><sheetView workbookViewId="0">' +
    '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
    '</sheetView></sheetViews>' +
    `${columns === '' ? '' : `<cols>${columns}</cols>`}` +
    `<sheetData>${header}${rows.join('')}</sheetData>` +
    `<autoFilter ref="A1:${last}"/>` +
    '</worksheet>'

  const workbook =
    `${declaration}<workbook xmlns="${sheetNamespace}" xmlns:r="${relationNamespace}">` +
    `<sheets><sheet name="${xml(name)}" sheetId="1" r:id="rId1"/></sheets>` +
    '<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">' +
    `${xml(`'${name.replace(/'/g, "''")}'!$A$1:$${columnLetters(width - 1)}$${String(table.rows.length + 1)}`)}` +
    '</definedName></definedNames>' +
    '</workbook>'

  const workbookRelations =
    `${declaration}<Relationships xmlns="${packageRelations}">` +
    `<Relationship Id="rId1" Type="${relationNamespace}/worksheet" Target="worksheets/sheet1.xml"/>` +
    `<Relationship Id="rId2" Type="${relationNamespace}/styles" Target="styles.xml"/>` +
    '</Relationships>'

  const stylesheet =
    `${declaration}<styleSheet xmlns="${sheetNamespace}">` +
    '<numFmts count="1"><numFmt numFmtId="164" formatCode="dd\\.mm\\.yyyy"/></numFmts>' +
    '<fonts count="2"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font>' +
    '<font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts>' +
    '<fills count="2"><fill><patternFill patternType="none"/></fill>' +
    '<fill><patternFill patternType="gray125"/></fill></fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="4">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" quotePrefix="1"/>' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" quotePrefix="1"/>' +
    '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '</cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Standard" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>'

  const contentTypes =
    `${declaration}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    '</Types>'

  const rootRelations =
    `${declaration}<Relationships xmlns="${packageRelations}">` +
    `<Relationship Id="rId1" Type="${relationNamespace}/officeDocument" Target="xl/workbook.xml"/>` +
    '</Relationships>'

  const encode = (text: string) => new TextEncoder().encode(text)

  return zipped([
    { path: '[Content_Types].xml', bytes: encode(contentTypes) },
    { path: '_rels/.rels', bytes: encode(rootRelations) },
    { path: 'xl/workbook.xml', bytes: encode(workbook) },
    { path: 'xl/_rels/workbook.xml.rels', bytes: encode(workbookRelations) },
    { path: 'xl/styles.xml', bytes: encode(stylesheet) },
    { path: 'xl/worksheets/sheet1.xml', bytes: encode(sheet) },
  ])
}
