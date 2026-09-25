import { render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { Button, IconButton } from './button.js'
import { Confirm } from './confirm.js'
import { Field } from './field.js'
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
