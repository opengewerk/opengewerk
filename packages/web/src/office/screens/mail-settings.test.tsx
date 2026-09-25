import type { RoleKey } from '@opengewerk/domain'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { InRouter } from '../../app/in-router.js'
import { MailSettingsScreen } from './mail-settings.js'

/**
 * The screen "E-Mail-Einstellungen": the mail server of the business, which
 * only the owner sees, whether the business sends mail at all, which everybody
 * who reads the settings sees, and whether a signed report goes to its
 * customer at once.
 */

interface Call {
  readonly path: string
  readonly method: string
  readonly body: unknown
}

let calls: Call[]
let answers: Map<string, { status: number; body: unknown }>

function serverSays(method: string, path: string, body: unknown, status = 200): void {
  answers.set(`${method} ${path}`, { status, body })
}

function inQueries(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  // In a router, for the links at the side of every settings screen (#219).
  return (
    <QueryClientProvider client={client}>
      <InRouter>{node}</InRouter>
    </QueryClientProvider>
  )
}

function signedInAs(...roles: RoleKey[]) {
  serverSays('GET', '/api/auth/get-session', {
    user: { id: 'u-1', email: 'chefin@nord.example.de', name: 'Christa Chefin' },
    session: { activeTenantId: 't-1' },
  })
  serverSays('GET', '/auth/tenants', [{ id: 't-1', name: 'Elektro Nord GmbH', roles }])
}

function region(name: string): HTMLElement {
  return screen.getByRole('region', { name })
}

