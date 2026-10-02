import 'fake-indexeddb/auto'

import {
  InvitationScreen,
  SecondFactorScreen,
  SecondFactorSetupScreen,
  SetupScreen,
  SignInScreen,
  SignOutButton,
  TenantScreen,
} from '@opengewerk/platform-web/gate'
import { SettingsPage, SettingsScreen } from '@opengewerk/platform-web/office'
import { EntrySuggestion } from '@opengewerk/platform-web/shell'
import { deleteLocalStore, storesOnDevice } from '@opengewerk/platform-web/sync'
import { InRouter } from '@opengewerk/platform-web/testing'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { officeApplication } from '../office/application.js'
import officeEntry from '../office/main.tsx?raw'
import { aTenantChoice } from '../session/test-tenants.js'
import siteEntry from '../site/main.tsx?raw'
import { application } from './application.js'
import { InApplication } from './in-application.js'
import { fakePushBrowser, forgetPushBrowser } from './test-push.js'

/**
 * What this application says and does where the foundation draws the screen
 * (ADR 0010).
 *
 * The gate before the first screen is the foundation's and is tested there,
 * with an application that belongs to nobody. What is held here is the
 * binding: that in this application the gate says what it has always said,
 * word for word. Its sentences stood in the screens themselves until the
 * screens moved; a word that changed on the way would be read by everybody
 * who signs in, and by no test of the foundation.
 */

const browser = vi.hoisted(() => ({ supported: false }))

vi.mock('@simplewebauthn/browser', () => ({
  WebAuthnError: class extends Error {},
  browserSupportsWebAuthn: () => browser.supported,
  startRegistration: () => Promise.reject(new Error('not in this test')),
  startAuthentication: () => Promise.resolve({ id: 'cred-1', rawId: 'cred-1', type: 'public-key' }),
}))

interface Call {
  readonly method: string
  readonly path: string
}

let calls: Call[]
let answers: Map<string, { readonly status: number; readonly body: unknown } | 'down'>

function serverSays(key: string, body: unknown, status = 200): void {
  answers.set(key, { status, body })
}

function inApplication(node: ReactNode) {
  // A client per test, so that one test's answers are not another's cache.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  return (
    <QueryClientProvider client={client}>
      <InApplication>{node}</InApplication>
    </QueryClientProvider>
  )
}

