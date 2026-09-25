import 'fake-indexeddb/auto'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { render, screen, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SyncClient } from '../../sync/client.js'
import { SyncProvider } from '../../sync/provider.js'
import { openLocalStore } from '../../sync/store.js'
import { TestServer } from '../../sync/test-server.js'
import { InstallationList } from './installations.js'
import { SiteList } from './sites.js'

/**
 * The lists of sites and installations, which the office did not have until
 * #219: a site was only found through its customer, an installation only
 * through its site.
 */

let server: TestServer
let counter = 0

async function mount(path: string) {
  const client = await SyncClient.start({
    store: await openLocalStore(`listen${String((counter += 1))}`),
    transport: server,
    writer: server,
    deviceId: 'office-computer',
    entities: ['customers', 'sites', 'installations', 'jobs'],
    onSignedOut: () => {},
  })

  await client.synchronise()

  const root = createRootRoute()
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({ getParentRoute: () => root, path: '/objekte', component: SiteList }),
      createRoute({ getParentRoute: () => root, path: '/anlagen', component: InstallationList }),
      createRoute({ getParentRoute: () => root, path: '/objekte/$siteId', component: () => null }),
      createRoute({
        getParentRoute: () => root,
        path: '/anlagen/$installationId',
        component: () => null,
      }),
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
}

beforeEach(() => {
  server = new TestServer()
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: /min-width:\s*(37\.5|64)rem/.test(query),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
  server.put('customers', { id: 'c-1', name: 'Familie Berg', kind: 'private', version: 1 })
  server.put('customers', {
    id: 'c-2',
    name: 'Hausverwaltung Nordblick GmbH',
    kind: 'property_management',
    version: 1,
  })
  server.put('sites', {
    id: 's-1',
    customerId: 'c-1',
    designation: 'Einfamilienhaus Berg',
    postalCode: '22301',
    city: 'Hamburg',
    updatedAt: '2026-09-20T08:00:00.000Z',
    version: 1,
  })
  server.put('sites', {
    id: 's-2',
    customerId: 'c-2',
    designation: 'Wohnanlage Elbchaussee',
    postalCode: '22763',
    city: 'Hamburg',
    updatedAt: '2026-09-24T08:00:00.000Z',
    version: 1,
  })
  server.put('installations', {
    id: 'i-1',
    siteId: 's-1',
    kind: 'wallbox',
    designation: 'Wallbox Garage',
    manufacturer: 'Mennekes',
    updatedAt: '2026-09-21T08:00:00.000Z',
    version: 1,
  })
  server.put('installations', {
    id: 'i-2',
    siteId: 's-2',
    kind: 'meter_cabinet',
    designation: 'Zählerschrank Keller',
    updatedAt: '2026-09-22T08:00:00.000Z',
    version: 1,
  })
  server.put('jobs', {
    id: 'j-1',
    customerId: 'c-1',
    siteId: 's-1',
    designation: 'Wallbox anschließen',
    kind: 'service',
    status: 'active',
    version: 1,
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the list of sites', () => {
  it('shows the customer and what runs there, the last changed first', async () => {
    await mount('/objekte')

    const table = await screen.findByRole('table', { name: 'Alle Objekte des Betriebs' })
    const rows = within(table)
      .getAllByRole('row')
      .slice(1)
      .map((row) =>
        within(row)
          .getAllByRole('cell')
          .map((cell) => cell.textContent),
      )

    expect(rows).toEqual([
      ['Wohnanlage Elbchaussee', 'Hausverwaltung Nordblick GmbH', '22763 Hamburg', '1', '0'],
      ['Einfamilienhaus Berg', 'Familie Berg', '22301 Hamburg', '1', '1'],
    ])
  })

  it('narrows to the sites with a job that runs', async () => {
    await mount('/objekte')
    const user = userEvent.setup()

    await screen.findByRole('table', { name: 'Alle Objekte des Betriebs' })
    await user.click(screen.getByRole('button', { name: 'Mit offenem Auftrag' }))

    expect(screen.getByRole('link', { name: 'Einfamilienhaus Berg' })).toBeDefined()
    expect(screen.queryByRole('link', { name: 'Wohnanlage Elbchaussee' })).toBeNull()
  })
})

describe('the list of installations', () => {
  it('finds an installation by its kind, and says where it is', async () => {
    await mount('/anlagen')
    const user = userEvent.setup()

    const table = await screen.findByRole('table', { name: 'Alle Anlagen des Betriebs' })

    expect(within(table).getByRole('cell', { name: 'Einfamilienhaus Berg' })).toBeDefined()

    await user.click(screen.getByRole('button', { name: 'Wallbox' }))

    expect(screen.getByRole('link', { name: 'Wallbox Garage' })).toBeDefined()
    expect(screen.queryByRole('link', { name: 'Zählerschrank Keller' })).toBeNull()
  })
})
