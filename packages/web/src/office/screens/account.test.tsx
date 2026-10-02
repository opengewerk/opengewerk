import 'fake-indexeddb/auto'

import { SyncProvider, openLocalStore } from '@opengewerk/platform-web/sync'
import { InRouter, TestServer } from '@opengewerk/platform-web/testing'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { InApplication } from '../../app/in-application.js'
import { aTenantChoice } from '../../session/test-tenants.js'
import { SyncClient } from '../../sync/client.js'
import { AccountScreen } from './account.js'

/**
 * "Konto" in the office, as this application binds it (ADR 0010).
 *
 * The screen is the foundation's and has its tests there: the second factor,
 * the recovery codes, the passkeys, the password and the devices. Here is what
 * only this application can get wrong: its two cards and where they stand, the
 * sentences it hands in, and the names of its two entries.
 */

vi.mock('@simplewebauthn/browser', () => {
  class WebAuthnError extends Error {
    constructor(readonly code: string) {
      super(code)
      this.name = 'WebAuthnError'
    }
  }

  return {
    WebAuthnError,
    browserSupportsWebAuthn: () => true,
    startRegistration: () => Promise.reject(new Error('not in this test')),
    startAuthentication: () => Promise.reject(new Error('not in this test')),
  }
})

let answers: Map<string, unknown>
let counter = 0

function answer(method: string, path: string, value: unknown) {
  answers.set(`${method} ${path}`, value)
}

function session(twoFactorEnabled: boolean) {
  answer('GET', '/api/auth/get-session', {
    user: { id: 'u-1', email: 'moritz@kohm.example.de', name: 'Moritz Kohm', twoFactorEnabled },
    session: { activeTenantId: 't-1', signInMethod: 'password' },
  })
}

async function mount() {
  const server = new TestServer()
  const client = await SyncClient.start({
    store: await openLocalStore(`account${String((counter += 1))}`),
    transport: server,
    writer: server,
    deviceId: 'office-computer',
    entities: [],
    onSignedOut: () => {},
  })

  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <InApplication>
        <SyncProvider client={client}>
          <InRouter at="/konto">
            <AccountScreen />
          </InRouter>
        </SyncProvider>
      </InApplication>
    </QueryClientProvider>,
  )

  await screen.findByRole('heading', { level: 1, name: 'Konto' })
}

/** The cards of the screen by their titles, in the order they stand in. */
function cards(): readonly string[] {
  return screen
    .getAllByRole('region')
    .map((card) => document.getElementById(card.getAttribute('aria-labelledby') ?? '')?.textContent)
    .filter((title): title is string => typeof title === 'string')
}

beforeEach(() => {
  answers = new Map()
  session(true)
  answer('GET', '/auth/tenants', [aTenantChoice(['owner'], { name: 'Elektro Kohm GmbH' })])
  answer('GET', '/auth/devices', [])
  answer('GET', '/auth/passkeys', [])
  answer('GET', '/push', { available: false, publicKey: null, occasions: [], devices: [] })

  vi.stubGlobal('fetch', (path: string, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${path}`

    return Promise.resolve(
      new Response(JSON.stringify(answers.get(key) ?? {}), {
        status: answers.has(key) ? 200 : 404,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('"Konto" in the office', () => {
  it('sets the businesses and the notifications between the passkeys and the password', async () => {
    await mount()
    await screen.findByText('Elektro Kohm GmbH')

    expect(cards()).toEqual([
      'Darstellung',
      'Zweiter Faktor',
      'Passkeys',
      'Betriebe',
      'Benachrichtigungen',
      'Passwort',
      'Angemeldete Geräte',
    ])
  })

  it('says by its own name how it looks, and where else that can be chosen', async () => {
    await mount()

    const card = within(screen.getByRole('region', { name: 'Darstellung' }))

    expect(
      card.getByText(
        'Wie OpenGewerk auf diesem Gerät aussieht. Hell ist der Standard, auf jedem neuen Gerät und vor der Anmeldung.',
      ),
    ).toBeTruthy()
    expect(
      card.getByText(
        'Gilt auf diesem Gerät, auch ohne Netz. Auf dem Tablet im Keller lässt sich unabhängig davon dunkel wählen.',
      ),
    ).toBeTruthy()
  })

  it('says by its own name what a second factor that is set up asks for', async () => {
    await mount()

    expect(
      await within(screen.getByRole('region', { name: 'Zweiter Faktor' })).findByText(
        'Eingerichtet. Bei jeder Anmeldung fragt OpenGewerk zusätzlich nach dem Code aus der App.',
      ),
    ).toBeTruthy()
  })

  it('says for which of its roles the second factor is a duty', async () => {
    session(false)
    await mount()

    expect(
      await within(screen.getByRole('region', { name: 'Zweiter Faktor' })).findByText(
        'Noch nicht eingerichtet. Ein zweiter Faktor macht ein gestohlenes Passwort allein nutzlos. Für die Rolle Inhaber ist er Pflicht, für alle anderen empfohlen.',
      ),
    ).toBeTruthy()
  })

  it('calls a session by the entry it was opened from, site or office', async () => {
    answer('GET', '/auth/devices', [
      {
        sessionId: 's-1',
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
        signedInAt: '2026-10-02T06:00:00.000Z',
        expiresAt: '2026-10-02T18:00:00.000Z',
        longLived: false,
        current: true,
      },
      {
        sessionId: 's-2',
        userAgent:
          'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
        signedInAt: '2026-09-28T05:30:00.000Z',
        expiresAt: '2026-10-28T05:30:00.000Z',
        longLived: true,
        current: false,
      },
    ])
    await mount()

    // The card is another one once the list has arrived, so it is looked up after it.
    await screen.findByText('Büro, 12 Stunden')

    const card = within(screen.getByRole('region', { name: 'Angemeldete Geräte' }))

    expect(card.getByText('Büro, 12 Stunden')).toBeTruthy()
    expect(card.getByText('Baustelle, 30 Tage')).toBeTruthy()
  })

  it('says by its own name what it will not do without a confirmation at the device', async () => {
    answer('POST', '/api/auth/reconfirm', { reconfirmedUntil: '2026-10-02T08:10:00.000Z' })
    await mount()

    const card = within(screen.getByRole('region', { name: 'Passkeys' }))

    await userEvent.click(await card.findByRole('button', { name: 'Passkey hinzufügen' }))
    await userEvent.type(card.getByLabelText('Passwort'), 'das-lange-passwort')
    await userEvent.type(card.getByLabelText('Code aus der App'), '123456')
    await userEvent.click(card.getByRole('button', { name: 'Weiter' }))

    expect(
      await card.findByText(
        'Danach fragt der Browser nach Fingerabdruck, Gesicht oder PIN. Ohne diese Bestätigung am Gerät legt OpenGewerk keinen Passkey an.',
      ),
    ).toBeTruthy()
  })
})
