import clsx from 'clsx'
import { useId } from 'react'
import type { ReactNode } from 'react'

import { useBand } from './band.js'
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
  /** On the page colour rather than raised, as the facts of a circuit are. */
  readonly onGround?: boolean
  readonly className?: string
  readonly children: ReactNode
}

export function Panel({
  title,
  action,
  roomy = false,
  onGround = false,
  className,
  children,
}: PanelProps) {
  const entry = useEntry()
  const headingId = useId()

  return (
    <section
      aria-labelledby={title ? headingId : undefined}
      className={clsx(
        'min-w-0 border border-line',
        onGround
          ? 'bg-ground [--surface-here:var(--color-ground)]'
          : 'bg-surface [--surface-here:var(--color-surface)]',
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

/**
 * A row of a table as it stands on a phone, where "Tabellen werden Karten,
 * eine Karte je Zeile" (board "Breiten und Auflösungen", #218): a box per
 * row as the chain of documents of "Auftrag im Büro, Telefon" draws it, the
 * name, the rest of the row in a line under it, and at the right what state
 * it is in.
 */
export interface TableCard {
  readonly key: string
  /**
   * The name, usually the link of the row. A link given `cardLink` makes the
   * whole box its target, as the row is the link in the table.
   */
  readonly title: ReactNode
  /** The other columns in a line: "AU-2026-0184 · Rheinstraße 12". */
  readonly sub?: ReactNode
  /** At the right: a state, a number, an amount. */
  readonly right?: ReactNode
  /** The buttons of the row, what the column "Ändern" holds in the table. */
  readonly actions?: ReactNode
  /** In the place of the box, the row while it is being changed. */
  readonly form?: ReactNode
}

/** For the link in the title of a `TableCard`: the whole box is its target. */
export const cardLink = 'text-inherit no-underline after:absolute after:inset-0'

export interface TablePanelProps {
  readonly title?: string
  readonly action?: ReactNode
  /** Between the head and the table: a form for a new row. */
  readonly lead?: ReactNode
  /** What a reader hears the table called; the title where there is one. */
  readonly caption: string
  /** `<thead>` and `<tbody>`, as for `Table`. */
  readonly children: ReactNode
  /**
   * The rows as boxes, shown instead of the table below 600 pixels. A table
   * without them scrolls in its frame there, as a list with its own cards
   * does not need them.
   */
  readonly cards?: readonly TableCard[]
  /** What stands in place of the boxes while there is no row. */
  readonly cardsEmpty?: ReactNode
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
  cards,
  cardsEmpty,
}: TablePanelProps) {
  const headingId = useId()
  const asCards = useBand() === 'S' && cards !== undefined

  return (
    <section
      aria-labelledby={title ? headingId : undefined}
      aria-label={title ? undefined : caption}
      className={clsx(
        // Clipped for the rounded corners, and not hidden: a card with
        // `overflow: hidden` is a scroll container, and the head of its table
        // would stick to the card instead of staying under the top bar (#272).
        'flex min-h-0 min-w-0 flex-col overflow-clip rounded-[5px] border border-line bg-surface',
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
      {asCards ? (
        <CardRows caption={caption} cards={cards} empty={cardsEmpty} />
      ) : (
        <Table caption={caption} lastRowOpen={!footer}>
          {children}
        </Table>
      )}
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

/** The rows of a table on a phone, one box each. */
function CardRows({
  caption,
  cards,
  empty,
}: {
  readonly caption: string
  readonly cards: readonly TableCard[]
  readonly empty: ReactNode
}) {
  if (cards.length === 0) {
    return <p className="px-3.5 py-3 text-[14px] leading-[1.4] text-ink-muted">{empty}</p>
  }

  return (
    <ul aria-label={caption} className="flex flex-col gap-1.5 px-3.5 py-3">
      {cards.map((card) =>
        card.form ? (
          <li key={card.key} className="rounded-[4px] border border-line bg-ground p-2.5">
            {card.form}
          </li>
        ) : (
          <li
            key={card.key}
            className="relative flex min-h-10 flex-wrap items-center gap-x-2 gap-y-1 rounded-[4px] border border-line bg-ground px-2.5 py-2 text-[15px]"
          >
            {/* Name and state together, so that a long line under the name
                wraps beside the state instead of pushing it below; only the
                buttons move to a line of their own when there is no room. */}
            <span className="flex min-w-0 grow items-center gap-2">
              <span className="min-w-0 grow">
                <span className="block [overflow-wrap:anywhere]">{card.title}</span>
                {card.sub ? (
                  <span className="mt-0.5 block text-[13px] text-ink-muted [overflow-wrap:anywhere]">
                    {card.sub}
                  </span>
                ) : null}
              </span>
              {card.right ? (
                <span className="flex shrink-0 flex-col items-end gap-[3px] text-[13px] text-ink-faint">
                  {card.right}
                </span>
              ) : null}
            </span>
            {/* Over the link that covers the box, or a tap on a button would
                open the row instead. */}
            {card.actions ? (
              <span className="relative z-10 ml-auto flex shrink-0 items-center gap-0.5">
                {card.actions}
              </span>
            ) : null}
          </li>
        ),
      )}
    </ul>
  )
}
