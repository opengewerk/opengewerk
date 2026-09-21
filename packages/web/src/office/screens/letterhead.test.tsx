import type { RoleKey } from '@opengewerk/domain'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LetterheadScreen } from './letterhead.js'

/**
 * The letterhead screen. Two people meet it: the owner, who changes it, and
 * the office, which reads it because it writes the documents it ends up on.
 * The second one must see the same letterhead and have nothing to press.
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

const stored = {
  companyName: null,
  street: 'Hafenstraße',
  houseNumber: '12',
  postalCode: '20457',
  city: 'Hamburg',
  country: 'DE',
  phone: null,
  email: null,
  website: null,
  taxNumber: '22/815/08154',
  vatId: null,
  iban: null,
  bic: null,
  bankName: null,
  registerCourt: null,
  registerNumber: null,
  managingDirectors: null,
  setUpAs: 'Elektro Nord GmbH',
  logo: null,
}

function signedInAs(...roles: RoleKey[]) {
  serverSays('GET', '/api/auth/get-session', {
    user: { id: 'u-1', email: 'chefin@nord.example.de', name: 'Christa Chefin' },
    session: { activeTenantId: 't-1' },
  })
  serverSays('GET', '/auth/tenants', [{ id: 't-1', name: 'Elektro Nord GmbH', roles }])
}

beforeEach(() => {
  calls = []
  answers = new Map()

  serverSays('GET', '/settings/letterhead', stored)

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
  vi.unstubAllGlobals()
})

describe('the letterhead screen for the owner', () => {
  it('starts from what is stored, with the name the business was set up as in view', async () => {
    signedInAs('owner')
    render(inQueries(<LetterheadScreen />))

    const street = await screen.findByLabelText('Straße')
    expect((street as HTMLInputElement).value).toBe('Hafenstraße')

    // An empty name prints the one the business was set up with, and the
    // placeholder says so before anybody wonders.
    const name = screen.getByLabelText('Name auf den Belegen') as HTMLInputElement
    expect(name.value).toBe('')
    expect(name.placeholder).toBe('Elektro Nord GmbH')
  })

  it('sends the whole letterhead when it is saved, and says that it was', async () => {
    signedInAs('owner')
    serverSays('PUT', '/settings/letterhead', { ...stored, iban: 'DE89 3704 0044 0532 0130 00' })
    render(inQueries(<LetterheadScreen />))

    const person = userEvent.setup()
    await person.type(await screen.findByLabelText('IBAN'), 'DE89 3704 0044 0532 0130 00')
    await person.click(await screen.findByRole('button', { name: 'Briefkopf speichern' }))

    expect(await screen.findByText('Gespeichert.')).toBeTruthy()

    const sent = calls.find((call) => call.method === 'PUT')?.body as Record<string, string>
    expect(sent['iban']).toBe('DE89 3704 0044 0532 0130 00')
    expect(sent['street']).toBe('Hafenstraße')
    expect(sent['companyName']).toBe('')
  })

  it('shows the reason the server gives when it refuses', async () => {
    signedInAs('owner')
    serverSays(
      'PUT',
      '/settings/letterhead',
      { message: 'Die IBAN stimmt nicht, ihre Prüfziffern gehen nicht auf.' },
      400,
    )
    render(inQueries(<LetterheadScreen />))

    await userEvent
      .setup()
      .click(await screen.findByRole('button', { name: 'Briefkopf speichern' }))

    expect((await screen.findByRole('alert')).textContent).toContain('Prüfziffern')
  })
})

describe('the letterhead screen for the office', () => {
  it('shows the same letterhead, and nothing that would change it', async () => {
    signedInAs('office')
    render(inQueries(<LetterheadScreen />))

    const street = (await screen.findByLabelText('Straße')) as HTMLInputElement
    expect(street.value).toBe('Hafenstraße')
    expect(street.readOnly).toBe(true)

    expect(await screen.findByText('Ändern kann den Briefkopf nur der Inhaber.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Briefkopf speichern' })).toBeNull()
    expect(screen.queryByText('Logo wählen')).toBeNull()
  })
})
