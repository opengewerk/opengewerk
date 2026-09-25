import type { RecordState } from '@opengewerk/domain'
import { Link, useNavigate } from '@tanstack/react-router'
import clsx from 'clsx'
import { ChevronDown, ChevronRight, Plus } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { MouseEvent, ReactNode } from 'react'

import { Button, Cell, Column, TablePanel } from '../components/index.js'
import { useBand } from '../components/band.js'
import type { Band } from '../components/band.js'
import { Chip, Key, PageHead } from './kit.js'

/**
 * A list of the office at every width, as the boards of the list pages and
 * "Breiten und Auflösungen" draw it (#218, #219).
 *
 * - S, a phone: the head with the one action beside the title, a search as
 *   wide as the screen, the chips under it, and one card per row.
 * - M, a tablet: the same head and search, and the table with its main
 *   columns, rows tall enough for a finger.
 * - L: the table with every column, as many rows as the window holds, and
 *   the pages under it. Tall windows show more rows, not taller ones.
 * - XL, from 1600 pixels: the main columns, and beside them a preview of the
 *   row that is selected. A click selects; "Akte öffnen" opens.
 * - XXL, from 2400 pixels: the list and the whole record side by side.
 *
 * Every row is a link to its record, and the whole row can be clicked, as on
 * the customer list of 19.09.2026. The name is a real link inside it, so Tab
 * reaches it, the middle button opens a second tab, and a reader hears where
 * it goes.
 */

export interface ListColumn {
  readonly id: string
  readonly header: string
  /** What is searched and sorted by. */
  readonly value: (row: RecordState) => string | number
  /** What the cell shows; the value where this is not given. */
  readonly cell?: (row: RecordState) => ReactNode
  readonly align?: 'right'
  /** A width for the column, as a class: `w-[124px]`. The first takes the rest. */
  readonly width?: string
  /** Grey, as the side columns of the canvas are. */
  readonly muted?: boolean
  /** Shown only with every column, at band L; dropped where room is short. */
  readonly wideOnly?: boolean
}

export interface ListFilter {
  readonly id: string
  readonly label: string
  readonly test: (row: RecordState) => boolean
}

export interface ListSort {
  readonly id: string
  readonly label: string
  readonly compare: (left: RecordState, right: RecordState) => number
}

export interface ListEmpty {
  readonly icon: LucideIcon
  readonly title: string
  readonly text: ReactNode
}

export interface ListScreenProps {
  readonly title: string
  /** What a reader hears the table called. */
  readonly caption: string
  readonly rows: readonly RecordState[]
  readonly columns: readonly ListColumn[]
  /** What the search finds besides the columns: the VAT id of a customer. */
  readonly alsoSearched?: (row: RecordState) => string
  readonly hrefFor: (row: RecordState) => string
  /** Hidden label of the search, "Kunden durchsuchen". */
  readonly searchLabel: string
  readonly searchPlaceholder: string
  /** The chips; "Alle" comes first by itself. */
  readonly filters?: readonly ListFilter[]
  /** A choice of order in the row of the search, "Sortiert nach". */
  readonly sorts?: readonly ListSort[]
  /** The one action of the list, "Neuer Kunde". */
  readonly primary?: { readonly label: string; readonly onPress: () => void }
  /** A row as a card, on a phone. */
  readonly card: (row: RecordState) => ReactNode
  /** The row that is selected, beside the list from 1600 pixels. */
  readonly preview?: (row: RecordState) => ReactNode
  /** The whole record of the row, beside the list from 2400 pixels. */
  readonly record?: (row: RecordState, close: () => void) => ReactNode
  /** Under the table: where a record of this kind comes from. */
  readonly note?: ReactNode
  /** A list with nothing in it yet. */
  readonly empty: ListEmpty
}

/** "248 Einträge", with the thousands the way a person writes them. */
export function entries(count: number): string {
  return count === 1 ? '1 Eintrag' : `${count.toLocaleString('de-DE')} Einträge`
}

/**
 * Strg K and the slash both send the focus to the search, the way the lists
 * people already use do. On the document, so they work wherever the focus is,
 * and the slash steps aside while somebody types, or it would eat one in the
 * middle of a street name.
 */
