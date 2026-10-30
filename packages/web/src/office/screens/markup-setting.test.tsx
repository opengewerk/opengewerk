import type { RoleKey } from '@opengewerk/domain'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { InRouter } from '../../app/in-router.js'
import { MarkupSettingScreen } from './markup-setting.js'
import { aTenantChoice } from '../../session/test-tenants.js'

/**
 * The screen "Aufschlag auf Material" (#463): what comes on an article's
 * purchase price to make its selling price. Set from today on by the owner,
 * seen by the office.
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
  serverSays('GET', '/auth/tenants', [aTenantChoice(roles)])
}

beforeEach(() => {
  calls = []
  answers = new Map()
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-09-22T10:00:00Z') })

  serverSays('GET', '/settings/parameters', [])

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

const periods = [
  {
    id: 'p-1',
    key: 'material.markup_basis_points',
    validFrom: '2026-01-01',
    validUntil: '2026-08-31',
    value: 2000,
    note: null,
  },
  {
    id: 'p-2',
    key: 'material.markup_basis_points',
    validFrom: '2026-09-01',
    validUntil: null,
    value: 2500,
    note: null,
  },
] as const

describe('the markup on material, as the owner sets it', () => {
  it('says that none is set, and saves one in hundredths of a percent from today', async () => {
    signedInAs('owner')
    render(inQueries(<MarkupSettingScreen />))

    expect(await screen.findByText('Noch kein Aufschlag eingestellt.')).toBeTruthy()

    const markup = await screen.findByLabelText('Aufschlag')
    const user = userEvent.setup()
    await user.type(markup, '22,5')
    await user.click(screen.getByRole('button', { name: 'Speichern' }))

    await waitFor(() => {
      expect(calls.find((call) => call.method === 'POST')?.body).toEqual({
        key: 'material.markup_basis_points',
        from: '2026-09-22',
        value: 2250,
        note: null,
      })
    })
    expect(
      await screen.findByText('Gespeichert. Die Verkaufspreise rechnen sich im Hintergrund neu.'),
    ).toBeTruthy()
  })

  it('says what applies since when, and how it was before', async () => {
    signedInAs('owner')
    serverSays('GET', '/settings/parameters', periods)
    render(inQueries(<MarkupSettingScreen />))

    expect(await screen.findByText('25 % seit dem 01.09.2026.')).toBeTruthy()
    expect(screen.getByText('Ab 01.01.2026: 20 %')).toBeTruthy()
    expect((screen.getByLabelText('Aufschlag') as HTMLInputElement).value).toBe('25')
  })

  it('refuses a markup out of range, before anything is sent', async () => {
    signedInAs('owner')
    render(inQueries(<MarkupSettingScreen />))

    const markup = await screen.findByLabelText('Aufschlag')
    const user = userEvent.setup()
    await user.type(markup, '22,555')

    expect(
      screen.getByText(
        'Ein Aufschlag liegt zwischen 0 und 1.000 % und hat höchstens zwei Stellen nach dem Komma.',
      ),
    ).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Speichern' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
    expect(calls.some((call) => call.method === 'POST')).toBe(false)
  })
})

describe('the markup on material, as the office sees it', () => {
  it('shows what applies with nothing to change', async () => {
    signedInAs('office')
    serverSays('GET', '/settings/parameters', periods)
    render(inQueries(<MarkupSettingScreen />))

    expect(await screen.findByText('25 % seit dem 01.09.2026.')).toBeTruthy()
    expect(screen.queryByLabelText('Aufschlag')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Speichern' })).toBeNull()
  })
})

describe('the markup on the metal surcharge (#462)', () => {
  it('is off until the owner switches it on, from today', async () => {
    signedInAs('owner')
    render(inQueries(<MarkupSettingScreen />))

    expect(
      await screen.findByText('Aus: der Metallzuschlag geht ohne Aufschlag in den Einzelpreis.'),
    ).toBeTruthy()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Einschalten' }))

    await waitFor(() => {
      expect(calls.find((call) => call.method === 'POST')?.body).toEqual({
        key: 'material.markup_on_metal',
        from: '2026-09-22',
        value: 1,
        note: null,
      })
    })
  })

  it('says since when it is on, and the office cannot switch it', async () => {
    signedInAs('office')
    serverSays('GET', '/settings/parameters', [
      ...periods,
      {
        id: 'm-1',
        key: 'material.markup_on_metal',
        validFrom: '2026-09-01',
        validUntil: null,
        value: 1,
        note: null,
      },
    ])
    render(inQueries(<MarkupSettingScreen />))

    expect(
      await screen.findByText(
        'An seit dem 01.09.2026: auch auf den Metallzuschlag kommt der Aufschlag.',
      ),
    ).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Ausschalten' })).toBeNull()
  })
})
