import clsx from 'clsx'
import type { ReactNode, ThHTMLAttributes, TdHTMLAttributes } from 'react'

/**
 * A table, and a real one: `<table>`, `<th scope>`, `<caption>`.
 *
 * The office works through lists, so this is the densest thing in the system
 * and also the one a screen reader has the most trouble with when it is built
 * out of divs. The caption is required rather than optional for the same
 * reason the field label is.
 */
export function Table({
  caption,
  children,
  lastRowOpen = false,
  fixed = false,
}: {
  readonly caption: string
  readonly children: ReactNode
  /**
   * No line under the last row, for a table that ends at the edge of its
   * card: the edge is the line, and a second one beside it looks like a
   * mistake.
   */
  readonly lastRowOpen?: boolean
  /** Column widths as given rather than as the content would like them. */
  readonly fixed?: boolean
}) {
  return (
    // The frame scrolls, never the page, as the board "Breiten und
    // Auflösungen" asks (#218). `scrolling-table` in `index.css` keeps the
    // first column standing while the rest slides past. The cells draw their
    // own borders (`border-separate`), because a collapsed border belongs to
    // the table and would scroll away under a cell that stays put. The frame
    // is positioned, or text that is only there for a screen reader, placed
    // absolutely in a heading, would reach past it and widen the page: the
    // accounts were 270 pixels too wide on a phone for that alone.
    <div className="relative max-w-full overflow-x-auto">
      <table
        className={clsx(
          'scrolling-table w-full border-separate border-spacing-0 text-table',
          lastRowOpen && '[&>tbody>tr:last-child>td]:border-b-0',
          fixed && 'table-fixed',
        )}
      >
        <caption className="sr-only">{caption}</caption>
        {children}
      </table>
    </div>
  )
}

export interface ColumnProps extends ThHTMLAttributes<HTMLTableCellElement> {
  /** Amounts and quantities are right aligned, everything else is not. */
  readonly numeric?: boolean
  readonly children: ReactNode
}

export function Column({ numeric = false, className, ...rest }: ColumnProps) {
  return (
    <th
      scope="col"
      className={clsx(
        'font-condensed text-label font-semibold tracking-[0.8px] uppercase',
        'text-ink-faint bg-ground border-b border-line',
        // As the table cards of the canvas: 8 pixels, and 14 at the edges.
        'px-2 py-2 leading-[1.2] first:pl-3.5 last:pr-3.5',
        // A width is the width of the text, as the canvas means it: there
        // `width: 120px` on a head cell makes a column of 136 with its
        // padding, here it made one of 120, and every column with a width
        // came out narrower than drawn (#219).
        'box-content',
        numeric ? 'text-right' : 'text-left',
        className,
      )}
      {...rest}
    />
  )
}

export interface CellProps extends TdHTMLAttributes<HTMLTableCellElement> {
  readonly numeric?: boolean
  readonly children: ReactNode
}

/**
 * A cell. A numeric one is right aligned and set in tabular figures, both at
 * once, because either alone still leaves a column that does not line up.
 */
export function Cell({ numeric = false, className, ...rest }: CellProps) {
  return (
    <td
      className={clsx(
        // Rows of 30 pixels from 1024 pixels on, for a mouse, and of 40
        // below, for a finger, as the board "Breiten und Auflösungen" has it.
        'px-2 py-[7px] leading-[1.2] first:pl-3.5 last:pr-3.5 max-lg:py-3',
        'border-b border-row text-ink',
        numeric && 'text-right numeric',
        className,
      )}
      {...rest}
    />
  )
}
