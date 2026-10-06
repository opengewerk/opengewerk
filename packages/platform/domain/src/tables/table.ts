import type { IsoDate } from '../model/identifier.js'

/**
 * A table as somebody keeps it in a spreadsheet, on its way into records.
 *
 * Whoever brings what they have kept in lists brings a file of sheets: rows
 * of cells under a row of names. This is what the two ends agree on. The
 * server reads a file into it and hands it to the page; the page shows its
 * columns, somebody says which field each of them is, and what goes back is
 * the sheet with that choice. Every cell is the text a person would read in
 * it, so that a day and a number arrive the same from a workbook and from a
 * file of separated values, and nothing below has to know which it was.
 */

/** One sheet: its rows as they stand, a row as long as its last cell that holds anything. */
export interface TableSheet {
  /** The name of the sheet in its workbook; empty where the file is one table and nothing else. */
  readonly name: string
  readonly rows: readonly (readonly string[])[]
}

/** A file that was read, with every sheet that holds anything. */
export interface TableFile {
  readonly name: string
  readonly sheets: readonly TableSheet[]
}

/**
 * How much of a table is read. The figures hold a file to what a list kept
 * by hand comes to, with room to spare, and they hold what travels between
 * page and server under the limit of one request: whoever has more splits
 * the list, and is told so in words.
 */
export const tableLimits = {
  /** The file as it is sent. */
  fileBytes: 10_000_000,
  /** What a packed file may unpack to; a workbook is an archive. */
  unpackedBytes: 60_000_000,
  sheets: 50,
  /** The last line of a sheet that may hold anything. */
  rows: 10_000,
  columns: 100,
  /** The characters of one cell; a longer one is cut and marked. */
  cellLength: 2_000,
  /** The cells that hold anything, over all sheets. */
  cells: 400_000,
  /** The characters of all cells together. */
  characters: 2_000_000,
  fileName: 200,
} as const

/** What marks a cell that was longer than a cell is read. */
const cut = '…'

/**
 * A cell as it is kept: one line, without the spaces around it. A line break
 * inside a cell is a space here, because what comes out of it is a name or a
 * number and never a paragraph, and so is a control character, which no name
 * holds on purpose. A cell over the limit keeps its beginning
 * and one character more than the limit, so that every rule about a length
 * still finds it too long.
 */
export function cellText(raw: string): string {
  const text = raw.replace(/[\s\p{Cc}]+/gu, ' ').trim()

  return text.length > tableLimits.cellLength ? text.slice(0, tableLimits.cellLength) + cut : text
}

/**
 * What two names are compared by: letters and digits, in lower case. "Raum-Nr."
 * and "raum nr" are the same column to whoever wrote them.
 */
