import type { ColumnMapping, TableField, TableFile, TableSheet } from '@opengewerk/platform-domain'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ColumnsPanel, readTableFile, sendTable, Steps, TableFilePanel } from './tables.js'

/**
 * What a screen that takes a table over is built from (opengewerk-haustechnik#100).
 * Held here is what somebody choosing a file and its columns gets: which step
 * they are at, what the file holds, and a choice of columns that can always
 * be sent, because a field never has two of them.
 */

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const shelves: TableSheet = {
  name: 'Regale',
  rows: [
    ['Regal', 'Böden', 'Bemerkung'],
    ['Werkstatt', '5', ''],
    ['Lager', '', 'wackelt'],
  ],
}

const fields: readonly TableField[] = [
  { key: 'name', label: 'Bezeichnung', required: true },
  { key: 'boards', label: 'Anzahl der Böden' },
]

describe('the steps of taking a table over', () => {
  it('say which step somebody is at and which are done, to a reader as well', () => {
    render(
      <Steps label="Schritte" names={['Datei und Spalten', 'Vorschau', 'Übernahme']} current={1} />,
    )

    const steps = within(screen.getByRole('list', { name: 'Schritte' })).getAllByRole('listitem')

    expect(steps.map((step) => step.getAttribute('aria-current'))).toEqual([null, 'step', null])
    expect(steps.map((step) => step.textContent)).toEqual([
      'Datei und Spalten (erledigt)',
      '2Vorschau',
      '3Übernahme',
    ])
  })
})

describe('the file a table is taken from', () => {
  const file: TableFile = {
    name: 'regale.xlsx',
    sheets: [shelves, { name: 'Alt', rows: [['Regal']] }],
  }

  it('asks for a file before there is one, and hands on the one somebody chose', async () => {
    const onFile = vi.fn()

    render(
      <TableFilePanel
        file={null}
        sheet={0}
        onSheet={vi.fn()}
        onFile={onFile}
        hint="Eine Zeile je Regal."
      />,
    )

    expect(screen.getByText('Eine Zeile je Regal.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Datei wählen' })).toBeTruthy()

    const chosen = new File(['Regal;Böden'], 'regale.csv', { type: 'text/csv' })

    await userEvent.upload(screen.getByLabelText('Datei wählen'), chosen)

    expect(onFile).toHaveBeenCalledTimes(1)
    expect(onFile).toHaveBeenCalledWith(chosen)
  })

  it('names the file, the sheet with its lines and where the header stands', () => {
    render(<TableFilePanel file={file} sheet={0} onSheet={vi.fn()} onFile={vi.fn()} />)

    expect(screen.getByText('regale.xlsx')).toBeTruthy()
    expect(screen.getByText('Blatt „Regale“ · 2 Zeilen · Kopfzeile in Zeile 1')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Andere Datei' })).toBeTruthy()
  })

  it('offers the sheets of a workbook that has several, and none where the file is one table', async () => {
    const onSheet = vi.fn()
    const { unmount } = render(
      <TableFilePanel file={file} sheet={0} onSheet={onSheet} onFile={vi.fn()} />,
    )

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Blatt' }), 'Alt')

    expect(onSheet).toHaveBeenCalledWith(1)

    unmount()
    render(
      <TableFilePanel
        file={{ name: 'regale.csv', sheets: [{ ...shelves, name: '' }] }}
        sheet={0}
        onSheet={onSheet}
        onFile={vi.fn()}
      />,
    )

    expect(screen.queryByRole('combobox', { name: 'Blatt' })).toBeNull()
    expect(screen.getByText('2 Zeilen · Kopfzeile in Zeile 1')).toBeTruthy()
  })

  it('says why a file was not read, and waits while one is being read', () => {
    render(
      <TableFilePanel
        file={null}
        sheet={0}
        onSheet={vi.fn()}
        onFile={vi.fn()}
        busy
        problem="Die Datei ist leer."
      />,
    )

    expect(screen.getByRole('alert').textContent).toBe('Die Datei ist leer.')
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Datei wird gelesen' }).disabled,
    ).toBe(true)
  })
})

describe('the columns of a sheet and their fields', () => {
  function shown(mapping: ColumnMapping, onChange = vi.fn()) {
    render(<ColumnsPanel sheet={shelves} fields={fields} mapping={mapping} onChange={onChange} />)

    return onChange
  }

  it('shows every column with the first thing in it and the field it is given', () => {
    shown({ name: 0 })

    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1)

    expect(rows.map((row) => within(row).getAllByRole('cell')[0]?.textContent)).toEqual([
      'Regal',
      'Böden',
      'Bemerkung',
    ])
    expect(rows.map((row) => within(row).getAllByRole('cell')[1]?.textContent)).toEqual([
      'Werkstatt',
      '5',
      'wackelt',
    ])
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: 'Feld für Regal' }).value).toBe(
      'name',
    )
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: 'Feld für Böden' }).value).toBe(
      '',
    )
  })

  it('gives a field to the column somebody chose and takes it from the one that had it', () => {
    const onChange = shown({ name: 0, boards: 1 })

    fireEvent.change(screen.getByRole('combobox', { name: 'Feld für Bemerkung' }), {
      target: { value: 'name' },
    })

    expect(onChange).toHaveBeenCalledWith({ boards: 1, name: 2 })
  })

  it('takes a column out again', () => {
    const onChange = shown({ name: 0, boards: 1 })

    fireEvent.change(screen.getByRole('combobox', { name: 'Feld für Böden' }), {
      target: { value: '' },
    })

    expect(onChange).toHaveBeenCalledWith({ name: 0 })
  })

  it('says which fields still need a column, and nothing once they have one', () => {
    shown({ boards: 1 })

    expect(screen.getByRole('status').textContent).toBe('Noch ohne Spalte: Bezeichnung.')

    cleanup()
    shown({ name: 0 })

    expect(screen.queryByRole('status')).toBeNull()
  })
})

describe('the requests a table travels in', () => {
  function answering(body: unknown) {
    const sent: { path: string; init: RequestInit }[] = []

    vi.stubGlobal('fetch', (path: string, init: RequestInit) => {
      sent.push({ path, init })

      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    })

    return sent
  }

  it('send the file as bytes, with its name in a header, and answer with the table', async () => {
    const table: TableFile = { name: 'bestände.csv', sheets: [shelves] }
    const sent = answering(table)
    const file = new File(['Regal;Böden'], 'bestände.csv', { type: 'text/csv' })

    await expect(readTableFile('/regale/tabelle', file)).resolves.toEqual(table)

    const [request] = sent
    const headers = request?.init.headers as Record<string, string>

    expect(request?.path).toBe('/regale/tabelle')
    expect(request?.init.method).toBe('POST')
    expect(request?.init.body).toBe(file)
    expect(headers['Content-Type']).toBe('application/octet-stream')
    expect(headers['x-file-name']).toBe('best%C3%A4nde.csv')
  })

  it('send a sheet with what was decided about it under the type of its own', async () => {
    const sent = answering({ taken: 2 })

    await expect(
      sendTable('/regale/vorschau', { sheet: shelves, mapping: { name: 0 } }),
    ).resolves.toEqual({ taken: 2 })

    const [request] = sent
    const headers = request?.init.headers as Record<string, string>

    expect(headers['Content-Type']).toBe('application/x.table+json')
    expect(JSON.parse(String(request?.init.body))).toEqual({ sheet: shelves, mapping: { name: 0 } })
  })
})
