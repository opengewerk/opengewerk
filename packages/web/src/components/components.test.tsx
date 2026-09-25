import { act, render, screen, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Button, IconButton } from './button.js'
import { Confirm } from './confirm.js'
import { Field } from './field.js'
import { TablePanel } from './panel.js'
import { DocumentState } from './state.js'
import { Strip } from './strip.js'
import { Cell, Column, Table } from './table.js'
import { Card, Shell, TextLink } from './surface.js'
import { ThemeSwitch } from './theme-switch.js'

/**
 * What these check is not how the components look. It is the handful of
 * promises the design makes that are invisible in a screenshot and break
 * silently: that a control is a control, that a field has a label, that a
 * conflict interrupts and a quiet state does not.
 */

describe('a button', () => {
  it('is a button and not something that merely looks like one', () => {
    // A div with an onClick renders identically, is skipped by Tab and is
    // announced as nothing. On a screen somebody operates one handed in a
    // cellar that is not a detail.
    render(<Button tone="primary">Festschreiben</Button>)

    const found = screen.getByRole('button', { name: 'Festschreiben' })
    expect(found.tagName).toBe('BUTTON')
    expect(found.getAttribute('type')).toBe('button')
  })

  it('takes its height from the density and not from the caller', () => {
    // The same component is 34px in the office and 60px on site. If a caller
    // could pass a height, the two densities would drift apart one screen at a
    // time.
    render(<Button>Vorschau</Button>)

    expect(screen.getByRole('button').className).toContain('h-control')
  })
})

describe('a button that is only an icon', () => {
  it('still says what it does', () => {
    render(
      <IconButton label="Foto aufnehmen">
        <svg aria-hidden="true" />
      </IconButton>,
    )

    expect(screen.getByRole('button', { name: 'Foto aufnehmen' })).toBeDefined()
  })
})

describe('a field', () => {
  it('is reachable by its label', () => {
    // The failure mode is silent: a field without a label looks finished and
    // is announced as "edit text" with no idea what for.
    render(<Field label="Rechnungsdatum" defaultValue="19.09.2026" numeric />)

    const input = screen.getByLabelText('Rechnungsdatum')
    expect(input.getAttribute('value')).toBe('19.09.2026')
    expect(input.className).toContain('numeric')
  })

  it('says what is wrong, where a reader will hear it', () => {
    render(<Field label="Schleifenimpedanz" problem="Über dem Grenzwert von 2,87 Ohm" />)

    const input = screen.getByLabelText('Schleifenimpedanz')
    const describedBy = input.getAttribute('aria-describedby')

    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(describedBy).toBeTruthy()
    expect(document.getElementById(describedBy as string)?.textContent).toContain('Grenzwert')
  })
})

describe('a table', () => {
  it('has a caption and column headers that point at their column', () => {
    render(
      <Table caption="Positionen der Rechnung">
        <thead>
          <tr>
            <Column>Bezeichnung</Column>
            <Column numeric>Summe</Column>
          </tr>
        </thead>
        <tbody>
          <tr>
            <Cell>Arbeitszeit Monteur</Cell>
            <Cell numeric>217,00</Cell>
          </tr>
        </tbody>
      </Table>,
    )

    expect(screen.getByRole('table', { name: 'Positionen der Rechnung' })).toBeDefined()
    expect(screen.getByRole('columnheader', { name: 'Summe' }).getAttribute('scope')).toBe('col')
    expect(screen.getByRole('cell', { name: '217,00' }).className).toContain('numeric')
  })
})

