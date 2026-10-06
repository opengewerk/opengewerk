/**
 * The rows of a file of separated values, as a spreadsheet saves a sheet as
 * text.
 *
 * What separates the values is not written anywhere in such a file. A German
 * spreadsheet writes a semicolon, because the comma is taken by the decimals,
 * an English one a comma, and a program that exports a list often a tab. So
 * the separator is read off the first rows: the one of the three that stands
 * in each of them equally often, since every row of a table has as many
 * columns as the next, and a remark with commas in it has not. Where none
 * does, in a list whose rows end early, it is the one used most. Counted
 * outside of quotes; a file that uses none is one column.
 *
 * A value in quotes holds whatever stands between them, a separator and a
 * line break included, and a quote written twice. That is all of the format
 * there is (RFC 4180), and a file that breaks it is still read: a quote in
 * the middle of a value is a character like any other.
 */
export function csvRows(text: string): string[][] {
  // The mark a file saved as Unicode begins with is no part of its first value.
  const content = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const separator = separatorOf(content)
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  // Whether the cell began with a quote: only then does a quote close it.
  let opened = false

  const endCell = () => {
    row.push(cell)
    cell = ''
    opened = false
  }
  const endRow = () => {
    endCell()
    rows.push(row)
    row = []
  }

  for (let at = 0; at < content.length; at += 1) {
    const character = content[at] ?? ''

    if (quoted) {
      if (character !== '"') {
        cell += character
      } else if (content[at + 1] === '"') {
        cell += '"'
        at += 1
      } else {
        quoted = false
      }
    } else if (character === '"' && cell === '' && !opened) {
      quoted = true
      opened = true
    } else if (character === separator) {
      endCell()
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && content[at + 1] === '\n') {
        at += 1
      }

      endRow()
    } else {
      cell += character
    }
  }

  // A last line without a line break at its end is a line as well.
  if (cell !== '' || opened || row.length > 0) {
    endRow()
  }

  return rows
}

/**
 * The three candidates, in the order that decides between two that fit
 * equally well: the semicolon first, which is what a German list means where
 * its decimals carry commas, then the tab, then the comma.
 */
const separators = [';', '\t', ','] as const

type Separator = (typeof separators)[number]

/** How many rows of the beginning decide what separates the values. */
const rowsAsked = 20

const isSeparator = (character: string): character is Separator =>
  (separators as readonly string[]).includes(character)

function separatorOf(content: string): string {
  const none = (): Record<Separator, number> => ({ ';': 0, '\t': 0, ',': 0 })
  /** How often each candidate stands in each of the first rows that hold anything. */
  const rows: Record<Separator, number>[] = []
  let counts = none()
  let holds = false
  let quoted = false
  // Whether a value begins here, whichever of the three separates them. Only
  // there does a quote open one, as where the rows are read: a quote in the
  // middle of a value must not hide what follows it from the count.
  let begins = true

  for (let at = 0; at < content.length && rows.length < rowsAsked; at += 1) {
    const character = content[at] ?? ''
    const breaks = !quoted && (character === '\n' || character === '\r')

    if (quoted) {
      if (character === '"' && content[at + 1] === '"') {
        at += 1
      } else if (character === '"') {
        quoted = false
      }
    } else if (character === '"' && begins) {
      quoted = true
    } else if (breaks) {
      if (holds) {
        rows.push(counts)
      }

      counts = none()
    } else if (isSeparator(character)) {
      counts[character] += 1
    }

    holds = !breaks
    begins = !quoted && (breaks || isSeparator(character))
  }

  if (holds && rows.length < rowsAsked) {
    rows.push(counts)
  }

  const [first] = rows
  const steady = separators.find(
    (separator) =>
      first !== undefined &&
      first[separator] > 0 &&
      rows.every((row) => row[separator] === first[separator]),
  )
  const used = (separator: Separator) => rows.reduce((sum, row) => sum + row[separator], 0)

  return (
    steady ??
    separators.reduce((most, separator) => (used(separator) > used(most) ? separator : most))
  )
}
