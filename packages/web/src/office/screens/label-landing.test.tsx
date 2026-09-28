import 'fake-indexeddb/auto'

import type { RecordState } from '@opengewerk/domain'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { SyncClient } from '../../sync/client.js'
import { SyncProvider } from '../../sync/provider.js'
import { openLocalStore } from '../../sync/store.js'
import { TestServer } from '../../sync/test-server.js'
import { LabelLandingScreen } from './label-landing.js'

/**
 * The address on a QR label in the browser of a phone (#308): signed in, it
 * opens the installation; a blocked label or one the device does not know
 * says why it opens nothing.
 */

let server: TestServer
let counter = 0

const labels: readonly RecordState[] = [
  { id: 'l-1', installationId: 'i-1', code: '7K2M9QX4TBA3HW8P', blockedAt: null },
  {
    id: 'l-0',
    installationId: 'i-1',
    code: 'A1B2C3D4E5F6G7H8',
    blockedAt: '2026-09-20T08:00:00.000Z',
  },
]

function Installation() {
  return <h1>Die Anlage</h1>
}

async function mount(path: string) {
  // The screen reads the code from the address of the page, as the camera
  // handed it over, and not from the router.
  globalThis.history.replaceState(null, '', path)

  for (const label of labels) {
    server.put('installation_labels', label)
  }

  const client = await SyncClient.start({
    store: await openLocalStore(`office-landing${String((counter += 1))}`),
    transport: server,
    writer: server,
    deviceId: 'telefon-im-browser',
    entities: ['installation_labels'],
    onSignedOut: () => {},
  })

  await client.synchronise()

  const root = createRootRoute()
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({ getParentRoute: () => root, path: '/a/$code', component: LabelLandingScreen }),
      createRoute({
        getParentRoute: () => root,
        path: '/anlagen/$installationId',
        component: Installation,
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

  return router
}

beforeEach(() => {
  server = new TestServer()
})

afterEach(() => {
  globalThis.history.replaceState(null, '', '/')
})

describe('the address of a QR label', () => {
  it('opens the installation of a valid label', async () => {
    const router = await mount('/a/7K2M9QX4TBA3HW8P')

    expect(await screen.findByRole('heading', { name: 'Die Anlage' })).toBeTruthy()
    expect(router.state.location.pathname).toBe('/anlagen/i-1')
  })

  it('reads the code as leniently as the scanner does', async () => {
    await mount('/a/7k2m-9qx4-tba3-hw8p')

    expect(await screen.findByRole('heading', { name: 'Die Anlage' })).toBeTruthy()
  })

  it('opens nothing for a blocked label and says so', async () => {
    await mount('/a/A1B2C3D4E5F6G7H8')

    expect(await screen.findByRole('heading', { name: 'Dieses Etikett ist gesperrt' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Die Anlage' })).toBeNull()
  })

  it('tells a label the business does not know from one the device does not hold', async () => {
    server.narrowed = { installation_labels: 'all' }
    await mount('/a/ZZZZZZZZZZZZZZZZ')

    expect(
      await screen.findByRole('heading', { name: 'Dieses Etikett kennt der Betrieb nicht' }),
    ).toBeTruthy()
  })

  it('says an installation outside the share of the device is not on it', async () => {
    server.narrowed = { installation_labels: 'jobs:abc' }
    await mount('/a/ZZZZZZZZZZZZZZZZ')

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: 'Diese Anlage liegt nicht auf diesem Gerät' }),
      ).toBeTruthy()
    })
  })

  it('says an address with no code in it is no label', async () => {
    await mount('/a/kein-etikett')

    expect(
      await screen.findByRole('heading', { name: 'Das ist kein Etikett einer Anlage' }),
    ).toBeTruthy()
  })
})
