import 'fake-indexeddb/auto'

import type { SyncConflict } from '@opengewerk/platform-domain'
import { act, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { Archive, BookOpen, LayoutDashboard, Mail, StickyNote } from 'lucide-react'
import { useContext } from 'react'
import { createPortal } from 'react-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { aTenant, inFrame, signedIn, standInServer } from '../in-frame.js'
import type { InFrame, StandIn } from '../in-frame.js'
import { probeApplication } from '../probe-application.js'
import { offerUpdate } from '../shell/updates.js'
import { Strip } from '../components/strip.js'
import { TestServer } from '../sync/test-server.js'
import { RequestRefused } from '../sync/transport.js'
import { OfficeFrame } from './frame.js'
import type { OfficeFrameProps } from './frame.js'
import type { NavigationEntry, NavigationGroup } from './navigation.js'
import { PathSlot } from './top-bar.js'

/**
 * What every office screen sits in: the header, the strips, the navigation
 * beside the screen and behind "Menü" on a phone.
 *
 * Which entries the navigation has is the application's to say (ADR 0010),
 * and so is what it is called; the frame adds the two entries at the foot.
 * The application in these tests belongs to nobody: it keeps shelves and
 * notes, and it is called what no application is called.
 */

const navigation: readonly NavigationGroup[] = [
  {
    title: 'Bestand',
    entries: [
      { to: '/', label: 'Regale', icon: Archive, also: ['/regale'] },
      { to: '/notizen', label: 'Notizen', icon: StickyNote, also: ['/zettel'] },
    ],
  },
  { title: 'Post', entries: [{ to: '/briefe', label: 'Briefe', icon: Mail }] },
]

/**
 * What an application puts before its groups and what it visits rather than
 * works in, as one has them whose boards draw an overview on top and a
 * catalogue at the foot (`opengewerk-haustechnik#83`).
 */
const overview: NavigationGroup = {
  entries: [{ to: '/lage', label: 'Lage', icon: LayoutDashboard }],
}
const ownFoot: readonly NavigationEntry[] = [
  { to: '/verzeichnis', label: 'Verzeichnis', icon: BookOpen },
]

const screens = {
  '/': () => <h1>Regale</h1>,
  '/regale/$shelfId': () => <h1>Ein Regal</h1>,
  '/notizen': () => <h1>Notizen</h1>,
  '/notizen/$noteId': () => <h1>Eine Notiz</h1>,
  '/zettel/$noteId': () => <h1>Ein Zettel</h1>,
  '/briefe': () => <h1>Briefe</h1>,
  '/lage': () => <h1>Lage</h1>,
  '/verzeichnis': () => <h1>Verzeichnis</h1>,
  '/konflikte': () => <h1>Abgleich</h1>,
  '/konto': () => <h1>Konto</h1>,
  '/instanz': () => <h1>Instanz</h1>,
  '/einstellungen': () => <h1>Einstellungen</h1>,
  '/einstellungen/notizen': () => <h1>Notizen einstellen</h1>,
}

let server: StandIn

function frame(props: Partial<OfficeFrameProps> = {}, options: InFrame = {}) {
  return inFrame(() => <OfficeFrame navigation={navigation} {...props} />, { screens, ...options })
}

/** The navigation beside the screen, once the screen under it stands. */
async function sidebar(): Promise<HTMLElement> {
  await screen.findByRole('heading', { level: 1 })

  return screen.getByRole('navigation', { name: 'Hauptbereiche' })
}

/**
 * The links of a navigation with what a reader hears, in order, and a star at
 * the one that is lit.
 *
 * Lit is said twice, to a reader and to the eye, and the two have to agree:
 * the router marks a link to the address one is at by itself, so a reader
 * could be told what the eye is not shown. An entry that is only one of the
 * two comes back with a question mark, which no test expects.
 */
function entries(nav: HTMLElement): string[] {
  return within(nav)
    .getAllByRole('link')
    .map((link) => {
      const said = link.getAttribute('aria-current') === 'page'
      const drawn = link.className.split(' ').includes('bg-ink')

      return `${link.getAttribute('aria-label') ?? link.textContent}${
        said && drawn ? ' *' : said || drawn ? ' ?' : ''
      }`
    })
}

/** What stands over the entries in small capitals: the titles of the groups, and whatever else is set like them. */
function titles(nav: HTMLElement): (string | null)[] {
  return [...nav.querySelectorAll('div')]
    .filter((element) => element.className.split(' ').includes('uppercase'))
    .map((element) => element.textContent)
}

/** A server with this many conflicts waiting. */
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
  signedIn(server)
  vi.spyOn(globalThis.location, 'assign').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('the header of the office', () => {
  it('names the application, the tenant and the person, and leads to the first screen from the mark', async () => {
    await frame({}, { at: '/notizen' })

    const header = await screen.findByRole('banner')

    expect(within(header).getByRole('link', { name: 'Probewerk' }).getAttribute('href')).toBe('/')
    expect(await within(header).findByText('Probewerk Nord')).toBeTruthy()
    expect(
      await within(header).findByRole('button', { name: 'Mia Mitglied, Konto und Darstellung' }),
    ).toBeTruthy()
    // Two letters for the round badge, and the name beside it.
    // The initials are drawn from an attribute, so that no text stands in front of the name.
    expect(header.querySelector('[data-initials="MM"]')?.textContent).toBe('')
  })

  it('shows no strip while there is nothing to do, and says under the exchange that everything arrived', async () => {
    await frame()

    const nav = await sidebar()

    await within(nav).findByText('Abgeglichen, gerade eben')
    // Neither the strip of the exchange nor an offer.
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('lets a keyboard reach the screen before the navigation', async () => {
    await frame()
    await screen.findByRole('heading', { level: 1 })

    const jump = screen.getByRole('link', { name: 'Zum Inhalt springen' })

    expect(jump.getAttribute('href')).toBe('#inhalt')
    expect(screen.getByRole('main').id).toBe('inhalt')
    // The first link of the page: Tab reaches it before anything else.
    expect(screen.getAllByRole('link')[0]).toBe(jump)
  })
})

describe('the person in the header', () => {
  const person = { name: 'Mia Mitglied, Konto und Darstellung' }

  it('opens with who it is and in which roles, light and dark, the account and the sign out', async () => {
    signedIn(server, [aTenant({ roleLabels: ['Leitung', 'Mitglied'] })])
    await frame()

    const button = await screen.findByRole('button', person)

    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('link', { name: 'Konto' })).toBeNull()

    await userEvent.click(button)

    expect(button.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('mia@nord.example.de · Leitung, Mitglied')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Konto' }).getAttribute('href')).toBe('/konto')
    expect(screen.getByRole('button', { name: 'Abmelden' })).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: 'Dunkel' }))

    expect(document.documentElement.dataset['theme']).toBe('dark')
  })

  it('shows the address alone until the roles are known', async () => {
    // The account answers, the list of tenants does not.
    server.answer('GET', '/auth/tenants', {}, 500)
    await frame()
    await userEvent.click(await screen.findByRole('button', person))

    expect(screen.getByText('mia@nord.example.de')).toBeTruthy()
  })

  it('closes on Escape, on a click outside and when a link is followed', async () => {
    const { router } = await frame()
    const button = await screen.findByRole('button', person)
    const open = () => screen.queryByRole('button', { name: 'Abmelden' })

    await userEvent.click(button)
    expect(open()).toBeTruthy()
    await userEvent.keyboard('{Escape}')
    expect(open()).toBeNull()

    await userEvent.click(button)
    expect(open()).toBeTruthy()
    await userEvent.click(screen.getByRole('heading', { level: 1 }))
    expect(open()).toBeNull()

    await userEvent.click(button)
    // A click inside the panel leaves it open.
    await userEvent.click(screen.getByText('Darstellung'))
    expect(open()).toBeTruthy()
    await userEvent.click(screen.getByRole('link', { name: 'Konto' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/konto')
    })
    expect(open()).toBeNull()
  })

  it('offers the area of the instance to somebody who runs it', async () => {
    server.answer('GET', '/instance/access', { operator: true, secondFactor: true })
    const { router } = await frame()

    await userEvent.click(await screen.findByRole('button', person))
    await userEvent.click(await screen.findByRole('link', { name: 'Instanz verwalten' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/instanz')
    })
    expect(screen.queryByRole('button', { name: 'Abmelden' })).toBeNull()
  })

  it('offers it to nobody else', async () => {
    server.answer('GET', '/instance/access', { operator: false, secondFactor: false })
    await frame()
    await userEvent.click(await screen.findByRole('button', person))

    await waitFor(() => {
      expect(server.heard.some((call) => call.path === '/instance/access')).toBe(true)
    })
    // The answer has arrived by now, and the entry would stand.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(screen.queryByRole('link', { name: 'Instanz verwalten' })).toBeNull()
  })

  it('does not ask who runs the instance before an account is known', async () => {
    server.answer('GET', '/api/auth/get-session', null)
    await frame()
    await screen.findByRole('button', { name: 'Konto und Darstellung' })
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(server.heard.some((call) => call.path === '/instance/access')).toBe(false)
  })

  it('starts the page again at the office once somebody signed out', async () => {
    await frame()
    await userEvent.click(await screen.findByRole('button', person))
    await userEvent.click(screen.getByRole('button', { name: 'Abmelden' }))

    await waitFor(() => {
      expect(globalThis.location.assign).toHaveBeenCalledWith('/')
    })
  })
})

describe('the navigation beside the screen', () => {
  it('lists the groups of the application under their titles, and the exchange and the settings at the foot', async () => {
    await frame()

    const nav = await sidebar()

    await within(nav).findByRole('link', { name: 'Einstellungen' })
    expect(entries(nav)).toEqual(['Regale *', 'Notizen', 'Briefe', 'Abgleich', 'Einstellungen'])
    expect(within(nav).getByText('Bestand')).toBeTruthy()
    expect(within(nav).getByText('Post')).toBeTruthy()
    expect(within(nav).getByRole('link', { name: 'Notizen' }).getAttribute('href')).toBe('/notizen')
    expect(within(nav).getByRole('link', { name: 'Abgleich' }).getAttribute('href')).toBe(
      '/konflikte',
    )
    expect(within(nav).getByRole('link', { name: 'Einstellungen' }).getAttribute('href')).toBe(
      '/einstellungen',
    )
  })

  it('leaves out a group without an entry, with its title', async () => {
    await frame({
      navigation: [{ title: 'Leer', entries: [] }, ...navigation],
    })

    const nav = await sidebar()

    expect(within(nav).queryByText('Leer')).toBeNull()
    expect(within(nav).getByText('Bestand')).toBeTruthy()
  })

  it('puts the entries of a group without a title first, with no title over them', async () => {
    await frame({ navigation: [overview, ...navigation] })

    const nav = await sidebar()

    await within(nav).findByRole('link', { name: 'Einstellungen' })
    expect(entries(nav)).toEqual([
      'Lage',
      'Regale *',
      'Notizen',
      'Briefe',
      'Abgleich',
      'Einstellungen',
    ])
    // The entry is the first thing in the navigation: no empty title, and no
    // room for one, stands before it.
    expect(nav.firstElementChild).toBe(within(nav).getByRole('link', { name: 'Lage' }))
    expect(titles(nav)).toEqual(['Bestand', 'Post'])
  })

  it('puts what the application has at the foot before the exchange and the settings, as quiet as they are', async () => {
    await frame({ foot: ownFoot })

    const nav = await sidebar()

    await within(nav).findByRole('link', { name: 'Einstellungen' })
    expect(entries(nav)).toEqual([
      'Regale *',
      'Notizen',
      'Briefe',
      'Verzeichnis',
      'Abgleich',
      'Einstellungen',
    ])

    const quiet = (name: string) =>
      within(nav).getByRole('link', { name }).className.split(' ').includes('text-ink-muted')

    expect(['Notizen', 'Verzeichnis', 'Abgleich', 'Einstellungen'].map(quiet)).toEqual([
      false,
      true,
      true,
      true,
    ])
  })

  it('lights an entry of the application at the foot on its own screen', async () => {
    await frame({ foot: ownFoot }, { at: '/verzeichnis' })

    const nav = await sidebar()

    await within(nav).findByRole('link', { name: 'Einstellungen' })
    expect(entries(nav).filter((entry) => /[*?]$/.test(entry))).toEqual(['Verzeichnis *'])
  })

  it.each([
    ['/', 'Regale'],
    // A record lights the list it is opened from, by the path the entry names besides.
    ['/regale/s-1', 'Regale'],
    ['/notizen', 'Notizen'],
    ['/notizen/n-1', 'Notizen'],
    ['/zettel/n-1', 'Notizen'],
    ['/briefe', 'Briefe'],
    ['/konflikte', 'Abgleich'],
    ['/einstellungen', 'Einstellungen'],
    ['/einstellungen/notizen', 'Einstellungen'],
  ])('lights at %s the entry %s and no other', async (at, lit) => {
    await frame({}, { at })

    const nav = await sidebar()

    await within(nav).findByRole('link', { name: 'Einstellungen' })
    expect(entries(nav).filter((entry) => /[*?]$/.test(entry))).toEqual([`${lit} *`])
  })

  it('lights nothing on a screen no entry leads to', async () => {
    await frame({}, { at: '/konto' })

    const nav = await sidebar()

    // The first entry lives at the root, and every path starts with that.
    expect(entries(nav).filter((entry) => /[*?]$/.test(entry))).toEqual([])
  })

  it('shows what waits beside an entry as a figure, and says it in words in the name of the link', async () => {
    await frame({
      navigation: [
        {
          title: 'Bestand',
          entries: [
            {
              to: '/notizen',
              label: 'Notizen',
              icon: StickyNote,
              badge: { value: 3, tone: 'waiting', spoken: '3 ungelesen' },
            },
          ],
        },
      ],
    })

    const link = within(await sidebar()).getByRole('link', { name: 'Notizen, 3 ungelesen' })

    // The figure is drawn and not read: a reader would hear "Notizen3".
    expect(within(link).getByText('3').getAttribute('aria-hidden')).toBe('true')
  })

  it.each([
    [1, 'Abgleich, ein Konflikt'],
    [3, 'Abgleich, 3 Konflikte'],
  ])(
    'counts %i waiting beside the exchange, and says no more under it then',
    async (count, name) => {
      await frame({}, { server: withConflicts(count) })

      const nav = await sidebar()
      const link = await within(nav).findByRole('link', { name })

      expect(within(link).getByText(String(count))).toBeTruthy()
      // The figure and the strip over the page say it; a line under the entry
      // would say it a third time.
      expect(within(nav).queryByText(/Abgeglichen|Noch nicht|Keine Verbindung/)).toBeNull()
    },
  )

  it('says under the exchange that nothing gets through, and nothing of a figure', async () => {
    const offline = new TestServer()

    offline.offline = true
    await frame({}, { server: offline })

    const nav = await sidebar()

    expect(await within(nav).findByText('Keine Verbindung')).toBeTruthy()
    expect(within(nav).getByRole('link', { name: 'Abgleich' })).toBeTruthy()
  })

  /**
   * The line was asked whether the last attempt left a reason behind, and a
   * server that answered and refused leaves one as well: "Keine Verbindung"
   * stood under the exchange on a device that had one (#545).
   */
  it('says under the exchange that the server refused it, and not that the connection is missing', async () => {
    const refusing = Object.assign(new TestServer(), {
      pull: () => Promise.reject(new RequestRefused(403, 'Abgleichen darf dieser Zugang nicht.')),
    })

    await frame({}, { server: refusing })

    const nav = await sidebar()
    const line = await within(nav).findByText('Abgleich abgelehnt')

    // Red, because somebody has to do something about it.
    expect(line.className).toContain('text-conflict')
    expect(within(nav).queryByText('Keine Verbindung')).toBeNull()
  })

  it('stays quiet under the exchange over a change the server refused at its own route', async () => {
    const refusing = Object.assign(new TestServer(), {
      patch: () =>
        Promise.reject(new RequestRefused(403, 'Regale ändern darf dieser Zugang nicht.')),
    })

    refusing.put('shelves', { id: 's-1', name: 'Halle' })

    const { client } = await frame({}, { server: refusing })
    const nav = await sidebar()

    await within(nav).findByText('Abgeglichen, gerade eben')
    await act(() => client.update('shelves', 's-1', { name: 'Halle, links' }))

    // What was refused is the change, and its sentence stands at the form.
    // The exchange went through a moment ago and goes on as it did.
    expect(client.status().troubleKind).toBe('change_refused')
    expect(within(nav).getByText('Abgeglichen, gerade eben').className).toContain('text-ink-faint')
    expect(within(nav).queryByText(/Abgleich abgelehnt|Keine Verbindung/)).toBeNull()
  })

  it('offers the settings only to somebody who may read one of them', async () => {
    // An application whose settings all take a right, and somebody without it.
    const guarded = probeApplication({
      settings: probeApplication().settings.filter((entry) => entry.right !== undefined),
    })

    await frame({}, { application: guarded })

    const nav = await sidebar()

    // The rights have arrived once the tenant stands in the header.
    await within(screen.getByRole('banner')).findByText('Probewerk Nord')
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(entries(nav)).toEqual(['Regale *', 'Notizen', 'Briefe', 'Abgleich'])
  })

  it('offers them to somebody who holds the right of one', async () => {
    const guarded = probeApplication({
      settings: probeApplication().settings.filter((entry) => entry.right !== undefined),
    })

    signedIn(server, [aTenant({ rights: ['shelf.settings'] })])
    await frame({}, { application: guarded })

    expect(await within(await sidebar()).findByRole('link', { name: 'Einstellungen' })).toBeTruthy()
  })
})

describe('the navigation on a phone', () => {
  it('opens behind "Menü" with the application, the tenant, the same entries and light and dark', async () => {
    await frame({}, { at: '/notizen' })

    const menu = await screen.findByRole('button', { name: 'Menü' })

    expect(menu.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('dialog')).toBeNull()

    await within(screen.getByRole('banner')).findByText('Probewerk Nord')
    await userEvent.click(menu)

    const drawer = screen.getByRole('dialog', { name: 'Menü' })

    expect(menu.getAttribute('aria-expanded')).toBe('true')
    expect(drawer.getAttribute('aria-modal')).toBe('true')
    expect(within(drawer).getByText('Probewerk')).toBeTruthy()
    expect(within(drawer).getByText('Probewerk Nord')).toBeTruthy()
    expect(entries(within(drawer).getByRole('navigation', { name: 'Hauptbereiche' }))).toEqual([
      'Regale',
      'Notizen *',
      'Briefe',
      'Abgleich',
      'Einstellungen',
    ])
    expect(within(drawer).getByRole('group', { name: 'Darstellung' })).toBeTruthy()
    // A keyboard starts inside, at the way out.
    expect(document.activeElement).toBe(
      within(drawer).getByRole('button', { name: 'Menü schließen' }),
    )
  })

  it('carries the entries before the groups and those of the application at the foot as well', async () => {
    await frame({ navigation: [overview, ...navigation], foot: ownFoot }, { at: '/notizen' })

    const menu = await screen.findByRole('button', { name: 'Menü' })

    await within(screen.getByRole('banner')).findByText('Probewerk Nord')
    await userEvent.click(menu)

    const nav = within(screen.getByRole('dialog', { name: 'Menü' })).getByRole('navigation', {
      name: 'Hauptbereiche',
    })

    expect(entries(nav)).toEqual([
      'Lage',
      'Regale',
      'Notizen *',
      'Briefe',
      'Verzeichnis',
      'Abgleich',
      'Einstellungen',
    ])
    // No empty title over the first entry, in the drawer either.
    expect(titles(nav)).toEqual(['Bestand', 'Post', 'Darstellung'])
  })

  it('closes when an entry is followed', async () => {
    const { router } = await frame()

    await userEvent.click(await screen.findByRole('button', { name: 'Menü' }))
    await userEvent.click(
      within(screen.getByRole('dialog', { name: 'Menü' })).getByRole('link', { name: 'Briefe' }),
    )

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/briefe')
    })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('closes on Escape, on the cross and on a tap beside it', async () => {
    await frame()

    const menu = await screen.findByRole('button', { name: 'Menü' })

    await userEvent.click(menu)
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()

    await userEvent.click(menu)
    await userEvent.click(screen.getByRole('button', { name: 'Menü schließen' }))
    expect(screen.queryByRole('dialog')).toBeNull()

    await userEvent.click(menu)

    const beside = screen.getByRole('dialog').firstElementChild

    if (!(beside instanceof HTMLElement)) {
      throw new Error('The menu has nothing beside it.')
    }

    await userEvent.click(beside)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('a screen that is worked in', () => {
  /** A screen that puts its path into the header where it is given a place. */
  function Worked() {
    const slot = useContext(PathSlot)

    return (
      <>
        <h1>Ein Regal</h1>
        {slot ? createPortal(<span>Lager / Reihe 4</span>, slot) : <p>kein Platz</p>}
      </>
    )
  }

  it('takes the width of the navigation and puts its path into the header, in place of the tenant', async () => {
    await frame({ focus: true }, { screens: { '/': Worked } })

    const header = await screen.findByRole('banner')

    expect(await within(header).findByText('Lager / Reihe 4')).toBeTruthy()
    expect(screen.queryByRole('navigation', { name: 'Hauptbereiche' })).toBeNull()
    // The person stays, and so does the way to the navigation on a phone.
    await within(header).findByRole('button', { name: 'Mia Mitglied, Konto und Darstellung' })
    expect(within(header).queryByText('Probewerk Nord')).toBeNull()
    expect(within(header).getByRole('button', { name: 'Menü' })).toBeTruthy()
  })

  it('is given no place while the navigation stands', async () => {
    await frame({}, { screens: { '/': Worked } })

    expect(await screen.findByText('kein Platz')).toBeTruthy()
    expect(screen.getByRole('navigation', { name: 'Hauptbereiche' })).toBeTruthy()
  })
})

describe('the strips over an office screen', () => {
  /**
   * In the order of the board of the strips: what cannot wait first, the
   * offers last. What the application adds stands with what cannot wait.
   */
  it('stand between the header and the screen: the exchange, what the application adds, a new version, the other entry', async () => {
    // A device with only a finger is offered the other entry.
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(pointer: coarse)',
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
    offerUpdate(() => {})

    await frame(
      {
        strips: (
          <Strip tone="conflict" urgent>
            Das Lager ist seit gestern nicht gezählt.
          </Strip>
        ),
      },
      { server: withConflicts(1) },
    )
    await screen.findByText('Hier bleiben')
    await screen.findByText(/Ein Konflikt wartet/)

    const text = document.body.textContent
    const order = [
      'Menü',
      'Ein Konflikt wartet',
      'Das Lager ist seit gestern nicht gezählt.',
      'Eine neue Fassung liegt bereit.',
      'Das sieht nach einem Gerät für unterwegs aus.',
      'Bestand',
    ].map((part) => text.indexOf(part))

    expect(order.every((position) => position >= 0)).toBe(true)
    expect(order).toEqual([...order].sort((left, right) => left - right))
    // The strip of the exchange leads to where a conflict is decided.
    expect(
      within(screen.getAllByRole('alert')[0] as HTMLElement)
        .getByRole('link', { name: 'Ansehen' })
        .getAttribute('href'),
    ).toBe('/konflikte')
  })
})

describe('the focus after a change of screen in the office', () => {
  /**
   * The frame swaps the screen without loading a document, and the focus
   * stayed on the link that led there: a reader heard nothing of the new
   * screen, and Tab went through the navigation once more.
   */
  it('stands at the heading of the screen somebody goes to from the navigation', async () => {
    await frame()

    const nav = await sidebar()

    await userEvent.setup().click(within(nav).getByRole('link', { name: 'Notizen' }))

    const heading = await screen.findByRole('heading', { level: 1, name: 'Notizen' })

    await waitFor(() => {
      expect(document.activeElement).toBe(heading)
    })
    // Reached by the frame and by no Tab.
    expect(heading.getAttribute('tabindex')).toBe('-1')
  })

  it('stands at the heading after the menu of a phone led there as well', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
    await frame()

    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Menü' }))
    await user.click(
      within(screen.getByRole('dialog', { name: 'Menü' })).getByRole('link', { name: 'Notizen' }),
    )

    // The menu has closed, and the link in it is gone with it.
    await waitFor(() => {
      expect(document.activeElement).toBe(
        screen.getByRole('heading', { level: 1, name: 'Notizen' }),
      )
    })
    expect(screen.queryByRole('dialog', { name: 'Menü' })).toBeNull()
  })
})
