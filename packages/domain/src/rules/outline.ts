import type { LineContent } from '../model/document-content.js'

/** What the outline needs to know about a line, and nothing more. */
type Outlined = Pick<LineContent, 'kind' | 'designation' | 'netCents'>

/**
 * One row of a document as it is laid out: a title, a position, or the sum of
 * a title closing its section.
 */
export type OutlineRow<Line extends Outlined> =
  | { readonly row: 'title'; readonly number: string; readonly line: Line }
  | { readonly row: 'item'; readonly number: string; readonly line: Line }
  | {
      readonly row: 'subtotal'
      readonly number: string
      readonly designation: string
      readonly netCents: number
    }

/**
 * The numbering and the section sums of a document, the way a German quote
 * reads: titles counted 1, 2, 3, their positions 1.1, 1.2, and after the last
 * position of a title the sum of what it holds.
 *
 * Worked out and never stored. The number of a position is where it stands,
 * and storing it would be a second place for the order, which drifts from the
 * first the moment somebody moves a line. The template and the screen both
 * call this, so a quote reads the same on paper and in the office.
 *
 * A document without titles numbers its positions 1, 2, 3 and has no sums.
 * Positions before the first title keep plain numbers as well; that is rare
 * and it is what a person would write by hand.
 *
 * A title without any position gets no sum. A line reading "Summe Titel 2:
 * 0,00 €" under an empty heading says nothing a reader could use.
 */
export function outlineRows<Line extends Outlined>(
  lines: readonly Line[],
): readonly OutlineRow<Line>[] {
  const rows: OutlineRow<Line>[] = []
  let titles = 0
  let loose = 0
  let open: { number: string; designation: string; netCents: number; items: number } | null = null

  const close = () => {
    if (open && open.items > 0) {
      rows.push({
        row: 'subtotal',
        number: open.number,
        designation: open.designation,
        netCents: open.netCents,
      })
    }
  }

  for (const line of lines) {
    if (line.kind === 'title') {
      close()
      titles += 1
      open = { number: String(titles), designation: line.designation, netCents: 0, items: 0 }
      rows.push({ row: 'title', number: open.number, line })
      continue
    }

    if (open) {
      open.items += 1
      open.netCents += line.netCents
      rows.push({ row: 'item', number: `${open.number}.${String(open.items)}`, line })
    } else {
      loose += 1
      rows.push({ row: 'item', number: String(loose), line })
    }
  }

  close()

  return rows
}
