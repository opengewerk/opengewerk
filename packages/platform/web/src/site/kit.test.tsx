import { render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'

import { InRouter } from '../in-router.js'
import { actionBarMark, ActionSlotProvider, SiteActionBar, SiteNoTabs } from './action-bar.js'
import {
  NotSent,
  SiteAnchor,
  SiteFacts,
  SiteLink,
  SiteRow,
  SiteRows,
  SiteTrouble,
  TitleCount,
  TopTitle,
} from './kit.js'

/**
 * The pieces a screen on site is built from (#219): what a reader gets from
 * them, and where the bar at the foot of a form is drawn.
 */

async function shown(node: ReactNode) {
  const result = render(
    <InRouter>
      <div data-testid="shown">{node}</div>
    </InRouter>,
  )

  await screen.findByTestId('shown')

  return result
}

describe('the pieces of a screen on site', () => {
  it('give a screen of the tabs its one title, with what is counted beside it', () => {
    render(<TopTitle over="Heute" title="Notizen" right={<TitleCount count={3} label="offen" />} />)

    expect(screen.getAllByRole('heading')).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Notizen')
    expect(screen.getByText('Heute')).toBeTruthy()
    expect(screen.getByText('3')).toBeTruthy()
    expect(screen.getByText('offen')).toBeTruthy()
  })

  it('write the facts of a record as terms with their values', () => {
    render(
      <SiteFacts
        facts={[
          { label: 'Raum', value: 'Werkstatt' },
          { label: 'Telefon', value: <SiteAnchor href="tel:+49621123">0621 123</SiteAnchor> },
        ]}
      />,
    )

    expect(screen.getAllByRole('term').map((term) => term.textContent)).toEqual(['Raum', 'Telefon'])
    expect(screen.getAllByRole('definition').map((value) => value.textContent)).toEqual([
      'Werkstatt',
      '0621 123',
    ])
    expect(screen.getByRole('link', { name: '0621 123' }).getAttribute('href')).toBe(
      'tel:+49621123',
    )
  })

  it('list rows to tap as links, each with its line and its state', async () => {
    await shown(
      <SiteRows label="Notizen">
        <SiteRow to="/notizen/n-1" title="Leiter im Flur" meta="Werkstatt" right={<NotSent />} />
        <SiteRow to="/notizen/n-2" title="Schlüssel fehlt" />
      </SiteRows>,
    )

    const rows = within(screen.getByRole('list', { name: 'Notizen' })).getAllByRole('link')

    expect(rows.map((row) => row.getAttribute('href'))).toEqual(['/notizen/n-1', '/notizen/n-2'])
    expect(rows[0]?.textContent).toBe('Leiter im FlurWerkstattnoch nicht übertragen')
    expect(rows[1]?.textContent).toBe('Schlüssel fehlt')
  })

  it('link to a screen of the site, and say what went wrong to a reader at once', async () => {
    await shown(
      <>
        <SiteLink to="/notizen/n-1">Zur Notiz</SiteLink>
        <SiteTrouble>Das ging nicht.</SiteTrouble>
      </>,
    )

    expect(screen.getByRole('link', { name: 'Zur Notiz' }).getAttribute('href')).toBe(
      '/notizen/n-1',
    )
    expect(screen.getByRole('alert').textContent).toBe('Das ging nicht.')
  })
})

describe('the bar at the foot of a form', () => {
  /** A shell as the site has one: a place for the bar, apart from the screen. */
  function WithSlot({ children }: { readonly children: ReactNode }) {
    const [slot, setSlot] = useState<HTMLElement | null>(null)

    return (
      <ActionSlotProvider value={slot}>
        <main>{children}</main>
        <div data-testid="slot" ref={setSlot} />
      </ActionSlotProvider>
    )
  }

  it('is drawn into the place the shell has for it, with the sentence under its buttons', async () => {
    render(
      <WithSlot>
        <p>Formular</p>
        <SiteActionBar note="Die Notiz bleibt auf diesem Gerät, bis sie übertragen ist.">
          <button type="button">Speichern</button>
        </SiteActionBar>
      </WithSlot>,
    )

    const slot = screen.getByTestId('slot')

    expect(await within(slot).findByRole('button', { name: 'Speichern' })).toBeTruthy()
    expect(within(slot).getByText(/bleibt auf diesem Gerät/)).toBeTruthy()
    expect(within(screen.getByRole('main')).queryByRole('button')).toBeNull()
    // What the shell asks the page for, to hide the tabs while a bar stands.
    expect(slot.querySelector(`[${actionBarMark}]`)).not.toBeNull()
  })

  it('stands in place where no shell is around it, with its buttons to be pressed', () => {
    render(
      <SiteActionBar>
        <button type="button">Speichern</button>
      </SiteActionBar>,
    )

    expect(screen.getByRole('button', { name: 'Speichern' })).toBeTruthy()
  })

  it('can be no bar at all and still take the tabs away, for a step of a flow', async () => {
    const { container } = render(
      <WithSlot>
        <SiteNoTabs />
      </WithSlot>,
    )

    const slot = screen.getByTestId('slot')

    await waitFor(() => {
      expect(slot.querySelector(`[${actionBarMark}]`)).not.toBeNull()
    })
    expect(slot.textContent).toBe('')
    expect(container.querySelector('main')?.querySelector(`[${actionBarMark}]`)).toBeNull()
  })
})