beforeEach(async () => {
  calls = []
  answers = new Map()
  browser.supported = false

  for (const tenant of await storesOnDevice()) {
    await deleteLocalStore(tenant)
  }

  vi.stubGlobal('fetch', (path: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'

    calls.push({ method, path })

    const answer = answers.get(`${method} ${path}`) ?? { status: 200, body: {} }

    if (answer === 'down') {
      return Promise.reject(new TypeError('Failed to fetch'))
    }

    return Promise.resolve(
      new Response(JSON.stringify(answer.body), {
        status: answer.status,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  globalThis.history.replaceState(null, '', '/')
})

describe('the gate of this application', () => {
  it('says beside the card what it is, where it runs and under which licence', () => {
    render(inApplication(<SignInScreen onSignedIn={vi.fn()} onSecondFactor={vi.fn()} />))

    expect(screen.getByRole('complementary').textContent).toBe(
      'OpenGewerk' +
        'Kunde, Objekt, Anlage, Auftrag, Beleg. Ein Datenmodell statt sechs Programme.' +
        'Diese Instanz läuft auf Ihrem eigenen Server. Die Daten verlassen ihn nicht, und niemand außer Ihnen kann sie abschalten.' +
        'AGPL-3.0',
    )
  })

  it('says under the sign in that the owner needs a second factor', () => {
    render(inApplication(<SignInScreen onSignedIn={vi.fn()} onSecondFactor={vi.fn()} />))

    expect(
      screen.getByText(
        'Für die Rolle Inhaber ist der zweite Faktor Pflicht, für alle anderen empfohlen. Nach dem Passwort folgt dann der Code aus der App; ein Passkey zählt selbst als zweiter Faktor.',
      ),
    ).toBeTruthy()
  })

  it('says after a forgotten password when a link is on its way, and that the owner helps', async () => {
    render(inApplication(<SignInScreen onSignedIn={vi.fn()} onSecondFactor={vi.fn()} />))

    await userEvent.type(screen.getByLabelText('E-Mail'), 'monteur@nord.example.de')
    await userEvent.click(screen.getByRole('button', { name: 'Passwort vergessen?' }))

    expect((await screen.findByRole('status')).textContent).toBe(
      'Wenn es zu dieser Adresse einen Zugang gibt und ein Betrieb, in dem er arbeitet, E-Mails verschickt, ist ein Link zu einem neuen Passwort unterwegs. Er gilt eine Stunde. Kommt keiner an, hilft der Inhaber des Betriebs weiter.',
    )
  })

  it('names itself where a passkey is unknown', async () => {
    browser.supported = true
    serverSays('GET /api/auth/passkey/generate-authenticate-options', { challenge: 'abc' })
    serverSays(
      'POST /api/auth/passkey/verify-authentication',
      { code: 'PASSKEY_NOT_FOUND', message: 'Passkey not found' },
      401,
    )

    render(inApplication(<SignInScreen onSignedIn={vi.fn()} onSecondFactor={vi.fn()} />))
    await userEvent.click(screen.getByRole('button', { name: 'Mit Passkey anmelden' }))

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Diesen Passkey kennt OpenGewerk nicht, vielleicht wurde er gelöscht. Die Anmeldung mit dem Passwort geht weiter.',
    )
  })

  it('says after a recovery code that new ones are made under "Konto" in the office', async () => {
    serverSays('GET /auth/recovery-codes', { left: 9 })

    render(inApplication(<SecondFactorScreen onVerified={vi.fn()} />))
    await userEvent.click(
      screen.getByRole('button', { name: 'Telefon nicht zur Hand? Wiederherstellungscode' }),
    )
    await userEvent.type(screen.getByLabelText('Wiederherstellungscode'), 'Ab3dE-fG7hJ')
    await userEvent.click(screen.getByRole('button', { name: 'Weiter' }))

    expect(
      await screen.findByText(
        'Der Code ist eingelöst. Es sind noch 9 Wiederherstellungscodes übrig. Unter "Konto" im Büro lassen sich neue erzeugen und der zweite Faktor auf einem neuen Telefon einrichten.',
      ),
    ).toBeTruthy()
  })

  it('says over the setup of a second factor that the owner has to have one', () => {
    render(inApplication(<SecondFactorSetupScreen onDone={vi.fn()} />))

    expect(
      screen.getByText(
        'Für die Rolle Inhaber ist ein zweiter Faktor Pflicht. Richten Sie ihn mit einer Authenticator-App auf dem Telefon ein.',
      ),
    ).toBeTruthy()
  })

  it('calls what is chosen a business: in the heading, for an account without one, and when one could not be chosen', async () => {
    const first = render(
      inApplication(
        <TenantScreen
          entry="office"
          deviceId="geraet"
          tenants={[]}
          onChosen={vi.fn()}
          onSignedOut={vi.fn()}
        />,
      ),
    )

    expect(screen.getByRole('heading', { level: 1, name: 'Kein Betrieb' })).toBeTruthy()
    expect(
      screen.getByText(
        'Dieses Konto gehört zu keinem Betrieb. Wer die Instanz betreibt, legt die Zugehörigkeit an.',
      ),
    ).toBeTruthy()
    first.unmount()

    answers.set('POST /auth/tenant', 'down')
    render(
      inApplication(
        <TenantScreen
          entry="office"
          deviceId="geraet"
          tenants={[aTenantChoice(['owner'], { id: 't-nord', name: 'Elektro Nord GmbH' })]}
          onChosen={vi.fn()}
          onSignedOut={vi.fn()}
        />,
      ),
    )

    expect(screen.getByRole('heading', { level: 1, name: 'Betrieb wählen' })).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: /Elektro Nord GmbH/ }))

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Der Betrieb ließ sich nicht auswählen.',
    )
  })

  /**
   * The setup code stands where `docker/setup.sh` writes it (#215), and the
   * name of the business stops where the settings would (#276): 120
   * characters, the limit `businessNameProblem` holds on the server.
   */
  it('sets up a business at the first run, and says where the setup code stands', () => {
    render(inApplication(<SetupScreen onDone={vi.fn()} />))

    expect(
      screen.getByText(
        'Diese Instanz ist noch leer. Hier entstehen der Betrieb und das erste Konto. Wer dieses Konto hat, legt später alle weiteren an.',
      ),
    ).toBeTruthy()
    expect(
      screen.getByText(
        'Steht auf dem Server in der Datei docker/.env. So richtet nur ein, wer an den Server kommt.',
      ),
    ).toBeTruthy()

    const business = screen.getByLabelText('Betrieb') as HTMLInputElement

    expect(business.maxLength).toBe(120)
    expect(screen.getByText('So wie der Betrieb auf einer Rechnung steht.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Betrieb anlegen' })).toBeTruthy()
  })
})

