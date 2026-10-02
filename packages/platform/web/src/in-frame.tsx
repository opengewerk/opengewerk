import type { TenantId } from '@opengewerk/platform-domain'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { vi } from 'vitest'

import type { InterfaceApplication } from './application.js'
import { InProbe, probeRules } from './probe-application.js'
import type { TenantChoice } from './session/session.js'
import { SyncClient } from './sync/client.js'
import { SyncProvider } from './sync/provider.js'
import { openLocalStore } from './sync/store.js'
import { TestServer } from './sync/test-server.js'

/**
 * A frame of the foundation as an application mounts it, for the tests of the
 * frames: the route over the screens, inside the application that belongs to
 * nobody, with a sync client of its records and a server that answers what a
 * test tells it to.
 */

export interface Heard {
  readonly method: string
  readonly path: string
  readonly body: unknown
}

export interface StandIn {
  /** What the server answers a request with; anything else is a 404. */
  readonly answer: (method: string, path: string, value: unknown, status?: number) => void
  /** Every request so far, in order. */
  readonly heard: Heard[]
}

/** Puts a server in the place of `fetch` that answers what it was told and remembers what it was asked. */
export function standInServer(): StandIn {
  const answers = new Map<string, { readonly value: unknown; readonly status: number }>()
  const heard: Heard[] = []

  vi.stubGlobal('fetch', (path: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const answer = answers.get(`${method} ${path}`)

    heard.push({
      method,
      path,
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
    })

    return Promise.resolve(
      new Response(JSON.stringify(answer?.value ?? {}), {
        status: answer?.status ?? 404,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  })

  return {
    answer(method, path, value, status = 200) {
      answers.set(`${method} ${path}`, { value, status })
    },
    heard,
  }
}

/** A tenant as the server lists it for the person signed in. */
export function aTenant(over: Partial<Omit<TenantChoice, 'id'>> & { id?: string } = {}) {
  return {
    name: 'Probewerk Nord',
    roles: ['member'],
    roleLabels: ['Mitglied'],
    rights: [],
    secondFactor: false,
    ...over,
    id: (over.id ?? 't-1') as TenantId,
  } satisfies TenantChoice
}

/** Somebody signed in, working in the first of these tenants. */
export function signedIn(
  server: StandIn,
  tenants: readonly TenantChoice[] = [aTenant()],
  person: { readonly name: string; readonly email: string } = {
    name: 'Mia Mitglied',
    email: 'mia@nord.example.de',
  },
): void {
  server.answer('GET', '/api/auth/get-session', {
    user: { id: 'u-1', ...person },
    session: { activeTenantId: tenants[0]?.id ?? null },
  })
  server.answer('GET', '/auth/tenants', tenants)
}

let stores = 0

/** A sync client of the probe records, exchanged once with this server. */
export async function probeClient(server: TestServer = new TestServer()): Promise<SyncClient> {
  const client = await SyncClient.start({
    store: await openLocalStore(`frame${String((stores += 1))}`),
    transport: server,
    writer: server,
    rules: probeRules,
    deviceId: 'device',
    entities: ['shelves', 'notes'],
    onSignedOut: () => {},
  })

  // Without a connection the round fails, and the client says so itself.
  await client.synchronise().catch(() => undefined)

  return client
}

export interface InFrame {
  /** The address to start at. */
  readonly at?: string
  /** The screens below the frame, by their path. One at `/` unless given. */
  readonly screens?: Readonly<Record<string, () => ReactNode>>
  readonly server?: TestServer
  readonly application?: InterfaceApplication
}

/** Mounts the frame as the route over its screens. */
export async function inFrame(frame: () => ReactNode, options: InFrame = {}) {
  const server = options.server ?? new TestServer()
  const client = await probeClient(server)
  const root = createRootRoute({ component: frame })
  const screens = options.screens ?? { '/': () => <h1>Regale</h1> }
  const router = createRouter({
    routeTree: root.addChildren(
      Object.entries(screens).map(([path, component]) =>
        createRoute({ getParentRoute: () => root, path, component }),
      ),
    ),
    history: createMemoryHistory({ initialEntries: [options.at ?? '/'] }),
  })

  const shown = render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <InProbe application={options.application}>
        <SyncProvider client={client}>
          <RouterProvider router={router} />
        </SyncProvider>
      </InProbe>
    </QueryClientProvider>,
  )

  return { router, client, server, ...shown }
}