function useKeysToSearch(target: { readonly current: HTMLInputElement | null }): void {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.defaultPrevented) {
        return
      }

      const combination = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k'
      const active = document.activeElement
      const typing =
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        active instanceof HTMLSelectElement ||
        (active instanceof HTMLElement && active.isContentEditable)
      const slash = event.key === '/' && !event.ctrlKey && !event.metaKey && !typing

      if (combination || slash) {
        event.preventDefault()
        target.current?.focus()
      }
    }

    document.addEventListener('keydown', onKey)

    return () => {
      document.removeEventListener('keydown', onKey)
    }
  }, [target])
}

/** What a table row is tall, before one has been measured. */
const assumedRow = 31
/** The pages of a list, the head of the table and the room under the card. */
const chrome = { pager: 45, head: 33, below: 18 }

/**
 * How many rows the window holds under the top of the table, measured when
 * the window or the table changes. Never fewer than six, as the boards have
 * it: a list of three rows per page on a short laptop is worse than one that
 * scrolls a little.
 */
function useRowsThatFit(frame: { readonly current: HTMLElement | null }, fallback: number): number {
  const [rows, setRows] = useState(fallback)

  useEffect(() => {
    const element = frame.current

    if (!element || typeof ResizeObserver !== 'function') {
      return
    }

    const measure = () => {
      const top = element.getBoundingClientRect().top
      const row = element.querySelector('tbody tr')?.getBoundingClientRect().height ?? assumedRow
      const room = window.innerHeight - top - chrome.head - chrome.pager - chrome.below

      setRows(Math.max(6, Math.floor(room / Math.max(row, 20))))
    }
    const observer = new ResizeObserver(measure)

    observer.observe(document.documentElement)
    observer.observe(element)

    return () => {
      observer.disconnect()
    }
  }, [frame])

  return rows
}

/** The rows a filter, a search and an order leave. */
function narrowed(
  rows: readonly RecordState[],
  columns: readonly ListColumn[],
  alsoSearched: ((row: RecordState) => string) | undefined,
  search: string,
  filter: ListFilter | undefined,
  sort: ListSort | undefined,
): readonly RecordState[] {
  const words = search.trim().toLocaleLowerCase('de').split(/\s+/).filter(Boolean)
  const found = rows.filter((row) => {
    if (filter && !filter.test(row)) {
      return false
    }

    if (words.length === 0) {
      return true
    }

    const haystack = [
      ...columns.map((column) => String(column.value(row))),
      alsoSearched?.(row) ?? '',
    ]
      .join(' ')
      .toLocaleLowerCase('de')

    return words.every((word) => haystack.includes(word))
  })

  return sort ? [...found].sort(sort.compare) : found
}

/** Whether a click landed on something that does its own thing. */
function onControl(event: MouseEvent): boolean {
  const target = event.target as HTMLElement

  return target.closest('a, button, input, select, textarea, label') !== null
}

/** Whether a click on a link should open it rather than select the row. */
function opensElsewhere(event: MouseEvent): boolean {
  return event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey
}

