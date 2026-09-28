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
import { render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import type { CodeReader } from '../../app/barcode.js'
import { SyncClient } from '../../sync/client.js'
import { SyncProvider } from '../../sync/provider.js'
import { openLocalStore } from '../../sync/store.js'
import { TestServer } from '../../sync/test-server.js'
import { ScanningContext } from '../camera.js'
import { SiteBoardScreen } from './boards.js'
import { SiteInstallationScreen } from './installation.js'
import { SiteLabelScanScreen } from './label-scanner.js'

/**
 * #308 on site: the tab "Scannen" reads the QR label on a cabinet door and
 * opens the installation, also without a network when it lies on the device,
 * and says why when a code opens nothing.
 */

let server: TestServer
let counter = 0

/** What the camera sees now; the test holds a label in front of it by setting this. */
let label: string | null = null
let stopped = 0

const reader: CodeReader = { read: () => Promise.resolve(label) }

function camera(): Promise<MediaStream> {
  const stream = new MediaStream()
  const track = {
    stop: () => {
      stopped += 1
    },
  } as unknown as MediaStreamTrack

  stream.getTracks = () => [track]

  return Promise.resolve(stream)
}

const rows: Readonly<Record<string, RecordState[]>> = {
  customers: [{ id: 'c-1', kind: 'business', name: 'Hausverwaltung Süd GmbH' }],
  sites: [
    {
      id: 's-1',
      customerId: 'c-1',
      designation: 'Rheinstraße 12',
      street: 'Rheinstraße',
      houseNumber: '12',
      postalCode: '68159',
      city: 'Mannheim',
    },
  ],
  installations: [
    {
      id: 'i-1',
      siteId: 's-1',
      kind: 'meter_cabinet',
      designation: 'Zählerschrank, Keller',
      serialNumber: 'HG-2019-11-0442',
      commissionedOn: '2019-11-04',
    },
  ],
  distribution_boards: [
    { id: 'b-1', installationId: 'i-1', designation: 'HV', kind: 'main', position: 0 },
  ],
  jobs: [
    {
      id: 'j-1',
      customerId: 'c-1',
      siteId: 's-1',
      installationId: 'i-1',
      parentJobId: null,
      number: 'AU-2026-0184',
      kind: 'service',
      status: 'active',
      designation: 'Störung Treppenhauslicht',
      description: null,
    },
  ],
  installation_labels: [
    { id: 'l-1', installationId: 'i-1', code: '7K2M9QX4TBA3HW8P', blockedAt: null },
    {
      id: 'l-0',
      installationId: 'i-1',
      code: 'A1B2C3D4E5F6G7H8',
      blockedAt: '2026-09-20T08:00:00.000Z',
    },
  ],
}

async function mount() {
  for (const [entity, list] of Object.entries(rows)) {
    for (const row of list) {
      server.put(entity, row)
    }
  }

  const client = await SyncClient.start({
    store: await openLocalStore(`etikett${String((counter += 1))}`),
    transport: server,
    writer: server,
    deviceId: 'telefon-am-schrank',
    entities: [
      'customers',
      'sites',
      'installations',
      'installation_labels',
      'distribution_boards',
      'board_sections',
      'circuits',
      'jobs',
      'form_records',
    ],
    onSignedOut: () => {},
  })

  await client.synchronise()

  const root = createRootRoute()
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({ getParentRoute: () => root, path: '/scannen', component: SiteLabelScanScreen }),
      createRoute({
        getParentRoute: () => root,
        path: '/anlagen/$installationId',
        component: SiteInstallationScreen,
      }),
      createRoute({
        getParentRoute: () => root,
        path: '/anlagen/$installationId/verteiler/$boardId',
        component: SiteBoardScreen,
      }),
    ]),
    history: createMemoryHistory({ initialEntries: ['/scannen'] }),
  })
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  render(
    <QueryClientProvider client={queries}>
      <ScanningContext.Provider
        value={{ openReader: () => Promise.resolve(reader), openCamera: camera, interval: 5 }}
      >
        <SyncProvider client={client}>
          <RouterProvider router={router} />
        </SyncProvider>
      </ScanningContext.Provider>
    </QueryClientProvider>,
  )

  return { client, router }
}

