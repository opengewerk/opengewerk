import { act, render, screen, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Button, IconButton } from './button.js'
import { Choice } from './choice.js'
import { Confirm } from './confirm.js'
import { Dialog, DialogActions } from './dialog.js'
import { Field, SelectField, TextArea } from './field.js'
import { TablePanel } from './panel.js'
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
    render(<Button tone="primary">Speichern</Button>)

    const found = screen.getByRole('button', { name: 'Speichern' })
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
    render(<Field label="Datum" defaultValue="19.09.2026" numeric />)

    const input = screen.getByLabelText('Datum')
    expect(input.getAttribute('value')).toBe('19.09.2026')
    expect(input.className).toContain('numeric')
  })

  it('says what is wrong, where a reader will hear it', () => {
    render(<Field label="Messwert" problem="Über dem Grenzwert von 2,87 Ohm" />)

    const input = screen.getByLabelText('Messwert')
    const describedBy = input.getAttribute('aria-describedby')

    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(describedBy).toBeTruthy()
    expect(document.getElementById(describedBy as string)?.textContent).toContain('Grenzwert')
  })

  /** The label of a control, by the id the control carries. */
  function labelOf(control: HTMLElement) {
    return document.querySelector(`label[for="${control.id}"]`)
  }

  it('carries a star beside its label where the screen asks for one, and keeps its name', () => {
    render(
      <>
        <Field label="Name" required starred />
        <SelectField
          label="Raum"
          value="shop"
          options={[{ value: 'shop', label: 'Werkstatt' }]}
          onChange={() => undefined}
          required
          starred
        />
        <TextArea label="Notiz" required starred />
      </>,
    )

    for (const name of ['Name', 'Raum', 'Notiz']) {
      const control = screen.getByLabelText(name)
      const star = labelOf(control)?.nextElementSibling

      // The label is the name and nothing else: the star stands beside it and
      // out of what a reader hears, and the control says that it is required.
      expect(labelOf(control)?.textContent).toBe(name)
      expect(star?.textContent).toBe('*')
      expect(star?.getAttribute('aria-hidden')).toBe('true')
      expect(control).toHaveProperty('required', true)
    }
  })

  it('carries no star for being required alone', () => {
    // A form before the sign in asks for nothing but required fields.
    render(
      <>
        <Field label="Passwort" required />
        <TextArea label="Grund" required />
      </>,
    )

    expect(screen.getByLabelText('Passwort')).toHaveProperty('required', true)
    expect(document.body.textContent).not.toContain('*')
  })

  it('keeps the star at the label where something stands at the right of it', () => {
    render(<Field label="Passwort" starred aside={<a href="#vergessen">Vergessen?</a>} />)

    const label = labelOf(screen.getByLabelText('Passwort'))
    const aside = screen.getByRole('link', { name: 'Vergessen?' })

    expect(label?.textContent).toBe('Passwort')
    expect(label?.nextElementSibling?.textContent).toBe('*')
    // The star belongs to the label, what stands at the right comes after both.
    expect(label?.parentElement?.contains(aside)).toBe(false)
    expect(
      (label?.parentElement?.compareDocumentPosition(aside) ?? 0) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })
})

