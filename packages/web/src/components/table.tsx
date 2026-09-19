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
}: {
  readonly caption: string
  readonly children: ReactNode
}) {
  return (
    <table className="w-full border-collapse text-table">
      <caption className="sr-only">{caption}</caption>
      {children}
    </table>
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
        'font-condensed text-label font-semibold tracking-wide uppercase',
        'text-ink-faint bg-ground border-b border-line',
        'px-3 py-2',
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
        'px-3 py-2 border-b border-line text-ink',
        numeric && 'text-right numeric',
        className,
      )}
      {...rest}
    />
  )
}
