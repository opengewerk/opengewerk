import type { RoleKey } from '@opengewerk/domain'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { InRouter } from '../../app/in-router.js'
import { aTenantChoice } from '../../session/test-tenants.js'
import { EmergencySurchargesScreen } from './emergency-surcharges.js'

/**
 * The settings of the surcharges of an emergency call (#293): what applies,
 * saving a percentage or a flat amount from the next day possible, and only
 * with the right to change settings.
 */

let calls: { path: string; method: string; body: unknown }[]
let answers: Map<string, unknown>

function mount(...roles: RoleKey[]) {
  answers.set('/api/auth/get-session', {
    user: { id: 'u-1', email: 'chefin@nord.example.de', name: 'Christa Chefin' },
    session: { activeTenantId: 't-1' },
  })
  answers.set('/auth/tenants', [aTenantChoice(roles)])

  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <InRouter>
        <EmergencySurchargesScreen />
      </InRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  calls = []
  answers = new Map()
  answers.set('/settings/parameters', [
    {
      id: 'p-1',
      key: 'emergency.night_flat_cents',
      validFrom: '2026-01-01',
      validUntil: null,
      value: 4500,
      note: null,
    },
  ])

  vi.stubGlobal('fetch', (path: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) : null

    calls.push({ path, method, body })

    const answer = method === 'POST' ? { id: 'x', ...(body as object) } : (answers.get(path) ?? {})

    return Promise.resolve(
      new Response(JSON.stringify(answer), {
        status: method === 'POST' ? 201 : answers.has(path) ? 200 : 404,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the settings of the surcharges (#293)', () => {
  it('show what applies and save a percentage, the flat amount set to nothing from the same day', async () => {
    mount('owner')

    expect(await screen.findByText(/45,00 € je Einsatz seit dem/)).toBeTruthy()

    const weekend = screen
      .getByRole('heading', { name: 'Wochenende' })
      .closest('section') as HTMLElement

    await userEvent.click(
      within(weekend).getByLabelText('Aufschlag auf die Arbeitszeit', { exact: false }),
    )
    await userEvent.type(within(weekend).getByLabelText('Aufschlag in %'), '50')
    await userEvent.click(within(weekend).getByRole('button', { name: 'Speichern' }))

    await waitFor(() => {
      expect(
        calls.filter((call) => call.path === '/settings/parameters' && call.method === 'POST'),
      ).toHaveLength(2)
    })

    const saved = calls
      .filter((call) => call.path === '/settings/parameters' && call.method === 'POST')
      .map((call) => call.body as { key: string; value: number })

    expect(saved.map((one) => [one.key, one.value])).toEqual([
      ['emergency.weekend_basis_points', 5000],
      ['emergency.weekend_flat_cents', 0],
    ])
  })

  it('save the night with its hours', async () => {
    mount('owner')

    const night = (await screen.findByRole('heading', { name: 'Nacht' })).closest(
      'section',
    ) as HTMLElement

    await userEvent.clear(within(night).getByLabelText('Nacht von'))
    await userEvent.type(within(night).getByLabelText('Nacht von'), '19:00')
    await userEvent.click(within(night).getByRole('button', { name: 'Speichern' }))

    await waitFor(() => {
      expect(calls.filter((call) => call.method === 'POST')).toHaveLength(4)
    })

    const saved = calls
      .filter((call) => call.method === 'POST')
      .map((call) => call.body as { key: string; value: number })

    expect(saved.map((one) => [one.key, one.value])).toEqual([
      ['emergency.night_flat_cents', 4500],
      ['emergency.night_basis_points', 0],
      ['emergency.night_from_minute', 1140],
      ['emergency.night_until_minute', 360],
    ])
  })

  it('are only read without the right to change settings', async () => {
    mount('office')

    expect(await screen.findByText(/45,00 € je Einsatz seit dem/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Speichern' })).toBeNull()
  })
})
