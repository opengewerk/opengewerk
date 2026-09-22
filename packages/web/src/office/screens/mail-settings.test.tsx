import type { RoleKey } from '@opengewerk/domain'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MailSettingsScreen } from './mail-settings.js'

/**
 * The screen "E-Mail": whether the instance sends mail, and the one thing a
 * business decides about it so far, whether a signed report goes to its
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

  return <QueryClientProvider client={client}>{node}</QueryClientProvider>
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

describe('the mail server', () => {
  it('is named with the address messages leave from', async () => {
    signedInAs('office')
    render(inQueries(<MailSettingsScreen />))

    expect(
      await screen.findByText(
        /Eingerichtet\. OpenGewerk verschickt von rechnung@nord\.example\.de/,
      ),
    ).toBeTruthy()
  })

  it('says where it is set up when there is none', async () => {
    signedInAs('office')
    serverSays('GET', '/settings/mail', { configured: false, from: null })
    render(inQueries(<MailSettingsScreen />))

    expect(await screen.findByText(/Nicht eingerichtet/)).toBeTruthy()
    expect(screen.getByText(/in der \.env mit SMTP_HOST und MAIL_FROM/)).toBeTruthy()
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
