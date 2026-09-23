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

/**
 * The order after one line has moved a step, or null where it cannot move.
 *
 * A position moves over one line, as it always has, and may cross a title on
 * the way: that is how it changes its section. A title moves with its section,
 * everything up to the next title, and jumps over the whole section beside it.
 * Moved one line at a time, a title would land above somebody else's
 * positions or in the middle of them, and the numbering would take them over
 * without a word.
 *
 * A title does not move above positions that stand before the first title.
 * They would end up under it and join its section, which is not what moving a
 * section up means; they get into a section by moving themselves.
 *
 * Here and not on the screen because it rests on what a section is, and that
 * is `outlineRows`'s to say. The screen asks the same function whether a
 * button can do anything, so a disabled arrow and a refused move cannot
 * disagree.
 */
export function movedInOutline<Line extends Pick<LineContent, 'kind'>>(
  lines: readonly Line[],
  index: number,
  step: -1 | 1,
): readonly Line[] | null {
  const line = lines[index]

  if (!line) {
    return null
  }

  if (line.kind !== 'title') {
    const target = index + step

    if (target < 0 || target >= lines.length) {
      return null
    }

    const order = [...lines]
    order.splice(index, 1)
    order.splice(target, 0, line)

    return order
  }

  const end = sectionEnd(lines, index)
  const section = lines.slice(index, end)

  if (step === 1) {
    if (end >= lines.length) {
      return null
    }

    const next = sectionEnd(lines, end)

    return [...lines.slice(0, index), ...lines.slice(end, next), ...section, ...lines.slice(next)]
  }

  const previous = lines.slice(0, index).findLastIndex((other) => other.kind === 'title')

  if (previous < 0) {
    return null
  }

  return [
    ...lines.slice(0, previous),
    ...section,
    ...lines.slice(previous, index),
    ...lines.slice(end),
  ]
}

/** Where the section of the title at `start` ends: at the next title, or at the end. */
function sectionEnd(lines: readonly Pick<LineContent, 'kind'>[], start: number): number {
  const next = lines.findIndex((line, index) => index > start && line.kind === 'title')

  return next < 0 ? lines.length : next
}
