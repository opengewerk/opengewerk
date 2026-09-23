import type { RoleKey } from '@opengewerk/domain'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PaymentTermScreen, paymentTermOn } from './payment-term.js'

/**
 * The screen "Zahlungsziel": how many days a customer has to pay, for every
 * document that states no term of its own. Set from today on by the owner,
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

  return <QueryClientProvider client={client}>{node}</QueryClientProvider>
}

function signedInAs(...roles: RoleKey[]) {
  serverSays('GET', '/api/auth/get-session', {
    user: { id: 'u-1', email: 'chefin@nord.example.de', name: 'Christa Chefin' },
    session: { activeTenantId: 't-1' },
  })
  serverSays('GET', '/auth/tenants', [{ id: 't-1', name: 'Elektro Nord GmbH', roles }])
}

const periods = [
  {
    id: 'p-1',
    key: 'invoice.payment_term_days',
    validFrom: '2026-01-01',
    validUntil: '2026-08-31',
    value: 14,
    note: null,
  },
  {
    id: 'p-2',
    key: 'invoice.payment_term_days',
    validFrom: '2026-09-01',
    validUntil: null,
    value: 30,
    note: null,
  },
] as const

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

describe('the payment term, as the owner sets it', () => {
  it('shows the default before anything was set, and saves a new term from today', async () => {
    signedInAs('owner')
    render(inQueries(<PaymentTermScreen />))

    expect(await screen.findByText('14 Tage, die Vorgabe von OpenGewerk.')).toBeTruthy()

    const days = await screen.findByLabelText('Tage')
    const user = userEvent.setup()
    await user.clear(days)
    await user.type(days, '30')
    await user.click(screen.getByRole('button', { name: 'Speichern' }))

    await waitFor(() => {
      expect(calls.find((call) => call.method === 'POST')?.body).toEqual({
        key: 'invoice.payment_term_days',
        from: '2026-09-22',
        value: 30,
        note: null,
      })
    })
    expect(await screen.findByRole('status')).toBeTruthy()
  })

  it('says what applies since when, and how it was before', async () => {
    signedInAs('owner')
    serverSays('GET', '/settings/parameters', periods)
    render(inQueries(<PaymentTermScreen />))

    expect(await screen.findByText('30 Tage seit dem 01.09.2026.')).toBeTruthy()
    expect(screen.getByText('Ab 01.01.2026: 14 Tage')).toBeTruthy()
    expect(screen.getByText('Ab 01.09.2026: 30 Tage')).toBeTruthy()
  })

  it('refuses what no document may state, before anything is sent', async () => {
    signedInAs('owner')
    render(inQueries(<PaymentTermScreen />))

    const days = await screen.findByLabelText('Tage')
    const user = userEvent.setup()
    await user.clear(days)
    await user.type(days, '400')

    expect(
      screen.getByText('Das Zahlungsziel liegt zwischen 0 und 365 Tagen, 0 heißt sofort zahlbar.'),
    ).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Speichern' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
    expect(calls.some((call) => call.method === 'POST')).toBe(false)
  })

  it('says why the server refused the change', async () => {
    signedInAs('owner')
    serverSays(
      'POST',
      '/settings/parameters',
      { message: 'Für invoice.payment_term_days gilt bereits ein Wert ab 2026-09-22.' },
      400,
    )
    render(inQueries(<PaymentTermScreen />))

    const days = await screen.findByLabelText('Tage')
    const user = userEvent.setup()
    await user.clear(days)
    await user.type(days, '21')
    await user.click(screen.getByRole('button', { name: 'Speichern' }))

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Für invoice.payment_term_days gilt bereits ein Wert ab 2026-09-22.',
    )
  })
})

describe('the payment term, as the office sees it', () => {
  it('is shown with nothing to press', async () => {
    signedInAs('office')
    serverSays('GET', '/settings/parameters', periods)
    render(inQueries(<PaymentTermScreen />))

    expect(await screen.findByText('30 Tage seit dem 01.09.2026.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Speichern' })).toBeNull()
  })
})

describe('the term of a day', () => {
  it('is the period that covered it, or the default before any', () => {
    expect(paymentTermOn(periods, '2026-05-10')).toBe(14)
    expect(paymentTermOn(periods, '2026-09-01')).toBe(30)
    expect(paymentTermOn(periods, '2025-12-31')).toBe(14)
    expect(paymentTermOn([], '2026-09-22')).toBe(14)
  })
})
