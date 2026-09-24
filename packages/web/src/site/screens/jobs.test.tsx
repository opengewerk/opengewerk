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
import { render, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SyncClient } from '../../sync/client.js'
import { SyncProvider } from '../../sync/provider.js'
import { openLocalStore } from '../../sync/store.js'
import { TestServer } from '../../sync/test-server.js'
import { SiteJobScreen } from './jobs.js'

/**
 * A job on site, seen by the technician who works on it (#128).
 *
 * The preview always runs as the owner, and that is how the site app could
 * offer every technician two buttons the server refused from the start: finishing
 * the job and writing a note about it. These tests look at the screen with
 * the roles somebody really has.
 */

let server: TestServer
let answers: Map<string, unknown>
let counter = 0

const rows: Readonly<Record<string, RecordState[]>> = {
  customers: [{ id: 'c-1', kind: 'private', name: 'Familie Berg' }],
  jobs: [
    {
      id: 'j-1',
      customerId: 'c-1',
      siteId: null,
      installationId: null,
      parentJobId: null,
      kind: 'service',
      status: 'active',
      designation: 'Steckdose ohne Strom',
      description: null,
    },
  ],
}

function signedInAs(...roles: RoleKey[]) {
  answers.set('/api/auth/get-session', {
    user: { id: 'u-1', email: 'max@nord.example.de', name: 'Max Monteur' },
    session: { activeTenantId: 't-1' },
  })
  answers.set('/auth/tenants', [{ id: 't-1', name: 'Elektro Nord GmbH', roles }])
}

async function mount() {
  for (const [entity, list] of Object.entries(rows)) {
    for (const row of list) {
      server.put(entity, row)
    }
  }

  const client = await SyncClient.start({
    store: await openLocalStore(`auftrag${String((counter += 1))}`),
    transport: server,
    writer: server,
    deviceId: 'telefon-max',
    entities: ['customers', 'sites', 'installations', 'jobs', 'documents', 'tasks'],
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
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  render(
    <QueryClientProvider client={queries}>
      <SyncProvider client={client}>
        <RouterProvider router={router} />
      </SyncProvider>
    </QueryClientProvider>,
  )

  await screen.findByRole('heading', { name: 'Steckdose ohne Strom' })

  return { client, queries }
}

beforeEach(() => {
  server = new TestServer()
  answers = new Map()
  answers.set('/tasks/assignees', [])

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

describe('a job on site, for a technician', () => {
  it('can be finished, and only its status goes out', async () => {
    signedInAs('technician')
    await mount()
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Auftrag abschließen' }))

    await waitFor(() => {
      expect(server.row('jobs', 'j-1')?.['status']).toBe('completed')
    })
    expect(
      server.operations().map(({ entity, kind, patches }) => ({ entity, kind, patches })),
    ).toEqual([
      {
        entity: 'jobs',
        kind: 'update',
        patches: [{ field: 'status', from: 'active', to: 'completed' }],
      },
    ])
    expect(await screen.findByText('Dieser Auftrag ist abgeschlossen.')).toBeTruthy()
  })

  it('takes a note about what happened, and nothing else about the job', async () => {
    signedInAs('technician')
    await mount()
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Notiz schreiben' }))
    await user.type(await screen.findByLabelText('Was passiert ist'), 'Sicherung getauscht.')
    await user.click(screen.getByRole('button', { name: 'Notiz sichern' }))

    await waitFor(() => {
      expect(server.row('jobs', 'j-1')?.['description']).toBe('Sicherung getauscht.')
    })
    expect(
      server.operations().flatMap((operation) => operation.patches.map((patch) => patch.field)),
    ).toEqual(['description'])
  })
})

describe('a job on site, for somebody who may not report on it', () => {
  it('offers neither finishing nor a note', async () => {
    signedInAs()
    const { queries } = await mount()

    // Both answers have to be in first, or the buttons are missing only
    // because nobody knows the roles yet, and the test would pass on any
    // screen.
    await waitFor(() => {
      expect(queries.getQueryState(['account'])?.status).toBe('success')
      expect(queries.getQueryState(['tenants'])?.status).toBe('success')
    })
    expect(screen.queryByRole('button', { name: 'Auftrag abschließen' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Notiz schreiben' })).toBeNull()
  })
})
