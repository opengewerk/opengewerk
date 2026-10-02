import 'fake-indexeddb/auto'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { probeClient, standInServer } from '../in-frame.js'
import type { StandIn } from '../in-frame.js'
import { InProbe } from '../probe-application.js'
import { SyncProvider } from '../sync/provider.js'
import { AccountScreen } from './account.js'

/**
 * What somebody looks after about their own account: light or dark on this
 * device (#216), the second factor with its recovery codes (#125), the
 * password (#126) and the devices the account is signed in on.
 *
 * What the application is called, for whom a second factor is required there
 * and what its two entries are called is the application's to say (ADR 0010),
 * and so are the cards it adds. The one in these tests belongs to nobody.
 */

let server: StandIn

function signedIn(twoFactorEnabled: boolean) {
  server.answer('GET', '/api/auth/get-session', {
    user: { id: 'u-1', email: 'mia@nord.example.de', name: 'Mia Mitglied', twoFactorEnabled },
    session: { activeTenantId: 't-1', signInMethod: 'password' },
  })
}

async function account(children?: ReactNode) {
  const client = await probeClient()

  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <InProbe>
        <SyncProvider client={client}>
          <AccountScreen>{children}</AccountScreen>
        </SyncProvider>
      </InProbe>
    </QueryClientProvider>,
  )

  await screen.findByRole('heading', { level: 1, name: 'Konto' })
}

/** A card of the screen, by its title. */
function card(title: string) {
  return within(screen.getByRole('region', { name: title }))
}

/** What was sent to a route, in order. */
function sent(method: string, path: string): unknown[] {
  return server.heard
    .filter((call) => call.method === method && call.path === path)
    .map((call) => call.body)
}

const desk = {
  sessionId: 's-1',
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  signedInAt: '2026-10-02T06:00:00.000Z',
  expiresAt: '2026-10-02T18:00:00.000Z',
  longLived: false,
  current: true,
}

const phone = {
  sessionId: 's-2',
  userAgent:
    'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
  signedInAt: '2026-09-28T05:30:00.000Z',
  expiresAt: '2026-10-28T05:30:00.000Z',
  longLived: true,
  current: false,
}