describe('a list of choices', () => {
  const countries = [
    { value: 'DE', label: 'Deutschland' },
    { value: 'AT', label: 'Österreich' },
  ]

  /**
   * The list as a reader meets it: each choice with what it hands back, and
   * how it is kept from being picked. Out of the list for a browser that
   * leaves hidden choices out, and not to be picked for one that shows them.
   */
  function choices(select: HTMLSelectElement) {
    return [...select.options].map((option) => ({
      value: option.value,
      label: option.textContent,
      kept: [option.hidden ? 'out of the list' : null, option.disabled ? 'not to be picked' : null]
        .filter(Boolean)
        .join(', '),
    }))
  }

  it('offers its choices and nothing else while it holds one of them', async () => {
    const changed = vi.fn()

    render(<SelectField label="Land" value="DE" options={countries} onChange={changed} />)

    const select = screen.getByRole<HTMLSelectElement>('combobox', { name: 'Land' })

    expect(select.value).toBe('DE')
    expect(choices(select)).toEqual([
      { value: 'DE', label: 'Deutschland', kept: '' },
      { value: 'AT', label: 'Österreich', kept: '' },
    ])

    await userEvent.selectOptions(select, 'Österreich')

    expect(changed).toHaveBeenCalledExactlyOnceWith('AT')
  })

  // Left to itself a browser shows the first choice for such a value, and
  // the form would hand back something other than what stands on the screen.
  it('shows a value its choices do not offer as what it is, and not as the first of them', () => {
    render(<SelectField label="Land" value="XX" options={countries} onChange={() => {}} />)

    const select = screen.getByRole<HTMLSelectElement>('combobox', { name: 'Land' })

    expect(select.value).toBe('XX')
    expect(choices(select)).toEqual([
      { value: 'XX', label: 'XX', kept: 'out of the list, not to be picked' },
      { value: 'DE', label: 'Deutschland', kept: '' },
      { value: 'AT', label: 'Österreich', kept: '' },
    ])
  })

  it('shows nothing chosen where it holds nothing and no choice stands for nothing', () => {
    render(<SelectField label="Land" value="" required options={countries} onChange={() => {}} />)

    const select = screen.getByRole<HTMLSelectElement>('combobox', { name: 'Land' })

    // Empty and required: the browser stops the form as at an empty field.
    expect(select.value).toBe('')
    expect(select.required).toBe(true)
    expect(choices(select)[0]).toEqual({
      value: '',
      label: '',
      kept: 'out of the list, not to be picked',
    })
  })

  it('takes a choice that stands for nothing as one of its choices', () => {
    render(
      <SelectField
        label="Land"
        value=""
        options={[{ value: '', label: 'Bitte wählen' }, ...countries]}
        onChange={() => {}}
      />,
    )

    const select = screen.getByRole<HTMLSelectElement>('combobox', { name: 'Land' })

    expect(choices(select).map((choice) => choice.label)).toEqual([
      'Bitte wählen',
      'Deutschland',
      'Österreich',
    ])
  })
})

