import {
  cellText,
  tableLimits,
  tooManyColumns,
  tooManyRows,
  tooMuch,
} from '@opengewerk/platform-domain'

/** A file that is not read as a table, with the sentence for whoever chose it. */
export class TableRefused extends Error {}

/**
 * The rows of one sheet while they are read, and what all sheets of a file
 * may hold together.
 *
 * Only a cell that holds anything is put down. A workbook often carries rows
 * that are formatted and empty down to its last line, and they are no rows of
 * the list: a sheet ends at the last cell with something in it, and a row at
 * its last such cell. A cell beyond what is read refuses the file in words
 * instead of being left out, because half a list taken over looks like a
 * whole one.
 */
export class SheetRows {
  readonly rows: string[][] = []

  constructor(private readonly budget: { cells: number; characters: number }) {}

  /** Puts down what stands at a row and a column, both counted from 0. */
  put(row: number, column: number, raw: string): void {
    const text = cellText(raw)

    if (text === '') {
      return
    }

    if (row >= tableLimits.rows) {
      throw new TableRefused(tooManyRows)
    }

    if (column >= tableLimits.columns) {
      throw new TableRefused(tooManyColumns)
    }

    this.budget.cells += 1
    this.budget.characters += text.length

    if (this.budget.cells > tableLimits.cells || this.budget.characters > tableLimits.characters) {
      throw new TableRefused(tooMuch)
    }

    while (this.rows.length <= row) {
      this.rows.push([])
    }

    const cells = this.rows[row] ?? []

    while (cells.length < column) {
      cells.push('')
    }

    cells[column] = text
  }
}

/** What one file may hold over all its sheets, counted down while it is read. */
export function tableBudget(): { cells: number; characters: number } {
  return { cells: 0, characters: 0 }
}
