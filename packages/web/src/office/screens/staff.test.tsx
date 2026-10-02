import { shippedRoles } from '@opengewerk/domain'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { InRouter } from '../../app/in-router.js'
import { aTenantChoice } from '../../session/test-tenants.js'
import { StaffScreen } from './staff.js'

/**
 * "Zugänge" in the office, as this application binds it (ADR 0010).
 *
 * The screen is the foundation's and has its tests there: the link that is
 * shown once, the warning before a role with a second factor, the roles of a
 * business by its own names, blocking, invitations and devices. Here is what
 * only this application can get wrong: its sentences, the question whether
 * the business sends mail, the role a new colleague starts with, and the key
 * the screen has among the settings of a business.
 */

interface Call {
  readonly path: string
  readonly method: string
  readonly body: unknown
}

let calls: Call[]
let answers: Map<string, unknown>

function serverSays(method: string, path: string, answer: unknown): void {
  answers.set(`${method} ${path}`, answer)
}

function sent(method: string, path: string): unknown[] {
  return calls
    .filter((call) => call.method === method && call.path === path)
    .map((call) => call.body)
}

function staffScreen(at = '/einstellungen/zugaenge') {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <InRouter at={at}>
        <StaffScreen />
      </InRouter>
    </QueryClientProvider>,
  )
}

const christa = {
  userId: 'u-1',
  name: 'Christa Chefin',
  email: 'chefin@nord.example.de',
  roles: ['owner'],
  blockedAt: null,
  lastSignInAt: '2026-09-20T08:00:00.000Z',
  twoFactorEnabled: true,
}

const maxMonteur = {
  userId: 'u-2',
  name: 'Max Monteur',
  email: 'monteur@nord.example.de',
  roles: ['technician'],
  blockedAt: null,
  lastSignInAt: null,
  twoFactorEnabled: false,
}

