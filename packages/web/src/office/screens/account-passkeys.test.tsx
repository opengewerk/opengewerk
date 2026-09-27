import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PasskeysPanel } from './account-passkeys.js'

/**
 * The card "Passkeys" under "Konto" (#167, #248), `passkeys_card()` of the
 * canvas: the list, renaming in the line, deleting after a question, and
 * adding after confirming again. The browser's half is a stand-in; what the
 * server makes of it is in the server's own tests.
 */

const browser = vi.hoisted(() => ({
  supported: true,
  registration: { id: 'cred-1', rawId: 'cred-1', type: 'public-key' },
  refusal: null as Error | null,
}))

vi.mock('@simplewebauthn/browser', () => {
  class WebAuthnError extends Error {
    constructor(readonly code: string) {
      super(code)
      this.name = 'WebAuthnError'
    }
  }

  return {
    WebAuthnError,
    browserSupportsWebAuthn: () => browser.supported,
    startRegistration: () =>
      browser.refusal ? Promise.reject(browser.refusal) : Promise.resolve(browser.registration),
    startAuthentication: () => Promise.reject(new Error('not in this test')),
  }
})

interface Call {
  readonly method: string
  readonly path: string
  readonly body: unknown
}

let calls: Call[]
let answers: Map<string, { status: number; body: unknown }>

function answer(method: string, path: string, body: unknown, status = 200) {
  answers.set(`${method} ${path}`, { status, body })
}

const today = new Date()
today.setHours(8, 12, 0, 0)

const listed = [
  {
    id: 'pk-1',
    name: 'Laptop Büro',
    createdAt: '2026-09-27T06:00:00.000Z',
    lastUsedAt: today.toISOString(),
    provider: null,
  },
  {
    id: 'pk-2',
    name: 'Telefon',
    createdAt: '2026-09-20T06:00:00.000Z',
    lastUsedAt: null,
    provider: null,
  },
]

function session(twoFactorEnabled: boolean) {
  answer('GET', '/api/auth/get-session', {
    user: { id: 'u-1', email: 'moritz@kohm.example.de', name: 'Moritz Kohm', twoFactorEnabled },
    session: { activeTenantId: 't-1', signInMethod: 'password' },
  })
}

