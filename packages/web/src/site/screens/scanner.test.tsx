import 'fake-indexeddb/auto'

import type { RecordState } from '@opengewerk/domain'
import { ScanningContext } from '@opengewerk/platform-web/site'
import type { CodeReader, Scanning } from '@opengewerk/platform-web/site'
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
import { beforeEach, describe, expect, it } from 'vitest'

import { SyncClient } from '../../sync/client.js'
import { SitePvStringScreen } from './pv.js'
import { SiteScannerScreen } from './scanner.js'

/**
 * #300 on the roof: the serial numbers of a string's modules from their
 * labels, one after the other, and by hand where no label can be read.
 */

let server: TestServer
let counter = 0

/** What the camera sees now; the test holds a label in front of it by setting this. */
let label: string | null = null
let stopped = 0

const reader: CodeReader = { read: () => Promise.resolve(label) }

/** A stream the picture takes, whose one track counts how often it is stopped. */
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

function module(id: string, position: number, serial: string | null) {
  return {
    id,
    pvStringId: 'st-2',
    manufacturer: 'JA Solar',
    model: 'JAM54S30-400/MR',
    serialNumber: serial,
    ratedPowerW: 400,
    position,
  }
}

const rows: Readonly<Record<string, RecordState[]>> = {
  customers: [{ id: 'c-1', kind: 'private', name: 'Familie Weber' }],
  sites: [{ id: 's-1', customerId: 'c-1', designation: 'Wohnhaus' }],
  installations: [{ id: 'pv-1', siteId: 's-1', kind: 'pv_system', designation: 'PV-Anlage Dach' }],
  jobs: [
    {
      id: 'j-1',
      customerId: 'c-1',
      siteId: 's-1',
      installationId: 'pv-1',
      parentJobId: null,
      kind: 'service',
      status: 'active',
      designation: 'Wartung PV-Anlage',
      description: null,
    },
  ],
  inverters: [{ id: 'w-1', installationId: 'pv-1', designation: 'WR 1', position: 0 }],
  pv_strings: [
    { id: 'st-1', inverterId: 'w-1', designation: 'String 1', position: 0 },
    { id: 'st-2', inverterId: 'w-1', designation: 'String 2', position: 1 },
  ],
  pv_modules: [
    { ...module('m-9', 0, 'JA2404118759'), pvStringId: 'st-1' },
    module('m-1', 0, 'JA2404118771'),
    module('m-2', 1, null),
    module('m-3', 2, null),
  ],
}

async function mount(path: string, scanning: Partial<Scanning> = {}) {
  for (const [entity, list] of Object.entries(rows)) {
    for (const row of list) {
      server.put(entity, row)
    }
  }

  const client = await SyncClient.start({
    store: await openLocalStore(`scanner${String((counter += 1))}`),
    transport: server,
    writer: server,
    deviceId: 'telefon-auf-dem-dach',
    entities: [
      'customers',
      'sites',
      'installations',
      'jobs',
      'inverters',
      'pv_strings',
      'pv_modules',
    ],
    onSignedOut: () => {},
  })

  await client.synchronise()

  const root = createRootRoute()
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({
        getParentRoute: () => root,
        path: '/auftraege/$jobId/wechselrichter/$inverterId/strings/$stringId',
        component: SitePvStringScreen,
      }),
      createRoute({
        getParentRoute: () => root,
        path: '/auftraege/$jobId/wechselrichter/$inverterId/strings/$stringId/scannen',
        component: SiteScannerScreen,
      }),
    ]),
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  render(
    <QueryClientProvider client={queries}>
      <ScanningContext.Provider
        value={{
          openReader: () => Promise.resolve(reader),
          openCamera: camera,
          interval: 5,
          ...scanning,
        }}
      >
        <SyncProvider client={client}>
          <RouterProvider router={router} />
        </SyncProvider>
      </ScanningContext.Provider>
    </QueryClientProvider>,
  )

  return { client, router }
}

const scanner = '/auftraege/j-1/wechselrichter/w-1/strings/st-2/scannen'

