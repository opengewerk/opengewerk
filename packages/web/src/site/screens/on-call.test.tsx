import 'fake-indexeddb/auto'

import type { RecordState, RoleKey } from '@opengewerk/domain'
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
import { render, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { aTenantChoice } from '../../session/test-tenants.js'
import { SyncClient } from '../../sync/client.js'
import { SiteJobList } from './jobs.js'
import { SiteNewCallScreen } from './on-call.js'

/**
 * A call taken on call on site (#293): the card on top of the open jobs while
 * the plan says so and with the right, and the call made there without a
 * network, a service call with the moment of the call.
 */

let server: TestServer
let answers: Map<string, unknown>
let counter = 0

function shift(over: Partial<RecordState> = {}): RecordState {
  return {
    id: 'sh-1',
    userId: 'u-1',
    startsAt: new Date(Date.now() - 3_600_000).toISOString(),
    endsAt: new Date(Date.now() + 86_400_000).toISOString(),
    note: null,
    ...over,
  }
}

/** What a technician may do in a business that took the right to make a call on call from the role. */
const withoutOnCall = aTenantChoice(['technician']).rights.filter(
  (right) => right !== 'job.on_call',
)

async function mount(
  path: string,
  rows: Readonly<Record<string, RecordState[]>> = {},
  roles: RoleKey[] = ['technician'],
  rights?: readonly string[],
) {
  answers.set('/api/auth/get-session', {
    user: { id: 'u-1', email: 'jonas@nord.example.de', name: 'Jonas Brandt' },
    session: { activeTenantId: 't-1' },
  })
  answers.set('/auth/tenants', [aTenantChoice(roles, rights ? { rights } : {})])

  for (const [entity, list] of Object.entries({
    customers: [{ id: 'c-1', kind: 'private', name: 'Familie Berg', phone: '040 123 456' }],
    on_call_shifts: [shift()],
    ...rows,
  })) {
    for (const row of list) {
      server.put(entity, row)
    }
  }

  const client = await SyncClient.start({
    store: await openLocalStore(`einsatz${String((counter += 1))}`),
    transport: server,
    writer: server,
    deviceId: 'telefon-jonas',
    entities: [
      'customers',
      'sites',
      'jobs',
      'tasks',
      'on_call_shifts',
      'appointments',
      'appointment_people',
    ],
    onSignedOut: () => {},
  })

  await client.synchronise()

  const root = createRootRoute()
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({ getParentRoute: () => root, path: '/', component: SiteJobList }),
      createRoute({
        getParentRoute: () => root,
        path: '/einsatz/neu',
        component: SiteNewCallScreen,
      }),
      createRoute({ getParentRoute: () => root, path: '/auftraege/$jobId', component: () => null }),
    ]),
    history: createMemoryHistory({ initialEntries: [path] }),
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

  return { client, router }
}

beforeEach(() => {
  server = new TestServer()
  answers = new Map()
  answers.set('/tasks/assignees', [{ userId: 'u-1', name: 'Jonas Brandt', active: true }])

  vi.stubGlobal('fetch', (path: string) =>
    Promise.resolve(
      new Response(JSON.stringify(answers.get(path) ?? {}), {
        status: answers.has(path) ? 200 : 404,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('on call on site (#293)', () => {
  it('shows the card on top of the open jobs, with the way to a new call', async () => {
    await mount('/')

    expect(await screen.findByText('Du hast Bereitschaft')).toBeTruthy()
    expect(
      (await screen.findByRole('link', { name: 'Einsatz anlegen' })).getAttribute('href'),
    ).toBe('/einsatz/neu')
  })

  it('shows no card outside the times of the plan', async () => {
    await mount('/', {
      on_call_shifts: [
        shift({
          startsAt: new Date(Date.now() + 86_400_000).toISOString(),
          endsAt: new Date(Date.now() + 2 * 86_400_000).toISOString(),
        }),
      ],
    })

    expect(await screen.findByText('Offene Aufträge')).toBeTruthy()
    // The times come from the store after the list: give the card the time it would take.
    await expect(screen.findByText('Du hast Bereitschaft', {}, { timeout: 500 })).rejects.toThrow()
  })

  it('shows no card without the right, in a time of the plan as well', async () => {
    await mount('/', {}, ['technician'], withoutOnCall)

    expect(await screen.findByText('Offene Aufträge')).toBeTruthy()
    // The times come from the store after the list: give the card the time it would take.
    await expect(screen.findByText('Du hast Bereitschaft', {}, { timeout: 500 })).rejects.toThrow()
  })

  it('makes the call without a network: a new customer and a running service call with its moment', async () => {
    const { client, router } = await mount('/einsatz/neu')

    await userEvent.type(await screen.findByLabelText('Name'), 'Familie Arslan')
    await userEvent.type(screen.getByLabelText('Anliegen'), 'Heizung ohne Strom')
    await userEvent.click(screen.getByLabelText(/Dringende Reparatur/))
    await userEvent.click(screen.getByRole('button', { name: 'Einsatz anlegen' }))

    await waitFor(() => {
      expect(client.list('jobs')).toHaveLength(1)
    })

    const [job] = client.list('jobs')
    const made = client.list('customers').find((customer) => customer['name'] === 'Familie Arslan')

    expect(job).toMatchObject({
      kind: 'service',
      status: 'active',
      designation: 'Heizung ohne Strom',
      urgentRepair: true,
      customerId: made?.['id'],
    })
    expect(Date.now() - new Date(String(job?.['emergencyAt'])).getTime()).toBeLessThan(60_000)
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/auftraege/${String(job?.['id'])}`)
    })
  })

  it('takes a customer who is on the device', async () => {
    const { client } = await mount('/einsatz/neu')

    await userEvent.type(await screen.findByLabelText('Kunde suchen'), 'Berg')
    await userEvent.click(await screen.findByRole('button', { name: 'Familie Berg' }))
    await userEvent.type(screen.getByLabelText('Anliegen'), 'Licht im Bad')
    await userEvent.click(screen.getByRole('button', { name: 'Einsatz anlegen' }))

    await waitFor(() => {
      expect(client.list('jobs')).toHaveLength(1)
    })

    expect(client.list('jobs')[0]).toMatchObject({ customerId: 'c-1' })
    expect(client.list('customers')).toHaveLength(1)
  })

  it('makes nothing outside a time of the plan', async () => {
    await mount('/einsatz/neu', { on_call_shifts: [] })

    expect(await screen.findByText(/wer laut Plan gerade Bereitschaft hat/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Einsatz anlegen' })).toBeNull()
  })

  it('makes nothing without the right, in a time of the plan as well', async () => {
    await mount('/einsatz/neu', {}, ['technician'], withoutOnCall)

    expect(await screen.findByText(/wer laut Plan gerade Bereitschaft hat/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Einsatz anlegen' })).toBeNull()
  })
})