describe('the head of a table', () => {
  /** The ResizeObserver of the table, run by hand once it has observed. */
  let measure: (() => void) | undefined

  beforeEach(() => {
    measure = undefined
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(private readonly callback: () => void) {}
        observe() {
          measure = () => {
            this.callback()
          }
        }
        disconnect() {}
      },
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  /** Frame, table and head with the sizes of a window. */
  function sized(frame: number, table: { width: number; height: number }) {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      const size =
        this.tagName === 'TABLE'
          ? table
          : this.tagName === 'THEAD'
            ? { width: table.width, height: 33.4 }
            : { width: frame, height: table.height }
      return DOMRect.fromRect(size)
    })
  }

  function positions() {
    return (
      <Table caption="Positionen der Rechnung">
        <thead>
          <tr>
            <Column>Bezeichnung</Column>
            <Column numeric>Summe</Column>
          </tr>
        </thead>
        <tbody>
          <tr>
            <Cell>Arbeitszeit Monteur</Cell>
            <Cell numeric>217,00</Cell>
          </tr>
        </tbody>
      </Table>
    )
  }

  function frameOf(table: HTMLElement): HTMLElement {
    return table.parentElement as HTMLElement
  }

  it('stays under the top bar while a table that fits scrolls with the page (#272)', () => {
    // A frame that scrolls sideways is a scroll container in both directions,
    // and a sticky head sticks to the frame, which never scrolls up or down.
    // One that clips is none, so a table that fits gets one of those.
    sized(900, { width: 900, height: 420.8 })
    render(positions())
    act(() => measure?.())

    const frame = frameOf(screen.getByRole('table'))
    expect(frame.className).toContain('overflow-x-clip')
    expect(frame.hasAttribute('data-wide')).toBe(false)
    expect(frame.hasAttribute('data-nested')).toBe(false)
    // As far as the head can travel before it would leave its table, rounded
    // down so that it never ends below the last row.
    expect(frame.style.getPropertyValue('--table-head-travel')).toBe('387px')
  })

  it('leaves a table wider than its frame to scroll sideways in it', () => {
    sized(360, { width: 900, height: 420.8 })
    render(positions())
    act(() => measure?.())

    const frame = frameOf(screen.getByRole('table'))
    expect(frame.className).toContain('overflow-x-auto')
    expect(frame.hasAttribute('data-wide')).toBe(true)
  })

  it('sticks to a column that scrolls on its own and not under the top bar', () => {
    // The top edge of the column is where the head belongs there. Under the
    // top bar would also push it down into its own rows wherever such a
    // container does not scroll at all, 56 pixels below the edge of a card
    // that clips with `overflow: hidden`.
    sized(900, { width: 900, height: 420.8 })
    render(<div style={{ overflowY: 'auto' }}>{positions()}</div>)
    act(() => measure?.())

    expect(frameOf(screen.getByRole('table')).hasAttribute('data-nested')).toBe(true)
  })

  it('scrolls sideways until it has been measured', () => {
    // A frame that scrolls shows every column; one that clips would cut a
    // wide table off before anybody knew it was wide.
    vi.stubGlobal('ResizeObserver', undefined)
    render(positions())

    const frame = frameOf(screen.getByRole('table'))
    expect(frame.className).toContain('overflow-x-auto')
    expect(frame.hasAttribute('data-wide')).toBe(true)
  })
})

describe('a table in a card on a phone', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  /** A window of the given width, as far as the bands are concerned. */
  function windowOf(width: number) {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: Number(/min-width:\s*([\d.]+)rem/.exec(query)?.[1] ?? '0') * 16 <= width,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
  }

  function objects(cards = true) {
    return (
      <TablePanel
        title="Objekte"
        caption="Objekte des Kunden"
        cards={
          cards
            ? [
                {
                  key: 's-1',
                  title: 'Rheinstraße 12',
                  sub: 'Rheinstraße 12, 68159 Mannheim · 3 Anlagen',
                  right: '1 offen',
                },
              ]
            : undefined
        }
      >
        <thead>
          <tr>
            <Column>Bezeichnung</Column>
            <Column>Anschrift</Column>
          </tr>
        </thead>
        <tbody>
          <tr>
            <Cell>Rheinstraße 12</Cell>
            <Cell>Rheinstraße 12, 68159 Mannheim</Cell>
          </tr>
        </tbody>
      </TablePanel>
    )
  }

  it('stands as one box per row below 600 pixels, as the board of the widths asks', () => {
    windowOf(390)
    render(objects())

    // "Tabellen werden Karten, eine Karte je Zeile": no table, a list under
    // the name of the table, each row with its other columns in a line.
    expect(screen.queryByRole('table')).toBeNull()
    const list = screen.getByRole('list', { name: 'Objekte des Kunden' })
    const [row] = within(list).getAllByRole('listitem')
    expect(row?.textContent).toBe('Rheinstraße 12Rheinstraße 12, 68159 Mannheim · 3 Anlagen1 offen')
  })

  it('stays a table from 600 pixels on, and where it has no boxes', () => {
    windowOf(768)
    const { unmount } = render(objects())
    expect(screen.getByRole('table', { name: 'Objekte des Kunden' })).toBeDefined()
    unmount()

    // A table that brings no boxes scrolls in its frame on a phone instead.
    windowOf(390)
    render(objects(false))
    expect(screen.getByRole('table', { name: 'Objekte des Kunden' })).toBeDefined()
  })
})

describe('the state of a document', () => {
  it('shows a number once there is one, and none while there is not', () => {
    const { rerender } = render(<DocumentState status="draft" />)
    expect(screen.getByText('Entwurf')).toBeDefined()

    rerender(<DocumentState status="issued" number="RE-2026-0231" />)
    expect(screen.getByText('Festgeschrieben')).toBeDefined()
    expect(screen.getByText('RE-2026-0231')).toBeDefined()
  })
})