/** The serial numbers the server got, by module. */
function sent() {
  return Object.fromEntries(
    server
      .operations()
      .map((operation) => [
        operation.recordId,
        operation.patches.find((patch) => patch.field === 'serialNumber')?.to,
      ]),
  )
}

beforeEach(() => {
  server = new TestServer()
  label = null
  stopped = 0
})

describe('the scanner of a string', () => {
  it('is opened from the string while a module has no serial number', async () => {
    const { router } = await mount('/auftraege/j-1/wechselrichter/w-1/strings/st-2')
    const user = userEvent.setup()

    expect(
      await screen.findByText(
        '2 von 3 Modulen ohne Seriennummer. Jede gescannte Nummer geht an das nächste Modul ohne.',
      ),
    ).toBeDefined()
    await user.click(screen.getByRole('button', { name: 'Seriennummern scannen' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(scanner)
    })
  })

  it('gives each label to the next module without a number, and takes a label only once', async () => {
    const { client } = await mount(scanner)

    expect(await screen.findByRole('heading', { name: 'Modul 2 von 3' })).toBeDefined()
    expect(screen.getByText('String 2, WR 1')).toBeDefined()

    label = 'JA2404118772'
    const last = await screen.findByRole('status')
    await waitFor(() => {
      expect(last.textContent).toBe('Modul 2JA2404118772')
    })
    // The camera still on the same label: it is not taken again, and not
    // called somebody else's either.
    await screen.findByRole('heading', { name: 'Modul 3 von 3' })
    expect(screen.queryByRole('alert')).toBeNull()

    // A label another module has.
    label = 'JA2404118759'
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Diese Nummer hat schon Modul 1 an String 1.',
    )

    label = '  JA2404118773  '
    expect(
      await screen.findByRole('heading', { name: 'Alle Module haben eine Seriennummer' }),
    ).toBeDefined()
    expect(screen.getByText('Jedes Modul dieses Strings hat eine Seriennummer.')).toBeDefined()
    // Nothing left to read: the camera is let go while the screen still stands.
    await waitFor(() => {
      expect(stopped).toBe(1)
    })

    await client.synchronise()
    expect(sent()).toEqual({ 'm-2': 'JA2404118772', 'm-3': 'JA2404118773' })
  })

  it('takes a number typed by hand, and goes on to the next module', async () => {
    const { client } = await mount(scanner)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Von Hand eingeben' }))
    expect(screen.getByText('String 2, WR 1, von Hand')).toBeDefined()

    await user.click(screen.getByRole('button', { name: 'Übernehmen und weiter' }))
    expect(await screen.findByText('Die Nummer, wie sie auf dem Etikett steht.')).toBeDefined()

    await user.type(screen.getByLabelText('Seriennummer von Modul 2'), 'JA2404118772')
    await user.click(screen.getByRole('button', { name: 'Übernehmen und weiter' }))

    const next = await screen.findByLabelText<HTMLInputElement>('Seriennummer von Modul 3')
    expect(next.value).toBe('')

    await client.synchronise()
    expect(sent()).toEqual({ 'm-2': 'JA2404118772' })
  })

  it('says so where there is no camera, and leaves the way by hand', async () => {
    await mount(scanner, { openCamera: () => Promise.reject(new Error('NotAllowedError')) })

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Die Kamera lässt sich nicht öffnen, sie ist nicht freigegeben oder nicht da. Die Nummern lassen sich von Hand eingeben.',
    )
    expect(screen.getByRole('button', { name: 'Von Hand eingeben' })).toBeDefined()
  })

  it('says so where the device reads no bar codes', async () => {
    await mount(scanner, { openReader: () => Promise.resolve(null) })

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Dieses Gerät liest keine Strichcodes. Die Nummern lassen sich von Hand eingeben.',
    )
  })

  it('lets go of the camera when it is done', async () => {
    const { router } = await mount(scanner)
    const user = userEvent.setup()

    await screen.findByRole('heading', { name: 'Modul 2 von 3' })
    await waitFor(() => {
      expect(stopped).toBe(0)
    })
    await user.click(screen.getByRole('button', { name: 'Fertig' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/auftraege/j-1/wechselrichter/w-1/strings/st-2')
    })
    expect(stopped).toBe(1)
  })
})
