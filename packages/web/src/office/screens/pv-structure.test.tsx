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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SyncClient } from '../../sync/client.js'
import { SyncProvider } from '../../sync/provider.js'
import { openLocalStore } from '../../sync/store.js'
import { TestServer } from '../../sync/test-server.js'
import { InstallationScreen } from './installations.js'
import { InverterScreen, PvStringScreen } from './pv-structure.js'

/**
 * #300 in the office: a PV system with its inverter, strings and modules,
 * and the battery that belongs to it, on the screens the canvas draws.
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
  sites: [
    { id: 's-1', customerId: 'c-1', designation: 'Wohnhaus' },
    { id: 's-2', customerId: 'c-1', designation: 'Scheune' },
  ],
  installations: [
    { id: 'pv-1', siteId: 's-1', kind: 'pv_system', designation: 'PV-Anlage Dach' },
    { id: 'pv-2', siteId: 's-2', kind: 'pv_system', designation: 'PV-Anlage Scheune' },
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
    { id: 'wb-1', siteId: 's-1', kind: 'wallbox', designation: 'Wallbox Garage' },
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
    { id: 'w-9', installationId: 'pv-2', designation: 'WR Scheune', position: 0 },
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
    store: await openLocalStore(`office-pv${String((counter += 1))}`),
    transport: server,
    writer: server,
    deviceId: 'office',
    entities: [
      'customers',
      'sites',
      'installations',
      'jobs',
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
        path: '/anlagen/$installationId',
        component: InstallationScreen,
      }),
      createRoute({
        getParentRoute: () => root,
        path: '/wechselrichter/$inverterId',
        component: InverterScreen,
      }),
      createRoute({
        getParentRoute: () => root,
        path: '/strings/$stringId',
        component: PvStringScreen,
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

/** The fields an operation sets, by name. */
function valuesOf(index = 0) {
  const operation = server.operations()[index]

  return Object.fromEntries(operation?.patches.map((patch) => [patch.field, patch.to]) ?? [])
}

beforeEach(() => {
  server = new TestServer()
  // Somebody from the office, who may change an installation and its
  // structure: the buttons for it are only there for that right.
  const answers = new Map<string, unknown>([
    [
      '/api/auth/get-session',
      {
        user: { id: 'u-1', email: 'u-1@nord.example.de', name: 'u-1' },
        session: { activeTenantId: 't-1' },
      },
    ],
    ['/auth/tenants', [{ id: 't-1', name: 'Solar Nord GmbH', roles: ['office'] }]],
  ])

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

describe('a PV system in the office', () => {
  it('lists its inverters and what belongs to it, and sums its power', async () => {
    const { router } = await mount('/anlagen/pv-1')
    const user = userEvent.setup()

    const inverters = await screen.findByRole('region', { name: 'Wechselrichter' })
    expect(
      within(inverters).getByRole('link', { name: 'WR 1' }).closest('li')?.textContent,
    ).toContain('Fronius Symo GEN24 10.0 Plus, 10,0 kW, 2 Strings, 4 Module, 1,60 kWp')

    const belongs = screen.getByRole('region', { name: 'Dazu gehören' })
    expect(
      within(belongs).getByRole('link', { name: 'Speicher Technikraum' }).closest('li')
        ?.textContent,
    ).toContain('Speicher, BYD Battery-Box HVS 7.7, am WR 1')
    // The wallbox says nothing about a system, so it is not among them.
    expect(within(belongs).queryByRole('link', { name: 'Wallbox Garage' })).toBeNull()

    const facts = screen.getByRole('region', { name: 'Anlage' })
    expect(facts.textContent).toContain('1,60 kWp aus 4 Modulen')
    expect(facts.textContent).toContain('1, zusammen 10,0 kW')

    // The structure opens at the first inverter, not at a board.
    await user.click(screen.getByRole('button', { name: 'Anlagenstruktur öffnen' }))
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/wechselrichter/w-1')
    })
  })

  it('takes a new inverter with its power in kilowatts, kept in watts', async () => {
    const { client } = await mount('/anlagen/pv-1')
    const user = userEvent.setup()

    const inverters = await screen.findByRole('region', { name: 'Wechselrichter' })
    await user.click(
      await within(inverters).findByRole('button', { name: 'Wechselrichter anlegen' }),
    )
    // The next number is suggested.
    expect(within(inverters).getByLabelText<HTMLInputElement>('Bezeichnung').value).toBe('WR 2')
    await user.type(within(inverters).getByLabelText('Hersteller'), 'SMA')
    await user.type(within(inverters).getByLabelText('Nennleistung in kW'), '4,6')
    await user.type(within(inverters).getByLabelText('MPP-Eingänge'), '2')
    await user.click(within(inverters).getByRole('button', { name: 'Wechselrichter anlegen' }))

    await waitFor(() => {
      expect(server.operations()).toHaveLength(1)
    })
    await client.synchronise()
    expect(valuesOf()).toEqual({
      designation: 'WR 2',
      manufacturer: 'SMA',
      ratedPowerW: 4_600,
      mppInputs: 2,
      installationId: 'pv-1',
      position: 1,
    })
  })

  it('refuses a power no inverter has, on the field, and queues nothing', async () => {
    await mount('/anlagen/pv-1')
    const user = userEvent.setup()

    const inverters = await screen.findByRole('region', { name: 'Wechselrichter' })
    await user.click(
      await within(inverters).findByRole('button', { name: 'Wechselrichter anlegen' }),
    )
    // Watts typed where kilowatts are asked.
    await user.type(within(inverters).getByLabelText('Nennleistung in kW'), '46000')
    await user.click(within(inverters).getByRole('button', { name: 'Wechselrichter anlegen' }))

    expect(
      await within(inverters).findByText(
        'Die Nennleistung ist größer als 0 und höchstens 10000 kW.',
      ),
    ).toBeDefined()
    expect(server.operations()).toEqual([])
  })
})

