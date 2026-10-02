import 'fake-indexeddb/auto'

import type { RecordState } from '@opengewerk/domain'
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
import { beforeEach, describe, expect, it } from 'vitest'

import { SyncClient } from '../../sync/client.js'
import { SiteJobScreen } from './jobs.js'
import { SiteInverterScreen, SitePvStringScreen } from './pv.js'

/**
 * #300 on site: a technician on the roof reads the PV structure of the job's
 * system and adds what is missing, a string or a row of modules, without a
 * network.
 */

let server: TestServer
let counter = 0

function module(id: string, pvStringId: string, position: number, serial: string | null) {
  return {
    id,
    pvStringId,
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
  installations: [
    {
      id: 'pv-1',
      siteId: 's-1',
      kind: 'pv_system',
      designation: 'PV-Anlage Dach',
      commissionedOn: '2022-05-17',
    },
    {
      id: 'bat-1',
      siteId: 's-1',
      kind: 'battery',
      designation: 'Speicher Technikraum',
      manufacturer: 'BYD',
      model: 'Battery-Box HVS 7.7',
      pvSystemId: 'pv-1',
      inverterId: 'w-1',
    },
  ],
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
  inverters: [
    {
      id: 'w-1',
      installationId: 'pv-1',
      designation: 'WR 1',
      manufacturer: 'Fronius',
      model: 'Symo GEN24 10.0 Plus',
      serialNumber: '34125009',
      ratedPowerW: 10_000,
      mppInputs: 2,
      position: 0,
    },
  ],
  pv_strings: [
    {
      id: 'st-1',
      inverterId: 'w-1',
      designation: 'String 1',
      mppInput: 1,
      azimuthDeg: 180,
      tiltDeg: 30,
      position: 0,
    },
    {
      id: 'st-2',
      inverterId: 'w-1',
      designation: 'String 2',
      mppInput: 2,
      azimuthDeg: 270,
      tiltDeg: 30,
      position: 1,
    },
  ],
  pv_modules: [
    module('m-1', 'st-1', 0, 'JA2404118759'),
    module('m-2', 'st-2', 0, 'JA2404118771'),
    module('m-3', 'st-2', 1, null),
    module('m-4', 'st-2', 2, null),
  ],
}

async function mount(path: string) {
  for (const [entity, list] of Object.entries(rows)) {
    for (const row of list) {
      server.put(entity, row)
    }
  }

  const client = await SyncClient.start({
    store: await openLocalStore(`dach${String((counter += 1))}`),
    transport: server,
    writer: server,
    deviceId: 'telefon-auf-dem-dach',
    entities: [
      'customers',
      'sites',
      'installations',
      'jobs',
      'documents',
      'tasks',
      'distribution_boards',
      'board_sections',
      'circuits',
      'equipment',
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
        path: '/auftraege/$jobId',
        component: SiteJobScreen,
      }),
      createRoute({
        getParentRoute: () => root,
        path: '/auftraege/$jobId/wechselrichter/$inverterId',
        component: SiteInverterScreen,
      }),
      createRoute({
        getParentRoute: () => root,
        path: '/auftraege/$jobId/wechselrichter/$inverterId/strings/$stringId',
        component: SitePvStringScreen,
      }),
    ]),
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  render(
    <QueryClientProvider client={queries}>
      <SyncProvider client={client}>
        <RouterProvider router={router} />
      </SyncProvider>
    </QueryClientProvider>,
  )

  return { client, router }
}

beforeEach(() => {
  server = new TestServer()
})

describe('the job at a PV system', () => {
  it('shows the inverters in the card of the system, with its power and what belongs to it', async () => {
    const { router } = await mount('/auftraege/j-1')
    const user = userEvent.setup()

    const card = await screen.findByRole('region', { name: 'Anlage' })
    expect(card.textContent).toContain('1,60 kWp aus 4 Modulen')

    const inverter = within(card).getByRole('link', { name: /WR 1/ })
    expect(inverter.textContent).toContain('Fronius Symo GEN24 10.0 Plus, 10,0 kW, 2 Strings')

    const belongs = within(card).getByRole('region', { name: 'Dazu gehören' })
    expect(belongs.textContent).toContain('Speicher Technikraum')
    expect(belongs.textContent).toContain('BYD Battery-Box HVS 7.7, am WR 1')

    await user.click(inverter)
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/auftraege/j-1/wechselrichter/w-1')
    })
  })
})

