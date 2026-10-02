import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { clockTime, moment, today } from '../format.js'
import { InProbe } from '../probe-application.js'
import { PasskeysPanel } from './passkeys.js'

/**
 * The card "Passkeys" under "Konto" (#167, #248), `passkeys_card()` of the
 * canvas: the list, renaming in the line, deleting after a question, and
 * adding after confirming again. The browser's half is a stand-in; what the
 * server makes of it is in the server's own tests.
 *
 * The card names the application where it says what it will not do without a
 * confirmation at the device (ADR 0010). The one in these tests belongs to
 * nobody.
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
let held: Set<string>

function answer(method: string, path: string, body: unknown, status = 200) {
  answers.set(`${method} ${path}`, { status, body })
}

/** A request the server takes and does not answer, for what the card shows meanwhile. */
function hold(method: string, path: string) {
  held.add(`${method} ${path}`)
}

/** How often the list was asked for, to see that a change asks for it again. */
function listAsked(): number {
  return calls.filter((call) => call.method === 'GET' && call.path === '/auth/passkeys').length
}

// Today as the list counts it, the day in Germany, at noon there: set on the
// clock of the machine instead, the fixture fell on yesterday for the two
// hours a day in which a machine in UTC is still a day behind Germany, and
// the test failed in CI every evening.
const usedToday = new Date(`${today()}T10:00:00Z`)

const listed = [
  {
    id: 'pk-1',
    name: 'Laptop am Schreibtisch',
    createdAt: '2026-09-27T06:00:00.000Z',
    lastUsedAt: usedToday.toISOString(),
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
    user: { id: 'u-1', email: 'mia@nord.example.de', name: 'Mia Mitglied', twoFactorEnabled },
    session: { activeTenantId: 't-1', signInMethod: 'password' },
  })
}

function mount(client = new QueryClient()) {
  render(
    <QueryClientProvider client={client}>
      <InProbe>
        <PasskeysPanel />
      </InProbe>
    </QueryClientProvider>,
  )
}

/** A tablet in portrait: at least 600 pixels, less than 1024, where each passkey is a box. */
function narrow() {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(min-width: 37.5rem)',
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
}

/** The card open at the second step of adding, confirmed with password and code. */
async function atTheName(): Promise<HTMLInputElement> {
  await userEvent.click(await screen.findByRole('button', { name: 'Passkey hinzufügen' }))
  await userEvent.type(screen.getByLabelText('Passwort'), 'das-lange-passwort')
  await userEvent.type(screen.getByLabelText('Code aus der App'), '123456')
  await userEvent.click(screen.getByRole('button', { name: 'Weiter' }))

  return (await screen.findByLabelText('Name')) as HTMLInputElement
}

function adding(): HTMLElement | null {
  return screen.queryByRole('region', { name: 'Passkey hinzufügen' })
}

