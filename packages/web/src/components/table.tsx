import clsx from 'clsx'
import { useEffect, useRef, useState } from 'react'
import type { ReactNode, RefObject, ThHTMLAttributes, TdHTMLAttributes } from 'react'

/**
 * How the frame of a table sits, which decides how its head stays in view
 * (#272) and what `index.css` does with it.
 */
interface FrameFit {
  /** The table is wider than its frame, and the frame scrolls sideways. */
  readonly wide: boolean
  /**
   * Something between the frame and the page is a scroll container: a column
   * that scrolls on its own, or a card that clips with `overflow: hidden`.
   * The head then sticks at the top edge of that one and not under the top
   * bar of the page, which would push it down into its own rows wherever that
   * container does not scroll at all.
   */
  readonly nested: boolean
}

function insideScrollContainer(element: HTMLElement): boolean {
  for (let above = element.parentElement; above; above = above.parentElement) {
    if (above === document.body || above === document.documentElement) {
      return false
    }

    const style = getComputedStyle(above)

    if (/auto|scroll|hidden|overlay/.test(`${style.overflowX} ${style.overflowY}`)) {
      return true
    }
  }

  return false
}

/**
 * Measured whenever the frame or the table changes size. It starts out wide,
 * which is always safe: a frame that scrolls sideways shows everything, one
 * that clips would cut a wide table off until the first measurement. Without
 * a ResizeObserver it stays so.
 *
 * The distance the head can travel down its table, the table less its head,
 * goes to the frame as `--table-head-travel` for the animation that carries
 * the head of a wide table. Straight onto the element, because it changes
 * with every row and nothing React renders depends on it.
 */
function useFrameFit(frame: RefObject<HTMLDivElement | null>): FrameFit {
  const [fit, setFit] = useState<FrameFit>({ wide: true, nested: false })

  useEffect(() => {
    const element = frame.current
    const table = element?.querySelector('table')

    if (!element || !table || typeof ResizeObserver !== 'function') {
      return
    }

    const observer = new ResizeObserver(() => {
      const bounds = table.getBoundingClientRect()
      const head = table.tHead?.getBoundingClientRect().height ?? 0
      const wide = bounds.width > element.getBoundingClientRect().width + 0.5
      const nested = insideScrollContainer(element)

      // Rounded down, so that the head never ends below the last row: a head
      // half a pixel past the table would make the frame of a wide table
      // scroll up and down as well.
      element.style.setProperty(
        '--table-head-travel',
        `${String(Math.max(0, Math.floor(bounds.height - head)))}px`,
      )
      setFit((before) =>
        before.wide === wide && before.nested === nested ? before : { wide, nested },
      )
    })

    observer.observe(element)
    observer.observe(table)

    return () => {
      observer.disconnect()
    }
  }, [frame])

  return fit
}

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
  const frame = useRef<HTMLDivElement>(null)
  const { wide, nested } = useFrameFit(frame)

  return (
    // The frame scrolls, never the page, as the board "Breiten und
    // Auflösungen" asks (#218). `scrolling-table` in `index.css` keeps the
    // first column standing while the rest slides past. The cells draw their
    // own borders (`border-separate`), because a collapsed border belongs to
    // the table and would scroll away under a cell that stays put. The frame
    // is positioned, or text that is only there for a screen reader, placed
    // absolutely in a heading, would reach past it and widen the page: the
    // accounts were 270 pixels too wide on a phone for that alone.
    //
    // It scrolls only while the table is wider than it (#272). A frame that
    // scrolls sideways is a scroll container in both directions, and a sticky
    // head would stick to it, which never scrolls up or down, instead of
    // staying under the top bar while the page scrolls, as the same board
    // asks. A frame that clips is none, and the head of a table that fits is
    // sticky; the head of a wide one follows the page by an animation that
    // the scrolling drives, both in `index.css`.
    <div
      ref={frame}
      data-wide={wide ? '' : undefined}
      data-nested={nested ? '' : undefined}
      className={clsx(
        'table-frame relative max-w-full',
        wide ? 'overflow-x-auto' : 'overflow-x-clip',
      )}
    >
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
