import clsx from 'clsx'
import { useId } from 'react'
import type { ReactNode } from 'react'

import { useEntry } from './surface.js'
import { Table } from './table.js'

/**
 * The cards of the canvas (#219), which every record is built from: `card()`
 * and `table_card()` in the office, `site_card()` on site.
 *
 * The title is the small condensed capitals of `label()`, and it is a heading
 * rather than a styled div: a record has six of these, and a reader moving
 * from heading to heading is how a screen of six cards is walked through. The
 * card takes its name from it.
 */

/** The condensed capitals over a card or a group of values. */
export function PanelLabel({
  id,
  children,
}: {
  readonly id?: string
  readonly children: ReactNode
}) {
  const entry = useEntry()

  return (
    <h2
      id={id}
      className={clsx(
        'font-condensed font-semibold uppercase text-ink-faint',
        entry === 'site' ? 'text-[14px] tracking-[1.1px]' : 'text-[12px] tracking-[1.1px]',
      )}
    >
      {children}
    </h2>
  )
}

export interface PanelProps {
  readonly title?: string
  /** Beside the title, at the right: "Objekt anlegen", a count. */
  readonly action?: ReactNode
  /** The padding of the form cards, which is a little wider. */
  readonly roomy?: boolean
  readonly className?: string
  readonly children: ReactNode
}

export function Panel({ title, action, roomy = false, className, children }: PanelProps) {
  const entry = useEntry()
  const headingId = useId()

  return (
    <section
      aria-labelledby={title ? headingId : undefined}
      className={clsx(
        'min-w-0 border border-line bg-surface [--surface-here:var(--color-surface)]',
        entry === 'site'
          ? 'rounded-[6px] p-3.5'
          : clsx('rounded-[5px]', roomy ? 'px-4 py-3.5' : 'px-3.5 py-3'),
        className,
      )}
    >
      {title || action ? (
        <div
          className={clsx(
            'flex flex-wrap items-center gap-x-2.5 gap-y-2',
            entry === 'site' ? 'mb-2.5' : 'mb-[9px]',
          )}
        >
          {title ? <PanelLabel id={headingId}>{title}</PanelLabel> : null}
          <div className="grow" />
          {action}
        </div>
      ) : null}
      {children}
    </section>
  )
}

export interface TablePanelProps {
  readonly title?: string
  readonly action?: ReactNode
  /** Between the head and the table: a form for a new row. */
  readonly lead?: ReactNode
  /** What a reader hears the table called; the title where there is one. */
  readonly caption: string
  /** `<thead>` and `<tbody>`, as for `Table`. */
  readonly children: ReactNode
  /** Under the table, over a line: the pages of a list. */
  readonly footer?: ReactNode
  /** Under the table without a line: a remark about what it shows. */
  readonly note?: ReactNode
  /** Grows to the space it is given, as the lists do. */
  readonly grow?: boolean
  readonly className?: string
}

/**
 * A table in a card, exactly like the customer list and the positions: the
 * head of the card over a line, the table, and under it the pages or a note.
 */
export function TablePanel({
  title,
  action,
  lead,
  caption,
  children,
  footer,
  note,
  grow = false,
  className,
}: TablePanelProps) {
  const headingId = useId()

  return (
    <section
      aria-labelledby={title ? headingId : undefined}
      aria-label={title ? undefined : caption}
      className={clsx(
        'flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[5px] border border-line bg-surface',
        '[--surface-here:var(--color-surface)]',
        grow && 'grow',
        className,
      )}
    >
      {title || action ? (
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2 border-b border-line px-3.5 py-[11px]">
          {title ? <PanelLabel id={headingId}>{title}</PanelLabel> : null}
          <div className="grow" />
          {action}
        </div>
      ) : null}
      {lead ? <div className="border-b border-line px-3.5 py-3">{lead}</div> : null}
      <Table caption={caption} lastRowOpen={!footer}>
        {children}
      </Table>
      {note ? <div className="px-3.5 py-2.5 text-[13px] text-ink-muted">{note}</div> : null}
      {grow ? <div className="grow" /> : null}
      {footer ? (
        <div className="flex flex-wrap items-center gap-2.5 border-t border-line px-3.5 py-[9px] text-[13px] text-ink-muted">
          {footer}
        </div>
      ) : null}
    </section>
  )
}