beforeEach(() => {
  calls = []
  answers = new Map()
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-09-22T10:00:00Z') })

  serverSays('GET', '/settings/parameters', [])
  serverSays('GET', '/settings/mail', { configured: true, from: 'rechnung@nord.example.de' })
  serverSays('GET', '/settings/mail/server', { server: null })
  serverSays('GET', '/settings/letterhead', {
    companyName: 'Elektro Nord GmbH',
    street: 'Hafenstraße',
    houseNumber: '12',
    postalCode: '20457',
    city: 'Hamburg',
    country: 'DE',
    phone: null,
    email: 'info@elektro-nord.example',
    website: null,
    setUpAs: 'Elektro Nord GmbH',
    logo: null,
  })

  vi.stubGlobal('fetch', (path: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'

    calls.push({
      path,
      method,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body,
    })

    const answer = answers.get(`${method} ${path}`) ?? { status: 200, body: {} }

    return Promise.resolve(
      new Response(JSON.stringify(answer.body), {
        status: answer.status,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('the mail server, as the office sees it', () => {
  it('is named with the address messages leave from, and nothing more', async () => {
    signedInAs('office')
    render(inQueries(<MailSettingsScreen />))

    expect(
      await screen.findByText(
        /Eingerichtet\. Dieser Betrieb verschickt von rechnung@nord\.example\.de/,
      ),
    ).toBeTruthy()
    expect(screen.queryByLabelText('Server')).toBeNull()
    expect(calls.some((call) => call.path === '/settings/mail/server')).toBe(false)
  })

  it('says who sets it up when there is none', async () => {
    signedInAs('office')
    serverSays('GET', '/settings/mail', { configured: false, from: null })
    render(inQueries(<MailSettingsScreen />))

    expect(await screen.findByText(/Nicht eingerichtet/)).toBeTruthy()
    expect(screen.getByText(/richtet der Inhaber hier ein/)).toBeTruthy()
  })
})

describe('the mail server, as the owner sets it up', () => {
  const stored = {
    host: 'smtp.ionos.de',
    port: 587,
    security: 'starttls',
    username: 'rechnung@nord.example.de',
    fromAddress: 'rechnung@nord.example.de',
    signature: 'Viele Grüße\n{benutzer}\n\n{briefkopf}',
    password: 'set',
    passwordSetAt: '2026-09-22T08:00:00.000Z',
    updatedAt: '2026-09-22T08:00:00.000Z',
  }

  it('shows what is kept, and never the password', async () => {
    signedInAs('owner')
    serverSays('GET', '/settings/mail/server', { server: stored })
    render(inQueries(<MailSettingsScreen />))

    const host = (await screen.findByLabelText('Server')) as HTMLInputElement

    expect(host.value).toBe('smtp.ionos.de')
    expect((screen.getByLabelText('Passwort') as HTMLInputElement).value).toBe('')
    expect(screen.getByText(/^Gespeichert am .+ Leer lassen, um es zu behalten\.$/)).toBeTruthy()
  })

  it('sends a password only when one was typed', async () => {
    signedInAs('owner')
    serverSays('GET', '/settings/mail/server', { server: stored })
    serverSays('PUT', '/settings/mail/server', { server: stored, check: { outcome: 'ready' } })
    render(inQueries(<MailSettingsScreen />))

    const person = userEvent.setup()

    await person.click(await screen.findByRole('button', { name: 'Speichern' }))

    await waitFor(() => {
      expect(calls.find((call) => call.method === 'PUT')?.body).toEqual({
        host: 'smtp.ionos.de',
        port: null,
        security: 'starttls',
        username: 'rechnung@nord.example.de',
        fromAddress: 'rechnung@nord.example.de',
        signature: 'Viele Grüße\n{benutzer}\n\n{briefkopf}',
      })
    })

    await person.type(screen.getByLabelText('Passwort'), 'neu-und-geheim')
    await person.click(screen.getByRole('button', { name: 'Speichern' }))

    await waitFor(() => {
      expect(calls.filter((call) => call.method === 'PUT')[1]?.body).toMatchObject({
        password: 'neu-und-geheim',
      })
    })
  })

  it('says after saving that the connection works', async () => {
    signedInAs('owner')
    serverSays('GET', '/settings/mail/server', { server: stored })
    serverSays('PUT', '/settings/mail/server', { server: stored, check: { outcome: 'ready' } })
    render(inQueries(<MailSettingsScreen />))

    await userEvent.setup().click(await screen.findByRole('button', { name: 'Speichern' }))

    expect((await screen.findByRole('status')).textContent).toBe(
      'Gespeichert. Die Verbindung zum Mailserver funktioniert, die Anmeldung wurde angenommen.',
    )
  })

  it('says why nothing was saved when the server refuses the settings', async () => {
    signedInAs('owner')
    serverSays('GET', '/settings/mail/server', { server: null })
    serverSays(
      'PUT',
      '/settings/mail/server',
      {
        message:
          'Nicht gespeichert. Der Mailserver smtp.ionos.de:587 lehnt die Anmeldung ab. Stimmen ' +
          'Benutzername und Passwort?',
      },
      422,
    )
    render(inQueries(<MailSettingsScreen />))

    const person = userEvent.setup()

    await person.type(await screen.findByLabelText('Server'), 'smtp.ionos.de')
    await person.type(screen.getByLabelText('Benutzername'), 'rechnung@nord.example.de')
    await person.type(screen.getByLabelText('Passwort'), 'falsch')
    await person.type(screen.getByLabelText('Absenderadresse'), 'rechnung@nord.example.de')
    await person.click(screen.getByRole('button', { name: 'Speichern' }))

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Nicht gespeichert. Der Mailserver smtp.ionos.de:587 lehnt die Anmeldung ab.',
    )
  })

  it('says when it saved for a server that cannot be reached right now', async () => {
    signedInAs('owner')
    serverSays('GET', '/settings/mail/server', { server: stored })
    serverSays('PUT', '/settings/mail/server', {
      server: stored,
      check: {
        outcome: 'unreachable',
        reason: 'Der Mailserver smtp.ionos.de:587 antwortet nicht.',
      },
    })
    render(inQueries(<MailSettingsScreen />))

    await userEvent.setup().click(await screen.findByRole('button', { name: 'Speichern' }))

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Gespeichert, aber der Mailserver lässt sich gerade nicht erreichen',
    )
  })

  it('checks the connection and says what the server answered', async () => {
    signedInAs('owner')
    serverSays('GET', '/settings/mail/server', { server: stored })
    serverSays('POST', '/settings/mail/server/check', {
      outcome: 'refused',
      reason: 'Der Mailserver smtp.ionos.de:587 lehnt die Anmeldung ab.',
    })
    render(inQueries(<MailSettingsScreen />))

    await userEvent.setup().click(await screen.findByRole('button', { name: 'Verbindung prüfen' }))

    expect((await screen.findByRole('alert')).textContent).toContain('lehnt die Anmeldung ab')
  })

  it('shows the signature as it reads, sent by hand and sent by itself', async () => {
    signedInAs('owner')
    serverSays('GET', '/settings/mail/server', { server: stored })
    render(inQueries(<MailSettingsScreen />))

    const byHand = await screen.findByText('Von Ihnen verschickt')
    const byItself = screen.getByText('Automatisch verschickt')

    await waitFor(() => {
      expect(byHand.closest('figure')?.textContent).toContain('Viele Grüße\nChrista Chefin')
    })
    expect(byItself.closest('figure')?.textContent).not.toContain('Christa Chefin')
    expect(byItself.closest('figure')?.textContent).toContain('Elektro Nord GmbH')
  })

  it('names an unknown placeholder before anything is sent', async () => {
    signedInAs('owner')
    serverSays('GET', '/settings/mail/server', { server: null })
    render(inQueries(<MailSettingsScreen />))

    const signature = await screen.findByLabelText('Signatur')

    await userEvent.setup().type(signature, 'Grüße, {{name}')

    expect(screen.getByText(/Unbekannt: \{name\}/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Speichern' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
  })

  it('asks for the password again when it no longer opens', async () => {
    signedInAs('owner')
    serverSays('GET', '/settings/mail/server', {
      server: { ...stored, password: 'unreadable' },
    })
    render(inQueries(<MailSettingsScreen />))

    expect(await screen.findByText(/lässt sich nicht mehr lesen/)).toBeTruthy()
  })
})

describe('a signed report', () => {
  it('stays with the office until the owner switches it on, from today', async () => {
    signedInAs('owner')
    serverSays('POST', '/settings/parameters', {})
    render(inQueries(<MailSettingsScreen />))

    await screen.findByText('Aus: unterschriebene Regieberichte bleiben beim Büro.')

    const section = region('Regiebericht nach der Unterschrift')

    expect(within(section).getByText('Gilt ab dem 22.09.2026.')).toBeTruthy()

    await userEvent
      .setup()
      .click(await within(section).findByRole('button', { name: 'Einschalten' }))

    await waitFor(() => {
      expect(calls.find((call) => call.method === 'POST')?.body).toEqual({
        key: 'report.mail_on_signature',
        from: '2026-09-22',
        value: 1,
        note: null,
      })
    })
  })

  it('is switched off again from the day after it was switched on, at the earliest', async () => {
    signedInAs('owner')
    serverSays('GET', '/settings/parameters', [
      {
        id: 'p-1',
        key: 'report.mail_on_signature',
        validFrom: '2026-09-22',
        validUntil: null,
        value: 1,
        note: null,
      },
    ])
    render(inQueries(<MailSettingsScreen />))

    expect(
      await screen.findByText(
        'An seit dem 22.09.2026: ein unterschriebener Regiebericht geht gleich an den Kunden.',
      ),
    ).toBeTruthy()

    const section = region('Regiebericht nach der Unterschrift')

    expect(await within(section).findByRole('button', { name: 'Ausschalten' })).toBeTruthy()
    expect(within(section).getByText('Gilt ab dem 23.09.2026.')).toBeTruthy()
    expect(within(section).getByText('Ab 22.09.2026: an')).toBeTruthy()
  })

  it('shows the office the setting and nothing to change it with', async () => {
    signedInAs('office')
    render(inQueries(<MailSettingsScreen />))

    const section = await screen.findByRole('region', {
      name: 'Regiebericht nach der Unterschrift',
    })

    await waitFor(() => {
      expect(within(section).queryByRole('button')).toBeNull()
    })
  })
})
