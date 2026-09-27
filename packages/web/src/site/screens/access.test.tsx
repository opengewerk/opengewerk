import 'fake-indexeddb/auto'

import type { RecordState, RoleKey } from '@opengewerk/domain'
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

import { SyncClient } from '../../sync/client.js'
import { SyncProvider } from '../../sync/provider.js'
import { openLocalStore } from '../../sync/store.js'
import { TestServer } from '../../sync/test-server.js'
import { SiteJobScreen } from './jobs.js'

/**
 * "Zugang zum Objekt" at a job on site (#286), the board "Auftrag: Zugang zum
 * Objekt": each value hidden until tapped, shown from the device also without
 * a network, and every showing a row through the outbox. A value that is not
 * on the device the owner and the office ask for at the route.
 */

let server: TestServer
let counter = 0
let roles: RoleKey[]
let calls: string[]
let reveal: () => Promise<Response>

const safe = {
  id: 'a-1',
  siteId: 's-1',
  designation: 'Schlüsseltresor Hof',
  hint: 'Links neben dem Hoftor.',
  valueSetAt: '2026-09-27T08:00:00.000Z',
  valueState: 'readable',
  value: '4711',
}

function answer(body: unknown, status = 200): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
}

async function mount(accesses: readonly RecordState[]) {
  server.put('customers', { id: 'c-1', kind: 'private', name: 'Familie Berg' })
  server.put('sites', { id: 's-1', customerId: 'c-1', designation: 'Einfamilienhaus Berg' })
  server.put('jobs', {
    id: 'j-1',
    customerId: 'c-1',
    siteId: 's-1',
    installationId: null,
    parentJobId: null,
    kind: 'service',
    status: 'active',
    designation: 'Steckdose ohne Strom',
    description: null,
  })

  for (const access of accesses) {
    server.put('site_accesses', access)
  }

  const client = await SyncClient.start({
    store: await openLocalStore(`site-access${String((counter += 1))}`),
    transport: server,
    writer: server,
    deviceId: 'phone-max',
    entities: [
      'customers',
      'sites',
      'installations',
      'jobs',
      'documents',
      'tasks',
      'time_entries',
      'job_notes',
      'site_accesses',
      'site_access_reveals',
    ],
    onSignedOut: () => {},
  })

  await client.synchronise()

  const root = createRootRoute()
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({
        getParentRoute: () => root,
        path: '/auftraege/$jobId',
        component: SiteJobScreen,
      }),
    ]),
    history: createMemoryHistory({ initialEntries: ['/auftraege/j-1'] }),
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

  await screen.findByRole('heading', { name: 'Steckdose ohne Strom' })

  return client
}

/** Until the roles are known, a screen shows what nobody may do. */
async function rolesKnown() {
  await waitFor(() => {
    expect(calls).toContain('GET /auth/tenants')
  })
}