export function ListScreen(props: ListScreenProps) {
  const {
    title,
    caption,
    rows,
    columns,
    alsoSearched,
    hrefFor,
    searchLabel,
    searchPlaceholder,
    filters = [],
    sorts = [],
    primary,
    card,
    preview,
    record,
    note,
  } = props
  const band = useBand()
  const [search, setSearch] = useState('')
  const [filterId, setFilterId] = useState<string | null>(null)
  const [sortId, setSortId] = useState<string | null>(sorts[0]?.id ?? null)
  const [page, setPage] = useState(0)
  const [chosen, setChosen] = useState<string | null>(null)
  const [closed, setClosed] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const frame = useRef<HTMLDivElement>(null)
  const countId = useId()

  useKeysToSearch(input)

  const filter = filters.find((candidate) => candidate.id === filterId)
  const sort = sorts.find((candidate) => candidate.id === sortId)
  const found = useMemo(
    () => narrowed(rows, columns, alsoSearched, search, filter, sort),
    [rows, columns, alsoSearched, search, filter, sort],
  )

  const fit = useRowsThatFit(frame, 20)
  const paged = band !== 'S'
  const size = paged ? fit : found.length
  const pages = Math.max(1, Math.ceil(found.length / Math.max(size, 1)))
  const shownPage = Math.min(page, pages - 1)
  const shown = found.slice(shownPage * size, shownPage * size + size)

  const beside = (band === 'XL' && preview) || (band === 'XXL' && record)
  // The selection falls back to the first row shown, as the boards draw it,
  // unless somebody closed the record beside the list.
  const selected = beside
    ? (shown.find((row) => String(row['id']) === chosen) ?? (closed ? null : (shown[0] ?? null)))
    : null

  const short = band !== 'L'
  const visible = columns.filter((column) => !(short && column.wideOnly))

  const choose = (row: RecordState) => {
    setChosen(String(row['id']))
    setClosed(false)
  }

  if (rows.length === 0) {
    return <EmptyList {...props} band={band} />
  }

  const head = (
    <PageHead
      title={title}
      count={entries(found.length === rows.length ? rows.length : found.length)}
      actions={
        primary ? (
          <Button tone="primary" icon={Plus} onClick={primary.onPress}>
            {primary.label}
          </Button>
        ) : null
      }
    />
  )

  const searchRow = (
    <SearchRow
      band={band}
      label={searchLabel}
      placeholder={searchPlaceholder}
      input={input}
      value={search}
      countId={countId}
      onChange={(value) => {
        setSearch(value)
        setPage(0)
      }}
      filters={filters}
      filterId={filterId}
      onFilter={(id) => {
        setFilterId(id)
        setPage(0)
      }}
      sorts={sorts}
      sortId={sortId}
      onSort={setSortId}
      hint={band === 'L' && sorts.length === 0}
    />
  )

  const counted = (
    <p id={countId} role="status" className="sr-only">
      {found.length === rows.length
        ? entries(rows.length)
        : `${entries(found.length)} von ${rows.length.toLocaleString('de-DE')}`}
    </p>
  )

  const nothingFound =
    found.length === 0 ? (
      <p className="rounded-[5px] border border-line bg-surface px-3.5 py-6 text-[14px] text-ink-muted">
        {search.trim()
          ? `Für „${search.trim()}“ gibt es keinen Treffer.`
          : 'In dieser Auswahl steht nichts.'}
      </p>
    ) : null

  const listing =
    band === 'S'
      ? (nothingFound ?? (
          <ul className="flex flex-col gap-2">
            {shown.map((row) => (
              <li key={String(row['id'])}>{card(row)}</li>
            ))}
          </ul>
        ))
      : (nothingFound ?? (
          <div ref={frame} className="flex min-w-0 grow flex-col">
            <TablePanel
              caption={caption}
              note={note}
              grow
              footer={
                <Pager
                  first={shownPage * size + 1}
                  last={Math.min(found.length, shownPage * size + size)}
                  total={found.length}
                  onBack={shownPage > 0 ? () => setPage(shownPage - 1) : undefined}
                  onNext={shownPage < pages - 1 ? () => setPage(shownPage + 1) : undefined}
                />
              }
            >
              <thead>
                <tr>
                  {visible.map((column) => (
                    <Column
                      key={column.id}
                      numeric={column.align === 'right'}
                      className={column.width}
                    >
                      {column.header}
                    </Column>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((row) => (
                  <ListRow
                    key={String(row['id'])}
                    row={row}
                    columns={visible}
                    href={hrefFor(row)}
                    selected={selected !== null && String(selected['id']) === String(row['id'])}
                    selects={Boolean(beside)}
                    onSelect={choose}
                  />
                ))}
              </tbody>
            </TablePanel>
          </div>
        ))

  if (band === 'XXL' && record) {
    return (
      <div className="flex grow gap-[18px] px-[22px] py-[18px]">
        <div className="flex w-[820px] shrink-0 flex-col gap-[13px] min-[187.5rem]:w-[900px]">
          {head}
          {searchRow}
          {counted}
          {listing}
        </div>
        {selected
          ? record(selected, () => {
              setClosed(true)
              setChosen(null)
            })
          : null}
      </div>
    )
  }

  return (
    <div className="flex grow flex-col gap-3 px-4 py-3.5 sm:gap-[13px] sm:px-5 sm:py-4 lg:px-[22px] lg:py-[18px]">
      {head}
      {band === 'XL' && preview ? (
        <div className="flex grow gap-4">
          <div className="flex min-w-0 grow flex-col gap-[13px]">
            {searchRow}
            {counted}
            {listing}
          </div>
          {selected ? preview(selected) : null}
        </div>
      ) : (
        <>
          {searchRow}
          {counted}
          {listing}
        </>
      )}
    </div>
  )
}

function ListRow({
  row,
  columns,
  href,
  selected,
  selects,
  onSelect,
}: {
  readonly row: RecordState
  readonly columns: readonly ListColumn[]
  readonly href: string
  readonly selected: boolean
  readonly selects: boolean
  readonly onSelect: (row: RecordState) => void
}) {
  const navigate = useNavigate()

  return (
    <tr
      className={clsx('cursor-pointer', selected ? 'bg-selected' : 'hover:bg-surface-sunken')}
      onClick={(event) => {
        if (onControl(event) || window.getSelection()?.toString()) {
          return
        }

        if (selects) {
          onSelect(row)
        } else {
          void navigate({ to: href })
        }
      }}
    >
      {columns.map((column, index) => {
        const content = column.cell ? column.cell(row) : column.value(row)

        return (
          <Cell
            key={column.id}
            numeric={column.align === 'right'}
            className={clsx(
              column.muted && 'text-ink-muted',
              index === 0 && selected && 'font-semibold',
            )}
          >
            {index === 0 ? (
              <Link
                to={href}
                className="text-inherit no-underline hover:underline"
                aria-current={selects && selected ? 'true' : undefined}
                onClick={(event) => {
                  if (selects && !opensElsewhere(event)) {
                    event.preventDefault()
                    onSelect(row)
                  }
                }}
              >
                {content}
              </Link>
            ) : (
              content
            )}
          </Cell>
        )
      })}
    </tr>
  )
}

/** "1 bis 14 von 248", and the two steps. */
function Pager({
  first,
  last,
  total,
  onBack,
  onNext,
}: {
  readonly first: number
  readonly last: number
  readonly total: number
  readonly onBack: (() => void) | undefined
  readonly onNext: (() => void) | undefined
}) {
  return (
    <>
      <span className="numeric">
        {`${first.toLocaleString('de-DE')} bis ${last.toLocaleString('de-DE')} von ${total.toLocaleString('de-DE')}`}
      </span>
      <div className="grow" />
      <Button size="small" disabled={!onBack} onClick={onBack}>
        Zurück
      </Button>
      <Button size="small" disabled={!onNext} onClick={onNext}>
        Weiter
      </Button>
    </>
  )
}

function SearchRow({
  band,
  label,
  placeholder,
  input,
  value,
  countId,
  onChange,
  filters,
  filterId,
  onFilter,
  sorts,
  sortId,
  onSort,
  hint,
}: {
  readonly band: Band
  readonly label: string
  readonly placeholder: string
  readonly input: { current: HTMLInputElement | null }
  readonly value: string
  readonly countId: string
  readonly onChange: (value: string) => void
  readonly filters: readonly ListFilter[]
  readonly filterId: string | null
  readonly onFilter: (id: string | null) => void
  readonly sorts: readonly ListSort[]
  readonly sortId: string | null
  readonly onSort: (id: string) => void
  readonly hint: boolean
}) {
  const searchId = useId()
  const sortSelectId = useId()
  const narrow = band === 'S' || band === 'M'

  const chips =
    filters.length > 0 ? (
      <div className="flex flex-wrap gap-1.5 lg:gap-2" role="group" aria-label="Auswahl">
        <Chip pressed={filterId === null} onPress={() => onFilter(null)}>
          Alle
        </Chip>
        {filters.map((filter) => (
          <Chip
            key={filter.id}
            pressed={filterId === filter.id}
            onPress={() => onFilter(filter.id)}
          >
            {filter.label}
          </Chip>
        ))}
      </div>
    ) : null

  return (
    <div
      className={clsx(
        'flex gap-2',
        narrow ? 'flex-col' : 'flex-wrap items-center gap-x-[9px] gap-y-2',
      )}
    >
      <label htmlFor={searchId} className="sr-only">
        {label}
      </label>
      <input
        id={searchId}
        ref={input}
        type="search"
        value={value}
        placeholder={placeholder}
        aria-describedby={countId}
        onChange={(event) => {
          onChange(event.target.value)
        }}
        className={clsx(
          'min-w-0 rounded-control border border-line-strong text-ink',
          narrow
            ? 'h-12 w-full rounded-[5px] bg-input px-3 text-[16px]'
            : clsx(
                'h-8 bg-surface px-2.5 text-[14px]',
                // As wide as on the boards: 300 pixels, 340 beside the
                // preview, 260 beside the record.
                band === 'XXL' ? 'w-[260px]' : band === 'XL' ? 'w-[340px]' : 'w-[300px]',
              ),
        )}
      />
      {chips}
      {!narrow && (hint || sorts.length > 0) ? <div className="grow" /> : null}
      {hint ? (
        <span className="flex items-center gap-1.5 text-[13px] text-ink-faint">
          Suche mit <Key>Strg</Key>
          <Key>K</Key>
        </span>
      ) : null}
      {sorts.length > 0 && !narrow ? (
        <span className="flex items-center gap-2 text-[13px] text-ink-faint">
          <label htmlFor={sortSelectId}>Sortiert nach</label>
          {/* Drawn as the small button of the board, the arrow in front, and
              still the native list underneath. */}
          <span className="relative inline-flex">
            <ChevronDown
              size={13}
              strokeWidth={2.3}
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-[9px] -translate-y-1/2 text-ink"
            />
            <select
              id={sortSelectId}
              value={sortId ?? ''}
              onChange={(event) => {
                onSort(event.target.value)
              }}
              className="h-[27px] cursor-pointer appearance-none rounded-control border border-control bg-ground pr-[9px] pl-[27px] text-[13px] text-ink"
            >
              {sorts.map((sort) => (
                <option key={sort.id} value={sort.id}>
                  {sort.label}
                </option>
              ))}
            </select>
          </span>
        </span>
      ) : null}
    </div>
  )
}

/** A list with nothing in it, `kunden_leer()` of the canvas. */
function EmptyList({
  title,
  searchLabel,
  searchPlaceholder,
  primary,
  empty,
  band,
}: ListScreenProps & { readonly band: Band }) {
  const Icon = empty.icon
  const narrow = band === 'S' || band === 'M'

  return (
    <div className="flex grow flex-col gap-3 px-4 py-3.5 sm:gap-[13px] sm:px-5 sm:py-4 lg:px-[22px] lg:py-[18px]">
      <PageHead
        title={title}
        count={entries(0)}
        actions={
          primary ? (
            <Button tone="primary" icon={Plus} onClick={primary.onPress}>
              {primary.label}
            </Button>
          ) : null
        }
      />
      <input
        type="search"
        aria-label={searchLabel}
        placeholder={searchPlaceholder}
        disabled
        className={clsx(
          'rounded-control border border-line bg-surface px-2.5 text-[14px]',
          narrow ? 'h-12 w-full' : 'h-8 w-[300px]',
        )}
      />
      <section
        aria-label={empty.title}
        className="flex grow flex-col justify-center gap-3 rounded-[5px] border border-line bg-surface px-5 py-14"
      >
        <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-surface-sunken text-ink-muted">
          <Icon size={26} strokeWidth={1.9} aria-hidden="true" />
        </div>
        <h2 className="text-center text-[18px] font-semibold">{empty.title}</h2>
        <p className="mx-auto max-w-[460px] text-center text-[14px] leading-[1.5] text-ink-muted">
          {empty.text}
        </p>
        {primary ? (
          <div className="flex justify-center">
            <Button tone="primary" icon={Plus} onClick={primary.onPress}>
              {primary.label}
            </Button>
          </div>
        ) : null}
      </section>
    </div>
  )
}

/** A card of a list on a phone: the name, a line under it, and what is open. */
export function ListCard({
  to,
  title,
  sub,
  right,
}: {
  readonly to: string
  readonly title: ReactNode
  readonly sub?: ReactNode
  readonly right?: ReactNode
}) {
  return (
    <Link
      to={to}
      className="flex min-h-16 items-center gap-2.5 rounded-[6px] border border-line bg-surface px-3 py-2.5 text-ink no-underline"
    >
      <span className="min-w-0 grow">
        <span className="block text-[16px] font-semibold [overflow-wrap:anywhere]">{title}</span>
        {sub ? <span className="mt-0.5 block text-[14px] text-ink-muted">{sub}</span> : null}
      </span>
      {right ? <span className="flex shrink-0 flex-col items-end gap-[3px]">{right}</span> : null}
      <ChevronRight
        size={18}
        strokeWidth={2.2}
        aria-hidden="true"
        className="shrink-0 text-ink-faint"
      />
    </Link>
  )
}