beforeEach(() => {
  calls = []
  answers = new Map()
  held = new Set()
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

    if (held.has(`${method} ${path}`)) {
      return new Promise<Response>(() => {})
    }

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
    expect(rows[0]?.textContent).toContain('Laptop am Schreibtisch')
    expect(rows[0]?.textContent).toContain(`Heute, ${clockTime(usedToday)}`)
    expect(rows[1]?.textContent).toContain('Telefon')
    // What a screen reader hears in a line, where the eye has the head of the table.
    expect(rows[1]?.textContent).toContain('Hinzugefügt am 20.09.2026')
    expect(rows[1]?.textContent).toContain('Zuletzt benutzt: Noch nie')
    expect(screen.getByText('Zuletzt benutzt')).toBeTruthy()
    expect(
      screen.getByText(
        'Das Passwort bleibt. Wer den letzten Passkey löscht, meldet sich weiter damit an.',
      ),
    ).toBeTruthy()
  })

  it.each([
    ['is on its way', 'Wird geladen.'],
    ['did not arrive', 'Die Liste kam nicht an.'],
    ['is empty', 'Noch kein Passkey für dieses Konto.'],
  ] as const)('says so when the list %s', async (state, sentence) => {
    if (state === 'is on its way') {
      hold('GET', '/auth/passkeys')
    } else if (state === 'did not arrive') {
      answer('GET', '/auth/passkeys', { message: 'Gerade nicht.' }, 500)
    } else {
      answer('GET', '/auth/passkeys', [])
    }

    // Without a second and a third try, so a list that did not arrive says so at once.
    mount(new QueryClient({ defaultOptions: { queries: { retry: false } } }))

    expect(await screen.findByText(sentence)).toBeTruthy()
    expect(screen.queryByRole('list', { name: 'Deine Passkeys' })).toBeNull()
    // Adding does not depend on the list.
    expect(screen.getByRole('button', { name: 'Passkey hinzufügen' })).toBeTruthy()
  })

  it('writes the day and the time for a passkey that last signed in on another day', async () => {
    const lastWeek = '2026-09-21T10:00:00.000Z'

    answer('GET', '/auth/passkeys', [{ ...listed[0], lastUsedAt: lastWeek }, listed[1]])
    mount()

    const rows = within(await screen.findByRole('list', { name: 'Deine Passkeys' })).getAllByRole(
      'listitem',
    )

    expect(rows[0]?.textContent).toContain(moment(lastWeek))
    expect(rows[0]?.textContent).toContain('21.09.2026')
    expect(rows[0]?.textContent).not.toContain('Heute')
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

    await userEvent.click(
      await screen.findByRole('button', { name: 'Laptop am Schreibtisch löschen' }),
    )

    const dialog = screen.getByRole('alertdialog', { name: 'Passkey löschen?' })

    expect(dialog.textContent).toContain('„Laptop am Schreibtisch“ meldet danach nicht mehr an.')
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

    expect(
      screen.getByText(
        'Zur Bestätigung dein Passwort und der Code aus der App, auch wenn du schon angemeldet bist.',
      ),
    ).toBeTruthy()

    await userEvent.type(screen.getByLabelText('Passwort'), 'das-lange-passwort')
    await userEvent.type(screen.getByLabelText('Code aus der App'), '123456')
    await userEvent.click(screen.getByRole('button', { name: 'Weiter' }))

    const name = (await screen.findByLabelText('Name')) as HTMLInputElement

    expect(calls).toContainEqual({
      method: 'POST',
      path: '/api/auth/reconfirm',
      body: { password: 'das-lange-passwort', code: '123456' },
    })
    // Neither stays in the card once the server has taken them.
    expect(screen.queryByLabelText('Passwort')).toBeNull()
    expect(screen.getByText('Bestätigt. Wie soll der Passkey in der Liste heißen?')).toBeTruthy()
    // The browser of the tests, which calls itself happy-dom; a real one
    // reads "Chrome auf Windows" and the like.
    expect(name.value).not.toBe('')
    // What the application will not do without the confirmation at the
    // device, said by its name.
    expect(
      screen.getByText(
        'Danach fragt der Browser nach Fingerabdruck, Gesicht oder PIN. Ohne diese Bestätigung am Gerät legt Probewerk keinen Passkey an.',
      ),
    ).toBeTruthy()

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
    expect(
      screen.getByText('Zur Bestätigung dein Passwort, auch wenn du schon angemeldet bist.'),
    ).toBeTruthy()

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
    narrow()
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

  it('renames and deletes from a box as from a line', async () => {
    answer('PATCH', '/auth/passkeys/pk-2', { id: 'pk-2', name: 'Diensthandy' })
    answer('DELETE', '/auth/passkeys/pk-1', { removed: 'pk-1' })
    narrow()
    mount()

    const boxes = within(await screen.findByRole('list', { name: 'Deine Passkeys' })).getAllByRole(
      'listitem',
    )
    const box = boxes[1] as HTMLElement

    await userEvent.click(within(box).getByRole('button', { name: 'Telefon umbenennen' }))

    const field = within(box).getByRole('textbox', { name: 'Neuer Name' })

    // The field takes the place of the name and of the two buttons.
    expect(within(box).queryByRole('button', { name: 'Telefon löschen' })).toBeNull()

    await userEvent.click(within(box).getByRole('button', { name: 'Abbrechen' }))
    expect(within(box).queryByRole('textbox', { name: 'Neuer Name' })).toBeNull()
    expect(field.isConnected).toBe(false)

    await userEvent.click(within(box).getByRole('button', { name: 'Telefon umbenennen' }))
    await userEvent.clear(within(box).getByRole('textbox', { name: 'Neuer Name' }))
    await userEvent.type(within(box).getByRole('textbox', { name: 'Neuer Name' }), 'Diensthandy')
    await userEvent.click(within(box).getByRole('button', { name: 'Speichern' }))

    await waitFor(() => {
      expect(calls).toContainEqual({
        method: 'PATCH',
        path: '/auth/passkeys/pk-2',
        body: { name: 'Diensthandy' },
      })
    })

    await userEvent.click(
      within(boxes[0] as HTMLElement).getByRole('button', {
        name: 'Laptop am Schreibtisch löschen',
      }),
    )
    await userEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Löschen' }),
    )

    await waitFor(() => {
      expect(calls.some((call) => call.method === 'DELETE')).toBe(true)
    })
  })

  it('asks for the list again once a passkey was renamed, and closes the field', async () => {
    answer('PATCH', '/auth/passkeys/pk-2', { id: 'pk-2', name: 'Telefon neu' })
    mount()

    await userEvent.click(await screen.findByRole('button', { name: 'Telefon umbenennen' }))

    // The line gives up its two buttons while its name is being changed.
    expect(screen.queryByRole('button', { name: 'Telefon löschen' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Laptop am Schreibtisch löschen' })).toBeTruthy()

    const before = listAsked()

    await userEvent.type(screen.getByRole('textbox', { name: 'Neuer Name' }), ' neu ')
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }))

    await waitFor(() => {
      expect(listAsked()).toBeGreaterThan(before)
    })
    expect(screen.queryByRole('textbox', { name: 'Neuer Name' })).toBeNull()
    // The name goes without the blanks somebody left around it.
    expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({ name: 'Telefon neu' })
  })

  it("says the server's sentence when a name is refused, and its own when nothing came back", async () => {
    answer('PATCH', '/auth/passkeys/pk-2', { message: 'So heißt schon ein Passkey.' }, 409)
    mount()

    await userEvent.click(await screen.findByRole('button', { name: 'Telefon umbenennen' }))
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }))

    expect((await screen.findByRole('alert')).textContent).toBe('So heißt schon ein Passkey.')
    // The field stays open, to be corrected.
    expect(screen.getByRole('textbox', { name: 'Neuer Name' })).toBeTruthy()

    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')))
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }))

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe('Der Name ließ sich nicht ändern.')
    })
  })

  it('takes a renaming back, and what went wrong about it with it', async () => {
    mount()

    await userEvent.click(await screen.findByRole('button', { name: 'Telefon umbenennen' }))
    await userEvent.clear(screen.getByRole('textbox', { name: 'Neuer Name' }))
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }))
    await screen.findByRole('alert')
    await userEvent.click(screen.getByRole('button', { name: 'Abbrechen' }))

    expect(screen.queryByRole('textbox', { name: 'Neuer Name' })).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    // The name is the one it was.
    expect(screen.getByRole('button', { name: 'Telefon umbenennen' })).toBeTruthy()
    expect(calls.some((call) => call.method === 'PATCH')).toBe(false)
  })

  it('waits with the name while the server has it', async () => {
    hold('PATCH', '/auth/passkeys/pk-2')
    mount()

    await userEvent.click(await screen.findByRole('button', { name: 'Telefon umbenennen' }))
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }))

    await waitFor(() => {
      expect(
        (screen.getByRole('button', { name: 'Speichern' }) as HTMLButtonElement).disabled,
      ).toBe(true)
    })
  })

  it('keeps a passkey when the question is taken back', async () => {
    mount()

    await userEvent.click(
      await screen.findByRole('button', { name: 'Laptop am Schreibtisch löschen' }),
    )
    await userEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Abbrechen' }),
    )

    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(calls.some((call) => call.method === 'DELETE')).toBe(false)
  })

  it('asks for the list again once a passkey was deleted, and says so when it could not be', async () => {
    answer('DELETE', '/auth/passkeys/pk-1', { removed: 'pk-1' })
    answer('DELETE', '/auth/passkeys/pk-2', { message: 'Gerade nicht.' }, 500)
    mount()

    await userEvent.click(
      await screen.findByRole('button', { name: 'Laptop am Schreibtisch löschen' }),
    )

    const before = listAsked()

    await userEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Löschen' }),
    )
    await waitFor(() => {
      expect(listAsked()).toBeGreaterThan(before)
    })
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Telefon löschen' }))
    await userEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Löschen' }),
    )

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Der Passkey ließ sich nicht löschen.',
    )
    // The question does not stay over a sentence nobody could read under it.
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('holds both buttons of the question while the server deletes', async () => {
    hold('DELETE', '/auth/passkeys/pk-1')
    mount()

    await userEvent.click(
      await screen.findByRole('button', { name: 'Laptop am Schreibtisch löschen' }),
    )

    const dialog = screen.getByRole('alertdialog')

    await userEvent.click(within(dialog).getByRole('button', { name: 'Löschen' }))

    await waitFor(() => {
      expect(
        (within(dialog).getByRole('button', { name: 'Löschen' }) as HTMLButtonElement).disabled,
      ).toBe(true)
    })
    expect(
      (within(dialog).getByRole('button', { name: 'Abbrechen' }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it.each([
    ['renaming another', 'Laptop am Schreibtisch umbenennen'],
    ['deleting another', 'Laptop am Schreibtisch löschen'],
    ['adding one', 'Passkey hinzufügen'],
  ])('drops what went wrong once somebody goes on to %s', async (_what, button) => {
    answer('DELETE', '/auth/passkeys/pk-2', { message: 'Gerade nicht.' }, 500)
    mount()

    await userEvent.click(await screen.findByRole('button', { name: 'Telefon löschen' }))
    await userEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Löschen' }),
    )
    await screen.findByRole('alert')

    await userEvent.click(screen.getByRole('button', { name: button }))

    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('takes the adding back at either step, and asks for the list again once one was added', async () => {
    answer('POST', '/api/auth/reconfirm', { reconfirmedUntil: '2026-09-27T10:00:00.000Z' })
    answer('GET', '/api/auth/passkey/generate-register-options', { challenge: 'abc' })
    answer('POST', '/api/auth/passkey/verify-registration', { id: 'pk-3' })
    mount()

    await userEvent.click(await screen.findByRole('button', { name: 'Passkey hinzufügen' }))
    expect(adding()).toBeTruthy()
    // The button that opened it makes room for the two steps.
    expect(screen.queryByRole('button', { name: 'Passkey hinzufügen' })).toBeNull()
    await userEvent.click(
      within(adding() as HTMLElement).getByRole('button', { name: 'Abbrechen' }),
    )
    expect(adding()).toBeNull()

    await atTheName()
    await userEvent.click(
      within(adding() as HTMLElement).getByRole('button', { name: 'Abbrechen' }),
    )
    expect(adding()).toBeNull()
    expect(calls.some((call) => call.path.includes('/passkey/'))).toBe(false)

    // Confirmed a moment ago, and asked again all the same: the card keeps no password.
    await atTheName()

    const before = listAsked()

    await userEvent.click(screen.getByRole('button', { name: 'Passkey anlegen' }))

    await waitFor(() => {
      expect(listAsked()).toBeGreaterThan(before)
    })
    expect(adding()).toBeNull()
    expect(screen.getByRole('button', { name: 'Passkey hinzufügen' })).toBeTruthy()
  })

  it('does not ask the browser for a passkey without a name', async () => {
    answer('POST', '/api/auth/reconfirm', { reconfirmedUntil: '2026-09-27T10:00:00.000Z' })
    mount()

    const name = await atTheName()

    // Nothing is wrong with a name nobody has tried to save yet.
    await userEvent.clear(name)
    expect(screen.queryByText(/braucht einen Namen/)).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Passkey anlegen' }))

    expect(screen.getByText(/braucht einen Namen/)).toBeTruthy()
    expect(calls.some((call) => call.path.includes('/passkey/'))).toBe(false)
  })

  /**
   * The confirmation holds ten minutes on the server (#167). A name that takes
   * longer sends somebody back to the first step, with the server's sentence.
   */
  it('goes back to the confirmation when it has run out by the time the name is given', async () => {
    answer('POST', '/api/auth/reconfirm', { reconfirmedUntil: '2026-09-27T10:00:00.000Z' })
    answer(
      'GET',
      '/api/auth/passkey/generate-register-options',
      { code: 'RECONFIRMATION_REQUIRED', message: 'Bitte noch einmal bestätigen.' },
      403,
    )
    mount()

    await atTheName()
    await userEvent.click(screen.getByRole('button', { name: 'Passkey anlegen' }))

    expect((await screen.findByRole('alert')).textContent).toBe('Bitte noch einmal bestätigen.')
    expect(screen.getByLabelText('Passwort')).toBeTruthy()
    expect(screen.queryByLabelText('Name')).toBeNull()
    // The card kept neither the password nor the code of the first time.
    expect((screen.getByLabelText('Passwort') as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText('Code aus der App') as HTMLInputElement).value).toBe('')
  })

  it('stays at the name when the passkey could not be added for another reason', async () => {
    answer('POST', '/api/auth/reconfirm', { reconfirmedUntil: '2026-09-27T10:00:00.000Z' })
    answer('GET', '/api/auth/passkey/generate-register-options', { challenge: 'abc' })
    browser.refusal = new Error('the authenticator fell over')
    mount()

    await atTheName()
    await userEvent.click(screen.getByRole('button', { name: 'Passkey anlegen' }))

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Der Passkey ließ sich nicht anlegen.',
    )
    expect(screen.getByLabelText('Name')).toBeTruthy()
    // Free to try again.
    expect(
      (screen.getByRole('button', { name: 'Passkey anlegen' }) as HTMLButtonElement).disabled,
    ).toBe(false)
  })

  it('says its own sentence when the confirmation did not come back', async () => {
    mount()

    await userEvent.click(await screen.findByRole('button', { name: 'Passkey hinzufügen' }))
    await userEvent.type(screen.getByLabelText('Passwort'), 'das-lange-passwort')
    await userEvent.type(screen.getByLabelText('Code aus der App'), '123456')

    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')))
    await userEvent.click(screen.getByRole('button', { name: 'Weiter' }))

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Die Bestätigung kam nicht an. Bitte gleich noch einmal.',
    )
    expect(screen.queryByLabelText('Name')).toBeNull()
    expect((screen.getByRole('button', { name: 'Weiter' }) as HTMLButtonElement).disabled).toBe(
      false,
    )
  })

  it.each([
    ['the confirmation', 'POST', '/api/auth/reconfirm', 'Wird geprüft'],
    ['the passkey', 'GET', '/api/auth/passkey/generate-register-options', 'Einen Moment'],
  ])('waits while %s is on its way', async (_what, method, path, label) => {
    answer('POST', '/api/auth/reconfirm', { reconfirmedUntil: '2026-09-27T10:00:00.000Z' })
    hold(method, path)
    mount()

    await userEvent.click(await screen.findByRole('button', { name: 'Passkey hinzufügen' }))
    await userEvent.type(screen.getByLabelText('Passwort'), 'das-lange-passwort')
    await userEvent.type(screen.getByLabelText('Code aus der App'), '123456')
    await userEvent.click(screen.getByRole('button', { name: 'Weiter' }))

    if (method === 'GET') {
      await userEvent.click(await screen.findByRole('button', { name: 'Passkey anlegen' }))
    }

    const waiting = (await screen.findByRole('button', { name: label })) as HTMLButtonElement

    expect(waiting.disabled).toBe(true)
  })

  it('offers no adding in a browser that cannot hold a passkey, and keeps the list', async () => {
    browser.supported = false
    mount()

    await screen.findByRole('list', { name: 'Deine Passkeys' })

    expect(screen.queryByRole('button', { name: 'Passkey hinzufügen' })).toBeNull()
    expect(screen.getByText('Dieser Browser kann keinen Passkey anlegen.')).toBeTruthy()
  })
})