describe('an inverter on site', () => {
  it('lists its strings with what they are and the serial numbers still missing', async () => {
    await mount('/auftraege/j-1/wechselrichter/w-1')

    const strings = await screen.findByRole('list', { name: 'Strings' })
    expect(
      within(strings)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual([
      'String 1MPP-Eingang 1, 1 Modul, 0,40 kWp, Süd 30°',
      'String 2MPP-Eingang 2, 3 Module, 1,20 kWp, West 30°2 Seriennummern fehlen',
    ])
  })

  it('takes the string that is missing without a network, and sends it once there is one', async () => {
    const { client } = await mount('/auftraege/j-1/wechselrichter/w-1')
    const user = userEvent.setup()
    server.offline = true

    await user.click(await screen.findByRole('button', { name: 'String nachtragen' }))
    const form = screen.getByRole('region', { name: 'String nachtragen' })
    await user.selectOptions(within(form).getByLabelText('MPP-Eingang'), 'Eingang 1')
    await user.type(within(form).getByLabelText('Ausrichtung in Grad'), '90')
    await user.type(within(form).getByLabelText('Neigung in Grad'), '15')
    await user.click(within(form).getByRole('button', { name: 'String sichern' }))

    const strings = await screen.findByRole('list', { name: 'Strings' })
    await waitFor(() => {
      expect(within(strings).getByText('String 3').closest('a')?.textContent).toContain(
        'noch nicht übertragen',
      )
    })
    expect(server.operations()).toEqual([])

    server.offline = false
    await client.synchronise()

    const [created] = server.operations()
    expect(created?.kind).toBe('create')
    expect(
      Object.fromEntries(created?.patches.map((patch) => [patch.field, patch.to]) ?? []),
    ).toEqual({
      designation: 'String 3',
      mppInput: 1,
      azimuthDeg: 90,
      tiltDeg: 15,
      inverterId: 'w-1',
      position: 2,
    })
  })
})

describe('a string on site', () => {
  it('lists its modules, and says which have no serial number yet', async () => {
    await mount('/auftraege/j-1/wechselrichter/w-1/strings/st-2')

    const modules = await screen.findByRole('list', { name: 'Module' })
    expect(
      within(modules)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([
      'Modul 1JA Solar JAM54S30-400/MR, 400 Wp, SN JA2404118771',
      'Modul 2Seriennummer fehlt',
      'Modul 3Seriennummer fehlt',
    ])
    expect(
      screen.getByText(
        '2 von 3 Modulen ohne Seriennummer. Jede gescannte Nummer geht an das nächste Modul ohne.',
      ),
    ).toBeDefined()
    expect(screen.getByRole('button', { name: 'Seriennummern scannen' })).toBeDefined()
  })

  it('takes a row of modules without a network', async () => {
    const { client } = await mount('/auftraege/j-1/wechselrichter/w-1/strings/st-2')
    const user = userEvent.setup()
    server.offline = true

    await user.click(await screen.findByRole('button', { name: 'Module nachtragen' }))
    const form = screen.getByRole('region', { name: 'Module nachtragen' })
    await user.type(within(form).getByLabelText('Anzahl'), '3')
    await user.click(within(form).getByRole('button', { name: '3 Module sichern' }))

    const modules = await screen.findByRole('list', { name: 'Module' })
    await waitFor(() => {
      expect(within(modules).getAllByRole('listitem')).toHaveLength(6)
    })

    server.offline = false
    await client.synchronise()
    expect(server.operations().map((operation) => operation.entity)).toEqual([
      'pv_modules',
      'pv_modules',
      'pv_modules',
    ])
  })
})