describe('an installation that belongs to a PV system', () => {
  it('says so in its facts, with links to the system and the inverter', async () => {
    await mount('/anlagen/bat-1')

    const facts = await screen.findByRole('region', { name: 'Anlage' })
    expect(within(facts).getByRole('link', { name: 'PV-Anlage Dach' }).getAttribute('href')).toBe(
      '/anlagen/pv-1',
    )
    expect(within(facts).getByRole('link', { name: 'WR 1' }).getAttribute('href')).toBe(
      '/wechselrichter/w-1',
    )
  })

  it('chooses among the PV systems at its site, and the inverters of the one chosen', async () => {
    const { client } = await mount('/anlagen/wb-1')
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Bearbeiten' }))
    const system = screen.getByLabelText<HTMLSelectElement>('Gehört zu PV-Anlage')
    // Only the system at the wallbox's own site.
    expect([...system.options].map((option) => option.textContent)).toEqual([
      'Zu keiner',
      'PV-Anlage Dach',
    ])
    // The inverter only once a system is chosen.
    expect(screen.queryByLabelText('Am Wechselrichter')).toBeNull()

    await user.selectOptions(system, 'PV-Anlage Dach')
    const inverter = screen.getByLabelText<HTMLSelectElement>('Am Wechselrichter')
    expect([...inverter.options].map((option) => option.textContent)).toEqual([
      'An keinem',
      'WR 1, Fronius Symo GEN24 10.0 Plus',
    ])
    await user.selectOptions(inverter, 'WR 1, Fronius Symo GEN24 10.0 Plus')
    await user.click(screen.getByRole('button', { name: 'Speichern' }))

    await waitFor(() => {
      expect(server.operations()).toHaveLength(1)
    })
    await client.synchronise()
    expect(valuesOf()).toEqual({ pvSystemId: 'pv-1', inverterId: 'w-1' })
  })

  it('lets go of both when it becomes something that belongs to none', async () => {
    const { client } = await mount('/anlagen/bat-1')
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Bearbeiten' }))
    await user.selectOptions(screen.getByLabelText('Art'), 'Heizung')
    expect(screen.queryByLabelText('Gehört zu PV-Anlage')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Speichern' }))

    await waitFor(() => {
      expect(server.operations()).toHaveLength(1)
    })
    await client.synchronise()
    expect(valuesOf()).toEqual({ kind: 'heating', pvSystemId: null, inverterId: null })
  })
})

describe('an inverter in the office', () => {
  it('shows its strings with where they face, and what hangs at it', async () => {
    await mount('/wechselrichter/w-1')

    const table = await screen.findByRole('table', { name: 'Strings des Wechselrichters' })
    const [, first, second] = within(table).getAllByRole('row')
    expect(first?.textContent).toContain('String 1')
    expect(first?.textContent).toContain('Süd, 180°')
    expect(second?.textContent).toContain('String 2')
    expect(second?.textContent).toContain('1,20 kWp')
    expect(second?.textContent).toContain('West, 270°')

    const attached = screen.getByRole('region', { name: 'Daran angeschlossen' })
    expect(within(attached).getByRole('link', { name: 'Speicher Technikraum' })).toBeDefined()

    // The tree holds the inverter open with both strings in it.
    const tree = screen.getByRole('region', { name: 'Struktur der Anlage' })
    expect(
      within(tree)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['WR 110,0 kW', 'String 11 Modul', 'String 23 Module'])
  })

  it('says what goes with it before it is deleted', async () => {
    const { client, router } = await mount('/wechselrichter/w-1')
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Wechselrichter löschen' }))

    const question = screen.getByRole('alertdialog', { name: 'WR 1 löschen?' })
    expect(question.textContent).toContain(
      'Mit dem Wechselrichter gehen 2 Strings und 4 Module. Speicher Technikraum hängt danach an keinem Wechselrichter mehr.',
    )

    await user.click(within(question).getByRole('button', { name: 'Löschen' }))
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/anlagen/pv-1')
    })

    await client.synchronise()
    expect(server.operations().map((operation) => [operation.entity, operation.kind])).toEqual([
      ['inverters', 'delete'],
    ])
  })

  it('takes a new string at an input of its own inverter', async () => {
    const { client, router } = await mount('/wechselrichter/w-1')
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'String anlegen' }))
    const detail = screen.getByRole('region', { name: 'Neuer String an WR 1' })
    expect(within(detail).getByLabelText<HTMLInputElement>('Bezeichnung').value).toBe('String 3')
    const input = within(detail).getByLabelText<HTMLSelectElement>('MPP-Eingang')
    // The inputs the inverter has, and no more.
    expect([...input.options].map((option) => option.textContent)).toEqual([
      'nicht angegeben',
      'Eingang 1',
      'Eingang 2',
    ])
    await user.selectOptions(input, 'Eingang 2')
    const lie = within(detail).getByRole('group', { name: 'Lage' })
    await user.type(within(lie).getByLabelText('Ausrichtung in Grad'), '90')
    await user.type(within(lie).getByLabelText('Neigung in Grad'), '15')
    await user.click(within(detail).getByRole('button', { name: 'String anlegen' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toMatch(/^\/strings\//)
    })
    await client.synchronise()
    expect(valuesOf()).toEqual({
      designation: 'String 3',
      mppInput: 2,
      azimuthDeg: 90,
      tiltDeg: 15,
      inverterId: 'w-1',
      position: 2,
    })
  })

  it('refuses a direction past the circle', async () => {
    await mount('/strings/st-2')
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Bearbeiten' }))
    const lie = screen.getByRole('group', { name: 'Lage' })
    const azimuth = within(lie).getByLabelText('Ausrichtung in Grad')
    await user.clear(azimuth)
    await user.type(azimuth, '360')
    await user.click(screen.getByRole('button', { name: 'Speichern' }))

    expect(
      await screen.findByText(
        'Die Ausrichtung ist eine ganze Zahl von 0 bis 359 Grad: 0 Nord, 90 Ost, 180 Süd, 270 West.',
      ),
    ).toBeDefined()
    expect(server.operations()).toEqual([])
  })
})

