import 'fake-indexeddb/auto'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AccountScreen } from '../office/screens/account.js'
import { SyncClient } from '../sync/client.js'
import { SyncProvider } from '../sync/provider.js'
import { openLocalStore } from '../sync/store.js'
import { TestServer } from '../sync/test-server.js'
import { PasswordResetScreen } from './password-reset.js'
import { SecondFactorScreen, SignInScreen } from './sign-in.js'

/**
 * The second step of a sign in, with the code from the app or with a recovery
 * code for somebody whose phone is gone (#125), and the recovery codes under
 * "Konto". Before, the codes were shown at the setup and could be used
 * nowhere: the sign in only knew the code from the app.
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
      <SyncProvider client={client}>
        <AccountScreen />
      </SyncProvider>
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

describe('the second step of a sign in', () => {
  it('asks for the code from the app, as it always has', async () => {
    const verified = vi.fn()

    render(<SecondFactorScreen onVerified={verified} />)
    await userEvent.type(screen.getByLabelText('Code aus der App'), '123456')
    await userEvent.click(screen.getByRole('button', { name: 'Weiter' }))

    expect(calls.map((call) => call.path)).toEqual(['/api/auth/two-factor/verify-totp'])
    expect(verified).toHaveBeenCalledOnce()
  })

  it('takes a recovery code instead, and says how many are left before going on', async () => {
    answers.set('/auth/recovery-codes', { left: 9 })

    const verified = vi.fn()

    render(<SecondFactorScreen onVerified={verified} />)
    await userEvent.click(
      screen.getByRole('button', { name: 'Telefon nicht zur Hand? Wiederherstellungscode' }),
    )
    await userEvent.type(screen.getByLabelText('Wiederherstellungscode'), ' Ab3dE-fG7hJ ')
    await userEvent.click(screen.getByRole('button', { name: 'Weiter' }))

    expect(calls[0]).toEqual({
      path: '/api/auth/two-factor/verify-backup-code',
      body: { code: 'Ab3dE-fG7hJ' },
    })
    expect(await screen.findByText(/noch 9 Wiederherstellungscodes übrig/)).toBeTruthy()
    // Not yet: the count is worth a moment before the application opens.
    expect(verified).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Weiter' }))

    expect(verified).toHaveBeenCalledOnce()
  })
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

    await userEvent.click(screen.getByRole('button', { name: 'Neue Wiederherstellungscodes' }))
    await userEvent.type(screen.getByLabelText('Passwort zur Bestätigung'), 'das-passwort')
    await userEvent.click(screen.getByRole('button', { name: 'Neue Codes erzeugen' }))

    expect(await screen.findByText('aaaaa-11111')).toBeTruthy()
    expect(
      calls.find((call) => call.path === '/api/auth/two-factor/generate-backup-codes')?.body,
    ).toEqual({ password: 'das-passwort' })
  })
})

describe('a forgotten password', () => {
  it('asks for a link for the address in the field, and says the same either way', async () => {
    render(<SignInScreen onSignedIn={vi.fn()} onSecondFactor={vi.fn()} />)

    await userEvent.type(screen.getByLabelText('E-Mail'), ' monteur@nord.example.de ')
    await userEvent.click(screen.getByRole('button', { name: 'Passwort vergessen?' }))

    expect(calls[0]).toEqual({
      path: '/api/auth/request-password-reset',
      body: { email: 'monteur@nord.example.de' },
    })
    expect(await screen.findByRole('status')).toBeTruthy()
    expect(screen.getByRole('status').textContent).toContain('Er gilt eine Stunde')
  })

  it('wants the address first, before it asks for anything', async () => {
    render(<SignInScreen onSignedIn={vi.fn()} onSecondFactor={vi.fn()} />)

    await userEvent.click(screen.getByRole('button', { name: 'Passwort vergessen?' }))

    expect(calls).toEqual([])
    expect(screen.getByRole('alert').textContent).toContain('E-Mail-Adresse')
  })

  it('sets the new password behind the link, twelve characters and twice the same', async () => {
    render(<PasswordResetScreen token="abcdefghijklmnopqrstuvwx" />)

    await userEvent.type(screen.getByLabelText('Neues Passwort'), 'zu-kurz')
    await userEvent.type(screen.getByLabelText('Neues Passwort wiederholen'), 'zu-kurz')
    await userEvent.click(screen.getByRole('button', { name: 'Passwort setzen' }))

    expect(calls).toEqual([])
    expect(screen.getByRole('alert').textContent).toContain('12 Zeichen')

    await userEvent.clear(screen.getByLabelText('Neues Passwort'))
    await userEvent.clear(screen.getByLabelText('Neues Passwort wiederholen'))
    await userEvent.type(screen.getByLabelText('Neues Passwort'), 'ein-neues-langes-passwort')
    await userEvent.type(
      screen.getByLabelText('Neues Passwort wiederholen'),
      'ein-neues-langes-passwort',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Passwort setzen' }))

    expect(calls[0]).toEqual({
      path: '/api/auth/reset-password',
      body: { token: 'abcdefghijklmnopqrstuvwx', newPassword: 'ein-neues-langes-passwort' },
    })
    expect(await screen.findByRole('heading', { name: 'Passwort gesetzt' })).toBeTruthy()
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
