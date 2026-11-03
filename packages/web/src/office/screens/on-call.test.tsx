import 'fake-indexeddb/auto'

import { berlinClock, type RoleKey } from '@opengewerk/domain'
import { today } from '@opengewerk/platform-web/format'
import { SyncProvider, openLocalStore } from '@opengewerk/platform-web/sync'
import { TestServer } from '@opengewerk/platform-web/testing'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { aTenantChoice } from '../../session/test-tenants.js'
import { SyncClient } from '../../sync/client.js'
import { OnCallScreen } from './on-call.js'
import { PlanningScreen } from './planning.js'

/**
 * The on-call plan and the surcharges in the office (#293): the plan with its
 * times, entering and swapping one with the right to write jobs, the row of
 * who is on call on the planning board, and the settings of the surcharges.
 */

let server: TestServer
let calls: { path: string; method: string; body: unknown }[]
let answers: Map<string, unknown>
let counter = 0

const inAWeek = new Date(Date.now() + 7 * 86_400_000)
const shifts = [
  {
    id: 'sh-1',
    userId: 'u-2',
    startsAt: new Date(Date.now() - 3_600_000).toISOString(),
    endsAt: inAWeek.toISOString(),
    note: 'Woche 45',
  },
  {
    id: 'sh-2',
    userId: 'u-3',
    startsAt: inAWeek.toISOString(),
    endsAt: new Date(Date.now() + 14 * 86_400_000).toISOString(),
    note: null,
  },
]

async function mount(at: string, roles: RoleKey[] = ['office']) {
  answers.set('/api/auth/get-session', {
    user: { id: 'u-1', email: 'buero@nord.example.de', name: 'Britta Büro' },
    session: { activeTenantId: 't-1' },
  })
  answers.set('/auth/tenants', [aTenantChoice(roles)])
  answers.set('/tasks/assignees', [
    { userId: 'u-2', name: 'Jonas Brandt', active: true },
    { userId: 'u-3', name: 'Lena Hoffmann', active: true },
  ])
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

  const client = await SyncClient.start({
    store: await openLocalStore(`bereitschaft${String((counter += 1))}`),
    transport: server,
    writer: server,
    deviceId: 'office-computer',
    entities: ['customers', 'jobs', 'appointments', 'appointment_people'],
    onSignedOut: () => {},
  })

  await client.synchronise()

  const root = createRootRoute()
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({ getParentRoute: () => root, path: '/plantafel', component: PlanningScreen }),
      createRoute({
        getParentRoute: () => root,
        path: '/plantafel/bereitschaft',
        component: OnCallScreen,
      }),
    ]),
    history: createMemoryHistory({ initialEntries: [at] }),
  })

  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <SyncProvider client={client}>
        <RouterProvider router={router} />
      </SyncProvider>
    </QueryClientProvider>,
  )

  return { router }
}

beforeEach(() => {
  server = new TestServer()
  answers = new Map()
  calls = []

  vi.stubGlobal('fetch', (path: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) : null

    calls.push({ path, method, body })

    const json = (value: unknown, status = 200) =>
      Promise.resolve(
        new Response(JSON.stringify(value), {
          status,
          headers: { 'Content-Type': 'application/json' },
        }),
      )

    if (path.startsWith('/on-call-shifts') && method === 'GET') {
      return json(shifts)
    }

    if (
      path.startsWith('/on-call-shifts') ||
      (path === '/settings/parameters' && method === 'POST')
    ) {
      return json({ id: 'x', ...((body as object | null) ?? {}) }, 201)
    }

    if (path.startsWith('/appointments/board')) {
      return json({ absences: [], holidays: [] })
    }

    return json(answers.get(path) ?? {}, answers.has(path) ? 200 : 404)
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the on-call plan in the office (#293)', () => {
  it('lists who is on call from when until when', async () => {
    await mount('/plantafel/bereitschaft')

    expect(await screen.findByText('Jonas Brandt')).toBeTruthy()
    expect(screen.getByText('Lena Hoffmann')).toBeTruthy()
    expect(screen.getByText('Woche 45')).toBeTruthy()
  })

  it('takes a new time with person, beginning and end', async () => {
    await mount('/plantafel/bereitschaft')

    await userEvent.click(await screen.findByRole('button', { name: 'Bereitschaft eintragen' }))
    await userEvent.selectOptions(screen.getByLabelText('Person', { exact: false }), 'u-3')
    const submit = screen.getAllByRole('button', { name: 'Bereitschaft eintragen' }).at(-1)

    await userEvent.click(submit as HTMLElement)

    await waitFor(() => {
      expect(calls.some((call) => call.path === '/on-call-shifts' && call.method === 'POST')).toBe(
        true,
      )
    })

    const made = calls.find((call) => call.path === '/on-call-shifts' && call.method === 'POST')

    expect(made?.body).toMatchObject({ userId: 'u-3', note: null })
    // From today at 17:00 in Germany, whatever the time zone of the computer.
    expect(
      berlinClock(new Date(String((made?.body as { startsAt?: unknown }).startsAt))),
    ).toMatchObject({ day: today(), minute: 17 * 60 })
  })

  it('swaps the people of two times', async () => {
    await mount('/plantafel/bereitschaft')

    const [first] = await screen.findAllByRole('button', { name: 'Tauschen' })

    await userEvent.click(first as HTMLElement)

    const panel = (await screen.findByText('Bereitschaft von Jonas Brandt tauschen'))
      .parentElement as HTMLElement

    await userEvent.click(within(panel).getByRole('button', { name: 'Tauschen' }))

    await waitFor(() => {
      expect(calls.find((call) => call.path === '/on-call-shifts/sh-1/swap')?.body).toEqual({
        with: 'sh-2',
      })
    })
  })

  it('is read and not changed without the right to write jobs', async () => {
    await mount('/plantafel/bereitschaft', ['technician'])

    expect(await screen.findByText('Jonas Brandt')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Bereitschaft eintragen' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Tauschen' })).toBeNull()
  })

  it('stands on the planning board in a row over the people', async () => {
    await mount('/plantafel')

    const board = await screen.findByRole('region', { name: 'Plantafel' })

    expect(await within(board).findByText('Bereitschaft')).toBeTruthy()
    expect((await within(board).findAllByText('Jonas Brandt')).length).toBeGreaterThan(0)
  })
})
