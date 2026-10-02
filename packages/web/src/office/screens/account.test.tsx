import 'fake-indexeddb/auto'

import { SyncProvider, openLocalStore } from '@opengewerk/platform-web/sync'
import { TestServer } from '@opengewerk/platform-web/testing'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { InApplication } from '../../app/in-application.js'
import { SyncClient } from '../../sync/client.js'
import { AccountScreen } from './account.js'

/**
 * What somebody looks after about their own account under "Konto": the
 * recovery codes for a phone that is gone (#125), the password (#126), and
 * light or dark on this device (#216).
 *
 * The sign in these belong to is the foundation's and is tested there
 * (ADR 0010). The screen is this application's, and so these stay here.
 */

let counter = 0

/**
 * "Konto" as the office has it, inside a business and its sync client: signing
 * out there sends and clears what the device holds (#186).
 */
async function account() {
  const server = new TestServer()
  const client = await SyncClient.start({
    store: await openLocalStore(`konto${String((counter += 1))}`),
    transport: server,
    writer: server,
    deviceId: 'geraet',
    entities: [],
    onSignedOut: () => {},
  })

  render(
    <QueryClientProvider client={new QueryClient()}>
      <InApplication>
        <SyncProvider client={client}>
          <AccountScreen />
        </SyncProvider>
      </InApplication>
    </QueryClientProvider>,
  )
}

interface Call {
  readonly path: string
  readonly body: unknown
}

let calls: Call[]
let answers: Map<string, unknown>

beforeEach(() => {
  calls = []
  answers = new Map()
  // "Konto" asks about push since #284; an instance without a key answers
  // this, and the card has nothing to switch.
  answers.set('/push', { available: false, publicKey: null, occasions: [], devices: [] })
  // And about the businesses of the person since #142 and #242.
  answers.set('/auth/tenants', [])
  // And about the passkeys of the account since #167 and #248.
  answers.set('/auth/passkeys', [])

  vi.stubGlobal('fetch', (path: string, init?: RequestInit) => {
    calls.push({
      path,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    })

    return Promise.resolve(
      new Response(JSON.stringify(answers.get(path) ?? {}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the recovery codes under "Konto"', () => {
  it('show how many are left, and a new set only after the password', async () => {
    answers.set('/api/auth/get-session', {
      user: { id: 'u-1', email: 'chefin@nord.example.de', name: 'Olga', twoFactorEnabled: true },
      session: { activeTenantId: 't-1' },
    })
    answers.set('/auth/devices', [])
    answers.set('/auth/recovery-codes', { left: 3 })
    answers.set('/api/auth/two-factor/generate-backup-codes', {
      backupCodes: ['aaaaa-11111', 'bbbbb-22222'],
    })

    await account()

    expect(await screen.findByText(/Noch 3 Codes übrig/)).toBeTruthy()

    // The small button of the board opens the question, and the one under the
    // password makes the codes (#219).
    await userEvent.click(screen.getByRole('button', { name: 'Neue Codes erzeugen' }))
    await userEvent.type(screen.getByLabelText('Passwort zur Bestätigung'), 'das-passwort')
    await userEvent.click(screen.getByRole('button', { name: 'Neue Codes erzeugen' }))

    expect(await screen.findByText('aaaaa-11111')).toBeTruthy()
    expect(
      calls.find((call) => call.path === '/api/auth/two-factor/generate-backup-codes')?.body,
    ).toEqual({ password: 'das-passwort' })
  })
})

describe('the password under "Konto"', () => {
  it('changes with the old one, and signs the other devices out', async () => {
    answers.set('/api/auth/get-session', {
      user: { id: 'u-1', email: 'buero@nord.example.de', name: 'Beate', twoFactorEnabled: false },
      session: { activeTenantId: 't-1' },
    })
    answers.set('/auth/devices', [])

    await account()

    await userEvent.type(await screen.findByLabelText('Bisheriges Passwort'), 'das-alte-passwort')
    await userEvent.type(screen.getByLabelText('Neues Passwort'), 'das-neue-lange-passwort')
    await userEvent.type(
      screen.getByLabelText('Neues Passwort wiederholen'),
      'das-neue-lange-passwort',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Passwort ändern' }))

    expect(calls.find((call) => call.path === '/api/auth/change-password')?.body).toEqual({
      currentPassword: 'das-alte-passwort',
      newPassword: 'das-neue-lange-passwort',
      revokeOtherSessions: true,
    })
    expect(
      await screen.findByText(/Alle anderen Geräte dieses Zugangs sind abgemeldet/),
    ).toBeTruthy()
  })
})

describe('light or dark under "Konto"', () => {
  it('switches this device and remembers it, with light as the start', async () => {
    localStorage.removeItem('opengewerk.theme')
    delete document.documentElement.dataset.theme
    answers.set('/api/auth/get-session', {
      user: { id: 'u-1', email: 'buero@nord.example.de', name: 'Beate', twoFactorEnabled: false },
      session: { activeTenantId: 't-1' },
    })
    answers.set('/auth/devices', [])

    await account()

    const group = await screen.findByRole('group', { name: 'Darstellung' })
    expect(group).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Hell' }).getAttribute('aria-pressed')).toBe('true')

    await userEvent.click(screen.getByRole('button', { name: 'Dunkel' }))

    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(localStorage.getItem('opengewerk.theme')).toBe('dark')
    expect(screen.getByRole('button', { name: 'Dunkel' }).getAttribute('aria-pressed')).toBe('true')

    await userEvent.click(screen.getByRole('button', { name: 'Hell' }))
    expect(document.documentElement.dataset.theme).toBe('light')
  })
})