describe('a table', () => {
  it('has a caption and column headers that point at their column', () => {
    render(
      <Table caption="Posten der Liste">
        <thead>
          <tr>
            <Column>Bezeichnung</Column>
            <Column numeric>Summe</Column>
          </tr>
        </thead>
        <tbody>
          <tr>
            <Cell>Erster Posten</Cell>
            <Cell numeric>217,00</Cell>
          </tr>
        </tbody>
      </Table>,
    )

    expect(screen.getByRole('table', { name: 'Posten der Liste' })).toBeDefined()
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
      <Table caption="Posten der Liste">
        <thead>
          <tr>
            <Column>Bezeichnung</Column>
            <Column numeric>Summe</Column>
          </tr>
        </thead>
        <tbody>
          <tr>
            <Cell>Erster Posten</Cell>
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
        title="Orte"
        caption="Orte in der Übersicht"
        cards={
          cards
            ? [
                {
                  key: 's-1',
                  title: 'Rheinstraße 12',
                  sub: 'Rheinstraße 12, 68159 Mannheim · 3 Einträge',
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
    const list = screen.getByRole('list', { name: 'Orte in der Übersicht' })
    const [row] = within(list).getAllByRole('listitem')
    expect(row?.textContent).toBe(
      'Rheinstraße 12Rheinstraße 12, 68159 Mannheim · 3 Einträge1 offen',
    )
  })

  it('stays a table from 600 pixels on, and where it has no boxes', () => {
    windowOf(768)
    const { unmount } = render(objects())
    expect(screen.getByRole('table', { name: 'Orte in der Übersicht' })).toBeDefined()
    unmount()

    // A table that brings no boxes scrolls in its frame on a phone instead.
    windowOf(390)
    render(objects(false))
    expect(screen.getByRole('table', { name: 'Orte in der Übersicht' })).toBeDefined()
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
        <p>Unterwegs</p>
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
      <Card label="Eintrag" tone="sunken">
        <TextLink href="#eintrag">Eintrag öffnen</TextLink>
      </Card>,
    )

    expect(screen.getByRole('region', { name: 'Eintrag' })).toBeDefined()
    // Colour alone is the one distinction a colour blind reader does not get.
    expect(screen.getByRole('link', { name: 'Eintrag öffnen' }).className).toContain('underline')
  })
})

describe('a short form over the page', () => {
  function Opened({ onClose }: { readonly onClose: () => void }) {
    return (
      <Dialog title="Zugang anlegen" sub="Ein Link, der einmal gilt." onClose={onClose}>
        <Field label="Name" autoFocus />
        <DialogActions>
          <Button onClick={onClose}>Abbrechen</Button>
        </DialogActions>
      </Dialog>
    )
  }

  it('is a dialog named by its heading, and takes the focus to the field that asks for it', () => {
    render(<Opened onClose={() => {}} />)

    const dialog = screen.getByRole('dialog', { name: 'Zugang anlegen' })

    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.getAttribute('aria-describedby')).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByLabelText('Name'))
  })

  it('takes the focus itself where no field asks for it, and hands it back when it closes', () => {
    const { rerender } = render(<button>Bearbeiten</button>)
    const opener = screen.getByRole('button', { name: 'Bearbeiten' })

    opener.focus()
    rerender(
      <>
        <button>Bearbeiten</button>
        <Dialog title="Zugang bearbeiten" onClose={() => {}}>
          <p>Angaben</p>
        </Dialog>
      </>,
    )

    expect(document.activeElement).toBe(screen.getByRole('dialog'))

    rerender(<button>Bearbeiten</button>)

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Bearbeiten' }))
  })

  it('closes on Escape and not by a tap beside it', async () => {
    const closed: string[] = []
    const user = userEvent.setup()
    const { container } = render(<Opened onClose={() => closed.push('zu')} />)

    // What somebody typed is not thrown away by a slip of the hand.
    await user.click(container.querySelector('[aria-hidden="true"]') as HTMLElement)
    expect(closed).toEqual([])

    await user.keyboard('{Escape}')
    expect(closed).toEqual(['zu'])
  })

  it('leaves Escape to a question that stands above it', async () => {
    const closed: string[] = []
    const user = userEvent.setup()

    render(
      <Dialog title="Zugang bearbeiten" onClose={() => closed.push('dialog')}>
        <Confirm
          open
          title="Gerät abmelden?"
          confirm="Abmelden"
          onConfirm={() => {}}
          onCancel={() => closed.push('frage')}
        >
          Das Gerät muss sich danach neu anmelden.
        </Confirm>
      </Dialog>,
    )

    await user.keyboard('{Escape}')

    expect(closed).toEqual(['frage'])
  })
})

describe('one of a few, all in sight', () => {
  const roles = [
    { value: 'lead', label: 'Leitung', note: 'Alles im Mandanten.' },
    { value: 'member', label: 'Mitglied' },
  ]

  it('is a group named by what is chosen, with an option named by its label and described by its sentence', () => {
    render(<Choice label="Rolle" options={roles} value="member" onChange={() => {}} />)

    const group = screen.getByRole('group', { name: 'Rolle' })
    const leading = within(group).getByRole('radio', { name: 'Leitung' })

    expect(
      document.getElementById(leading.getAttribute('aria-describedby') ?? '')?.textContent,
    ).toBe('Alles im Mandanten.')
    expect(
      within(group).getByRole('radio', { name: 'Mitglied' }).hasAttribute('aria-describedby'),
    ).toBe(false)
    expect(
      within(group)
        .getAllByRole('radio')
        .map((radio) => (radio as HTMLInputElement).checked),
    ).toEqual([false, true])
  })

  it('says which one was picked, and has none picked where none is', async () => {
    const picked: string[] = []
    const user = userEvent.setup()

    render(
      <Choice
        label="Rolle"
        options={roles}
        value={null}
        onChange={(value) => picked.push(value)}
      />,
    )

    expect(
      screen.getAllByRole('radio').map((radio) => (radio as HTMLInputElement).checked),
    ).toEqual([false, false])

    // The whole card is the target, not only the dot.
    await user.click(screen.getByText('Alles im Mandanten.'))

    expect(picked).toEqual(['lead'])
  })
})
