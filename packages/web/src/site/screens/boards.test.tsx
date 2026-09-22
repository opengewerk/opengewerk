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

import { SyncClient } from '../../sync/client.js'
import { SyncProvider } from '../../sync/provider.js'
import { openLocalStore } from '../../sync/store.js'
import { TestServer } from '../../sync/test-server.js'
import { SiteBoardScreen, SiteCircuitScreen } from './boards.js'
import { SiteJobScreen } from './jobs.js'

/**
 * #70 on site: a technician in front of a board reads what is written down
 * about it and adds the circuit that is missing, without a network.
 */

let server: TestServer
let counter = 0

const rows: Readonly<Record<string, RecordState[]>> = {
  customers: [{ id: 'c-1', kind: 'private', name: 'Familie Berg' }],
  sites: [{ id: 's-1', customerId: 'c-1', designation: 'Einfamilienhaus' }],
  installations: [
    { id: 'i-1', siteId: 's-1', kind: 'meter_cabinet', designation: 'Zählerschrank' },
  ],
  jobs: [
    {
      id: 'j-1',
      customerId: 'c-1',
      siteId: 's-1',
      installationId: 'i-1',
      parentJobId: null,
      kind: 'service',
      status: 'active',
      designation: 'Steckdose ohne Strom',
      description: null,
    },
  ],
  distribution_boards: [
    {
      id: 'b-1',
      installationId: 'i-1',
      kind: 'sub_distribution',
      designation: 'UV Küche',
      location: 'Flur',
      position: 0,
    },
  ],
  board_sections: [{ id: 'f-1', distributionBoardId: 'b-1', designation: 'Feld 1', position: 0 }],
  circuits: [
    {
      id: 'k-10',
      distributionBoardId: 'b-1',
      boardSectionId: 'f-1',
      designation: 'F10',
      consumer: 'Geschirrspüler',
      overcurrentDevice: null,
      tripCharacteristic: null,
      ratedCurrentMilli: null,
      rcdType: null,
      ratedResidualCurrentMilli: null,
      cableType: null,
      cableCores: null,
      cableCrossSectionMilli: null,
      cableLengthMilli: null,
      cableInstallationMethod: null,
      position: 0,
    },
    {
      id: 'k-2',
      distributionBoardId: 'b-1',
      boardSectionId: 'f-1',
      designation: 'F2',
      consumer: 'Steckdosen Küche',
      overcurrentDevice: 'circuit_breaker',
      tripCharacteristic: 'b',
      ratedCurrentMilli: 16_000,
      rcdType: 'a',
      ratedResidualCurrentMilli: 30,
      cableType: 'NYM-J',
      cableCores: 3,
      cableCrossSectionMilli: 2_500,
      cableLengthMilli: null,
      cableInstallationMethod: null,
      position: 0,
    },
  ],
}

