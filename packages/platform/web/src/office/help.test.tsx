import 'fake-indexeddb/auto'

import { act, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { Archive, BookOpen, ListChecks, StickyNote } from 'lucide-react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Dialog } from '../components/dialog.js'
import { inFrame, signedIn, standInServer } from '../in-frame.js'
import type { InFrame } from '../in-frame.js'
import { OfficeFrame } from './frame.js'
import type { OfficeFrameProps } from './frame.js'
import type { HelpSource } from './help.js'
import type { NavigationGroup } from './navigation.js'

/**
 * The help beside a screen (opengewerk-haustechnik#131): the question mark
 * in the header, the entry behind "Menü" where the header has no room, and
 * the drawer with the text of the screen that stands.
 *
 * The texts are the application's. The one in these tests keeps shelves and
 * notes and has a text for the first and none for the second.
 */

const navigation: readonly NavigationGroup[] = [
  {
    title: 'Bestand',
    entries: [
      { to: '/', label: 'Regale', icon: Archive },
      { to: '/notizen', label: 'Notizen', icon: StickyNote },
      { to: '/briefe', label: 'Briefe', icon: StickyNote },
    ],
  },
]

const screens = {
  '/': () => <h1>Regale</h1>,
  '/notizen': () => <h1>Notizen</h1>,
  '/briefe': () => <h1>Briefe</h1>,
  '/hilfe': () => <h1>Kurzanleitungen</h1>,
  '/konflikte': () => <h1>Abgleich</h1>,
  '/einstellungen': () => <h1>Einstellungen</h1>,
}

const texts: Readonly<Record<string, string>> = {
  '/': '# Regale\n\nHier stehen die Regale des Lagers.\n\n## Kurzanleitung\n\n1. Ein Regal anlegen.\n2. Eine Nummer vergeben.',
  '/briefe': '# Briefe\n\nHier liegt die Post.\n\nMehr bei den [Notizen](/notizen).',
}

function source(over: Partial<HelpSource> = {}): HelpSource & { asked: string[] } {
  const asked: string[] = []

  return {
    asked,
    textAt: (pathname) => {
      asked.push(pathname)

      return Promise.resolve(texts[pathname] ?? null)
    },
    ...over,
  }
}

function frame(props: Partial<OfficeFrameProps> = {}, options: InFrame = {}) {
  return inFrame(() => <OfficeFrame navigation={navigation} {...props} />, { screens, ...options })
}

const helpName = 'Hilfe zu dieser Seite'

/** The question mark in the header, once the screen under it stands. */
async function questionMark(): Promise<HTMLElement> {
  await screen.findByRole('heading', { level: 1 })

  return within(screen.getByRole('banner')).getByRole('button', { name: helpName })
}

beforeEach(() => {
  globalThis.localStorage.clear()
  signedIn(standInServer())
  vi.spyOn(globalThis.location, 'assign').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('an office without a help', () => {
  it('has neither the question mark nor the entry behind "Menü"', async () => {
    await frame()
    await screen.findByRole('heading', { level: 1 })

    expect(screen.queryByRole('button', { name: helpName })).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Menü' }))

    expect(
      within(screen.getByRole('dialog', { name: 'Menü' })).queryByRole('button', {
        name: helpName,
      }),
    ).toBeNull()
    expect(screen.queryByRole('complementary', { name: 'Hilfe' })).toBeNull()
  })
})

describe('the question mark in the header', () => {
  it('stands between the search and the person and says that nothing is open', async () => {
    const help = source()

    await frame({ help })

    const button = await questionMark()
    const controls = within(screen.getByRole('banner'))
      .getAllByRole('button')
      .map((found) => found.getAttribute('aria-label') ?? found.textContent)

    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(controls.indexOf(helpName)).toBe(controls.length - 2)
    expect(screen.queryByRole('complementary', { name: 'Hilfe' })).toBeNull()
    // A text is asked for when somebody wants to read it and not before.
    expect(help.asked).toEqual([])
  })

  it('opens the text of the screen that stands, under what the text is called', async () => {
    await frame({ help: source() })

    const button = await questionMark()

    await userEvent.click(button)

    const drawer = screen.getByRole('complementary', { name: 'Hilfe' })

    expect(button.getAttribute('aria-expanded')).toBe('true')
    expect(await within(drawer).findByRole('heading', { level: 2, name: 'Regale' })).toBeTruthy()
    // What the text is called stands once, at the head of the drawer.
    expect(within(drawer).getAllByRole('heading', { name: 'Regale' })).toHaveLength(1)
    expect(within(drawer).getByText('Hier stehen die Regale des Lagers.')).toBeTruthy()
    expect(within(drawer).getByRole('heading', { level: 3, name: 'Kurzanleitung' })).toBeTruthy()
    expect(
      within(drawer)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Ein Regal anlegen.', 'Eine Nummer vergeben.'])
    // A keyboard starts at the way out.
    expect(document.activeElement).toBe(
      within(drawer).getByRole('button', { name: 'Hilfe schließen' }),
    )
  })

  it('leaves the screen in use beside the text', async () => {
    await frame({ help: source() })
    await userEvent.click(await questionMark())

    const drawer = screen.getByRole('complementary', { name: 'Hilfe' })

    expect(drawer.getAttribute('aria-modal')).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('heading', { level: 1, name: 'Regale' })).toBeTruthy()
  })

  it('closes the text again, as do the cross and Escape', async () => {
    await frame({ help: source() })

    const button = await questionMark()

    await userEvent.click(button)
    await userEvent.click(button)

    expect(screen.queryByRole('complementary', { name: 'Hilfe' })).toBeNull()
    expect(button.getAttribute('aria-expanded')).toBe('false')

    await userEvent.click(button)
    await userEvent.click(screen.getByRole('button', { name: 'Hilfe schließen' }))

    expect(screen.queryByRole('complementary', { name: 'Hilfe' })).toBeNull()

    await userEvent.click(button)
    await userEvent.keyboard('{Escape}')

    expect(screen.queryByRole('complementary', { name: 'Hilfe' })).toBeNull()
  })

  it('leaves Escape to a dialog that stands on the screen', async () => {
    const onClose = vi.fn()

    await frame(
      { help: source() },
      {
        screens: {
          ...screens,
          '/': () => (
            <>
              <h1>Regale</h1>
              <Dialog title="Ein Regal anlegen" onClose={onClose}>
                <p>Welche Nummer?</p>
              </Dialog>
            </>
          ),
        },
      },
    )
    await userEvent.click(await questionMark())
    await userEvent.keyboard('{Escape}')

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('complementary', { name: 'Hilfe' })).toBeTruthy()
  })
})

describe('the help while somebody moves on', () => {
  it('follows the address: left open, it shows the text of the next screen', async () => {
    const help = source()
    const { router } = await frame({ help })

    await userEvent.click(await questionMark())

    const drawer = screen.getByRole('complementary', { name: 'Hilfe' })

    await within(drawer).findByRole('heading', { name: 'Regale' })
    await act(() => router.navigate({ to: '/briefe' }))

    expect(await within(drawer).findByRole('heading', { level: 2, name: 'Briefe' })).toBeTruthy()
    expect(within(drawer).getByText('Hier liegt die Post.')).toBeTruthy()
    expect(within(drawer).queryByText('Hier stehen die Regale des Lagers.')).toBeNull()
    expect(help.asked).toEqual(['/', '/briefe'])
  })

  it('says so on a screen the application has no text for, and stays what it is', async () => {
    await frame({ help: source() }, { at: '/notizen' })
    await userEvent.click(await questionMark())

    const drawer = screen.getByRole('complementary', { name: 'Hilfe' })

    expect(
      await within(drawer).findByText('Zu dieser Seite gibt es noch keinen Hilfetext.'),
    ).toBeTruthy()
    expect(within(drawer).getByRole('heading', { level: 2, name: 'Hilfe' })).toBeTruthy()
  })

  it('takes a text the application has at hand as well as one it loads', async () => {
    await frame({ help: { textAt: (pathname) => texts[pathname] ?? null } })
    await userEvent.click(await questionMark())

    expect(
      await within(screen.getByRole('complementary', { name: 'Hilfe' })).findByText(
        'Hier stehen die Regale des Lagers.',
      ),
    ).toBeTruthy()
  })
})

describe('the ways from the help to more', () => {
  it('lists what the application has beyond the screen at the foot of the drawer', async () => {
    await frame({
      help: source({
        more: [
          { to: '/hilfe', label: 'Kurzanleitungen', icon: ListChecks },
          { to: '/hilfe/handbuch', label: 'Handbuch öffnen', icon: BookOpen },
        ],
      }),
    })
    await userEvent.click(await questionMark())

    const links = within(screen.getByRole('complementary', { name: 'Hilfe' })).getAllByRole('link')

    expect(links.map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['Kurzanleitungen', '/hilfe'],
      ['Handbuch öffnen', '/hilfe/handbuch'],
    ])
  })

  it('makes way for what they lead to', async () => {
    await frame({
      help: source({ more: [{ to: '/hilfe', label: 'Kurzanleitungen', icon: ListChecks }] }),
    })
    await userEvent.click(await questionMark())
    await userEvent.click(screen.getByRole('link', { name: 'Kurzanleitungen' }))

    expect(await screen.findByRole('heading', { level: 1, name: 'Kurzanleitungen' })).toBeTruthy()
    expect(screen.queryByRole('complementary', { name: 'Hilfe' })).toBeNull()
  })

  it('has no link where the application names none', async () => {
    await frame({ help: source() })
    await userEvent.click(await questionMark())

    const drawer = screen.getByRole('complementary', { name: 'Hilfe' })

    await within(drawer).findByText('Hier stehen die Regale des Lagers.')

    expect(within(drawer).queryByRole('link')).toBeNull()
  })
})

describe('a link in the text of a screen', () => {
  it('leaves the help beside the screen it leads to, from 1024 pixels on', async () => {
    await frame({ help: source() }, { at: '/briefe' })
    await userEvent.click(await questionMark())

    const drawer = screen.getByRole('complementary', { name: 'Hilfe' })

    await userEvent.click(await within(drawer).findByRole('link', { name: 'Notizen' }))

    expect(await screen.findByRole('heading', { level: 1, name: 'Notizen' })).toBeTruthy()
    expect(screen.getByRole('complementary', { name: 'Hilfe' })).toBeTruthy()
  })

  it('closes the help below, where it lies over the screen', async () => {
    // No width is reached: the window of a phone.
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))

    await frame({ help: source() }, { at: '/briefe' })
    await userEvent.click(await questionMark())
    await userEvent.click(
      await within(screen.getByRole('complementary', { name: 'Hilfe' })).findByRole('link', {
        name: 'Notizen',
      }),
    )

    expect(await screen.findByRole('heading', { level: 1, name: 'Notizen' })).toBeTruthy()
    expect(screen.queryByRole('complementary', { name: 'Hilfe' })).toBeNull()
  })
})

describe('the help behind "Menü"', () => {
  it('is the last entry of the navigation there, closes the menu and opens the text', async () => {
    await frame({ help: source() })
    await screen.findByRole('heading', { level: 1 })
    await userEvent.click(screen.getByRole('button', { name: 'Menü' }))

    const menu = screen.getByRole('dialog', { name: 'Menü' })
    // Everything that can be followed or pressed among the entries, in order;
    // the cross of the menu and light and dark stand outside of them.
    const entries = [
      ...within(menu)
        .getByRole('navigation', { name: 'Hauptbereiche' })
        .querySelectorAll('a, button:not([aria-label]):not([aria-pressed])'),
    ].map((entry) => entry.textContent)

    expect(entries.slice(-3)).toEqual(['Abgleich', 'Einstellungen', helpName])

    await userEvent.click(within(menu).getByRole('button', { name: helpName }))

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Menü' })).toBeNull()
    })
    expect(
      await within(screen.getByRole('complementary', { name: 'Hilfe' })).findByText(
        'Hier stehen die Regale des Lagers.',
      ),
    ).toBeTruthy()
  })
})
