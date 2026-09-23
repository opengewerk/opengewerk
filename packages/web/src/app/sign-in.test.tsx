import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AccountScreen } from '../office/screens/account.js'
import { SecondFactorScreen } from './sign-in.js'

/**
 * The second step of a sign in, with the code from the app or with a recovery
 * code for somebody whose phone is gone (#125), and the recovery codes under
 * "Konto". Before, the codes were shown at the setup and could be used
 * nowhere: the sign in only knew the code from the app.
 */

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

    render(
      <QueryClientProvider client={new QueryClient()}>
        <AccountScreen />
      </QueryClientProvider>,
    )

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