function mount() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <PasskeysPanel />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  calls = []
  answers = new Map()
  browser.supported = true
  browser.refusal = null
  session(true)
  answer('GET', '/auth/passkeys', listed)

  vi.stubGlobal('fetch', (path: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'

    calls.push({
      method,
      path,
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
    })

    const found = answers.get(`${method} ${path}`) ?? { status: 200, body: {} }

    return Promise.resolve(
      new Response(JSON.stringify(found.body), {
        status: found.status,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the passkeys under "Konto"', () => {
  it('lists each with the day it was added and when it last signed in', async () => {
    mount()

    const list = await screen.findByRole('list', { name: 'Deine Passkeys' })
    const rows = within(list).getAllByRole('listitem')

    expect(rows).toHaveLength(2)
    expect(rows[0]?.textContent).toContain('Laptop Büro')
    expect(rows[0]?.textContent).toContain('Heute, 08:12')
    expect(rows[1]?.textContent).toContain('Telefon')
    expect(rows[1]?.textContent).toContain('Noch nie')
    expect(
      screen.getByText(
        'Das Passwort bleibt. Wer den letzten Passkey löscht, meldet sich weiter damit an.',
      ),
    ).toBeTruthy()
  })

  it('renames one in its line', async () => {
    answer('PATCH', '/auth/passkeys/pk-2', { id: 'pk-2', name: 'Diensthandy' })
    mount()

    await userEvent.click(await screen.findByRole('button', { name: 'Telefon umbenennen' }))

    const field = screen.getByRole('textbox', { name: 'Neuer Name' })

    await userEvent.clear(field)
    await userEvent.type(field, 'Diensthandy')
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }))

    await waitFor(() => {
      expect(calls).toContainEqual({
        method: 'PATCH',
        path: '/auth/passkeys/pk-2',
        body: { name: 'Diensthandy' },
      })
    })
  })

  it('does not send a name that is empty', async () => {
    mount()

    await userEvent.click(await screen.findByRole('button', { name: 'Telefon umbenennen' }))
    await userEvent.clear(screen.getByRole('textbox', { name: 'Neuer Name' }))
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }))

    expect((await screen.findByRole('alert')).textContent).toContain('braucht einen Namen')
    expect(calls.some((call) => call.method === 'PATCH')).toBe(false)
  })

  it('deletes one only after asking', async () => {
    answer('DELETE', '/auth/passkeys/pk-1', { removed: 'pk-1' })
    mount()

    await userEvent.click(await screen.findByRole('button', { name: 'Laptop Büro löschen' }))

    const dialog = screen.getByRole('alertdialog', { name: 'Passkey löschen?' })

    expect(dialog.textContent).toContain('„Laptop Büro“ meldet danach nicht mehr an.')
    expect(calls.some((call) => call.method === 'DELETE')).toBe(false)

    await userEvent.click(within(dialog).getByRole('button', { name: 'Löschen' }))

    await waitFor(() => {
      expect(calls).toContainEqual({
        method: 'DELETE',
        path: '/auth/passkeys/pk-1',
        body: undefined,
      })
    })
  })

  it('adds one after the password and the code, with the name of this device as the proposal', async () => {
    answer('POST', '/api/auth/reconfirm', { reconfirmedUntil: '2026-09-27T10:00:00.000Z' })
    answer('GET', '/api/auth/passkey/generate-register-options', { challenge: 'abc' })
    answer('POST', '/api/auth/passkey/verify-registration', { id: 'pk-3' })
    mount()

    await userEvent.click(await screen.findByRole('button', { name: 'Passkey hinzufügen' }))
    await userEvent.type(screen.getByLabelText('Passwort'), 'das-lange-passwort')
    await userEvent.type(screen.getByLabelText('Code aus der App'), '123456')
    await userEvent.click(screen.getByRole('button', { name: 'Weiter' }))

    const name = (await screen.findByLabelText('Name')) as HTMLInputElement

    expect(calls).toContainEqual({
      method: 'POST',
      path: '/api/auth/reconfirm',
      body: { password: 'das-lange-passwort', code: '123456' },
    })
    // The browser of the tests, which calls itself happy-dom; a real one
    // reads "Chrome auf Windows" and the like.
    expect(name.value).not.toBe('')

    await userEvent.clear(name)
    await userEvent.type(name, 'Laptop Werkstatt')
    await userEvent.click(screen.getByRole('button', { name: 'Passkey anlegen' }))

    await waitFor(() => {
      expect(calls).toContainEqual({
        method: 'POST',
        path: '/api/auth/passkey/verify-registration',
        body: { response: browser.registration, name: 'Laptop Werkstatt' },
      })
    })
  })

  it('asks for the password alone where the account has no app', async () => {
    session(false)
    answer('POST', '/api/auth/reconfirm', { reconfirmedUntil: '2026-09-27T10:00:00.000Z' })
    mount()

    await userEvent.click(await screen.findByRole('button', { name: 'Passkey hinzufügen' }))

    expect(screen.queryByLabelText('Code aus der App')).toBeNull()

    await userEvent.type(screen.getByLabelText('Passwort'), 'das-lange-passwort')
    await userEvent.click(screen.getByRole('button', { name: 'Weiter' }))

    await screen.findByLabelText('Name')
    expect(calls).toContainEqual({
      method: 'POST',
      path: '/api/auth/reconfirm',
      body: { password: 'das-lange-passwort' },
    })
  })

  it('shows the field for the code when the server asks for it, set up in another tab perhaps', async () => {
    session(false)
    answer(
      'POST',
      '/api/auth/reconfirm',
      {
        code: 'CODE_REQUIRED',
        message: 'Für dieses Konto gehört der Code aus der App zur Bestätigung dazu.',
      },
      400,
    )
    mount()

    await userEvent.click(await screen.findByRole('button', { name: 'Passkey hinzufügen' }))

    expect(screen.queryByLabelText('Code aus der App')).toBeNull()

    await userEvent.type(screen.getByLabelText('Passwort'), 'das-lange-passwort')
    await userEvent.click(screen.getByRole('button', { name: 'Weiter' }))

    expect((await screen.findByRole('alert')).textContent).toContain('Code aus der App')
    expect(await screen.findByLabelText('Code aus der App')).toBeTruthy()
  })

  it("says the server's sentence when the confirmation fails", async () => {
    answer(
      'POST',
      '/api/auth/reconfirm',
      { code: 'INVALID_PASSWORD', message: 'Das Passwort stimmt nicht.' },
      401,
    )
    mount()

    await userEvent.click(await screen.findByRole('button', { name: 'Passkey hinzufügen' }))
    await userEvent.type(screen.getByLabelText('Passwort'), 'falsch-aber-lang')
    await userEvent.type(screen.getByLabelText('Code aus der App'), '123456')
    await userEvent.click(screen.getByRole('button', { name: 'Weiter' }))

    expect((await screen.findByRole('alert')).textContent).toBe('Das Passwort stimmt nicht.')
    expect(screen.queryByLabelText('Name')).toBeNull()
  })

  it('says so in German when the browser question is cancelled', async () => {
    answer('POST', '/api/auth/reconfirm', { reconfirmedUntil: '2026-09-27T10:00:00.000Z' })
    answer('GET', '/api/auth/passkey/generate-register-options', { challenge: 'abc' })
    const { WebAuthnError } = await import('@simplewebauthn/browser')
    browser.refusal = new (WebAuthnError as unknown as new (code: string) => Error)(
      'ERROR_CEREMONY_ABORTED',
    )
    mount()

    await userEvent.click(await screen.findByRole('button', { name: 'Passkey hinzufügen' }))
    await userEvent.type(screen.getByLabelText('Passwort'), 'das-lange-passwort')
    await userEvent.type(screen.getByLabelText('Code aus der App'), '123456')
    await userEvent.click(screen.getByRole('button', { name: 'Weiter' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Passkey anlegen' }))

    expect((await screen.findByRole('alert')).textContent).toContain('Abgebrochen')
    expect(calls.some((call) => call.path.endsWith('/verify-registration'))).toBe(false)
  })

  it('shows a box for each passkey below 1024 pixels, where the buttons grow to a finger', async () => {
    // A tablet in portrait: at least 600 pixels, less than 1024.
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(min-width: 37.5rem)',
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
    mount()

    const list = await screen.findByRole('list', { name: 'Deine Passkeys' })
    const boxes = within(list).getAllByRole('listitem')

    expect(boxes[1]?.textContent).toContain('Hinzugefügt am 20.09.2026 · Zuletzt benutzt: Noch nie')
    expect(
      within(boxes[1] as HTMLElement).getByRole('button', { name: 'Telefon löschen' }),
    ).toBeTruthy()
    // No head of a table over boxes.
    expect(screen.queryByText('Zuletzt benutzt')).toBeNull()
  })

  it('offers no adding in a browser that cannot hold a passkey, and keeps the list', async () => {
    browser.supported = false
    mount()

    await screen.findByRole('list', { name: 'Deine Passkeys' })

    expect(screen.queryByRole('button', { name: 'Passkey hinzufügen' })).toBeNull()
    expect(screen.getByText('Dieser Browser kann keinen Passkey anlegen.')).toBeTruthy()
  })
})
