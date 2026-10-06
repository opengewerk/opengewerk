import {
  columnName,
  fieldOfColumn,
  fieldsWithoutColumn,
  headerIndex,
  tableBodyType,
  tableColumns,
  tableFileNameHeader,
  tableFileType,
  tableLineCount,
  withColumn,
  type ColumnMapping,
  type TableField,
  type TableFile,
  type TableSheet,
} from '@opengewerk/platform-domain'
import clsx from 'clsx'
import { Check, FileSpreadsheet, Upload } from 'lucide-react'
import { type ReactNode, useRef } from 'react'

import { Button } from '../components/button.js'
import { Panel, TablePanel } from '../components/panel.js'
import { Cell, Column } from '../components/table.js'
import { request } from '../sync/transport.js'
import { FilterSelect } from './kit.js'

/**
 * What a screen is built from that takes a table over: the steps it goes
 * through, the file somebody chose, and its columns with the field each of
 * them is. What the fields are and what becomes of the rows the application
 * says; a table is read on the server (`readTableFile`) and goes back with
 * what was decided about it (`sendTable`).
 */

/** Sends the file somebody chose to the route that reads it, and answers with the table in it. */
export function readTableFile(path: string, file: File): Promise<TableFile> {
  return request<TableFile>(path, {
    method: 'POST',
    body: file,
    headers: {
      'Content-Type': tableFileType,
      [tableFileNameHeader]: encodeURIComponent(file.name),
    },
  })
}

/** Sends a sheet with what was decided about it, under the type such a request has. */
export function sendTable<Answer>(path: string, body: unknown): Promise<Answer> {
  return request<Answer>(path, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': tableBodyType },
  })
}

export interface StepsProps {
  /** What a reader hears the list called: "Schritte des Imports". */
  readonly label: string
  readonly names: readonly string[]
  /** The step somebody is at, counted from 0. Those before it are done. */
  readonly current: number
}

/**
 * The steps of something that is done in a few screens, `steps()` of the
 * canvas: a number for each, a tick for those that are done, and the one
 * somebody is at said to a reader as well as shown.
 */
export function Steps({ label, names, current }: StepsProps) {
  return (
    <ol aria-label={label} className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
      {names.map((name, index) => {
        const done = index < current
        const on = index === current

        return (
          <li
            key={name}
            aria-current={on ? 'step' : undefined}
            className="flex items-center gap-2.5"
          >
            <span className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className={clsx(
                  'flex size-6 shrink-0 items-center justify-center rounded-full text-[12px] font-bold',
                  done
                    ? 'bg-done text-on-status'
                    : on
                      ? 'bg-ink text-ground'
                      : 'bg-surface-sunken text-ink-muted',
                )}
              >
                {done ? <Check size={13} strokeWidth={2.6} /> : index + 1}
              </span>
              <span
                className={clsx('text-[13px]', on ? 'font-semibold text-ink' : 'text-ink-muted')}
              >
                {name}
                {done ? <span className="sr-only"> (erledigt)</span> : null}
              </span>
            </span>
            {index < names.length - 1 ? (
              <span aria-hidden="true" className="h-px w-10 bg-line max-sm:w-4" />
            ) : null}
          </li>
        )
      })}
    </ol>
  )
}

const acceptedFiles =
  '.xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

const lines = (count: number) =>
  count === 1 ? '1 Zeile' : `${count.toLocaleString('de-DE')} Zeilen`

export interface TableFilePanelProps {
  /** The table that was read, or null before a file is chosen. */
  readonly file: TableFile | null
  /** Which of its sheets is taken, counted from 0. */
  readonly sheet: number
  readonly onSheet: (index: number) => void
  /** Somebody chose a file. Reading it is the caller's, who knows the route. */
  readonly onFile: (file: File) => void
  /** While the file is on its way and being read. */
  readonly busy?: boolean
  /** Why the file that was chosen is not a table, in the words of the server. */
  readonly problem?: string | null
  /** Under the button before a file is chosen: what the table should hold. */
  readonly hint?: ReactNode
}

/**
 * The file a table is taken from, the card "Datei" of the canvas: its name,
 * the sheet with its lines and where its header stands, and the way to
 * another file. A workbook with several sheets offers them as a choice.
 */