describe('an invitation into a business', () => {
  const token = 'a'.repeat(43)
  const offer = {
    state: 'open',
    company: 'Elektro Nord GmbH',
    name: 'Nele Neu',
    email: 'neue@nord.example.de',
    expiresAt: '2026-10-09T08:00:00.000Z',
    knownAccount: false,
  }

  it.each([
    [
      'redeemed',
      'Er wurde schon benutzt. Wenn das nicht Sie waren, sagen Sie dem Betrieb bitte Bescheid.',
    ],
    ['revoked', 'Der Betrieb hat ihn zurückgezogen. Bitte dort nachfragen.'],
    ['expired', 'Er ist abgelaufen. Der Betrieb kann einen neuen erzeugen.'],
  ])('says who to turn to when the link was %s', async (state, sentence) => {
    serverSays(`GET /invitation/${token}`, { ...offer, state })

    render(inApplication(<InvitationScreen token={token} />))

    expect(await screen.findByText(sentence)).toBeTruthy()
  })

  it('welcomes somebody new with who made the account, and that nobody there sees the password', async () => {
    serverSays(`GET /invitation/${token}`, offer)

    render(inApplication(<InvitationScreen token={token} />))

    expect((await screen.findByText('Nele Neu')).parentElement?.textContent).toBe(
      'Der Betrieb hat einen Zugang für Nele Neu angelegt, mit der Adresse neue@nord.example.de. Fehlt nur noch ein Passwort, und das wählen Sie selbst: niemand im Betrieb bekommt es zu sehen.',
    )
  })

  it('tells an address with an account that the business is added, under a button that says so', async () => {
    serverSays(`GET /invitation/${token}`, {
      ...offer,
      name: 'Ingo Inhaber',
      email: 'ingo@example.de',
      knownAccount: true,
    })

    render(inApplication(<InvitationScreen token={token} />))

    expect((await screen.findByText('ingo@example.de')).parentElement?.textContent).toBe(
      'Für ingo@example.de gibt es auf dieser Instanz schon ein Konto. Sie behalten Ihr Passwort; der Betrieb kommt einfach dazu.',
    )
    expect(screen.getByRole('button', { name: 'Betrieb übernehmen' })).toBeTruthy()
  })
})

describe('the sign in after the scan of a QR label (#308)', () => {
  it('says over the card that the installation opens afterwards', () => {
    globalThis.history.replaceState(null, '', '/a/7K2M9QX4TBA3HW8P')
    render(inApplication(<SignInScreen onSignedIn={vi.fn()} onSecondFactor={vi.fn()} />))

    expect(screen.getByRole('note').textContent).toBe(
      'Du hast das Etikett einer Anlage gescannt. Nach der Anmeldung öffnet sie sich.',
    )
  })

  it('says nothing of a label anywhere else', () => {
    render(inApplication(<SignInScreen onSignedIn={vi.fn()} onSecondFactor={vi.fn()} />))

    expect(screen.queryByRole('note')).toBeNull()
  })
})

describe('what each entry hands to the foundation', () => {
  /**
   * The site never shows a settings screen, the list of businesses, "Zugänge"
   * or the area of the instance, and a phone should not load any of them. So
   * the office adds them to what the entries share, and the site hands in the
   * shared value as it is.
   */
  it('is the same application, with the settings of a business only from the office', () => {
    expect(application.settings).toEqual([])
    expect(officeApplication.settings.map((entry) => entry.key)).toEqual([
      'briefkopf',
      'steuern',
      'nummernkreise',
      'zahlungsziel',
      'tags',
      'fristen',
      'belehrungen',
      'regiebericht',
      'e-mail',
      'sicherung',
      'zugaenge',
      'protokoll',
    ])
    expect(application.ownTenant).toBeUndefined()
    // A further business is made by an owner, on the card under "Konto".
    expect(officeApplication.ownTenant).toEqual({
      right: 'tenant.create',
      to: '/konto',
      hash: 'betriebe',
      label: 'Weiteren Betrieb anlegen',
    })

    // What "Zugänge" and the area of the instance say comes only with the
    // office, beside the sentences both entries share.
    expect(application.sentences.staff).toBeUndefined()
    expect(application.sentences.instance).toBeUndefined()
    expect(officeApplication.sentences.staff?.accounts).toBe('Konten dieses Betriebs')
    expect(officeApplication.sentences.instance?.tenants.title).toBe('Betriebe')

    const {
      ownTenant: _office,
      sentences: { staff: _staff, instance: _instance, ...sentences },
      ...shared
    } = officeApplication

    expect({ ...shared, sentences, settings: [] }).toEqual(application)
  })

  /**
   * Which of the two an entry hands in is one line of its `main.tsx`, and no
   * test renders that file: it mounts into the page and starts the service
   * worker. Handed the shared value, the office would list no settings and
   * say nothing of it; handed the office's, a phone on site would load a list
   * it never draws. Both would pass every other test, so the line is read.
   */
  it('is handed in by the entry itself, the office its own and the site the shared one', () => {
    expect(officeEntry).toContain('<Root entry="office" application={officeApplication}>')
    expect(siteEntry).toContain('<Root entry="site" application={application}>')
  })
})

