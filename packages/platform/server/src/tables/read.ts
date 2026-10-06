import {
  cellText,
  csvRows,
  tableLimits,
  type TableFile,
  type TableSheet,
} from '@opengewerk/platform-domain'

import { isZip } from '../files/zip.js'
import { SheetRows, tableBudget, TableRefused } from './limits.js'
import { workbookSheets } from './workbook.js'

/**
 * A file somebody chose, read as the table it is: a workbook (.xlsx) with
 * its sheets, or a file of separated values (.csv) as one sheet.
 *
 * What it is is decided by its first bytes and never by its name. A workbook
 * is a ZIP archive and begins like one; everything that is text is read as
 * separated values. Anything else is refused with what to do instead, and so
 * is a file that holds nothing.
 *
 * @throws TableRefused with the sentence for whoever chose the file
 */
export function tableFileOf(bytes: Uint8Array, name: string): TableFile {
  if (bytes.length === 0) {
    throw new TableRefused('Die Datei ist leer.')
  }

  if (bytes.length > tableLimits.fileBytes) {
    throw new TableRefused(tableFileTooLarge)
  }

  const sheets = (isZip(bytes) ? workbookSheets(bytes) : [separatedValues(bytes)]).filter(
    (sheet) => sheet.rows.length > 0,
  )

  if (sheets.length === 0) {
    throw new TableRefused('In der Datei steht keine Zeile.')
  }

  return { name: cellText(name).slice(0, tableLimits.fileName), sheets }
}

/** What to say about a file over the limit, here and where the limit ends the reading of a request. */
export const tableFileTooLarge = `Die Datei hat mehr als ${Math.floor(tableLimits.fileBytes / 1_000_000)} MB. Teilen Sie die Tabelle in mehrere Dateien.`

const neither =
  'Die Datei ist weder eine Arbeitsmappe (.xlsx) noch eine Tabelle als Text (.csv). Speichern Sie die Tabelle in einem der beiden Formate.'

/** How the old binary format of a spreadsheet begins, and a workbook with a password, which is wrapped in it. */
const compoundFile = [0xd0, 0xcf, 0x11, 0xe0]

function separatedValues(bytes: Uint8Array): TableSheet {
  if (compoundFile.every((byte, at) => bytes[at] === byte)) {
    throw new TableRefused(
      'Die Datei ist im alten Format (.xls) oder mit einem Kennwort geschützt. Speichern Sie die Tabelle als .xlsx ohne Kennwort oder als .csv.',
    )
  }

  const text = textOf(bytes)

  // Text has no zero bytes. A picture, a PDF and every other binary file has.
  if (text.includes('\u0000')) {
    throw new TableRefused(neither)
  }

  const sheet = new SheetRows(tableBudget())

  csvRows(text).forEach((row, line) => {
    row.forEach((cell, column) => {
      sheet.put(line, column, cell)
    })
  })

  return { name: '', rows: sheet.rows }
}

/**
 * The bytes as text. A file of separated values does not say how it is
 * encoded: one saved as "Unicode" begins with a mark that says so, and
 * without one it is UTF-8 where it reads as UTF-8 and otherwise the Western
 * encoding of Windows, which is what a German spreadsheet writes when
 * somebody picks "CSV" and nothing else. Read as that, every byte is a
 * character, so the last step never fails.
 */
function textOf(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes)
  }

  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(bytes)
  }

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('windows-1252').decode(bytes)
  }
}