beforeEach(() => {
  globalThis.localStorage.clear()
  delete document.documentElement.dataset['theme']
  server = standInServer()
  signedIn(false)
  server.answer('GET', '/auth/tenants', [])
  server.answer('GET', '/auth/devices', [])
  server.answer('GET', '/auth/passkeys', [])
  vi.spyOn(globalThis.location, 'assign').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('the account screen', () => {
  it('names the person under its title, and the account alone until it is known', async () => {
    server.answer('GET', '/api/auth/get-session', null)
    await account()

    expect(screen.getByText('Dieses Konto.')).toBeTruthy()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })

  it('names the person with the address once the account is known', async () => {
    await account()

    expect(await screen.findByText('Mia Mitglied, mia@nord.example.de')).toBeTruthy()
  })

  it('shows what the application adds between the passkeys and the password', async () => {
    await account(<section aria-label="Lager">Die Regale dieser Person.</section>)

    const added = screen.getByRole('region', { name: 'Lager' })
    const before = screen.getByRole('region', { name: 'Passkeys' })
    const after = screen.getByRole('region', { name: 'Passwort' })

    expect(before.compareDocumentPosition(added) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(added.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('starts the page again at the office once somebody signed out', async () => {
    await account()
    await userEvent.click(screen.getByRole('button', { name: 'Abmelden' }))

    await waitFor(() => {
      expect(globalThis.location.assign).toHaveBeenCalledWith('/')
    })
  })
})

describe('light or dark on the account screen', () => {
  it('says how the application looks on this device, by its name and in its words', async () => {
    await account()

    expect(
      card('Darstellung').getByText(
        'Wie Probewerk auf diesem Gerät aussieht. Hell ist der Standard, auf jedem neuen Gerät und vor der Anmeldung.',
      ),
    ).toBeTruthy()
    // That it holds on this device is the foundation's to say; where else it
    // may be chosen otherwise, the application's.
    expect(
      card('Darstellung').getByText(
        'Gilt auf diesem Gerät, auch ohne Netz. Unterwegs lässt sich etwas anderes wählen.',
      ),
    ).toBeTruthy()
  })

  it('switches this device and remembers it, with light as the start', async () => {
    await account()

    const group = card('Darstellung').getByRole('group', { name: 'Darstellung' })
    const pressed = (name: string) =>
      within(group).getByRole('button', { name }).getAttribute('aria-pressed')

    expect(pressed('Hell')).toBe('true')

    await userEvent.click(within(group).getByRole('button', { name: 'Dunkel' }))

    expect(document.documentElement.dataset['theme']).toBe('dark')
    expect(globalThis.localStorage.getItem('opengewerk.theme')).toBe('dark')
    expect(pressed('Dunkel')).toBe('true')
    expect(pressed('Hell')).toBe('false')

    await userEvent.click(within(group).getByRole('button', { name: 'Hell' }))

    expect(document.documentElement.dataset['theme']).toBe('light')
  })
})

describe('the second factor of the account', () => {
  /**
   * Not "Noch nicht eingerichtet" while the answer is on its way: for a
   * moment that told everybody with a second factor they had none (#223).
   */
  it('says that it is loading until the account is known', async () => {
    vi.stubGlobal('fetch', () => new Promise<Response>(() => {}))
    await account()

    expect(card('Zweiter Faktor').getByText('Wird geladen.')).toBeTruthy()
    expect(card('Zweiter Faktor').queryByText(/Noch nicht eingerichtet/)).toBeNull()
  })

  it('offers to set one up where there is none, and says for whom it is required in the words of the application', async () => {
    await account()

    expect(
      await card('Zweiter Faktor').findByText(
        'Noch nicht eingerichtet. Ein zweiter Faktor macht ein gestohlenes Passwort allein nutzlos. Für die Leitung ist er Pflicht.',
      ),
    ).toBeTruthy()
    expect(
      card('Zweiter Faktor').queryByRole('region', { name: 'Wiederherstellungscodes' }),
    ).toBeNull()
  })

  it('opens the setup in place and closes it again', async () => {
    await account()
    await userEvent.click(
      await card('Zweiter Faktor').findByRole('button', { name: 'Zweiten Faktor einrichten' }),
    )

    // The setup asks for the password first; it is the gate's and tested there.
    expect(card('Zweiter Faktor').getByLabelText('Passwort')).toBeTruthy()
    expect(
      card('Zweiter Faktor').queryByRole('button', { name: 'Zweiten Faktor einrichten' }),
    ).toBeNull()

    await userEvent.click(card('Zweiter Faktor').getByRole('button', { name: 'Später' }))

    expect(
      card('Zweiter Faktor').getByRole('button', { name: 'Zweiten Faktor einrichten' }),
    ).toBeTruthy()
  })

  it('says that it is set up, by the name of the application, with the recovery codes under it', async () => {
    signedIn(true)
    await account()

    expect(
      await card('Zweiter Faktor').findByText(
        'Eingerichtet. Bei jeder Anmeldung fragt Probewerk zusätzlich nach dem Code aus der App.',
      ),
    ).toBeTruthy()
    expect(
      card('Zweiter Faktor').getByRole('region', { name: 'Wiederherstellungscodes' }),
    ).toBeTruthy()
    expect(
      card('Zweiter Faktor').queryByRole('button', { name: 'Zweiten Faktor einrichten' }),
    ).toBeNull()
  })
})

describe('the recovery codes of the account', () => {
  beforeEach(() => {
    signedIn(true)
  })

  function codes() {
    return within(screen.getByRole('region', { name: 'Wiederherstellungscodes' }))
  }

  it.each([
    [3, 'Noch 3 Codes übrig. Die Codes sind der Weg hinein, wenn das Telefon weg ist.'],
    [1, 'Noch ein Code übrig. Die Codes sind der Weg hinein, wenn das Telefon weg ist.'],
    [
      0,
      'Kein Code mehr übrig. Ist das Telefon weg, geht die Anmeldung dann nicht mehr; am besten jetzt neue Codes erzeugen.',
    ],
  ])('say how many are left: %i', async (left, sentence) => {
    server.answer('GET', '/auth/recovery-codes', { left })
    await account()

    expect(await screen.findByText(sentence)).toBeTruthy()
  })

  it('say what they are for while the count is not known', async () => {
    // An answer without a count, as a server that keeps none gives.
    server.answer('GET', '/auth/recovery-codes', {})
    await account()
    await screen.findByRole('region', { name: 'Wiederherstellungscodes' })

    expect(
      await codes().findByText(
        'Die Codes sind der Weg hinein, wenn das Telefon weg ist. Jeder gilt einmal.',
      ),
    ).toBeTruthy()
  })

  /**
   * The count and not the codes: they were shown once, when they were made. A
   * new set asks for the password and replaces the old one.
   */
  it('make a new set only after the password, show it once and count again', async () => {
    server.answer('GET', '/auth/recovery-codes', { left: 3 })
    server.answer('POST', '/api/auth/two-factor/generate-backup-codes', {
      backupCodes: ['aaaaa-11111', 'bbbbb-22222'],
    })
    await account()
    await screen.findByText(/Noch 3 Codes übrig/)

    // The small button opens the question, and the one under the password
    // makes the codes (#219).
    await userEvent.click(codes().getByRole('button', { name: 'Neue Codes erzeugen' }))

    expect(sent('POST', '/api/auth/two-factor/generate-backup-codes')).toEqual([])

    const counted = server.heard.filter((call) => call.path === '/auth/recovery-codes').length

    await userEvent.type(codes().getByLabelText('Passwort zur Bestätigung'), 'das-passwort')
    await userEvent.click(codes().getByRole('button', { name: 'Neue Codes erzeugen' }))

    expect(await codes().findByText('aaaaa-11111')).toBeTruthy()
    expect(codes().getByText('bbbbb-22222')).toBeTruthy()
    expect(sent('POST', '/api/auth/two-factor/generate-backup-codes')).toEqual([
      { password: 'das-passwort' },
    ])
    // The question is closed, the password gone from the page.
    expect(codes().queryByLabelText('Passwort zur Bestätigung')).toBeNull()
    await waitFor(() => {
      expect(
        server.heard.filter((call) => call.path === '/auth/recovery-codes').length,
      ).toBeGreaterThan(counted)
    })
  })

  it('say the sentence of the server when the password is refused, and keep the question open', async () => {
    server.answer('GET', '/auth/recovery-codes', { left: 3 })
    server.answer(
      'POST',
      '/api/auth/two-factor/generate-backup-codes',
      { message: 'Das Passwort stimmt nicht.' },
      401,
    )
    await account()
    await screen.findByText(/Noch 3 Codes übrig/)
    await userEvent.click(codes().getByRole('button', { name: 'Neue Codes erzeugen' }))
    await userEvent.type(codes().getByLabelText('Passwort zur Bestätigung'), 'falsch')
    await userEvent.click(codes().getByRole('button', { name: 'Neue Codes erzeugen' }))

    expect((await codes().findByRole('alert')).textContent).toBe('Das Passwort stimmt nicht.')
    expect(codes().getByLabelText('Passwort zur Bestätigung')).toBeTruthy()
  })

  it('say so in their own words when nothing came back', async () => {
    server.answer('GET', '/auth/recovery-codes', { left: 3 })
    await account()
    await screen.findByText(/Noch 3 Codes übrig/)
    await userEvent.click(codes().getByRole('button', { name: 'Neue Codes erzeugen' }))
    await userEvent.type(codes().getByLabelText('Passwort zur Bestätigung'), 'das-passwort')
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')))
    await userEvent.click(codes().getByRole('button', { name: 'Neue Codes erzeugen' }))

    expect((await codes().findByRole('alert')).textContent).toBe(
      'Es kamen keine neuen Codes zurück.',
    )
  })

  it('take the question back without asking the server', async () => {
    server.answer('GET', '/auth/recovery-codes', { left: 3 })
    await account()
    await screen.findByText(/Noch 3 Codes übrig/)
    await userEvent.click(codes().getByRole('button', { name: 'Neue Codes erzeugen' }))
    await userEvent.type(codes().getByLabelText('Passwort zur Bestätigung'), 'das-passwort')
    await userEvent.click(codes().getByRole('button', { name: 'Abbrechen' }))

    expect(codes().queryByLabelText('Passwort zur Bestätigung')).toBeNull()
    expect(sent('POST', '/api/auth/two-factor/generate-backup-codes')).toEqual([])

    // Opened again, the password typed before is gone.
    await userEvent.click(codes().getByRole('button', { name: 'Neue Codes erzeugen' }))
    expect((codes().getByLabelText('Passwort zur Bestätigung') as HTMLInputElement).value).toBe('')
  })
})

describe('the password of the account', () => {
  async function typed(old: string, next: string, repeated: string) {
    const fill = async (label: string, value: string) => {
      const field = card('Passwort').getByLabelText(label)

      await userEvent.clear(field)
      await userEvent.type(field, value)
    }

    await fill('Bisheriges Passwort', old)
    await fill('Neues Passwort', next)
    await fill('Neues Passwort wiederholen', repeated)
    await userEvent.click(card('Passwort').getByRole('button', { name: 'Passwort ändern' }))
  }

  it('changes with the old one, signs the other devices out and lists them again', async () => {
    server.answer('POST', '/api/auth/change-password', { status: true })
    await account()

    const listed = () => server.heard.filter((call) => call.path === '/auth/devices').length
    const before = listed()

    await typed('das-alte-passwort', 'das-neue-lange-passwort', 'das-neue-lange-passwort')

    expect((await card('Passwort').findByRole('status')).textContent).toBe(
      'Geändert. Alle anderen Geräte dieses Zugangs sind abgemeldet.',
    )
    expect(sent('POST', '/api/auth/change-password')).toEqual([
      {
        currentPassword: 'das-alte-passwort',
        newPassword: 'das-neue-lange-passwort',
        revokeOtherSessions: true,
      },
    ])
    // The three fields are empty again, and the list of devices is asked anew.
    expect((card('Passwort').getByLabelText('Bisheriges Passwort') as HTMLInputElement).value).toBe(
      '',
    )
    await waitFor(() => {
      expect(listed()).toBeGreaterThan(before)
    })
  })

  it('refuses one that is too short before anything is sent', async () => {
    await account()
    await typed('das-alte-passwort', 'zu-kurz', 'zu-kurz')

    expect(card('Passwort').getByRole('alert').textContent).toBe(
      'Das neue Passwort braucht mindestens 12 Zeichen.',
    )
    expect(sent('POST', '/api/auth/change-password')).toEqual([])
  })

  it('refuses one that is not repeated before anything is sent', async () => {
    await account()
    await typed('das-alte-passwort', 'das-neue-lange-passwort', 'das-andere-lange-passwort')

    expect(card('Passwort').getByRole('alert').textContent).toBe(
      'Die beiden neuen Passwörter sind nicht gleich.',
    )
    expect(sent('POST', '/api/auth/change-password')).toEqual([])
  })

  it('asks whether the old one is right when the server refuses', async () => {
    server.answer('POST', '/api/auth/change-password', { message: 'Invalid password' }, 400)
    await account()
    await typed('nicht-das-alte', 'das-neue-lange-passwort', 'das-neue-lange-passwort')

    expect((await card('Passwort').findByRole('alert')).textContent).toBe(
      'Das Passwort wurde nicht geändert. Stimmt das bisherige?',
    )
    // What was typed stays, to be corrected.
    expect((card('Passwort').getByLabelText('Neues Passwort') as HTMLInputElement).value).toBe(
      'das-neue-lange-passwort',
    )
  })

  it('asks to try again when the change did not arrive', async () => {
    await account()
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')))
    await typed('das-alte-passwort', 'das-neue-lange-passwort', 'das-neue-lange-passwort')

    expect((await card('Passwort').findByRole('alert')).textContent).toBe(
      'Die Änderung kam nicht an. Bitte gleich noch einmal.',
    )
  })
})

describe('the devices of the account', () => {
  const devices = 'Angemeldete Geräte'

  it('say that this is the only one where no other is signed in', async () => {
    await account()

    expect(await card(devices).findByText('Keine Anmeldung außer dieser.')).toBeTruthy()
    expect(card(devices).queryByRole('table')).toBeNull()
  })

  it('say so when the list did not arrive', async () => {
    server.answer('GET', '/auth/devices', {}, 500)
    await account()

    expect(await card(devices).findByText('Die Liste kam nicht an.')).toBeTruthy()
  })

  it('say that they are loading until the list is there', async () => {
    vi.stubGlobal('fetch', () => new Promise<Response>(() => {}))
    await account()

    expect(card(devices).getByText('Wird geladen.')).toBeTruthy()
  })

  /**
   * How long a session holds is the foundation's to say, by the kind of
   * session; what the entry it was opened from is called, the application's.
   */
  it('list each with what it is and which kind of session, by the names of the application for its entries', async () => {
    server.answer('GET', '/auth/devices', [desk, phone])
    await account()

    const table = await screen.findByRole('table', {
      name: 'Geräte, auf denen dieses Konto angemeldet ist',
    })
    const rows = within(table).getAllByRole('row').slice(1)

    expect(rows).toHaveLength(2)
    expect(rows[0]?.textContent).toContain('Chrome auf Windows')
    expect(rows[0]?.textContent).toContain('dieses Gerät')
    expect(rows[0]?.textContent).toContain('Schreibtisch, 12 Stunden')
    expect(rows[1]?.textContent).toContain('Chrome auf Android')
    expect(rows[1]?.textContent).not.toContain('dieses Gerät')
    expect(rows[1]?.textContent).toContain('Unterwegs, 30 Tage')
  })

  it('offer no sign out for the device one is looking from', async () => {
    server.answer('GET', '/auth/devices', [desk, phone])
    await account()

    const table = await screen.findByRole('table')
    const button = (name: string) =>
      within(table).getByRole('button', { name }) as HTMLButtonElement

    expect(button('Chrome auf Windows abmelden').disabled).toBe(true)
    expect(button('Chrome auf Android abmelden').disabled).toBe(false)
  })

  it('sign another device out only after asking, and list them again', async () => {
    server.answer('GET', '/auth/devices', [desk, phone])
    server.answer('DELETE', '/auth/devices/s-2', {})
    await account()

    const table = await screen.findByRole('table')
    const listed = () =>
      server.heard.filter((call) => call.method === 'GET' && call.path === '/auth/devices').length

    await userEvent.click(
      within(table).getByRole('button', { name: 'Chrome auf Android abmelden' }),
    )

    const question = screen.getByRole('alertdialog', { name: 'Gerät abmelden?' })

    expect(question.textContent).toContain('Chrome auf Android muss sich danach neu anmelden.')
    expect(server.heard.some((call) => call.method === 'DELETE')).toBe(false)

    const before = listed()

    await userEvent.click(within(question).getByRole('button', { name: 'Abmelden' }))

    await waitFor(() => {
      expect(sent('DELETE', '/auth/devices/s-2')).toHaveLength(1)
    })
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull()
    })
    await waitFor(() => {
      expect(listed()).toBeGreaterThan(before)
    })
  })

  it('leave the device signed in when the question is taken back', async () => {
    server.answer('GET', '/auth/devices', [desk, phone])
    await account()
    await userEvent.click(
      within(await screen.findByRole('table')).getByRole('button', {
        name: 'Chrome auf Android abmelden',
      }),
    )
    await userEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Abbrechen' }),
    )

    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(server.heard.some((call) => call.method === 'DELETE')).toBe(false)
  })

  it('say so when a device could not be signed out', async () => {
    server.answer('GET', '/auth/devices', [desk, phone])
    server.answer('DELETE', '/auth/devices/s-2', {}, 500)
    await account()
    await userEvent.click(
      within(await screen.findByRole('table')).getByRole('button', {
        name: 'Chrome auf Android abmelden',
      }),
    )
    await userEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Abmelden' }),
    )

    expect(
      (await screen.findByText('Das Gerät ließ sich nicht abmelden.')).getAttribute('role'),
    ).toBe('alert')
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })
})