beforeEach(() => {
  server = new TestServer()
  label = null
  stopped = 0
})

describe('the tab "Scannen"', () => {
  it('opens the installation of a label, with its boards below it and its jobs on the device', async () => {
    const { router } = await mount()

    expect(await screen.findByText('Etikett scannen')).toBeTruthy()
    label = 'https://msk.opengewerk.de/a/7K2M9QX4TBA3HW8P'

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/anlagen/i-1')
    })
    label = null

    const card = await screen.findByRole('region', { name: 'Anlage' })
    expect(within(card).getByText('Zählerschrank, Keller')).toBeTruthy()
    expect(within(card).getByRole('link', { name: /HV/ }).getAttribute('href')).toBe(
      '/anlagen/i-1/verteiler/b-1',
    )
    const jobs = screen.getByRole('region', { name: 'Aufträge an dieser Anlage' })
    expect(
      within(jobs).getByRole('link', { name: /Störung Treppenhauslicht/ }).textContent,
    ).toContain('AU-2026-0184')
    // The camera went with the tab.
    expect(stopped).toBe(1)
  })

  it('reads the code whatever host is in front of it, and opens without a network', async () => {
    const { router } = await mount()
    server.offline = true

    label = 'https://alte-adresse.example/a/7k2m-9qx4-tba3-hw8p'

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/anlagen/i-1')
    })
  })

  it('opens the board below the installation, not below a job', async () => {
    const user = userEvent.setup()
    const { router } = await mount()
    label = 'https://msk.opengewerk.de/a/7K2M9QX4TBA3HW8P'
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/anlagen/i-1')
    })
    label = null

    await user.click(await screen.findByRole('link', { name: /HV/ }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/anlagen/i-1/verteiler/b-1')
    })
    expect(
      await screen.findByText('In diesem Verteiler ist noch kein Stromkreis erfasst.'),
    ).toBeTruthy()
  })

  it('says a blocked label is blocked, and scans again', async () => {
    const user = userEvent.setup()
    await mount()
    label = 'https://msk.opengewerk.de/a/A1B2C3D4E5F6G7H8'

    expect(await screen.findByText('Dieses Etikett ist gesperrt')).toBeTruthy()
    label = null
    await user.click(screen.getByRole('button', { name: 'Nochmal scannen' }))

    expect(await screen.findByText('QR-Etikett einer Anlage')).toBeTruthy()
  })

  it('says a code that is no label is none, such as the serial number of a module', async () => {
    await mount()
    label = 'JA2404118771'

    expect(await screen.findByText('Das ist kein Etikett einer Anlage')).toBeTruthy()
  })

  it('asks the server once more for a label it does not know, and then says it is not on the device', async () => {
    await mount()
    server.narrowed = { installation_labels: 'jobs:abc' }
    const pull = server.pull.bind(server)
    let pulls = 0
    server.pull = () => {
      pulls += 1

      return pull()
    }

    label = 'https://msk.opengewerk.de/a/ZZZZZZZZZZZZZZZZ'

    expect(await screen.findByText('Diese Anlage liegt nicht auf diesem Gerät')).toBeTruthy()
    expect(pulls).toBeGreaterThan(0)
  })

  it('says a label the whole business does not know belongs to no installation of it', async () => {
    server.narrowed = { installation_labels: 'all' }
    await mount()

    label = 'https://msk.opengewerk.de/a/ZZZZZZZZZZZZZZZZ'

    expect(await screen.findByText('Dieses Etikett kennt der Betrieb nicht')).toBeTruthy()
  })
})