beforeEach(() => {
  server = new TestServer()
  roles = ['technician']
  calls = []
  reveal = () => answer({ state: 'readable', value: '2468' }, 201)
  vi.stubGlobal('fetch', (path: string, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${path}`

    calls.push(key)

    if (key === 'GET /api/auth/get-session') {
      return answer({
        user: { id: 'u-1', email: 'max@nord.example.de', name: 'Max Monteur' },
        session: { activeTenantId: 't-1' },
      })
    }

    if (key === 'GET /auth/tenants') {
      return answer([{ id: 't-1', name: 'Elektro Nord GmbH', roles }])
    }

    if (key === 'GET /tasks/assignees') {
      return answer([])
    }

    if (key.startsWith('POST /sites/s-1/accesses/') && key.endsWith('/reveal')) {
      return reveal()
    }

    return answer({}, 404)
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the ways into the site of a job', () => {
  it('hide each value until it is tapped, and send each showing, leaving the person to the server', async () => {
    await mount([safe])
    const user = userEvent.setup()
    const card = await screen.findByRole('region', { name: 'Zugang zum Objekt' })

    expect(within(card).getByText('Schlüsseltresor Hof')).toBeTruthy()
    expect(within(card).getByText('Links neben dem Hoftor.')).toBeTruthy()
    expect(within(card).getByLabelText('verdeckt')).toBeTruthy()
    expect(within(card).queryByText('4711')).toBeNull()

    await user.click(within(card).getByRole('button', { name: 'Schlüsseltresor Hof anzeigen' }))

    expect(within(card).getByText('4711')).toBeTruthy()
    await waitFor(() => {
      expect(server.operations().map(({ entity, kind }) => `${entity} ${kind}`)).toEqual([
        'site_access_reveals create',
      ])
    })

    const written = Object.fromEntries(
      (server.operations()[0]?.patches ?? []).map((patch) => [patch.field, patch.to]),
    )

    expect(written).toMatchObject({ siteAccessId: 'a-1' })
    expect(Number.isNaN(Date.parse(String(written['revealedAt'])))).toBe(false)
    expect(written).not.toHaveProperty('userId')

    await user.click(within(card).getByRole('button', { name: 'Schlüsseltresor Hof verbergen' }))

    expect(within(card).queryByText('4711')).toBeNull()
    // Nothing went to the route: the value was on the device.
    expect(calls.filter((call) => call.startsWith('POST'))).toEqual([])
  })

  it('show a value without a network, and the showing waits in the outbox', async () => {
    const client = await mount([safe])
    const user = userEvent.setup()
    const card = await screen.findByRole('region', { name: 'Zugang zum Objekt' })

    server.offline = true
    await user.click(within(card).getByRole('button', { name: 'Schlüsseltresor Hof anzeigen' }))

    expect(within(card).getByText('4711')).toBeTruthy()
    await waitFor(() => {
      expect(client.status().pending).toBe(1)
    })
    expect(server.operations()).toEqual([])
  })

  it('say so when a value cannot be read any more, and offer nothing to show', async () => {
    await mount([
      { id: 'a-2', siteId: 's-1', designation: 'Alarmanlage', valueState: 'unreadable' },
    ])
    const card = await screen.findByRole('region', { name: 'Zugang zum Objekt' })

    expect(
      within(card).getByText('Nicht mehr lesbar. Das Büro trägt den Wert neu ein.'),
    ).toBeTruthy()
    expect(within(card).queryByRole('button', { name: /anzeigen$/ })).toBeNull()
  })

  it('are not there at a site without one', async () => {
    await mount([])
    await rolesKnown()

    expect(screen.queryByRole('region', { name: 'Zugang zum Objekt' })).toBeNull()
  })
})

describe('a way in whose value is not on the device', () => {
  // Of a site whose jobs are closed: the row, without the value.
  const closedSite = {
    id: 'a-3',
    siteId: 's-1',
    designation: 'Garage',
    hint: null,
    valueSetAt: '2026-09-27T08:00:00.000Z',
    valueState: 'readable',
  }

  it('is asked for at the route by the office, which keeps who saw it', async () => {
    roles = ['office']
    await mount([closedSite])
    await rolesKnown()
    const user = userEvent.setup()
    const card = await screen.findByRole('region', { name: 'Zugang zum Objekt' })

    await user.click(await within(card).findByRole('button', { name: 'Garage anzeigen' }))

    expect(await within(card).findByText('2468')).toBeTruthy()
    expect(calls).toContain('POST /sites/s-1/accesses/a-3/reveal')
    // The route wrote the trace; nothing waits in the outbox.
    expect(server.operations()).toEqual([])
  })

  it('says why not without a network', async () => {
    roles = ['owner']
    reveal = () => Promise.reject(new TypeError('Failed to fetch'))
    await mount([closedSite])
    await rolesKnown()
    const user = userEvent.setup()
    const card = await screen.findByRole('region', { name: 'Zugang zum Objekt' })

    await user.click(await within(card).findByRole('button', { name: 'Garage anzeigen' }))

    expect(
      await within(card).findByText(
        'Keine Verbindung. Ohne Netz sind nur die Werte zu offenen Aufträgen auf diesem Gerät.',
      ),
    ).toBeTruthy()
    expect(within(card).queryByText('2468')).toBeNull()
  })

  it('offers nothing to a technician, who holds the values of the open jobs only', async () => {
    await mount([closedSite])
    await rolesKnown()
    const card = await screen.findByRole('region', { name: 'Zugang zum Objekt' })

    expect(within(card).getByText('Garage')).toBeTruthy()
    expect(within(card).queryByRole('button', { name: 'Garage anzeigen' })).toBeNull()
  })
})
