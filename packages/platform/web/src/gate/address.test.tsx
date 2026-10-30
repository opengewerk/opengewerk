import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { InProbe } from '../probe-application.js'
import { addressToken } from '../session/session.js'
import { AddressScreen } from './address.js'

/**
 * The far end of the link in the mail to an address (opengewerk#754), and the
 * piece of the address bar that leads to it.
 *
 * Driven through the screen: the one thing that matters is that nothing is
 * confirmed before the button, so that a scanner of mails that opens the link
 * confirms nothing by itself.
 */

interface Call {
  readonly path: string
  readonly method: string
}

const token = 'b'.repeat(43)

let calls: Call[]
let answers: Map<string, { readonly status: number; readonly body: unknown }>
let went: string | null

function serverSays(method: string, path: string, body: unknown, status = 200): void {
  answers.set(`${method} ${path}`, { status, body })
}

function inQueries(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  return render(
    <QueryClientProvider client={client}>
      <InProbe>{node}</InProbe>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  calls = []
  answers = new Map()
  went = null

  vi.stubGlobal('fetch', (path: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const answer = answers.get(`${method} ${path}`) ?? { status: 200, body: {} }

    calls.push({ path, method })

    return Promise.resolve(
      new Response(JSON.stringify(answer.body), {
        status: answer.status,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  })

  vi.stubGlobal('location', {
    origin: 'https://probewerk.example.de',
    pathname: '/',
    assign: (to: string) => {
      went = to
    },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the token in the address', () => {
  it('is found where the link in the mail puts it and nowhere else', () => {
    expect(addressToken(`/adresse/${token}`)).toBe(token)
    expect(addressToken('/')).toBeNull()
    expect(addressToken(`/einladung/${token}`)).toBeNull()
    expect(addressToken('/adresse/zu-kurz')).toBeNull()
  })
})

describe('the link to an address', () => {
  it('shows the address, confirms nothing before the button, and then says it holds', async () => {
    serverSays('GET', `/auth/address/${token}`, {
      state: 'open',
      name: 'Mia Mitglied',
      email: 'mia.neu@nord.example.de',
    })
    serverSays('POST', `/auth/address/${token}`, {
      email: 'mia.neu@nord.example.de',
      changed: true,
    })
    inQueries(<AddressScreen token={token} />)

    expect(
      await screen.findByText(
        'Mit dem Knopf gilt mia.neu@nord.example.de für Ihr Konto, und Sie melden sich ab dann mit ihr an. Die bisherige Adresse bekommt einen Hinweis.',
      ),
    ).toBeTruthy()
    expect(calls.filter((call) => call.method === 'POST')).toEqual([])

    await userEvent.click(screen.getByRole('button', { name: 'Adresse bestätigen' }))

    expect(await screen.findByRole('heading', { name: 'E-Mail-Adresse bestätigt' })).toBeTruthy()
    expect(calls.filter((call) => call.method === 'POST')).toEqual([
      { path: `/auth/address/${token}`, method: 'POST' },
    ])

    await userEvent.click(screen.getByRole('button', { name: 'Zur Anmeldung' }))
    expect(went).toBe('/')
  })

  it('says that a link that is gone holds no more, and offers nothing to confirm', async () => {
    serverSays('GET', `/auth/address/${token}`, { state: 'gone', name: '', email: '' })
    inQueries(<AddressScreen token={token} />)

    expect(await screen.findByText(/Dieser Link gilt nicht mehr/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Adresse bestätigen' })).toBeNull()
  })

  it('says the sentence of the server where the confirmation is refused', async () => {
    serverSays('GET', `/auth/address/${token}`, {
      state: 'open',
      name: 'Mia Mitglied',
      email: 'mia.neu@nord.example.de',
    })
    serverSays(
      'POST',
      `/auth/address/${token}`,
      { statusCode: 409, message: 'Diese E-Mail-Adresse gehört schon zu einem anderen Konto.' },
      409,
    )
    inQueries(<AddressScreen token={token} />)

    await userEvent.click(await screen.findByRole('button', { name: 'Adresse bestätigen' }))

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Diese E-Mail-Adresse gehört schon zu einem anderen Konto.',
    )
  })
})