beforeEach(() => {
  calls = []
  answers = new Map()

  serverSays('GET', '/staff', [christa, maxMonteur])
  // The roles of the business, as the server lists them from its rows: here
  // the three a business starts with.
  serverSays('GET', '/staff/roles', shippedRoles)
  serverSays('GET', '/staff/invitations', [])
  // Christa is looking, and she is the owner: the list of settings at the
  // side asks which of them she may read.
  serverSays('GET', '/api/auth/get-session', {
    user: { id: 'u-1', email: 'chefin@nord.example.de', name: 'Christa Chefin' },
    session: { activeTenantId: 't-1' },
  })
  serverSays('GET', '/auth/tenants', [aTenantChoice(['owner'])])

  vi.stubGlobal('fetch', (path: string, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${path}`

    calls.push({
      path,
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    })

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

describe('"Zugänge" in the office', () => {
  it('says who works in this business, and names its table by the business', async () => {
    staffScreen()
    await screen.findByText('Max Monteur')

    expect(screen.getByText('Wer in diesem Betrieb arbeitet, und womit.')).toBeTruthy()
    expect(screen.getByRole('table', { name: 'Konten dieses Betriebs' })).toBeTruthy()
  })

  /**
   * The screen names itself by a key, and the settings of this application
   * have to list it under that key. Opened somewhere else than at its own
   * address, so that the router does not light the entry by itself.
   */
  it('is lit among the settings of the business', async () => {
    staffScreen('/anderswo')
    await screen.findByText('Max Monteur')

    const settings = screen.getByRole('navigation', { name: 'Einstellungen' })
    const entry = await within(settings).findByRole('link', { name: 'Zugänge' })

    expect(entry.getAttribute('aria-current')).toBe('page')
    expect(entry.getAttribute('href')).toBe('/einstellungen/zugaenge')
  })

  it('starts the form of a new account with the technician ticked', async () => {
    staffScreen()
    await screen.findByText('Max Monteur')

    await userEvent.setup().click(screen.getByRole('button', { name: 'Zugang anlegen' }))

    const form = screen
      .getByRole('button', { name: 'Link erzeugen' })
      .closest('form') as HTMLElement

    expect(
      within(form)
        .getAllByRole('checkbox')
        .map((box) => [box.closest('label')?.textContent, (box as HTMLInputElement).checked]),
    ).toEqual([
      ['Inhaber', false],
      ['Büro', false],
      ['Monteur', true],
    ])
  })

  /**
   * Whether the business sends mail is a question for its mail settings
   * (#81), which are this application's. With a mail server the invitation
   * can go by mail, and nobody in the office sees the link.
   */
  it('asks the mail settings of the business, and invites by mail where it has a server', async () => {
    serverSays('GET', '/settings/mail', { configured: true, from: 'buero@nord.example.de' })
    serverSays('POST', '/staff', {
      id: 'i-1',
      token: null,
      expiresAt: '2026-10-09T08:00:00.000Z',
      email: 'neue@nord.example.de',
    })

    staffScreen()
    await screen.findByText('Max Monteur')

    const person = userEvent.setup()

    await person.click(screen.getByRole('button', { name: 'Zugang anlegen' }))
    await person.type(screen.getByLabelText('Name'), 'Nele Neu')
    await person.type(screen.getByLabelText('E-Mail'), 'neue@nord.example.de')
    await person.click(await screen.findByRole('button', { name: 'Per E-Mail einladen' }))

    expect(sent('GET', '/settings/mail').length).toBeGreaterThan(0)
    expect(sent('POST', '/staff')).toEqual([
      { name: 'Nele Neu', email: 'neue@nord.example.de', roles: ['technician'], send: 'mail' },
    ])
    expect((await screen.findByRole('status')).textContent).toBe(
      'Die Einladung geht per E-Mail an neue@nord.example.de. Der Link darin gilt sieben Tage und funktioniert genau einmal; im Büro sieht ihn niemand. Ob die E-Mail angekommen ist, steht unten bei den offenen Einladungen.',
    )
  })

  it('says where the mail server is set up, where the business has none', async () => {
    serverSays('GET', '/settings/mail', { configured: false, from: null })

    staffScreen()
    await screen.findByText('Max Monteur')

    await userEvent.setup().click(screen.getByRole('button', { name: 'Zugang anlegen' }))

    expect(screen.queryByRole('button', { name: 'Per E-Mail einladen' })).toBeNull()
    expect(
      screen.getByText(
        'Per E-Mail einladen geht, sobald unter "E-Mail-Einstellungen" ein Mailserver eingerichtet ist.',
      ),
    ).toBeTruthy()
  })

  it('names the devices of a person by the business and by its two entries', async () => {
    serverSays('GET', '/staff/u-2/devices', [
      {
        sessionId: 's-1',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0.0.0 Safari/537.36',
        signedInAt: '2026-10-02T06:00:00.000Z',
        expiresAt: '2026-10-02T18:00:00.000Z',
        longLived: false,
        current: false,
      },
      {
        sessionId: 's-2',
        userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) Chrome/140.0.0.0 Mobile Safari/537.36',
        signedInAt: '2026-09-28T05:30:00.000Z',
        expiresAt: '2026-10-28T05:30:00.000Z',
        longLived: true,
        current: false,
      },
    ])
    serverSays('GET', '/staff/u-1/devices', [])

    staffScreen()
    await screen.findByText('Max Monteur')

    const person = userEvent.setup()
    const row = (name: string) =>
      within(screen.getByRole('table', { name: 'Konten dieses Betriebs' }))
        .getByText(name)
        .closest('tr') as HTMLElement

    await person.click(within(row('Max Monteur')).getByRole('button', { name: 'Geräte' }))

    const devices = await screen.findByRole('table', {
      name: 'Geräte, auf denen Max Monteur in diesem Betrieb angemeldet ist',
    })

    expect(within(devices).getByText('Büro, 12 Stunden')).toBeTruthy()
    expect(within(devices).getByText('Baustelle, 30 Tage')).toBeTruthy()

    await person.click(within(row('Christa Chefin')).getByRole('button', { name: 'Geräte' }))

    expect(
      await screen.findByText('In diesem Betrieb ist gerade kein Gerät angemeldet.'),
    ).toBeTruthy()
  })
})
