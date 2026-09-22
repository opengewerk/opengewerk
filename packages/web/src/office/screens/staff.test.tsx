import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { StaffScreen } from './staff.js'

/**
 * The screen the office administers accounts on.
 *
 * Two of the checks here are about something that must not be on the screen,
 * which is unusual for a test and is the point of this one. A password field
 * would look perfectly reasonable in a form that creates an account, and it is
 * exactly what the whole link exists to avoid.
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

function asked(path: string, method = 'GET'): Call | undefined {
  return calls.find((call) => call.path === path && call.method === method)
}

function inQueries(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  return <QueryClientProvider client={client}>{node}</QueryClientProvider>
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
  serverSays('GET', '/staff/invitations', [])

  vi.stubGlobal('fetch', (path: string, init?: RequestInit) => {
    calls.push({
      path,
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    })

    return Promise.resolve(
      new Response(JSON.stringify(answers.get(`${init?.method ?? 'GET'} ${path}`) ?? {}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  })

  vi.stubGlobal('location', { origin: 'https://opengewerk.example.de', pathname: '/zugaenge' })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the staff screen', () => {
  it('shows who works here, with roles and the last time the business saw them', async () => {
    render(inQueries(<StaffScreen />))

    expect(await screen.findByText('Max Monteur')).toBeTruthy()
    expect(screen.getByText('chefin@nord.example.de')).toBeTruthy()
    // Somebody who has never signed in says so in a word, not with a dash.
    expect(screen.getByText('Noch nie')).toBeTruthy()
  })

  /**
   * The sentence from the issue, as a check: a password a colleague knows and
   * that then stays for three years is worse than one nobody knows. So the one
   * field that must never appear on this screen is a password, neither for
   * setting one nor for showing one.
   */
  it('never asks for or shows a password', async () => {
    render(inQueries(<StaffScreen />))
    await screen.findByText('Max Monteur')

    await userEvent.setup().click(screen.getByRole('button', { name: 'Zugang anlegen' }))

    expect(screen.getByLabelText('E-Mail')).toBeTruthy()
    expect(screen.queryByLabelText(/Passwort/)).toBeNull()
  })

  /**
   * The wall from #62, named before somebody walks into it.
   *
   * The requirement hangs on the role and is checked on every request, so the
   * person made an owner meets it at their next click. The server does not
   * refuse the change and should not; this warning is what turns a 403 nobody
   * expected into something somebody chose.
   */
  it('says that the owner role brings a second factor with it, before the change', async () => {
    render(inQueries(<StaffScreen />))
    await screen.findByText('Max Monteur')

    const person = userEvent.setup()

    // The general sentence stands over the list at all times, so that it is on
    // screen while somebody is reaching for a checkbox rather than after.
    expect(screen.getByText(/Die Rolle Inhaber verlangt einen zweiten Faktor/)).toBeTruthy()

    await person.click(screen.getByRole('button', { name: 'Zugang anlegen' }))
    expect(screen.queryByText(/zweiter Faktor Pflicht/)).toBeNull()

    // Scoped to the form, because the rows of the table carry the same three
    // boxes and clicking one of those would change somebody's roles instead of
    // filling in a form.
    const form = screen.getByRole('button', { name: 'Link erzeugen' }).closest('form')

    await person.click(within(form as HTMLElement).getByLabelText('Inhaber'))

    expect(screen.getByText(/zweiter Faktor Pflicht/)).toBeTruthy()
    // And nothing has been sent: the warning is shown while somebody is still
    // filling the form in, which is the only moment it is worth anything.
    expect(asked('/staff', 'POST')).toBeUndefined()
  })

  it('hands the link over once, and says that there is no second time', async () => {
    serverSays('POST', '/staff', {
      token: 'b'.repeat(43),
      expiresAt: '2026-09-27T08:00:00.000Z',
      email: 'neue@nord.example.de',
    })

    render(inQueries(<StaffScreen />))
    await screen.findByText('Max Monteur')

    const person = userEvent.setup()

    await person.click(screen.getByRole('button', { name: 'Zugang anlegen' }))
    await person.type(screen.getByLabelText('Name'), 'Nele Neu')
    await person.type(screen.getByLabelText('E-Mail'), 'neue@nord.example.de')
    await person.click(screen.getByRole('button', { name: 'Link erzeugen' }))

    expect(asked('/staff', 'POST')?.body).toEqual({
      name: 'Nele Neu',
      email: 'neue@nord.example.de',
      roles: ['technician'],
      send: 'link',
    })

    // The address is put together in the browser, out of the one it is already
    // looking at. The server is never told an address of its own.
    const link = await screen.findByLabelText('Einmal-Link')
    expect((link as HTMLInputElement).value).toBe(
      `https://opengewerk.example.de/einladung/${'b'.repeat(43)}`,
    )
    expect(screen.getByText(/nur jetzt hier/)).toBeTruthy()
  })

  it('sends the invitation by mail where the instance has a mail server', async () => {
    serverSays('GET', '/settings/mail', { configured: true, from: 'buero@nord.example.de' })
    serverSays('POST', '/staff', {
      id: 'i-1',
      token: null,
      expiresAt: '2026-09-29T08:00:00.000Z',
      email: 'neue@nord.example.de',
    })

    render(inQueries(<StaffScreen />))
    await screen.findByText('Max Monteur')

    const person = userEvent.setup()

    await person.click(screen.getByRole('button', { name: 'Zugang anlegen' }))
    await person.type(screen.getByLabelText('Name'), 'Nele Neu')
    await person.type(screen.getByLabelText('E-Mail'), 'neue@nord.example.de')
    await person.click(await screen.findByRole('button', { name: 'Per E-Mail einladen' }))

    expect(asked('/staff', 'POST')?.body).toEqual({
      name: 'Nele Neu',
      email: 'neue@nord.example.de',
      roles: ['technician'],
      send: 'mail',
    })

    // No link to copy: it exists in the message and nowhere else.
    expect(
      await screen.findByText(/Die Einladung geht per E-Mail an neue@nord\.example\.de/),
    ).toBeTruthy()
    expect(screen.queryByLabelText('Einmal-Link')).toBeNull()
  })

  it('offers only the link on an instance without a mail server', async () => {
    serverSays('GET', '/settings/mail', { configured: false, from: null })

    render(inQueries(<StaffScreen />))
    await screen.findByText('Max Monteur')

    await userEvent.setup().click(screen.getByRole('button', { name: 'Zugang anlegen' }))

    expect(screen.getByRole('button', { name: 'Link erzeugen' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Per E-Mail einladen' })).toBeNull()
    expect(screen.getByText(/sobald die Instanz einen Mailserver hat/)).toBeTruthy()
  })

  it('says for each open invitation how it travels', async () => {
    const invitation = {
      email: 'x@nord.example.de',
      roles: ['technician'],
      expiresAt: '2026-09-29T08:00:00.000Z',
      invitedBy: 'u-1',
    }

    serverSays('GET', '/staff/invitations', [
      { ...invitation, id: 'i-1', name: 'Lina Link', mail: null },
      {
        ...invitation,
        id: 'i-2',
        name: 'Paul Post',
        mail: { status: 'sent', sentAt: '2026-09-22T08:05:00.000Z', lastError: null },
      },
      {
        ...invitation,
        id: 'i-3',
        name: 'Fritz Fehler',
        mail: { status: 'failed', sentAt: null, lastError: 'EENVELOPE: Adresse unbekannt' },
      },
    ])

    render(inQueries(<StaffScreen />))

    const table = await screen.findByRole('table', {
      name: 'Einladungen, die noch benutzt werden können',
    })
    const row = (name: string) => within(table).getByText(name).closest('tr') as HTMLElement

    expect(within(row('Lina Link')).getByText('Link weitergegeben')).toBeTruthy()
    expect(within(row('Paul Post')).getByText(/^Per E-Mail verschickt am /)).toBeTruthy()
    expect(
      within(row('Fritz Fehler')).getByText(
        'E-Mail nicht zugestellt: EENVELOPE: Adresse unbekannt',
      ),
    ).toBeTruthy()
  })

  it('sends the roles of one person the moment a box is ticked', async () => {
    render(inQueries(<StaffScreen />))
    await screen.findByText('Max Monteur')

    // Max is the second row, so his checkboxes are the second set of three.
    const office = screen.getAllByLabelText('Büro')

    await userEvent.setup().click(office[1] as HTMLElement)

    expect(asked('/staff/u-2', 'PATCH')?.body).toEqual({ roles: ['technician', 'office'] })
  })
})