async function mount(path: string) {
  for (const [entity, list] of Object.entries(rows)) {
    for (const row of list) {
      server.put(entity, row)
    }
  }

  const client = await SyncClient.start({
    store: await openLocalStore(`verteiler${String((counter += 1))}`),
    transport: server,
    writer: server,
    deviceId: 'geraet-im-keller',
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
        path: '/auftraege/$jobId/verteiler/$boardId',
        component: SiteBoardScreen,
      }),
      createRoute({
        getParentRoute: () => root,
        path: '/auftraege/$jobId/verteiler/$boardId/stromkreise/$circuitId',
        component: SiteCircuitScreen,
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

describe('the boards of the job', () => {
  it('are in the card of its installation, with a way to the circuits', async () => {
    const { router } = await mount('/auftraege/j-1')
    const user = userEvent.setup()

    const card = await screen.findByRole('region', { name: 'Anlage' })
    const board = within(card).getByRole('link', { name: /UV Küche/ })

    expect(board.textContent).toContain('Unterverteilung, Flur, 2 Stromkreise')

    await user.click(board)
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/auftraege/j-1/verteiler/b-1')
    })
  })
})

describe('a board on site', () => {
  it('lists its circuits section by section, F2 before F10, with what is known of them', async () => {
    await mount('/auftraege/j-1/verteiler/b-1')

    const field = await screen.findByRole('region', { name: 'Feld 1' })
    const links = within(field).getAllByRole('link')

    expect(links.map((link) => link.textContent)).toEqual([
      'F2 Steckdosen KücheLS B 16 A, Typ A 30 mA, NYM-J 3 × 2,5 mm²',
      'F10 GeschirrspülerNoch nichts zu Sicherung und Leitung eingetragen',
    ])
  })

  it('takes the circuit that is missing without a network, and sends it once there is one', async () => {
    const { client } = await mount('/auftraege/j-1/verteiler/b-1')
    const user = userEvent.setup()
    server.offline = true

    await user.click(await screen.findByRole('button', { name: 'Stromkreis nachtragen' }))

    const form = screen.getByRole('region', { name: 'Stromkreis nachtragen' })
    await user.type(within(form).getByLabelText('Bezeichnung'), 'F3')
    await user.type(within(form).getByLabelText('Verbraucher'), 'Außensteckdose')
    await user.selectOptions(within(form).getByLabelText('Feld'), 'Feld 1')

    const protection = within(form).getByRole('group', { name: 'Schutzeinrichtung' })
    await user.selectOptions(
      within(protection).getByLabelText('Art'),
      'Leitungsschutzschalter (LS)',
    )
    await user.selectOptions(within(protection).getByLabelText('Charakteristik'), 'B')
    // With the unit, the way it is read off the breaker and the cable.
    await user.type(within(protection).getByLabelText('Nennstrom in A'), '16 A')

    const cable = within(form).getByRole('group', { name: 'Leitung' })
    await user.type(within(cable).getByLabelText('Querschnitt in mm²'), '1,5 mm²')
    await user.type(within(cable).getByLabelText('Länge in m'), '12,5')

    await user.click(within(form).getByRole('button', { name: 'Stromkreis sichern' }))

    const field = await screen.findByRole('region', { name: 'Feld 1' })
    await waitFor(() => {
      expect(within(field).getByText(/F3/).closest('a')?.textContent).toContain(
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
      designation: 'F3',
      consumer: 'Außensteckdose',
      boardSectionId: 'f-1',
      overcurrentDevice: 'circuit_breaker',
      tripCharacteristic: 'b',
      ratedCurrentMilli: 16_000,
      cableCrossSectionMilli: 1_500,
      cableLengthMilli: 12_500,
      distributionBoardId: 'b-1',
      // After the two circuits already in the section.
      position: 1,
    })
  })

  it('refuses a figure it could not read, on the field, and queues nothing', async () => {
    await mount('/auftraege/j-1/verteiler/b-1')
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Stromkreis nachtragen' }))

    const form = screen.getByRole('region', { name: 'Stromkreis nachtragen' })
    await user.type(within(form).getByLabelText('Bezeichnung'), 'F4')
    await user.type(within(form).getByLabelText('Nennstrom in A'), 'sechzehn')
    await user.type(within(form).getByLabelText('Bemessungsdifferenzstrom in mA'), '0,03')
    await user.type(within(form).getByLabelText('Querschnitt in mm²'), '1,5555')
    await user.click(within(form).getByRole('button', { name: 'Stromkreis sichern' }))

    expect(within(form).getByText('Das ist keine Zahl.')).toBeDefined()
    expect(within(form).getByText('Das ist keine ganze Zahl.')).toBeDefined()
    expect(
      within(form).getByText('Das ist keine Zahl mit höchstens 3 Nachkommastellen.'),
    ).toBeDefined()
    expect(server.operations()).toEqual([])
  })

  it('offers the curves with a breaker and the categories with a fuse, and drops a curve that no longer fits', async () => {
    await mount('/auftraege/j-1/verteiler/b-1')
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Stromkreis nachtragen' }))

    const protection = within(
      screen.getByRole('region', { name: 'Stromkreis nachtragen' }),
    ).getByRole('group', { name: 'Schutzeinrichtung' })
    const device = within(protection).getByLabelText('Art')
    const curve = within(protection).getByLabelText<HTMLSelectElement>('Charakteristik')

    await user.selectOptions(device, 'Leitungsschutzschalter (LS)')
    await user.selectOptions(curve, 'C')
    expect([...curve.options].map((option) => option.text)).toEqual([
      'nicht angegeben',
      'B',
      'C',
      'D',
      'K',
      'Z',
    ])

    await user.selectOptions(device, 'Schmelzsicherung D0 (NEOZED)')
    expect(curve.value).toBe('')
    expect([...curve.options].map((option) => option.text)).toEqual(['nicht angegeben', 'gG', 'aM'])
  })
})

describe('a circuit on site', () => {
  it('shows what is known and takes the rest, field by field', async () => {
    const { client } = await mount('/auftraege/j-1/verteiler/b-1/stromkreise/k-2')
    const user = userEvent.setup()

    const known = await screen.findByRole('region', { name: 'Was bekannt ist' })
    expect(within(known).getByText('LS B 16 A')).toBeDefined()
    expect(within(known).getByText('NYM-J 3 × 2,5 mm²')).toBeDefined()

    await user.click(screen.getByRole('button', { name: 'Angaben ergänzen' }))

    const form = screen.getByRole('region', { name: 'Angaben ergänzen' })
    await user.type(within(form).getByLabelText('Länge in m'), '18')
    await user.selectOptions(
      within(form).getByLabelText('Verlegeart'),
      'C: Direkt auf oder in der Wand',
    )
    await user.click(within(form).getByRole('button', { name: 'Angaben sichern' }))

    await client.synchronise()

    const [changed] = server.operations()
    // Only what changed travels, each with what the device saw in it, so
    // that the office changing the consumer meanwhile is no collision.
    expect(
      [...(changed?.patches ?? [])].sort((left, right) => left.field.localeCompare(right.field)),
    ).toEqual([
      { field: 'cableInstallationMethod', from: null, to: 'c' },
      { field: 'cableLengthMilli', from: null, to: 18_000 },
    ])
  })

  it('takes the equipment found on it', async () => {
    const { client } = await mount('/auftraege/j-1/verteiler/b-1/stromkreise/k-2')
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Betriebsmittel nachtragen' }))
    await user.type(screen.getByLabelText('Bezeichnung'), 'Steckdose Arbeitsplatte')
    await user.type(screen.getByLabelText('Hersteller'), 'Busch-Jaeger')
    await user.click(screen.getByRole('button', { name: 'Betriebsmittel sichern' }))

    await client.synchronise()

    const [created] = server.operations()
    expect(created?.entity).toBe('equipment')
    expect(created?.patches).toContainEqual({ field: 'circuitId', from: null, to: 'k-2' })
    expect(server.all('equipment')).toHaveLength(1)
  })
})