export function tableNameKey(name: string): string {
  return name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

/** The letters a spreadsheet gives a column: A, B and after Z on with AA. */
export function columnLetters(index: number): string {
  let letters = ''

  for (let rest = index + 1; rest > 0; rest = Math.floor((rest - 1) / 26)) {
    letters = String.fromCharCode(65 + ((rest - 1) % 26)) + letters
  }

  return letters
}

const holdsSomething = (row: readonly string[]) => row.some((cell) => cell !== '')

/** Where the names of the columns stand: the first row that holds anything, or -1 in an empty sheet. */
export function headerIndex(sheet: TableSheet): number {
  return sheet.rows.findIndex(holdsSomething)
}

/** How many rows below the names hold anything. */
export function tableLineCount(sheet: TableSheet): number {
  const head = headerIndex(sheet)

  return head < 0 ? 0 : sheet.rows.slice(head + 1).filter(holdsSomething).length
}

/** A column somebody can give a field: its place, its name and the first thing that stands in it. */
export interface TableColumn {
  readonly index: number
  /** What the header calls it; empty where a column holds values under no name. */
  readonly name: string
  readonly sample: string
}

/** The columns of a sheet that have a name or hold anything, from left to right. */
export function tableColumns(sheet: TableSheet): readonly TableColumn[] {
  const head = headerIndex(sheet)

  if (head < 0) {
    return []
  }

  const header = sheet.rows[head] ?? []
  const below = sheet.rows.slice(head + 1)
  const width = below.reduce((widest, row) => Math.max(widest, row.length), header.length)
  const columns: TableColumn[] = []

  for (let index = 0; index < width; index += 1) {
    const name = header[index] ?? ''
    const sample = below.find((row) => (row[index] ?? '') !== '')?.[index] ?? ''

    if (name !== '' || sample !== '') {
      columns.push({ index, name, sample })
    }
  }

  return columns
}

/** What a column is called where it is named: by its header, or by its letters where it has none. */
export function columnName(column: Pick<TableColumn, 'index' | 'name'>): string {
  return column.name === '' ? `Spalte ${columnLetters(column.index)}` : column.name
}

/** A field a column can be given, as the application that takes the table describes it. */
export interface TableField {
  readonly key: string
  /** What it is called where somebody chooses it. */
  readonly label: string
  /** What a column that holds it is called in the lists people keep, beside the label. */
  readonly names?: readonly string[]
  /** Nothing can be read without a column for it. */
  readonly required?: boolean
}

/**
 * Which column each field is read from: the key of a field and the place of
 * its column. A field has one column and a column one field, which this shape
 * says for the field and `columnMappingProblem` for the column.
 */
export type ColumnMapping = Readonly<Record<string, number>>

/**
 * The choice a page starts with: every field gets the first free column that
 * is called what the field is called. Compared by `tableNameKey` and never by
 * likeness: a column that was guessed wrong is taken over wrong, one that was
 * not guessed is seen and chosen.
 */
export function suggestedMapping(
  columns: readonly TableColumn[],
  fields: readonly TableField[],
): ColumnMapping {
  const mapping: Record<string, number> = {}
  const taken = new Set<number>()

  for (const field of fields) {
    // A name of nothing but punctuation has no key, and is called like nothing.
    const keys = new Set(
      [field.label, ...(field.names ?? [])].map(tableNameKey).filter((key) => key !== ''),
    )
    const column = columns.find(
      (candidate) =>
        candidate.name !== '' &&
        !taken.has(candidate.index) &&
        keys.has(tableNameKey(candidate.name)),
    )

    if (column) {
      mapping[field.key] = column.index
      taken.add(column.index)
    }
  }

  return mapping
}

/** The fields that need a column and have none. */
export function fieldsWithoutColumn(
  mapping: ColumnMapping,
  fields: readonly TableField[],
): readonly TableField[] {
  return fields.filter((field) => field.required === true && mapping[field.key] === undefined)
}

/** The field a column is given, or null where it stays out. */
export function fieldOfColumn(mapping: ColumnMapping, index: number): string | null {
  return Object.keys(mapping).find((key) => mapping[key] === index) ?? null
}

/**
 * The choice after somebody gave a column a field, or took it out with null.
 * The field leaves the column it had and the column the field it had, so that
 * what stands on the screen is always a choice that can be sent.
 */
export function withColumn(
  mapping: ColumnMapping,
  index: number,
  field: string | null,
): ColumnMapping {
  const next: Record<string, number> = {}

  for (const [key, column] of Object.entries(mapping)) {
    if (column !== index && key !== field) {
      next[key] = column
    }
  }

  if (field !== null) {
    next[field] = index
  }

  return next
}

/**
 * Why a sheet that came over the wire is not one, or null. A route asks this
 * before anything else: what it gets is whatever somebody sent, and the
 * limits of a file that was read hold for a sheet that was typed as well.
 */
export function tableSheetProblem(sheet: unknown): string | null {
  const shaped =
    typeof sheet === 'object' &&
    sheet !== null &&
    typeof (sheet as TableSheet).name === 'string' &&
    Array.isArray((sheet as TableSheet).rows) &&
    (sheet as TableSheet).rows.every(
      (row) => Array.isArray(row) && row.every((cell) => typeof cell === 'string'),
    )

  if (!shaped) {
    return 'Die Tabelle steht als Blatt mit einem Namen und Zeilen aus Zellen.'
  }

  const { rows } = sheet as TableSheet

  if (rows.length > tableLimits.rows) {
    return tooManyRows
  }

  let cells = 0
  let characters = 0

  for (const row of rows) {
    if (row.length > tableLimits.columns) {
      return tooManyColumns
    }

    for (const cell of row) {
      if (cell.length > tableLimits.cellLength + cut.length) {
        return `Eine Zelle hat mehr als ${count(tableLimits.cellLength)} Zeichen.`
      }

      cells += cell === '' ? 0 : 1
      characters += cell.length
    }
  }

  return cells > tableLimits.cells || characters > tableLimits.characters ? tooMuch : null
}

const count = (figure: number) => figure.toLocaleString('de-DE')

/** The sentences about a table that is more than is read, for whoever reads a file as well. */
export const tooManyRows = `Die Tabelle hat mehr als ${count(tableLimits.rows)} Zeilen. Teilen Sie sie in mehrere Dateien.`
export const tooManyColumns = `Die Tabelle hat mehr als ${count(tableLimits.columns)} Spalten. Lassen Sie weg, was nicht übernommen wird.`
export const tooMuch =
  'Die Tabelle hält mehr, als auf einmal gelesen wird. Teilen Sie sie in mehrere Dateien.'

/**
 * Why a choice of columns cannot be worked with, or null: what came over the
 * wire has to be a choice at all, among the fields of this table and the
 * columns of this sheet, with a column for every field that needs one.
 */
export function columnMappingProblem(
  mapping: unknown,
  fields: readonly TableField[],
  sheet: TableSheet,
): string | null {
  if (typeof mapping !== 'object' || mapping === null || Array.isArray(mapping)) {
    return 'Die Zuordnung der Spalten steht als Feld mit seiner Spalte.'
  }

  const known = new Map(fields.map((field) => [field.key, field]))
  const columns = new Set(tableColumns(sheet).map((column) => column.index))
  const taken = new Set<number>()

  for (const [key, index] of Object.entries(mapping)) {
    if (!known.has(key)) {
      return `Das Feld ${key} gibt es in dieser Tabelle nicht.`
    }

    if (typeof index !== 'number' || !columns.has(index)) {
      return `Die Spalte für „${known.get(key)?.label ?? key}“ gibt es in der Datei nicht.`
    }

    if (taken.has(index)) {
      return `Die Spalte ${columnLetters(index)} ist zwei Feldern zugeordnet.`
    }

    taken.add(index)
  }

  const [missing] = fieldsWithoutColumn(mapping as ColumnMapping, fields)

  return missing ? `Für „${missing.label}“ ist keine Spalte gewählt.` : null
}

/** One row of a table as the fields it was given: what stands in the column of each. */
export interface TableRecord {
  /** The line in the file, counted from one as a spreadsheet counts its rows. */
  readonly line: number
  /** Every field that has a column, empty where the cell is. */
  readonly values: Readonly<Record<string, string>>
}

/**
 * The rows below the names, each as its fields. A row in which no chosen
 * column holds anything is not a record: a blank line, a line of sums under a
 * column nobody takes. Every other row is one, and keeps the line it stands
 * in, so that what is said about it can be found in the file.
 */
export function tableRecords(sheet: TableSheet, mapping: ColumnMapping): readonly TableRecord[] {
  const head = headerIndex(sheet)
  const fields = Object.entries(mapping)
  const records: TableRecord[] = []

  if (head < 0) {
    return records
  }

  for (let index = head + 1; index < sheet.rows.length; index += 1) {
    const row = sheet.rows[index] ?? []
    const values: Record<string, string> = {}
    let holds = false

    for (const [key, column] of fields) {
      const cell = row[column] ?? ''

      values[key] = cell
      holds ||= cell !== ''
    }

    if (holds) {
      records.push({ line: index + 1, values })
    }
  }

  return records
}

/**
 * Lines as somebody would name them: "301", "88, 89", "13 bis 26". Three and
 * more in a row are a range, so that four hundred rooms of one floor are one
 * line of a preview and not four hundred numbers.
 */
export function lineWords(lines: readonly number[]): string {
  const sorted = [...new Set(lines)].sort((one, other) => one - other)
  const parts: string[] = []

  for (let at = 0; at < sorted.length;) {
    let end = at

    while (end + 1 < sorted.length && sorted[end + 1] === (sorted[end] ?? 0) + 1) {
      end += 1
    }

    if (end - at >= 2) {
      parts.push(`${sorted[at]} bis ${sorted[end]}`)
    } else {
      parts.push(...sorted.slice(at, end + 1).map(String))
    }

    at = end + 1
  }

  return parts.join(', ')
}

/**
 * The day a cell names, or null where it names none: written as a list
 * writes it, 02.10.2026 or 2.10.2026, or as a program does, 2026-10-02. A day
 * the calendar does not have is none, and a year of two digits is none
 * either: which century it means is a guess.
 */
export function dayOfCell(text: string): IsoDate | null {
  const written = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(text)
  const programmed = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  const [year, month, day] = written
    ? [Number(written[3]), Number(written[2]), Number(written[1])]
    : programmed
      ? [Number(programmed[1]), Number(programmed[2]), Number(programmed[3])]
      : [0, 0, 0]

  if (year < 1 || month < 1 || month > 12 || day < 1) {
    return null
  }

  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0

  if (day > days) {
    return null
  }

  const two = (figure: number) => String(figure).padStart(2, '0')

  return `${String(year).padStart(4, '0')}-${two(month)}-${two(day)}`
}

/** The whole number a cell holds, or null: digits and nothing else, a year or a level. */
export function wholeNumberOfCell(text: string): number | null {
  return /^-?\d{1,15}$/.test(text) ? Number(text) : null
}
