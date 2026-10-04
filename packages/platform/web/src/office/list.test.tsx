import type { RecordState } from '@opengewerk/platform-domain'
import { useRouterState } from '@tanstack/react-router'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { Archive, Tag } from 'lucide-react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { InRouter } from '../in-router.js'
import { entries, lastChanged, ListCard, ListScreen, SortChoice } from './list.js'
import type { ListScreenProps } from './list.js'

/**
 * A list of the office at every width (#218, #219): cards on a phone, a
 * table from a tablet on, a preview beside it from 1600 pixels and the whole
 * record beside it from 2400.
 *
 * The rows are shelves, records no application has. What a list is called,
 * which columns it has and where a row leads is the screen's that uses it.
 */

/** Thirty shelves: every third in the cellar, every fourth full, and two rooms. */
const shelves: RecordState[] = Array.from({ length: 30 }, (_, index) => {
  const number = index + 1

  return {
    id: `s-${String(number).padStart(2, '0')}`,
    name: `Regal ${String(number).padStart(2, '0')}`,
    room: number % 3 === 0 ? 'Keller' : 'Werkstatt',
    state: number % 4 === 0 ? 'full' : 'free',
    colour: number % 5 === 0 ? 'rot' : 'blau',
    code: `X${String(1000 + number)}`,
    updatedAt: `2026-09-${String(number).padStart(2, '0')}T08:00:00.000Z`,
  }
})

function Where() {
  const path = useRouterState({ select: (state) => state.location.pathname })

  return <p data-testid="where">{path}</p>
}

/** The list by itself, for a test that keeps it mounted while its rows change. */
function theList(over: Partial<ListScreenProps> = {}) {
  return (
    <ListScreen
      title="Regale"
      caption="Regale"
      rows={shelves}
      columns={[
        {
          id: 'name',
          header: 'Name',
          value: (row) => String(row['name']),
          beside: (row) => (row['colour'] === 'rot' ? <span>rot</span> : null),
        },
        { id: 'room', header: 'Raum', value: (row) => String(row['room']), muted: true },
        {
          id: 'state',
          header: 'Stand',
          value: (row) => String(row['state']),
          cell: (row) => <em>{row['state'] === 'full' ? 'voll' : 'frei'}</em>,
          wideOnly: true,
        },
      ]}
      alsoSearched={(row) => String(row['code'])}
      hrefFor={(row) => `/regale/${String(row['id'])}`}
      searchLabel="Regale durchsuchen"
      searchPlaceholder="Name, Raum"
      filters={[
        { id: 'cellar', label: 'Keller', test: (row) => row['room'] === 'Keller' },
        { id: 'shop', label: 'Werkstatt', test: (row) => row['room'] === 'Werkstatt' },
      ]}
      facets={{
        label: 'Stand',
        filters: [
          { id: 'full', label: 'Voll', test: (row) => row['state'] === 'full' },
          { id: 'free', label: 'Frei', test: (row) => row['state'] === 'free' },
        ],
      }}
      choice={{
        label: 'Farbe',
        all: 'Alle Farben',
        icon: Tag,
        options: [
          { id: 'rot', label: 'Rot', test: (row) => row['colour'] === 'rot' },
          { id: 'blau', label: 'Blau', test: (row) => row['colour'] === 'blau' },
        ],
      }}
      sorts={[
        {
          id: 'name',
          label: 'Name',
          compare: (left, right) => String(left['name']).localeCompare(String(right['name']), 'de'),
        },
        lastChanged,
      ]}
      primary={{ label: 'Neues Regal', onPress: () => {} }}
      card={(row) => <ListCard to={`/regale/${String(row['id'])}`} title={String(row['name'])} />}
      preview={(row) => <aside aria-label="Vorschau">Vorschau {String(row['name'])}</aside>}
      record={(row, close) => (
        <aside aria-label="Akte">
          Akte {String(row['name'])}
          <button type="button" onClick={close}>
            Schließen
          </button>
        </aside>
      )}
      empty={{ icon: Archive, title: 'Noch kein Regal', text: 'Das erste Regal entsteht hier.' }}
      {...over}
    />
  )
}

function list(over: Partial<ListScreenProps> = {}) {
  return (
    <InRouter>
      <Where />
      {theList(over)}
    </InRouter>
  )
}

/** The window as wide as a band of the boards. */
function width(pixels: number): void {
  const minimum = (query: string) => Number(/min-width: ([\d.]+)rem/.exec(query)?.[1] ?? '0') * 16

  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: pixels >= minimum(query),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
}