describe('the two entries of this application', () => {
  /** A device with only a finger, or with a mouse: happy-dom answers no to every query. */
  function device(coarse: boolean, fine: boolean) {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(pointer: coarse)' ? coarse : query === '(any-pointer: fine)' && fine,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
  }

  beforeEach(() => {
    globalThis.localStorage.clear()
  })

  it('are the office and the site, and a phone in the office is offered the site', () => {
    device(true, false)
    render(inApplication(<EntrySuggestion here="office" />))

    expect(screen.getByText('Das sieht nach einem Gerät für die Baustelle aus.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Zur Baustellenansicht' }).getAttribute('href')).toBe(
      '/m/',
    )
  })

  it('offer a desk on site the office', () => {
    device(false, true)
    render(inApplication(<EntrySuggestion here="site" />))

    expect(
      screen.getByText('Das sieht nach einem Arbeitsplatz aus. Im Büro ist mehr zu sehen.'),
    ).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Zur Büroansicht' }).getAttribute('href')).toBe('/')
  })
})

describe('the settings of a business', () => {
  function signedInAsOwner() {
    serverSays('GET /api/auth/get-session', {
      user: { id: 'u-1', email: 'chefin@nord.example.de', name: 'Christa Chefin' },
      session: { activeTenantId: 't-1' },
    })
    serverSays('GET /auth/tenants', [aTenantChoice(['owner'])])
  }

  it('are called the business’s on the overview, and what is the account’s is said to be found under the name', async () => {
    signedInAsOwner()
    render(
      inApplication(
        <InRouter at="/einstellungen">
          <SettingsScreen />
        </InRouter>,
      ),
    )

    expect(await screen.findByText('Was dieser Betrieb für sich festlegt.')).toBeTruthy()
    expect(
      screen.getByText(
        'Hell oder dunkel, Passwort und zweiter Faktor gehören nicht dem Betrieb, sondern dem Konto. Sie stehen im Menü unter dem Namen oben rechts.',
      ),
    ).toBeTruthy()
  })

  it('stand beside every settings screen under "Dieser Betrieb"', async () => {
    signedInAsOwner()
    render(
      inApplication(
        <InRouter at="/einstellungen/zahlungsziel">
          <SettingsPage active="zahlungsziel" title="Zahlungsziel" sub="Wie viele Tage.">
            <p>Karte</p>
          </SettingsPage>
        </InRouter>,
      ),
    )

    const beside = await screen.findByRole('navigation', { name: 'Einstellungen' })

    expect(beside.textContent?.startsWith('Dieser Betrieb')).toBe(true)
    expect(
      (await screen.findByRole('link', { name: 'Zahlungsziel' })).getAttribute('aria-current'),
    ).toBe('page')
  })
})

describe('signing out of this application', () => {
  afterEach(() => {
    forgetPushBrowser()
  })

  /**
   * Push goes first, while there is a session to take the row of this device
   * off with (#284): the server sends nothing to a device whose session has
   * ended, but the next person on this browser should not hold the last
   * one's subscription either.
   */
  it('takes push off this device before the session ends', async () => {
    const { subscription } = fakePushBrowser({ subscribed: true })

    // `fakePushBrowser` stubs globals of its own; the server of this test
    // goes in again after it.
    vi.stubGlobal('fetch', (path: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'

      calls.push({ method, path })

      const body =
        path === '/push' && method === 'GET'
          ? {
              available: true,
              publicKey: 'BAAB',
              occasions: [],
              devices: [
                {
                  id: 'p-1',
                  label: 'Chrome auf Windows',
                  entry: 'office',
                  since: '2037-09-27T08:00:00.000Z',
                  thisSession: true,
                },
                {
                  id: 'p-2',
                  label: 'Safari auf dem Telefon',
                  entry: 'site',
                  since: '2037-09-27T08:00:00.000Z',
                  thisSession: false,
                },
              ],
            }
          : {}

      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    })

    const signedOut = vi.fn()

    render(inApplication(<SignOutButton client={null} onSignedOut={signedOut} />))
    await userEvent.click(screen.getByRole('button', { name: 'Abmelden' }))

    await waitFor(() => {
      expect(signedOut).toHaveBeenCalled()
    })
    // The row of this session and no other, then the browser's own
    // subscription, and only then the session.
    expect(calls).toEqual([
      { method: 'GET', path: '/push' },
      { method: 'DELETE', path: '/push/subscriptions/p-1' },
      { method: 'POST', path: '/auth/sign-out' },
    ])
    expect(subscription.unsubscribe).toHaveBeenCalledOnce()
  })
})
