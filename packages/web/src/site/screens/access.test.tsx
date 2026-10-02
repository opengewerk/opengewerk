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

import { type EditResult, SyncClient } from '../../sync/client.js'
import { SyncProvider } from '../../sync/provider.js'
import { openLocalStore } from '../../sync/store.js'
import { TestServer } from '../../sync/test-server.js'
import { SiteJobScreen } from './jobs.js'
import { aTenantChoice } from '../../session/test-tenants.js'

/**
 * "Zugang zum Objekt" at an open job on site (#286), the board "Auftrag:
 * Zugang zum Objekt": each value hidden until tapped, shown from the device
 * also without a network once its showing is in the outbox, and hidden again
 * when the value changes. The owner and the office hold the values of their
 * own open jobs the same way (#447) and ask the route for any other.
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
      return answer([aTenantChoice(roles)])
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

    expect(await within(card).findByText('4711')).toBeTruthy()
    await waitFor(() => {
      expect(server.operations().map(({ entity, kind }) => `${entity} ${kind}`)).toEqual([
        'site_access_reveals create',
      ])
    })

    const written = Object.fromEntries(
      (server.operations()[0]?.patches ?? []).map((patch) => [patch.field, patch.to]),
    )

    expect(written).toMatchObject({ siteAccessId: 'a-1', valueSetAt: safe.valueSetAt })
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

    expect(await within(card).findByText('4711')).toBeTruthy()
    await waitFor(() => {
      expect(client.status().pending).toBe(1)
    })
    expect(server.operations()).toEqual([])
  })

  it('write one showing for two quick taps', async () => {
    const client = await mount([safe])
    const user = userEvent.setup()
    const card = await screen.findByRole('region', { name: 'Zugang zum Objekt' })
    let release: (result: EditResult) => void = () => {}
    const create = vi.spyOn(client, 'create').mockImplementation(
      () =>
        new Promise<EditResult>((resolve) => {
          release = resolve
        }),
    )
    const button = within(card).getByRole('button', { name: 'Schlüsseltresor Hof anzeigen' })

    // The second tap comes while the first showing is still being written.
    await user.click(button)
    await user.click(button)

    expect(create).toHaveBeenCalledTimes(1)

    release({ outcome: 'queued', id: 'r-1' })

    expect(await within(card).findByText('4711')).toBeTruthy()
  })

  it('keep a value hidden when its showing cannot be written on the device', async () => {
    const client = await mount([safe])
    const user = userEvent.setup()
    const card = await screen.findByRole('region', { name: 'Zugang zum Objekt' })

    vi.spyOn(client, 'create').mockRejectedValueOnce(new DOMException('full', 'QuotaExceededError'))
    await user.click(within(card).getByRole('button', { name: 'Schlüsseltresor Hof anzeigen' }))

    expect(
      await within(card).findByText(
        'Das Anzeigen ließ sich auf diesem Gerät nicht festhalten. Der Wert bleibt verdeckt.',
      ),
    ).toBeTruthy()
    expect(within(card).queryByText('4711')).toBeNull()
    expect(within(card).getByLabelText('verdeckt')).toBeTruthy()
  })

  it('hide a shown value when a new one arrives, until it is tapped again', async () => {
    const client = await mount([safe])
    const user = userEvent.setup()
    const card = await screen.findByRole('region', { name: 'Zugang zum Objekt' })

    await user.click(within(card).getByRole('button', { name: 'Schlüsseltresor Hof anzeigen' }))

    expect(await within(card).findByText('4711')).toBeTruthy()

    server.put('site_accesses', { ...safe, value: '0815', valueSetAt: '2026-09-27T11:00:00.000Z' })
    await client.synchronise()

    await waitFor(() => {
      expect(within(card).queryByText('4711')).toBeNull()
    })
    expect(within(card).queryByText('0815')).toBeNull()

    await user.click(within(card).getByRole('button', { name: 'Schlüsseltresor Hof anzeigen' }))

    expect(await within(card).findByText('0815')).toBeTruthy()
    await waitFor(() => {
      expect(server.operations().map(({ entity }) => entity)).toEqual([
        'site_access_reveals',
        'site_access_reveals',
      ])
    })
  })

  it('leave the screen when the job is closed on the device, without waiting for the network', async () => {
    const client = await mount([safe])

    await screen.findByRole('region', { name: 'Zugang zum Objekt' })
    server.offline = true
    await client.update('jobs', 'j-1', { status: 'completed' })

    await waitFor(() => {
      expect(screen.queryByRole('region', { name: 'Zugang zum Objekt' })).toBeNull()
    })
    expect(client.status().pending).toBe(1)
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

  it('show the owner a value on the device the same way, without the route (#447)', async () => {
    roles = ['owner']
    await mount([safe])
    await rolesKnown()
    const user = userEvent.setup()
    const card = await screen.findByRole('region', { name: 'Zugang zum Objekt' })

    server.offline = true
    await user.click(within(card).getByRole('button', { name: 'Schlüsseltresor Hof anzeigen' }))

    expect(await within(card).findByText('4711')).toBeTruthy()
    expect(calls.filter((call) => call.startsWith('POST'))).toEqual([])
  })

  it('are not there at a site without one', async () => {
    await mount([])
    await rolesKnown()

    expect(screen.queryByRole('region', { name: 'Zugang zum Objekt' })).toBeNull()
  })
})

describe('a way in whose value is not on the device', () => {
  // The row without the value, as a device holds it for a job its person is not on.
  const withoutValue = {
    id: 'a-3',
    siteId: 's-1',
    designation: 'Garage',
    hint: null,
    valueSetAt: '2026-09-27T08:00:00.000Z',
    valueState: 'readable',
  }

  it('is asked for at the route by the office, which keeps who saw it', async () => {
    roles = ['office']
    await mount([withoutValue])
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
    await mount([withoutValue])
    await rolesKnown()
    const user = userEvent.setup()
    const card = await screen.findByRole('region', { name: 'Zugang zum Objekt' })

    await user.click(await within(card).findByRole('button', { name: 'Garage anzeigen' }))

    expect(
      await within(card).findByText(
        'Keine Verbindung. Auf dem Gerät liegen nur die Werte der offenen Aufträge, denen du zugeordnet bist. Jeden anderen Wert zeigt die Verbindung, dabei wird festgehalten, wer ihn gesehen hat.',
      ),
    ).toBeTruthy()
    expect(within(card).queryByText('2468')).toBeNull()
  })

  it('offers nothing to a technician whose device holds no value for it', async () => {
    await mount([withoutValue])
    await rolesKnown()
    const card = await screen.findByRole('region', { name: 'Zugang zum Objekt' })

    expect(within(card).getByText('Garage')).toBeTruthy()
    expect(within(card).queryByRole('button', { name: 'Garage anzeigen' })).toBeNull()
  })
})
