import type { RoleKey } from '@opengewerk/domain'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { NumberRangesScreen } from './number-ranges.js'

/**
 * The screen "Nummernkreise": the pattern of each sequence, the next number,
 * and what the next document will be called, worked out while typing.
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

const invoices = {
  key: 'invoice',
  pattern: 'RE-{year}-{number:4}',
  nextValue: 14,
  next: 'RE-2026-0014',
}

const quotes = { key: 'quote', pattern: 'AN-{year}-{number:4}', nextValue: 1, next: 'AN-2026-0001' }

const jobs = { key: 'job', pattern: 'AU-{year}-{number:4}', nextValue: 3, next: 'AU-2026-0003' }

function section(name: string): HTMLElement {
  return screen.getByRole('region', { name })
}

beforeEach(() => {
  calls = []
  answers = new Map()
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-09-22T10:00:00Z') })

  serverSays('GET', '/settings/number-ranges', [jobs, quotes, invoices])

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

describe('the number ranges', () => {
  it('count the jobs as well, which get their number when they are created (#145)', async () => {
    signedInAs('office')
    render(inQueries(<NumberRangesScreen />))

    const jobSection = await screen.findByRole('region', { name: 'Aufträge' })

    expect(jobSection.textContent).toContain('der nächste Auftrag heißt AU-2026-0003')
    expect(jobSection.textContent).toContain('beim Anlegen')
  })

  it('show the office each pattern and the next number, with nothing to change', async () => {
    signedInAs('office')
    render(inQueries(<NumberRangesScreen />))

    const invoiceSection = await screen.findByRole('region', { name: 'Rechnungen' })

    expect(invoiceSection.textContent).toContain('der nächste Beleg heißt RE-2026-0014')
    expect(invoiceSection.textContent).toContain('lückenlos')

    await waitFor(() => {
      expect(within(invoiceSection).queryByRole('button')).toBeNull()
    })
  })

  it('show the owner the next number while the pattern is typed', async () => {
    signedInAs('owner')
    render(inQueries(<NumberRangesScreen />))

    const person = userEvent.setup()
    const pattern = await within(
      await screen.findByRole('region', { name: 'Rechnungen' }),
    ).findByLabelText('Muster')

    await person.clear(pattern)
    await person.type(pattern, 'R-{{number:5}')

    expect(section('Rechnungen').textContent).toContain('Der nächste Beleg heißt R-00014.')
  })

  it('say what is wrong with a pattern, and save none', async () => {
    signedInAs('owner')
    render(inQueries(<NumberRangesScreen />))

    const person = userEvent.setup()
    const quoteSection = await screen.findByRole('region', { name: 'Angebote' })
    const pattern = await within(quoteSection).findByLabelText('Muster')

    await person.clear(pattern)
    await person.type(pattern, 'AN-{{year}')

    expect(within(quoteSection).getByText(/Es fehlt \{number\}/)).toBeTruthy()
    expect(
      (within(quoteSection).getByRole('button', { name: 'Speichern' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
  })

  it('send the next number only when it was moved, and never below the one there is', async () => {
    signedInAs('owner')
    serverSays('PUT', '/settings/number-ranges/invoice', {
      ...invoices,
      pattern: 'RE-{year}-{number:5}',
      next: 'RE-2026-00014',
    })
    render(inQueries(<NumberRangesScreen />))

    const person = userEvent.setup()
    const invoiceSection = await screen.findByRole('region', { name: 'Rechnungen' })
    const pattern = await within(invoiceSection).findByLabelText('Muster')

    await person.clear(pattern)
    await person.type(pattern, 'RE-{{year}-{{number:5}')
    await person.click(within(invoiceSection).getByRole('button', { name: 'Speichern' }))

    await waitFor(() => {
      expect(calls.find((call) => call.method === 'PUT')?.body).toEqual({
        pattern: 'RE-{year}-{number:5}',
      })
    })
    expect(
      await screen.findByText('Gespeichert. Der nächste Beleg heißt RE-2026-00014.'),
    ).toBeTruthy()

    const next = within(section('Rechnungen')).getByLabelText('Nächste Nummer')

    await person.clear(next)
    await person.type(next, '9')

    expect(within(section('Rechnungen')).getByText(/kann nur steigen, von 14 an/)).toBeTruthy()
  })
})