async function shown(over: Partial<ListScreenProps> = {}) {
  const result = render(list(over))

  await screen.findByTestId('where')

  return result
}

/** The names in the first column of the table, in the order shown. */
function names(): string[] {
  return within(screen.getByRole('table'))
    .getAllByRole('link')
    .map((link) => link.textContent)
}

const counted = () => screen.getByRole('status').textContent

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('a list at a desk', () => {
  it('shows a page of rows with every column, in the first order it was given, and says how many there are', async () => {
    // Handed over the other way round: the order is the list's, not the rows'.
    await shown({ rows: [...shelves].reverse() })

    expect(screen.getByRole('heading', { level: 1, name: 'Regale' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Neues Regal' })).toBeTruthy()
    expect(counted()).toBe('30 Einträge')
    expect(
      within(screen.getByRole('table'))
        .getAllByRole('columnheader')
        .map((header) => header.textContent),
    ).toEqual(['Name', 'Raum', 'Stand'])
    // Twenty to a page where nothing was measured, sorted by name.
    expect(names()).toHaveLength(20)
    expect(names().slice(0, 3)).toEqual(['Regal 01', 'Regal 02', 'Regal 03'])
    expect(screen.getByText('1 bis 20 von 30')).toBeTruthy()
    // The keys of the search are named only where no order takes the place.
    expect(screen.queryByText('Strg')).toBeNull()
  })

  it('goes on to the next page and back, and offers no step that leads nowhere', async () => {
    await shown()

    expect(screen.getByRole('button', { name: 'Zurück' })).toHaveProperty('disabled', true)

    await userEvent.click(screen.getByRole('button', { name: 'Weiter' }))

    expect(screen.getByText('21 bis 30 von 30')).toBeTruthy()
    expect(names()).toHaveLength(10)
    expect(names()[0]).toBe('Regal 21')
    expect(screen.getByRole('button', { name: 'Weiter' })).toHaveProperty('disabled', true)

    await userEvent.click(screen.getByRole('button', { name: 'Zurück' }))

    expect(names()[0]).toBe('Regal 01')
  })

  it('shows what a column draws in its cell, and what follows the link outside of it', async () => {
    await shown()

    const fifth = within(screen.getByRole('table')).getAllByRole('row')[5] as HTMLElement

    // The link is the name alone: what stands beside it is no part of where
    // the row leads.
    expect(within(fifth).getByRole('link').textContent).toBe('Regal 05')
    expect(within(fifth).getByText('rot')).toBeTruthy()
    expect(within(fifth).getByText('frei').tagName).toBe('EM')
  })

  it('opens the record of a row that is clicked anywhere, and leaves a link in it to itself', async () => {
    await shown()

    // A cell of the first row, not the chip of the same name over the table.
    await userEvent.click(
      within(screen.getByRole('table')).getAllByText('Werkstatt')[0] as HTMLElement,
    )

    expect(await screen.findByText('/regale/s-01')).toBe(screen.getByTestId('where'))
  })
})

describe('a row of a list', () => {
  /**
   * The whole row opens its record, except where something in it does its
   * own thing: a button beside the name is pressed, and the row stays.
   */
  it('leaves a control inside it to itself', async () => {
    const pressed = vi.fn()

    await shown({
      columns: [
        {
          id: 'name',
          header: 'Name',
          value: (row) => String(row['name']),
          beside: () => (
            <button type="button" onClick={pressed}>
              Merken
            </button>
          ),
        },
      ],
    })

    await userEvent.click(screen.getAllByRole('button', { name: 'Merken' })[0] as HTMLElement)

    expect(pressed).toHaveBeenCalledOnce()
    // The router would have moved by now, as it does for a click on a cell.
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(screen.getByTestId('where').textContent).toBe('/')
  })
})

describe('the search of a list', () => {
  it('finds a row by every word, in any column and in what is searched besides, whatever the case', async () => {
    await shown()

    await userEvent.type(screen.getByLabelText('Regale durchsuchen'), 'keller REGAL 2')

    // In the cellar, and a two in its number.
    expect(names()).toEqual(['Regal 12', 'Regal 21', 'Regal 24', 'Regal 27'])
    expect(counted()).toBe('4 Einträge von 30')

    await userEvent.clear(screen.getByLabelText('Regale durchsuchen'))
    // The code of a shelf is in no column.
    await userEvent.type(screen.getByLabelText('Regale durchsuchen'), 'x1017')

    expect(names()).toEqual(['Regal 17'])
    expect(counted()).toBe('1 Eintrag von 30')
  })

  it('says so when nothing is found, with what was looked for', async () => {
    await shown()

    await userEvent.type(screen.getByLabelText('Regale durchsuchen'), ' Dachboden ')

    expect(screen.getByText('Für „Dachboden“ gibt es keinen Treffer.')).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
    expect(counted()).toBe('0 Einträge von 30')
  })

  it('goes back to the first page when the search changes what is listed', async () => {
    await shown()

    await userEvent.click(screen.getByRole('button', { name: 'Weiter' }))
    await userEvent.type(screen.getByLabelText('Regale durchsuchen'), 'Regal')

    expect(screen.getByText('1 bis 20 von 30')).toBeTruthy()
  })

  it('takes the focus from Strg K and from the slash, but not while somebody types', async () => {
    await shown()

    const search = screen.getByLabelText('Regale durchsuchen')

    fireEvent.keyDown(document, { key: 'k', ctrlKey: true })
    expect(document.activeElement).toBe(search)

    search.blur()
    fireEvent.keyDown(document, { key: '/' })
    expect(document.activeElement).toBe(search)

    // A slash in the middle of a word is a slash.
    await userEvent.type(search, 'a/b')
    expect((search as HTMLInputElement).value).toBe('a/b')
  })
})

describe('the chips and the choice of a list', () => {
  it('start with everything, and narrow to one of the first group at a time', async () => {
    await shown()

    expect(screen.getByRole('button', { name: 'Alle' }).getAttribute('aria-pressed')).toBe('true')

    await userEvent.click(screen.getByRole('button', { name: 'Keller' }))

    expect(counted()).toBe('10 Einträge von 30')
    expect(screen.getByRole('button', { name: 'Alle' }).getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByRole('button', { name: 'Keller' }).getAttribute('aria-pressed')).toBe('true')

    await userEvent.click(screen.getByRole('button', { name: 'Werkstatt' }))

    expect(counted()).toBe('20 Einträge von 30')
    expect(screen.getByRole('button', { name: 'Keller' }).getAttribute('aria-pressed')).toBe(
      'false',
    )

    await userEvent.click(screen.getByRole('button', { name: 'Alle' }))

    expect(counted()).toBe('30 Einträge')
  })

  it('narrow further with the second group, which goes off when pressed again', async () => {
    await shown()

    await userEvent.click(screen.getByRole('button', { name: 'Keller' }))
    await userEvent.click(within(screen.getByRole('group', { name: 'Stand' })).getByText('Voll'))

    // In the cellar and full: every twelfth.
    expect(names()).toEqual(['Regal 12', 'Regal 24'])

    await userEvent.click(within(screen.getByRole('group', { name: 'Stand' })).getByText('Voll'))

    expect(counted()).toBe('10 Einträge von 30')
  })

  it('narrow with the choice from the list as well, together with every chip that is on', async () => {
    await shown()

    await userEvent.click(screen.getByRole('button', { name: 'Keller' }))
    await userEvent.selectOptions(screen.getByLabelText('Farbe'), 'rot')

    // In the cellar and red: every fifteenth.
    expect(names()).toEqual(['Regal 15', 'Regal 30'])

    await userEvent.selectOptions(screen.getByLabelText('Farbe'), '')

    expect(counted()).toBe('10 Einträge von 30')
  })

  it('say that a selection holds nothing, which is not a search without a hit', async () => {
    await shown({
      filters: [{ id: 'attic', label: 'Dachboden', test: (row) => row['room'] === 'Dachboden' }],
    })

    await userEvent.click(screen.getByRole('button', { name: 'Dachboden' }))

    expect(screen.getByText('In dieser Auswahl steht nichts.')).toBeTruthy()
  })

  it('are left out where a list has none, and a choice while it has nothing to choose', async () => {
    await shown({
      filters: undefined,
      facets: undefined,
      choice: { label: 'Farbe', all: 'Alle Farben', options: [] },
    })

    expect(screen.queryByRole('group', { name: 'Auswahl' })).toBeNull()
    expect(screen.queryByRole('group', { name: 'Stand' })).toBeNull()
    expect(screen.queryByLabelText('Farbe')).toBeNull()
  })
})

describe('the order of a list', () => {
  it('changes with the choice beside the search', async () => {
    await shown()

    await userEvent.selectOptions(screen.getByLabelText('Sortiert nach'), 'changed')

    // The last change first.
    expect(names().slice(0, 3)).toEqual(['Regal 30', 'Regal 29', 'Regal 28'])
  })

  it('is the order of the rows where a list offers none, and then says how to search', async () => {
    await shown({ sorts: undefined, rows: [...shelves].reverse() })

    expect(names()[0]).toBe('Regal 30')
    expect(screen.queryByLabelText('Sortiert nach')).toBeNull()
    expect(screen.getByText('Strg')).toBeTruthy()
  })

  it('puts the last change first, and of two changed in the same moment the later one', () => {
    // In the order a sort that stopped at the moment would leave them in.
    const rows = [
      { id: 'a', updatedAt: '2026-09-01T08:00:00.000Z' },
      { id: 'b', updatedAt: '2026-09-02T08:00:00.000Z' },
      { id: 'c', updatedAt: '2026-09-02T08:00:00.000Z' },
    ]

    expect([...rows].sort(lastChanged.compare).map((row) => row.id)).toEqual(['c', 'b', 'a'])
  })

  it('offers the orders by name under a label a reader hears', async () => {
    const chosen = vi.fn()

    render(
      <SortChoice
        options={[
          { id: 'name', label: 'Name' },
          { id: 'changed', label: 'Zuletzt geändert' },
        ]}
        value="name"
        onChange={chosen}
      />,
    )
    await userEvent.selectOptions(screen.getByLabelText('Sortiert nach'), 'changed')

    expect(chosen).toHaveBeenCalledWith('changed')
  })
})

describe('a list at other widths', () => {
  it('is a card per row on a phone, every row and no pages', async () => {
    width(390)
    await shown()

    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.getAllByRole('listitem')).toHaveLength(30)
    expect(screen.getByRole('link', { name: 'Regal 07' }).getAttribute('href')).toBe('/regale/s-07')
    expect(screen.queryByRole('button', { name: 'Weiter' })).toBeNull()
    // No room for the order beside the search.
    expect(screen.queryByLabelText('Sortiert nach')).toBeNull()
  })

  it('is a table without the columns for a wide window on a tablet', async () => {
    width(820)
    await shown()

    expect(
      within(screen.getByRole('table'))
        .getAllByRole('columnheader')
        .map((header) => header.textContent),
    ).toEqual(['Name', 'Raum'])
  })

  /**
   * From 1600 pixels a click selects and the preview beside the list shows
   * the row. The first row is selected to begin with, as the boards draw it.
   */
  it('selects a row beside the preview from 1600 pixels instead of opening it', async () => {
    width(1920)
    await shown()

    expect(screen.getByRole('complementary', { name: 'Vorschau' }).textContent).toBe(
      'Vorschau Regal 01',
    )

    await userEvent.click(screen.getByRole('link', { name: 'Regal 04' }))

    expect(screen.getByRole('complementary', { name: 'Vorschau' }).textContent).toBe(
      'Vorschau Regal 04',
    )
    expect(screen.getByRole('link', { name: 'Regal 04' }).getAttribute('aria-current')).toBe('true')
    // Still on the list.
    expect(screen.getByTestId('where').textContent).toBe('/')

    // A click anywhere in another row selects that one.
    await userEvent.click(
      within(screen.getAllByRole('row')[2] as HTMLElement).getByText('Werkstatt'),
    )

    expect(screen.getByRole('complementary', { name: 'Vorschau' }).textContent).toBe(
      'Vorschau Regal 02',
    )
  })

  it('lets a link open in a second tab from there as anywhere', async () => {
    width(1920)
    await shown()

    // Whether the list stood in the way is asked where the click arrives
    // last: React listens at the root of what it rendered, so a listener on
    // the link itself would answer before the list had its turn.
    let stoodInTheWay: boolean | null = null
    const afterTheList = (clicked: Event) => {
      stoodInTheWay = clicked.defaultPrevented
      // A test has no second tab to open.
      clicked.preventDefault()
    }

    document.addEventListener('click', afterTheList)
    fireEvent.click(screen.getByRole('link', { name: 'Regal 04' }), { ctrlKey: true })
    document.removeEventListener('click', afterTheList)

    expect(stoodInTheWay).toBe(false)
    expect(screen.getByRole('complementary', { name: 'Vorschau' }).textContent).toBe(
      'Vorschau Regal 01',
    )
  })

  it('shows the whole record beside the list from 2400 pixels, until it is closed', async () => {
    width(2560)
    await shown()

    expect(screen.getByRole('complementary', { name: 'Akte' }).textContent).toContain(
      'Akte Regal 01',
    )
    expect(screen.queryByRole('complementary', { name: 'Vorschau' })).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Schließen' }))

    expect(screen.queryByRole('complementary', { name: 'Akte' })).toBeNull()

    await userEvent.click(screen.getByRole('link', { name: 'Regal 03' }))

    expect(screen.getByRole('complementary', { name: 'Akte' }).textContent).toContain(
      'Akte Regal 03',
    )
  })

  it('opens a row on a wide window too, where a list has nothing to show beside it', async () => {
    width(1920)
    await shown({ preview: undefined })

    // A cell of the first row, not the chip of the same name over the table.
    await userEvent.click(
      within(screen.getByRole('table')).getAllByText('Werkstatt')[0] as HTMLElement,
    )

    expect(await screen.findByText('/regale/s-01')).toBe(screen.getByTestId('where'))
  })
})

describe('the page of a list', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  /**
   * A window that holds so many rows under the top of the table: the table
   * begins at 100, a row is 30 high, and the head of the table, the pages and
   * the room under the card take 96 of what is left. The observer of the
   * list measures as soon as it is given something to observe, as a browser
   * does.
   */
  function windowHolding(rows: number): void {
    vi.stubGlobal('innerHeight', 100 + 96 + rows * 30)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      const row = this.tagName === 'TR'

      return { top: row ? 0 : 100, height: row ? 30 : 0, width: 0, left: 0 } as DOMRect
    })
    vi.stubGlobal(
      'ResizeObserver',
      class {
        private gone = false

        constructor(private readonly callback: () => void) {}

        observe() {
          queueMicrotask(() => {
            if (!this.gone) {
              this.callback()
            }
          })
        }

        disconnect() {
          this.gone = true
        }
      },
    )
  }

  it('is as long as the window holds rows under the top of the table', async () => {
    windowHolding(8)
    await shown()

    expect(await screen.findByText('1 bis 8 von 30')).toBeTruthy()
    expect(names()).toHaveLength(8)
  })

  it('is never shorter than six rows, however short the window', async () => {
    windowHolding(2)
    await shown()

    expect(await screen.findByText('1 bis 6 von 30')).toBeTruthy()
  })

  /**
   * The frame of the table is not there while a list has no rows, and the
   * list measured only the frame it found when it came: rows that arrived
   * after it, from the first exchange of a device, were paged twenty at a
   * time for good, whatever the window held (opengewerk-haustechnik#31).
   */
  it('is measured as well when the rows come after the list', async () => {
    windowHolding(8)

    /** A list that is there before its rows are, as on a device before its first exchange. */
    function Arriving() {
      const [rows, setRows] = useState<readonly RecordState[]>([])

      return (
        <>
          <button
            type="button"
            onClick={() => {
              setRows(shelves)
            }}
          >
            Abgleichen
          </button>
          {theList({ rows })}
        </>
      )
    }

    render(
      <InRouter>
        <Where />
        <Arriving />
      </InRouter>,
    )
    await screen.findByTestId('where')

    expect(screen.queryByRole('table')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Abgleichen' }))

    expect(await screen.findByText('1 bis 8 von 30')).toBeTruthy()
    expect(names()).toHaveLength(8)
  })
})