export function TableFilePanel({
  file,
  sheet,
  onSheet,
  onFile,
  busy = false,
  problem = null,
  hint,
}: TableFilePanelProps) {
  const picker = useRef<HTMLInputElement>(null)
  const chosen = file?.sheets[sheet]
  const head = chosen ? headerIndex(chosen) : -1

  return (
    <Panel title="Datei">
      <input
        ref={picker}
        type="file"
        accept={acceptedFiles}
        aria-label="Datei wählen"
        className="sr-only"
        onChange={(event) => {
          const [picked] = event.target.files ?? []

          // The same file chosen twice is a change the second time as well.
          event.target.value = ''

          if (picked) {
            onFile(picked)
          }
        }}
      />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5">
        {file && chosen ? (
          <>
            <FileSpreadsheet
              size={22}
              strokeWidth={1.9}
              aria-hidden="true"
              className="shrink-0 text-ink-muted"
            />
            <div className="min-w-0 grow leading-[1.35]">
              <div className="font-semibold [overflow-wrap:anywhere]">{file.name}</div>
              <div className="text-[13px] text-ink-faint">
                {[
                  chosen.name === '' ? null : `Blatt „${chosen.name}“`,
                  lines(tableLineCount(chosen)),
                  head < 0 ? null : `Kopfzeile in Zeile ${head + 1}`,
                ]
                  .filter((part) => part !== null)
                  .join(' · ')}
              </div>
            </div>
            {file.sheets.length > 1 ? (
              <FilterSelect
                label="Blatt"
                width="lg:w-[200px]"
                value={String(sheet)}
                options={file.sheets.map((one, index) => ({
                  value: String(index),
                  label: one.name,
                }))}
                onChange={(value) => {
                  onSheet(Number(value))
                }}
              />
            ) : null}
          </>
        ) : (
          <div className="min-w-0 grow text-[14px] leading-[1.45] text-ink-muted">
            {hint ?? 'Eine Arbeitsmappe (.xlsx) oder eine Tabelle als Text (.csv).'}
          </div>
        )}
        <Button
          size={file ? 'small' : 'normal'}
          tone={file ? 'secondary' : 'primary'}
          icon={Upload}
          disabled={busy}
          onClick={() => picker.current?.click()}
        >
          {busy ? 'Datei wird gelesen' : file ? 'Andere Datei' : 'Datei wählen'}
        </Button>
      </div>
      {problem ? (
        <p role="alert" className="mt-2.5 text-[14px] leading-[1.4] text-conflict">
          {problem}
        </p>
      ) : null}
    </Panel>
  )
}

/** What a column that is not taken is given. */
const leftOut = ''

export interface ColumnsPanelProps {
  readonly sheet: TableSheet
  readonly fields: readonly TableField[]
  readonly mapping: ColumnMapping
  readonly onChange: (mapping: ColumnMapping) => void
  /** Under the table: what is said about columns that stay out. */
  readonly note?: ReactNode
}

/**
 * The columns of a sheet with the field each of them is, the card "Spalten
 * zuordnen" of the canvas: what the column is called in the file, the first
 * thing that stands in it, and the choice among the fields. A field has one
 * column, so giving it to a second takes it from the first; a column that is
 * not taken stays out. Which fields still need a column is said under the
 * table, and holds whoever uses this back from going on.
 */
export function ColumnsPanel({ sheet, fields, mapping, onChange, note }: ColumnsPanelProps) {
  const columns = tableColumns(sheet)
  const missing = fieldsWithoutColumn(mapping, fields)
  const options = [
    { value: leftOut, label: 'Nicht übernehmen' },
    ...fields.map((field) => ({ value: field.key, label: field.label })),
  ]
  const choice = (index: number, name: string) => (
    <FilterSelect
      label={`Feld für ${name}`}
      width="lg:w-[280px]"
      value={fieldOfColumn(mapping, index) ?? leftOut}
      options={options}
      onChange={(value) => {
        onChange(withColumn(mapping, index, value === leftOut ? null : value))
      }}
    />
  )

  return (
    <TablePanel
      title="Spalten zuordnen"
      caption="Spalten der Datei und ihre Felder"
      cards={columns.map((column) => ({
        key: String(column.index),
        title: null,
        form: (
          <div className="flex flex-col gap-1.5">
            <code className="text-[14px] [overflow-wrap:anywhere]">{columnName(column)}</code>
            {column.sample === '' ? null : (
              <span className="text-[13px] text-ink-faint [overflow-wrap:anywhere]">
                {column.sample}
              </span>
            )}
            {choice(column.index, columnName(column))}
          </div>
        ),
      }))}
      cardsEmpty="In diesem Blatt steht keine Spalte."
      note={
        missing.length > 0 || note ? (
          <>
            {missing.length > 0 ? (
              <p role="status" className="text-waiting">
                Noch ohne Spalte: {missing.map((field) => field.label).join(', ')}.
              </p>
            ) : null}
            {note}
          </>
        ) : undefined
      }
    >
      <thead>
        <tr>
          <Column className="w-[220px]">Spalte in der Datei</Column>
          <Column className="w-[260px]">Erste Zeile</Column>
          <Column>Feld</Column>
        </tr>
      </thead>
      <tbody>
        {columns.map((column) => (
          <tr key={column.index}>
            <Cell>
              <code className="text-[13px] [overflow-wrap:anywhere]">{columnName(column)}</code>
            </Cell>
            <Cell className="text-ink-faint [overflow-wrap:anywhere]">{column.sample}</Cell>
            <Cell>{choice(column.index, columnName(column))}</Cell>
          </tr>
        ))}
      </tbody>
    </TablePanel>
  )
}
