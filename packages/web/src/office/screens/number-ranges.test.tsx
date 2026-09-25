import type { RoleKey } from '@opengewerk/domain'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { InRouter } from '../../app/in-router.js'
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

const invoices = {
  key: 'invoice',
  pattern: 'RE-{year}-{number:4}',
  nextValue: 14,
  next: 'RE-2026-0014',
}

const quotes = { key: 'quote', pattern: 'AN-{year}-{number:4}', nextValue: 1, next: 'AN-2026-0001' }

const jobs = { key: 'job', pattern: 'AU-{year}-{number:4}', nextValue: 3, next: 'AU-2026-0003' }

/** The row of one sequence in the table of the board "Nummernkreise" (#219). */
function row(name: string): HTMLElement {
  return screen.getByRole('row', { name })
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

    const jobRow = await screen.findByRole('row', { name: 'Aufträge' })

    expect(jobRow.textContent).toContain('AU-2026-0003')
    expect(jobRow.textContent).toContain('beim Anlegen')
  })

  it('show the office each pattern and the next number, with nothing to change', async () => {
    signedInAs('office')
    render(inQueries(<NumberRangesScreen />))

    const invoiceRow = await screen.findByRole('row', { name: 'Rechnungen' })

    expect(invoiceRow.textContent).toContain('RE-{year}-{number:4}')
    expect(invoiceRow.textContent).toContain('RE-2026-0014')
    expect(invoiceRow.textContent).toContain('lückenlos')

    await waitFor(() => {
      expect(within(invoiceRow).queryByRole('button')).toBeNull()
    })
    expect(within(invoiceRow).queryByRole('textbox')).toBeNull()
  })

  it('show the owner the next number while the pattern is typed', async () => {
    signedInAs('owner')
    render(inQueries(<NumberRangesScreen />))

    const person = userEvent.setup()
    const pattern = await within(
      await screen.findByRole('row', { name: 'Rechnungen' }),
    ).findByLabelText('Muster der Rechnungen')

    await person.clear(pattern)
    await person.type(pattern, 'R-{{number:5}')

    expect(row('Rechnungen').textContent).toContain('R-00014')
  })

  it('say what is wrong with a pattern, and save none', async () => {
    signedInAs('owner')
    render(inQueries(<NumberRangesScreen />))

    const person = userEvent.setup()
    const quoteRow = await screen.findByRole('row', { name: 'Angebote' })
    const pattern = await within(quoteRow).findByLabelText('Muster der Angebote')

    await person.clear(pattern)
    await person.type(pattern, 'AN-{{year}')

    expect(within(quoteRow).getByText(/Es fehlt \{number\}/)).toBeTruthy()
    expect(
      (within(quoteRow).getByRole('button', { name: 'Angebote speichern' }) as HTMLButtonElement)
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
    const invoiceRow = await screen.findByRole('row', { name: 'Rechnungen' })
    const pattern = await within(invoiceRow).findByLabelText('Muster der Rechnungen')

    // Nothing changed, nothing to save: the button waits (#223).
    expect(
      (
        within(invoiceRow).getByRole('button', {
          name: 'Rechnungen speichern',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true)

    await person.clear(pattern)
    await person.type(pattern, 'RE-{{year}-{{number:5}')
    await person.click(within(invoiceRow).getByRole('button', { name: 'Rechnungen speichern' }))

    await waitFor(() => {
      expect(calls.find((call) => call.method === 'PUT')?.body).toEqual({
        pattern: 'RE-{year}-{number:5}',
      })
    })
    expect(
      await screen.findByText('Gespeichert. Der nächste Beleg heißt RE-2026-00014.'),
    ).toBeTruthy()

    const next = within(row('Rechnungen')).getByLabelText('Nächste Nummer der Rechnungen')

    await person.clear(next)
    await person.type(next, '9')

    expect(within(row('Rechnungen')).getByText(/kann nur steigen, von 14 an/)).toBeTruthy()
  })
})
