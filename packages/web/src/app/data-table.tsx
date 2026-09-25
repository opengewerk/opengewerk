import type { RecordState } from '@opengewerk/domain'
import { Link } from '@tanstack/react-router'
import {
  columnFilteringFeature,
  createFilteredRowModel,
  createSortedRowModel,
  filterFns,
  flexRender,
  globalFilteringFeature,
  rowSortingFeature,
  sortFns,
  tableFeatures,
  useTable,
} from '@tanstack/react-table'
import type { ColumnDef } from '@tanstack/react-table'
import { useEffect, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import { Cell, Column, Field, Table } from '../components/index.js'

/**
 * The two things every list in the office does: sort by a column and narrow by
 * one search box.
 *
 * Named out loud rather than taken from a bundle of everything, because in
 * version 9 a feature that is not listed is not shipped. Pagination, grouping,
 * pinning and row selection are all absent on purpose: none of them is used
 * here, and every one of them would ride along in the bundle the site entry
 * has a budget for.
 */
export const listFeatures = tableFeatures({
  rowSortingFeature,
  // The search box filters across every column at once, and that is what
  // `globalFilteringFeature` is. It is built on the per column one and says so
  // as a type error when that is left out, which is how this list grew.
  columnFilteringFeature,
  globalFilteringFeature,
  sortedRowModel: createSortedRowModel(),
  filteredRowModel: createFilteredRowModel(),
  sortFns,
  filterFns,
})

export type ListColumns = ColumnDef<typeof listFeatures, RecordState, unknown>[]

/**
 * Sends the slash key to the search box, the way every list people already use
 * does.
 *
 * On the document rather than on a container, because the key has to work
 * wherever the focus happens to be on the page. It steps aside as soon as
 * somebody is typing into anything, or the shortcut would eat a slash in the
 * middle of a street name.
 */
function useSlashToSearch(target: { current: HTMLInputElement | null }): void {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const active = document.activeElement

      if (
        event.key !== '/' ||
        event.defaultPrevented ||
        event.metaKey ||
        event.ctrlKey ||
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        active instanceof HTMLSelectElement ||
        (active instanceof HTMLElement && active.isContentEditable)
      ) {
        return
      }

      event.preventDefault()
      target.current?.focus()
    }

    document.addEventListener('keydown', onKey)

    return () => {
      document.removeEventListener('keydown', onKey)
    }
  }, [target])
}

/**
 * A dense list with a search box, and every row a link.
 *
 * A link and not a row with a click handler. A handler is skipped by Tab,
 * announced as nothing, cannot be opened in a second tab and does not show
 * where it goes. The office works through these lists all day, mostly with the
 * keyboard.
 */
export function DataTable({
  caption,
  rows,
  columns,
  hrefFor,
  searchLabel,
  empty,
}: {
  readonly caption: string
  readonly rows: readonly RecordState[]
  readonly columns: ListColumns
  /** Where a row leads, as a path inside this entry's router. */
  readonly hrefFor: (row: RecordState) => string
  readonly searchLabel: string
  readonly empty: ReactNode
}) {
  const [filter, setFilter] = useState('')
  const search = useRef<HTMLInputElement>(null)
  const countId = useId()

  useSlashToSearch(search)

  const table = useTable({
    features: listFeatures,
    columns,
    data: rows as RecordState[],
    state: { globalFilter: filter },
    onGlobalFilterChange: setFilter,
    getRowId: (row) => String(row['id']),
  })

  const found = table.getRowModel().rows

  return (
    <div className="flex flex-col gap-3">
      <div className="max-w-md">
        <Field
          ref={search}
          label={searchLabel}
          type="search"
          value={filter}
          hint="Die Schrägstrich-Taste springt hierher."
          aria-describedby={countId}
          onChange={(event) => {
            setFilter(event.target.value)
          }}
        />
      </div>

      {/*
        `status` and not a plain paragraph: the number changes while somebody
        types, and a reader that is not told cannot hear the list getting
        shorter.
      */}
      <p id={countId} role="status" className="text-table text-ink-muted">
        {found.length === rows.length
          ? rows.length === 1
            ? '1 Eintrag'
            : `${String(rows.length)} Einträge`
          : `${String(found.length)} von ${String(rows.length)} Einträgen`}
      </p>

      {rows.length === 0 ? (
        <div className="py-6 text-body text-ink-muted">{empty}</div>
      ) : found.length === 0 ? (
        // A search that finds nothing is not an empty list: "Noch kein Kunde
        // angelegt" under a search for a name that is not there reads as if
        // the customers were gone (#223).
        <div className="py-6 text-body text-ink-muted">{`Für „${filter.trim()}“ gibt es keinen Treffer.`}</div>
      ) : (
        <Table caption={caption}>
          <thead>
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id}>
                {group.headers.map((header) => {
                  const sorted = header.column.getIsSorted()

                  return (
                    <Column
                      key={header.id}
                      numeric={header.column.columnDef.meta?.numeric === true}
                      // Said to a screen reader as well as drawn. A column
                      // that only looks sorted is sorted for half the room.
                      aria-sort={
                        sorted === 'asc'
                          ? 'ascending'
                          : sorted === 'desc'
                            ? 'descending'
                            : undefined
                      }
                    >
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 cursor-pointer font-condensed uppercase tracking-wide"
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        <span aria-hidden="true">
                          {sorted === 'asc' ? '↑' : sorted === 'desc' ? '↓' : ''}
                        </span>
                      </button>
                    </Column>
                  )
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {found.map((row) => (
              <tr key={row.id} className="hover:bg-surface-sunken">
                {row.getAllCells().map((cell, index) => (
                  <Cell key={cell.id} numeric={cell.column.columnDef.meta?.numeric === true}>
                    {index === 0 ? (
                      <Link
                        to={hrefFor(row.original)}
                        className="text-copper-text font-semibold underline underline-offset-2"
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </Link>
                    ) : (
                      flexRender(cell.column.columnDef.cell, cell.getContext())
                    )}
                  </Cell>
                ))}
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  )
}
