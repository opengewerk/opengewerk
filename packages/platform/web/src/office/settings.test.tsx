import type { TenantId } from '@opengewerk/platform-domain'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { InRouter } from '../in-router.js'
import { InProbe } from '../probe-application.js'
import type { TenantChoice } from '../session/session.js'
import {
  Saved,
  SettingsHistory,
  SettingsPage,
  SettingsScreen,
  SettingsState,
  SettingsText,
} from './settings.js'

/**
 * The settings of a tenant: the overview with a tile for each screen, and the
 * frame every one of those screens stands in.
 *
 * Which screens there are is the application's to say, with the right each of
 * them takes (ADR 0010). The foundation lists what the person may read, by
 * the rights the server resolved, and holds no list of its own. The
 * application in these tests belongs to nobody: three settings, one for
 * whoever holds a right of its own, one for whoever may read the people of a
 * tenant, and one for everybody.
 */

let answers: Map<string, unknown>

function signedInWith(...rights: string[]) {
  const tenant: TenantChoice = {
    id: 't-1' as TenantId,
    name: 'Probewerk Nord',
    roles: ['member'],
    roleLabels: ['Mitglied'],
    rights,
    secondFactor: false,
  }

  answers.set('/api/auth/get-session', {
    user: { id: 'u-1', email: 'mia@nord.example.de', name: 'Mia Mitglied' },
    session: { activeTenantId: 't-1' },
  })
  answers.set('/auth/tenants', [tenant])
}

function show(node: ReactNode, at = '/einstellungen') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  return render(
    <QueryClientProvider client={client}>
      <InProbe>
        <InRouter at={at}>{node}</InRouter>
      </InProbe>
    </QueryClientProvider>,
  )
}

/** Where the links of a list lead, in their order. */
function targets(within_: HTMLElement): (string | null)[] {
  return within(within_)
    .getAllByRole('link')
    .map((link) => link.getAttribute('href'))
}