describe('a strip over the screen', () => {
  it('interrupts for a conflict and does not for the quiet states', () => {
    // `alert` is announced at once, `status` when the reader gets to it. Using
    // `alert` for a quiet state would train people to ignore it, and then the
    // one that matters goes past them too.
    const { rerender } = render(<Strip tone="info">Eine neue Fassung liegt bereit.</Strip>)
    expect(screen.getByRole('status')).toBeDefined()

    rerender(<Strip tone="wait">3 Änderungen auf dem Gerät. Keine Verbindung.</Strip>)
    expect(screen.getByRole('status')).toBeDefined()

    rerender(
      <Strip tone="conflict" urgent>
        Ein Konflikt wartet auf eine Entscheidung.
      </Strip>,
    )
    expect(screen.getByRole('alert')).toBeDefined()
  })

  it('says its second sentence under the first on site and after it in the office', () => {
    const { rerender } = render(
      <Shell entry="site">
        <Strip tone="wait" detail="3 Änderungen auf dem Gerät.">
          Keine Verbindung.
        </Strip>
      </Shell>,
    )

    // Two lines: each sentence is an element of its own.
    expect(screen.getByText('Keine Verbindung.').textContent).toBe('Keine Verbindung.')
    expect(screen.getByText('3 Änderungen auf dem Gerät.')).toBeDefined()

    rerender(
      <Shell entry="office">
        <Strip tone="wait" detail="Bis sie entschieden ist, geht nichts hinaus.">
          Der Server nimmt eine Änderung nicht an.
        </Strip>
      </Shell>,
    )

    // One line: both sentences in one run of text.
    expect(screen.getByRole('status').textContent).toBe(
      'Der Server nimmt eine Änderung nicht an. Bis sie entschieden ist, geht nichts hinaus.',
    )
  })
})

describe('a question before something that cannot be taken back', () => {
  it('starts on the way out, and Escape and the way out both cancel', async () => {
    const answers: string[] = []
    const user = userEvent.setup()

    render(
      <Confirm
        open
        title="Anna Weber sperren?"
        confirm="Sperren"
        onConfirm={() => answers.push('sperren')}
        onCancel={() => answers.push('abbrechen')}
      >
        Anna Weber kann sich danach nicht mehr anmelden.
      </Confirm>,
    )

    const dialog = screen.getByRole('alertdialog', { name: 'Anna Weber sperren?' })
    expect(dialog.getAttribute('aria-describedby')).toBeTruthy()
    // Enter by reflex must not block anybody.
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Abbrechen' }))

    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'Abbrechen' }))
    await user.click(screen.getByRole('button', { name: 'Sperren' }))

    expect(answers).toEqual(['abbrechen', 'abbrechen', 'sperren'])
  })

  it('is not there while it is not asked', () => {
    render(
      <Confirm
        open={false}
        title="Gerät abmelden?"
        confirm="Abmelden"
        onConfirm={() => {}}
        onCancel={() => {}}
      >
        Das Gerät muss sich danach neu anmelden.
      </Confirm>,
    )

    expect(screen.queryByRole('alertdialog')).toBeNull()
  })
})

describe('the shell of an entry point', () => {
  it('writes the density and leaves light or dark to the root', () => {
    const { container } = render(
      <Shell entry="site">
        <p>Baustelle</p>
      </Shell>,
    )

    const root = container.firstElementChild as HTMLElement
    expect(root.getAttribute('data-entry')).toBe('site')
    // The dark tokens are read on `:root`. An attribute here would be one the
    // stylesheet never looks at, which is what the old `theme` prop wrote.
    expect(root.hasAttribute('data-theme')).toBe(false)
  })
})

describe('the switch between light and dark', () => {
  it('shows both words and marks the chosen one', async () => {
    const chosen: string[] = []
    render(
      <ThemeSwitch
        value="light"
        onChoose={(theme) => {
          chosen.push(theme)
        }}
      />,
    )

    const group = screen.getByRole('group', { name: 'Darstellung' })
    expect(group).toBeDefined()
    expect(screen.getByRole('button', { name: 'Hell' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Dunkel' }).getAttribute('aria-pressed')).toBe(
      'false',
    )

    await userEvent.click(screen.getByRole('button', { name: 'Dunkel' }))
    expect(chosen).toEqual(['dark'])
  })
})

describe('a card and a link', () => {
  it('carry a name and an underline', () => {
    render(
      <Card label="Anlage" tone="sunken">
        <TextLink href="#akte">Anlagenakte öffnen</TextLink>
      </Card>,
    )

    expect(screen.getByRole('region', { name: 'Anlage' })).toBeDefined()
    // Colour alone is the one distinction a colour blind reader does not get.
    expect(screen.getByRole('link', { name: 'Anlagenakte öffnen' }).className).toContain(
      'underline',
    )
  })
})
