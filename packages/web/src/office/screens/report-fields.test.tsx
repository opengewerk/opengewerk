import { type RoleKey, reportDefinition } from '@opengewerk/domain'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ReportFieldsScreen } from './report-fields.js'

/**
 * The screen "Felder des Regieberichts" (#78): the owner gives the reports
 * fields of their own, saved as the next version; the office sees them.
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

const weather = {
  kind: 'choice' as const,
  key: 'field_1',
  label: 'Wetter',
  options: [
    { value: 'trocken', label: 'trocken' },
    { value: 'Regen', label: 'Regen' },
  ],
}

beforeEach(() => {
  calls = []
  answers = new Map()

  serverSays('GET', '/settings/report-fields', { definition: null })

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

describe('the fields of the reports, as the owner sets them', () => {
  it('start empty, and are saved with a key, a kind and options', async () => {
    signedInAs('owner')
    serverSays('PUT', '/settings/report-fields', {
      definition: reportDefinition(1, [weather]),
    })
    render(inQueries(<ReportFieldsScreen />))

    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Feld hinzufügen' }))
    await user.type(screen.getByLabelText('Beschriftung'), 'Wetter')
    await user.selectOptions(screen.getByLabelText('Art'), 'Auswahl')

    // A choice with one option is refused before anything is sent.
    await user.type(screen.getByLabelText('Möglichkeiten'), 'trocken')
    expect(
      screen.getByText('report: die Auswahl field_1 hat weniger als zwei Möglichkeiten.'),
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Speichern' })).toHaveProperty('disabled', true)

    await user.type(screen.getByLabelText('Möglichkeiten'), '{Enter}Regen')
    await user.click(screen.getByRole('button', { name: 'Speichern' }))

    await waitFor(() => {
      expect(calls.find((call) => call.method === 'PUT')?.body).toEqual({ fields: [weather] })
    })
    expect((await screen.findByRole('status')).textContent).toContain('Gespeichert als Fassung 1.')
  })

  it('give a field added next to a saved one the next key', async () => {
    signedInAs('owner')
    serverSays('GET', '/settings/report-fields', { definition: reportDefinition(3, [weather]) })
    render(inQueries(<ReportFieldsScreen />))

    const user = userEvent.setup()

    expect(await screen.findByText('Fassung 3')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Feld hinzufügen' }))

    const second = screen.getAllByRole('group')[1]

    if (!second) {
      throw new Error('No second field.')
    }

    await user.type(within(second).getByLabelText('Beschriftung'), 'Anfahrt')
    await user.selectOptions(within(second).getByLabelText('Art'), 'Zahl mit Einheit')
    await user.click(screen.getByRole('button', { name: 'Speichern' }))

    await waitFor(() => {
      expect(calls.find((call) => call.method === 'PUT')?.body).toEqual({
        fields: [
          weather,
          { kind: 'number', key: 'field_2', label: 'Anfahrt', unit: 'kilometre', decimals: 0 },
        ],
      })
    })
  })
})

describe('the fields of the reports, as the office sees them', () => {
  it('are shown with nothing to press', async () => {
    signedInAs('office')
    serverSays('GET', '/settings/report-fields', { definition: reportDefinition(2, [weather]) })
    render(inQueries(<ReportFieldsScreen />))

    expect(await screen.findByText('Wetter')).toBeTruthy()
    expect(screen.getByText('Auswahl: trocken, Regen')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Speichern' })).toBeNull()
  })
})
