import 'fake-indexeddb/auto'

import type { SyncConflict } from '@opengewerk/platform-domain'
import { act, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { Archive, PackageOpen, StickyNote } from 'lucide-react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Button } from '../components/button.js'
import { aTenant, inFrame, signedIn, standInServer } from '../in-frame.js'
import type { InFrame, StandIn } from '../in-frame.js'
import { entryChoiceKey } from '../shell/entry.js'
import { offerUpdate } from '../shell/updates.js'
import { TestServer } from '../sync/test-server.js'
import { SiteActionBar } from './action-bar.js'
import { SiteFrame } from './frame.js'
import type { SiteFrameProps, SiteTab } from './frame.js'
import { SiteHeader } from './header.js'

/**
 * What every screen on site sits in: the strips, the header of a screen, the
 * tabs where the thumb is, and the menu behind the last of them.
 *
 * Which places the tabs lead to is the application's to say (ADR 0010); the
 * conflicts and the menu the frame adds. The application in these tests
 * belongs to nobody.
 */

const tabs: readonly SiteTab[] = [
  { to: '/', label: 'Regale', icon: Archive, also: ['/regale'] },
  { to: '/pakete', label: 'Pakete', icon: PackageOpen, also: ['/sendungen'] },
  { to: '/notizen', label: 'Notizen', icon: StickyNote },
]

const screens = {
  '/': () => <h1>Regale</h1>,
  '/regale/$shelfId': () => (
    <SiteHeader
      title="Regal am Fenster"
      sub="Reihe 4"
      back={{ to: '/', label: 'Zurück zu den Regalen' }}
    />
  ),
  '/regale/$shelfId/notiz': () => (
    <>
      <SiteHeader title="Notiz" />
      <SiteActionBar>
        <Button tone="primary">Speichern</Button>
      </SiteActionBar>
    </>
  ),
  '/pakete': () => <h1>Pakete</h1>,
  '/sendungen/$parcelId': () => <h1>Eine Sendung</h1>,
  '/notizen': () => <h1>Notizen</h1>,
  '/konflikte': () => <h1>Konflikte</h1>,
  '/konflikte/$conflictId': () => <h1>Ein Konflikt</h1>,
  '/anderswo': () => <h1>Anderswo</h1>,
}

let server: StandIn

function frame(props: Partial<SiteFrameProps> = {}, options: InFrame = {}) {
  return inFrame(() => <SiteFrame tabs={tabs} {...props} />, { screens, ...options })
}

/** The tabs at the bottom and the rail of a tablet: the same places twice, in the order of the page. */
async function places(): Promise<readonly [HTMLElement, HTMLElement]> {
  await screen.findByRole('heading', { level: 1 })

  const [rail, bottom] = screen.getAllByRole('navigation', { name: 'Bereiche' })

  if (!rail || !bottom) {
    throw new Error('The places stand twice, as a rail and at the bottom.')
  }

  return [rail, bottom]
}

/**
 * What a reader hears a place called, with a star at the one that is lit.
 *
 * Lit is said twice, to a reader and to the eye, and the two have to agree:
 * the router marks a link to the address one is at by itself, so a reader
 * could be told what the eye is not shown. A place that is only one of the
 * two comes back with a question mark, which no test expects.
 */
function heard(nav: HTMLElement): string[] {
  return [
    ...within(nav)
      .getAllByRole('link')
      .map((link) => {
        const said = link.getAttribute('aria-current') === 'page'
        const drawn = link.className.split(' ').includes('text-copper-text')

        return `${link.getAttribute('aria-label') ?? link.textContent}${
          said && drawn ? ' *' : said || drawn ? ' ?' : ''
        }`
      }),
    ...within(nav)
      .getAllByRole('button')
      .map((button) => `[${button.textContent}]`),
  ]
}

function withConflicts(count: number): TestServer {
  return Object.assign(new TestServer(), {
    conflicts: () =>
      Promise.resolve(
        Array.from({ length: count }, (_, index) => ({
          id: `c-${String(index)}`,
        })) as unknown as SyncConflict[],
      ),
  })
}

beforeEach(() => {
  globalThis.localStorage.clear()
  delete document.documentElement.dataset['theme']
  server = standInServer()
  signedIn(server, [aTenant({ roleLabels: ['Leitung', 'Mitglied'] })])
  vi.spyOn(globalThis.location, 'assign').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('the places on site', () => {
  it('are those of the application, then the conflicts and the menu, at the bottom and as a rail', async () => {
    await frame()

    const [rail, bottom] = await places()
    const expected = ['Regale *', 'Pakete', 'Notizen', 'Konflikte', '[Menü]']

    expect(heard(bottom)).toEqual(expected)
    expect(heard(rail)).toEqual(expected)
    expect(
      within(bottom)
        .getAllByRole('link')
        .map((link) => link.getAttribute('href')),
    ).toEqual(['/', '/pakete', '/notizen', '/konflikte'])
  })

  it.each([
    ['/', 'Regale'],
    // A place stays lit on the screens it leads on to, by the paths it names.
    ['/regale/s-1', 'Regale'],
    ['/pakete', 'Pakete'],
    ['/sendungen/p-1', 'Pakete'],
    ['/notizen', 'Notizen'],
    ['/konflikte', 'Konflikte'],
    ['/konflikte/c-1', 'Konflikte'],
  ])('light at %s the place %s and no other', async (at, lit) => {
    await frame({}, { at })

    for (const nav of await places()) {
      expect(heard(nav).filter((place) => /[*?]$/.test(place))).toEqual([`${lit} *`])
    }
  })

  it('light nothing on a screen no place leads to', async () => {
    await frame({}, { at: '/anderswo' })

    const [, bottom] = await places()

    // The first place lives at the root, and every path starts with that.
    expect(heard(bottom).filter((place) => /[*?]$/.test(place))).toEqual([])
  })

  it.each([
    [1, 'Konflikte, einer wartet'],
    [3, 'Konflikte, 3 warten'],
  ])(
    'carry %i waiting on the conflicts as a figure, in words for a reader',
    async (count, name) => {
      await frame({}, { server: withConflicts(count) })

      for (const nav of await places()) {
        const link = await within(nav).findByRole('link', { name })

        // Drawn and not read: a reader would hear the figure after the label.
        expect(within(link).getByText(String(count)).getAttribute('aria-hidden')).toBe('true')
      }
    },
  )

  it('carry no figure while nothing waits', async () => {
    await frame()

    const [, bottom] = await places()

    expect(within(bottom).getByRole('link', { name: 'Konflikte' }).textContent).toBe('Konflikte')
  })
})

describe('what stands over a screen on site', () => {
  /**
   * In the order of the boards: what the strips say, then the header of the
   * screen, then what the application keeps in view on every screen, then the
   * screen. The header is written by the screen and drawn up here.
   */
  it('is the strips, the header of the screen and what the application keeps in view, in that order', async () => {
    // A desk on the entry for a hand is offered the other entry.
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(any-pointer: fine)',
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
    offerUpdate(() => {})

    await frame(
      { underHeader: <section aria-label="Läuft">Die Zählung läuft seit 07:30.</section> },
      { at: '/regale/s-1', server: withConflicts(1) },
    )
    await screen.findByRole('heading', { name: 'Regal am Fenster' })
    await screen.findByText(/Ein Konflikt wartet/)
    await screen.findByText('Hier bleiben')

    const text = document.body.textContent
    const order = [
      'Ein Konflikt wartet',
      'Eine neue Fassung liegt bereit.',
      'Das sieht nach einem Schreibtisch aus.',
      'Regal am Fenster',
      'Die Zählung läuft seit 07:30.',
    ].map((part) => text.indexOf(part))

    expect(order.every((position) => position >= 0)).toBe(true)
    expect(order).toEqual([...order].sort((left, right) => left - right))
    // The header is outside of the screen it was written in.
    expect(within(screen.getByRole('main')).queryByRole('banner')).toBeNull()
    expect(
      within(screen.getAllByRole('alert')[0] as HTMLElement)
        .getByRole('link', { name: 'Ansehen' })
        .getAttribute('href'),
    ).toBe('/konflikte')
  })

  it('follows the way back of a header without leaving the page', async () => {
    const { router } = await frame({}, { at: '/regale/s-1' })

    await userEvent.click(await screen.findByRole('link', { name: 'Zurück zu den Regalen' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/')
    })
    expect(await screen.findByRole('heading', { name: 'Regale' })).toBeTruthy()
    // The screen of a tab has no header of its own.
    expect(screen.queryByRole('banner')).toBeNull()
    expect(globalThis.location.assign).not.toHaveBeenCalled()
  })

  it('is nothing of the application where it keeps nothing in view', async () => {
    await frame()
    await places()

    expect(screen.queryByRole('region', { name: 'Läuft' })).toBeNull()
  })

  it('draws the bar of a form under the screen, where the thumb is', async () => {
    await frame({}, { at: '/regale/s-1/notiz' })

    const save = await screen.findByRole('button', { name: 'Speichern' })

    // Not in the screen that wrote it, and after it in the page.
    expect(screen.getByRole('main').contains(save)).toBe(false)
    expect(
      screen.getByRole('main').compareDocumentPosition(save) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })
})

describe('the menu on site', () => {
  async function opened(): Promise<HTMLElement> {
    const [, bottom] = await places()
    const button = within(bottom).getByRole('button', { name: 'Menü' })

    expect(button.getAttribute('aria-expanded')).toBe('false')
    await userEvent.click(button)
    expect(button.getAttribute('aria-expanded')).toBe('true')

    return screen.getByRole('dialog', { name: 'Menü' })
  }

  it('opens from the last tab with the person, the roles and the tenant, and light and dark', async () => {
    await frame()
    await places()
    expect(screen.queryByRole('dialog')).toBeNull()

    const sheet = await opened()

    expect(sheet.getAttribute('aria-modal')).toBe('true')
    expect(await within(sheet).findByText('Mia Mitglied')).toBeTruthy()
    expect(await within(sheet).findByText('Leitung, Mitglied · Probewerk Nord')).toBeTruthy()
    expect(within(sheet).getByText('MM')).toBeTruthy()
    // A keyboard starts inside, at the way out.
    expect(document.activeElement).toBe(
      within(sheet).getByRole('button', { name: 'Menü schließen' }),
    )

    await userEvent.click(within(sheet).getByRole('button', { name: 'Dunkel' }))

    expect(document.documentElement.dataset['theme']).toBe('dark')
  })

  it('opens from the rail of a tablet as well', async () => {
    await frame()

    const [rail] = await places()

    await userEvent.click(within(rail).getByRole('button', { name: 'Menü' }))

    expect(screen.getByRole('dialog', { name: 'Menü' })).toBeTruthy()
  })

  it('shows what the application adds for this device, before the way to the office', async () => {
    await frame({ menu: <button type="button">Etiketten drucken</button> })

    const sheet = await opened()
    const added = within(sheet).getByRole('button', { name: 'Etiketten drucken' })
    const office = within(sheet).getByRole('link', { name: /Zum Schreibtisch/ })

    expect(added.compareDocumentPosition(office) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(
      within(sheet).getByRole('group', { name: 'Darstellung' }).compareDocumentPosition(added) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('leads to the office in the words of the application, and remembers that choice', async () => {
    await frame()

    const sheet = await opened()
    const office = within(sheet).getByRole('link', { name: /Zum Schreibtisch/ })

    expect(office.getAttribute('href')).toBe('/')
    expect(office.textContent).toBe('Zum SchreibtischMehr Übersicht, für Maus und Tastatur')

    // The page stays where it is: a test has no second document to go to.
    office.addEventListener('click', (event) => {
      event.preventDefault()
    })
    await userEvent.click(office)

    // So the office does not offer the way back the next morning.
    expect(globalThis.localStorage.getItem(entryChoiceKey)).toBe('office')
  })

  it('closes on the cross, on Escape and on a tap beside it', async () => {
    await frame()

    const [, bottom] = await places()
    const button = within(bottom).getByRole('button', { name: 'Menü' })

    await userEvent.click(button)
    await userEvent.click(screen.getByRole('button', { name: 'Menü schließen' }))
    expect(screen.queryByRole('dialog')).toBeNull()

    await userEvent.click(button)
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()

    await userEvent.click(button)

    const beside = screen.getByRole('dialog').firstElementChild

    if (!(beside instanceof HTMLElement)) {
      throw new Error('The menu has nothing beside it.')
    }

    await userEvent.click(beside)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('starts the page again on site once somebody signed out', async () => {
    await frame()
    await userEvent.click(within(await opened()).getByRole('button', { name: 'Abmelden' }))

    await waitFor(() => {
      expect(globalThis.location.assign).toHaveBeenCalledWith('/m/')
    })
  })
})

describe('the focus after a change of screen on site', () => {
  it('stands at the heading of the place somebody goes to', async () => {
    await frame()

    const [, bottom] = await places()

    await userEvent.setup().click(within(bottom).getByRole('link', { name: 'Pakete' }))

    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'Pakete' }))
    })
  })

  /**
   * Below the tabs the title of a screen stands in the header over it, which
   * is not part of the page itself: the frame is asked for the heading, not
   * the content alone.
   */
  it('stands at the title in the header of a screen below the tabs', async () => {
    const { router } = await frame()

    await places()
    await act(() => router.navigate({ to: '/regale/$shelfId', params: { shelfId: 's-1' } }))

    const title = await screen.findByRole('heading', { level: 1, name: 'Regal am Fenster' })

    await waitFor(() => {
      expect(document.activeElement).toBe(title)
    })
    expect(screen.getByRole('banner').contains(title)).toBe(true)
  })
})