describe('a string in the office', () => {
  it('shows its facts and its modules, with the serial numbers still missing', async () => {
    await mount('/strings/st-2')

    const facts = await screen.findByRole('region', { name: 'String' })
    expect(facts.textContent).toContain('2 von 2')
    expect(facts.textContent).toContain('West, 270°')
    expect(facts.textContent).toContain('30°')
    expect(facts.textContent).toContain('3 Module, zusammen 1,20 kWp')

    const table = screen.getByRole('table', { name: 'Module des Strings' })
    const [, first, second] = within(table).getAllByRole('row')
    expect(first?.textContent).toContain('JA2404118771')
    expect(second?.textContent).toContain('fehlt')
    expect(screen.getByText(/2 von 3 Modulen ohne Seriennummer\./)).toBeDefined()
  })

  it('adds a batch of modules at its end, with what the string already has', async () => {
    const { client } = await mount('/strings/st-2')
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Module anlegen' }))
    const batch = screen.getByRole('region', { name: 'Module anlegen' })
    // Maker, model and power of the modules already on the string.
    expect(within(batch).getByLabelText<HTMLInputElement>('Modell').value).toBe('JAM54S30-400/MR')
    expect(within(batch).getByLabelText<HTMLInputElement>('Leistung in Wp').value).toBe('400')
    await user.type(within(batch).getByLabelText('Anzahl'), '2')
    expect(within(batch).getByText(/Legt 2 Module mit denselben Angaben/)).toBeDefined()
    await user.click(within(batch).getByRole('button', { name: '2 Module anlegen' }))

    await waitFor(() => {
      expect(server.operations()).toHaveLength(2)
    })
    await client.synchronise()
    expect([valuesOf(0), valuesOf(1)]).toEqual([
      {
        manufacturer: 'JA Solar',
        model: 'JAM54S30-400/MR',
        ratedPowerW: 400,
        pvStringId: 'st-2',
        position: 3,
      },
      {
        manufacturer: 'JA Solar',
        model: 'JAM54S30-400/MR',
        ratedPowerW: 400,
        pvStringId: 'st-2',
        position: 4,
      },
    ])
  })

  it('refuses more than a hundred at once', async () => {
    await mount('/strings/st-2')
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Module anlegen' }))
    const batch = screen.getByRole('region', { name: 'Module anlegen' })
    await user.type(within(batch).getByLabelText('Anzahl'), '101')
    await user.click(within(batch).getByRole('button', { name: 'Module anlegen' }))

    expect(await within(batch).findByText('Auf einmal gehen 1 bis 100 Module.')).toBeDefined()
    expect(server.operations()).toEqual([])
  })

  it('takes a serial number over the pencil', async () => {
    const { client } = await mount('/strings/st-2')
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Modul 2 bearbeiten' }))
    await user.type(screen.getByLabelText('Seriennummer'), 'JA2404118772')
    await user.click(screen.getByRole('button', { name: 'Speichern' }))

    await waitFor(() => {
      expect(server.operations()).toHaveLength(1)
    })
    await client.synchronise()
    expect(server.operations()[0]?.recordId).toBe('m-3')
    expect(valuesOf()).toEqual({ serialNumber: 'JA2404118772' })
  })
})