beforeEach(() => {
  answers = new Map()

  vi.stubGlobal('fetch', (path: string) =>
    Promise.resolve(
      new Response(JSON.stringify(answers.get(path) ?? {}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the overview of the settings', () => {
  it('lists every screen of the application for somebody who may read them all, in its order', async () => {
    signedInWith('shelf.settings', 'membership.read')
    show(<SettingsScreen />)

    await screen.findByRole('link', { name: /Regale/ })

    expect(targets(screen.getByRole('list'))).toEqual([
      '/einstellungen/regale',
      '/einstellungen/zugaenge',
      '/einstellungen/notizen',
    ])
    // The tile says what the screen is for, in the sentence of the application.
    expect(screen.getByRole('link', { name: /Regale/ }).textContent).toBe(
      'RegaleWie die Regale eines Mandanten heißen.',
    )
  })

  /**
   * By the right an entry names and by nothing else: an entry without one is
   * for everybody, and one whose right the person lacks is left out. A
   * courtesy and not the gate, the routes behind each screen ask again.
   */
  it.each([
    [['membership.read'], ['/einstellungen/zugaenge', '/einstellungen/notizen']],
    [['shelf.settings'], ['/einstellungen/regale', '/einstellungen/notizen']],
    [['note.read'], ['/einstellungen/notizen']],
  ])('leaves out what the rights %j do not open', async (rights, shown) => {
    signedInWith(...rights)
    show(<SettingsScreen />)

    // Once the rights have arrived: until then only what is for everybody
    // stands, and a check made before would pass for any list.
    if (rights.includes('membership.read')) {
      await screen.findByRole('link', { name: /Zugänge/ })
    } else if (rights.includes('shelf.settings')) {
      await screen.findByRole('link', { name: /Regale/ })
    } else {
      await screen.findByRole('link', { name: /Notizen/ })
      await new Promise((resolve) => setTimeout(resolve, 50))
    }

    expect(targets(screen.getByRole('list'))).toEqual(shown)
  })

  it('says whose settings these are in the words of the application, and where the account is in its own', async () => {
    signedInWith()
    show(<SettingsScreen />)

    expect(await screen.findByRole('heading', { level: 1, name: 'Einstellungen' })).toBeTruthy()
    expect(screen.getByText('Was dieser Mandant für sich festlegt.')).toBeTruthy()
    expect(
      screen.getByText(
        'Das Passwort gehört nicht dem Mandanten, sondern dem Konto. Sie stehen im Menü unter dem Namen oben rechts.',
      ),
    ).toBeTruthy()
  })
})

describe('the frame of a settings screen', () => {
  it('lists the other settings beside the screen, under whose they are, and lights the one it is', async () => {
    signedInWith('shelf.settings', 'membership.read')
    // At an address under none of the links: the router lights a link to the
    // address one is at by itself, and the list goes by the key it is given,
    // as the raised card does.
    show(
      <SettingsPage active="zugaenge" title="Zugänge" sub="Wer hier arbeitet.">
        <p>Karte</p>
      </SettingsPage>,
      '/woanders',
    )

    const beside = await screen.findByRole('navigation', { name: 'Einstellungen' })

    await within(beside).findByRole('link', { name: 'Regale' })

    expect(within(beside).getByText('Dieser Mandant')).toBeTruthy()
    expect(targets(beside)).toEqual([
      '/einstellungen/regale',
      '/einstellungen/zugaenge',
      '/einstellungen/notizen',
    ])
    expect(
      within(beside)
        .getAllByRole('link')
        .map((link) => link.getAttribute('aria-current')),
    ).toEqual([null, 'page', null])
  })

  it('has one heading, the line under it, the action, the cards, and the way back to the overview', async () => {
    signedInWith()
    show(
      <SettingsPage
        active="notizen"
        title="Notizen"
        sub="Was eine Notiz festhält."
        actions={<button type="button">Speichern</button>}
      >
        <p>Karte eins</p>
        <p>Karte zwei</p>
      </SettingsPage>,
      '/einstellungen/notizen',
    )

    expect(await screen.findByRole('heading', { level: 1, name: 'Notizen' })).toBeTruthy()
    // One title to a screen and only one.
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByText('Was eine Notiz festhält.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Speichern' })).toBeTruthy()
    expect(screen.getByText('Karte eins')).toBeTruthy()
    expect(screen.getByText('Karte zwei')).toBeTruthy()
    // On a phone and a tablet the list beside the screen gives way to this.
    expect(screen.getByRole('link', { name: 'Einstellungen' }).getAttribute('href')).toBe(
      '/einstellungen',
    )
  })
})

describe('the pieces of a settings card', () => {
  it('say that something was saved to a reader as well, in the words given or their own', () => {
    const { unmount } = render(<Saved />)

    expect(screen.getByRole('status').textContent).toBe('Gespeichert.')
    unmount()

    render(<Saved>Verschickt.</Saved>)

    expect(screen.getByRole('status').textContent).toBe('Verschickt.')
  })

  it('list what was set before, and nothing where nothing was', () => {
    const { unmount, container } = render(<SettingsHistory items={[]} />)

    expect(container.textContent).toBe('')
    unmount()

    render(<SettingsHistory items={['bis 31.12.2025: 30 Tage', 'bis 30.06.2025: 10 Tage']} />)

    expect(screen.getByText('Verlauf')).toBeTruthy()
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'bis 31.12.2025: 30 Tage',
      'bis 30.06.2025: 10 Tage',
    ])
  })

  it('write a sentence and a state as paragraphs', () => {
    render(
      <>
        <SettingsText>ein Satz</SettingsText>
        <SettingsState>14 Tage</SettingsState>
      </>,
    )

    expect(screen.getByText('ein Satz').tagName).toBe('P')
    expect(screen.getByText('14 Tage').tagName).toBe('P')
  })
})