describe('a list with nothing in it', () => {
  it('says what belongs here and offers the one action, with a search that has nothing to search', async () => {
    const pressed = vi.fn()

    await shown({ rows: [], primary: { label: 'Neues Regal', onPress: pressed } })

    expect(screen.getByRole('region', { name: 'Noch kein Regal' }).textContent).toContain(
      'Das erste Regal entsteht hier.',
    )
    expect(screen.getByRole('searchbox', { name: 'Regale durchsuchen' })).toHaveProperty(
      'disabled',
      true,
    )
    expect(screen.getByText('0 Einträge')).toBeTruthy()

    // Beside the title and under the sentence.
    const buttons = screen.getAllByRole('button', { name: 'Neues Regal' })

    expect(buttons).toHaveLength(2)

    await userEvent.click(buttons[1] as HTMLElement)

    expect(pressed).toHaveBeenCalledOnce()
  })
})

describe('the count of a list in words', () => {
  it('is singular for one, and writes the thousands the way a person does', () => {
    expect(entries(0)).toBe('0 Einträge')
    expect(entries(1)).toBe('1 Eintrag')
    expect(entries(248)).toBe('248 Einträge')
    expect(entries(12480)).toBe('12.480 Einträge')
  })
})

describe('a card of a list on a phone', () => {
  it('is one link to the record, with the line under the name and what stands at the right', async () => {
    render(
      <InRouter>
        <ListCard
          to="/regale/s-01"
          title="Regal 01"
          sub="Werkstatt"
          below={<span>rot</span>}
          right={<span>voll</span>}
        />
      </InRouter>,
    )

    const card = await screen.findByRole('link')

    expect(card.getAttribute('href')).toBe('/regale/s-01')
    expect(card.textContent).toBe('Regal 01Werkstattrotvoll')
  })
})
