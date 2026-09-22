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
import { BoardScreen } from './boards.js'
import { CircuitScreen } from './circuits.js'
import { InstallationScreen } from './installations.js'

/**
 * #70 in the office: a board written down with its sections and circuits,
 * the way the chart on its door will list them.
 */

let server: TestServer
let counter = 0

function circuit(part: Record<string, unknown>): RecordState {
  return {
    distributionBoardId: 'b-1',
    boardSectionId: null,
    consumer: null,
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
    ...part,
  } as RecordState
}

const rows: Readonly<Record<string, RecordState[]>> = {
  customers: [{ id: 'c-1', kind: 'private', name: 'Familie Berg' }],
  sites: [{ id: 's-1', customerId: 'c-1', designation: 'Einfamilienhaus' }],
  installations: [
    { id: 'i-1', siteId: 's-1', kind: 'meter_cabinet', designation: 'Zählerschrank' },
  ],
  distribution_boards: [
    {
      id: 'b-1',
      installationId: 'i-1',
      kind: 'main_distribution',
      designation: 'HV',
      location: 'Keller',
      position: 0,
    },
  ],
  board_sections: [{ id: 'f-1', distributionBoardId: 'b-1', designation: 'Feld 1', position: 0 }],
  circuits: [
    circuit({ id: 'k-1', designation: 'Q1', consumer: 'Zuleitung UV' }),
    circuit({ id: 'k-10', boardSectionId: 'f-1', designation: 'F10', consumer: 'Herd' }),
    circuit({
      id: 'k-2',
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
      cableLengthMilli: 18_500,
      cableInstallationMethod: 'c',
    }),
  ],
  equipment: [],
}

async function mount(path: string) {
  for (const [entity, list] of Object.entries(rows)) {
    for (const row of list) {
      server.put(entity, row)
    }
  }

  const client = await SyncClient.start({
    store: await openLocalStore(`office-boards${String((counter += 1))}`),
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
        path: '/verteiler/$boardId',
        component: BoardScreen,
      }),
      createRoute({
        getParentRoute: () => root,
        path: '/stromkreise/$circuitId',
        component: CircuitScreen,
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

/** The rows of the circuit table as a person reads them, cell by cell. */
function tableRows(): string[][] {
  const table = screen.getByRole('table', { name: 'Stromkreise des Verteilers' })

  return within(table)
    .getAllByRole('row')
    .slice(1)
    .map((row) =>
      within(row)
        .getAllByRole('cell')
        .map((cell) => cell.textContent.trim())
        .slice(0, 7),
    )
}

beforeEach(() => {
  server = new TestServer()
})

describe('the boards of an installation', () => {
  it('are listed with what is on them, and a new one goes at the end', async () => {
    const { client } = await mount('/anlagen/i-1')
    const user = userEvent.setup()

    const boards = await screen.findByRole('region', { name: 'Verteiler' })
    expect(within(boards).getByRole('link', { name: /HV/ }).textContent).toContain(
      'Hauptverteilung, Keller, 3 Stromkreise',
    )
    expect(
      within(boards).getByRole('link', { name: 'Stromkreisverzeichnis' }).getAttribute('href'),
    ).toBe('/installations/i-1/circuit-chart')

    await user.click(within(boards).getByRole('button', { name: 'Verteiler anlegen' }))
    await user.type(within(boards).getByLabelText('Bezeichnung'), 'UV Küche')
    await user.click(within(boards).getByRole('button', { name: 'Anlegen' }))
    await client.synchronise()

    const [created] = server.operations()
    expect(
      Object.fromEntries(created?.patches.map((patch) => [patch.field, patch.to]) ?? []),
    ).toEqual({
      designation: 'UV Küche',
      kind: 'main_distribution',
      installationId: 'i-1',
      position: 1,
    })
  })
})

describe('a board in the office', () => {
  it('lists its circuits the way the chart does: on the board first, then each section', async () => {
    await mount('/verteiler/b-1')

    await screen.findByRole('table', { name: 'Stromkreise des Verteilers' })

    expect(tableRows()).toEqual([
      ['Ohne Feld'],
      ['Q1', 'Zuleitung UV', '', '', '', '', ''],
      ['Feld 1'],
      ['F2', 'Steckdosen Küche', 'LS B 16 A', 'Typ A 30 mA', 'NYM-J 3 × 2,5 mm²', '18,5 m', 'C'],
      ['F10', 'Herd', '', '', '', '', ''],
    ])
    expect(screen.getByRole('link', { name: 'Stromkreisverzeichnis' }).getAttribute('href')).toBe(
      '/installations/i-1/circuit-chart?board=b-1',
    )
  })

  it('puts the next circuit into the section the last one went into', async () => {
    const { client } = await mount('/verteiler/b-1')
    const user = userEvent.setup()
    const circuits = await screen.findByRole('region', { name: 'Stromkreise' })

    await user.click(within(circuits).getByRole('button', { name: 'Stromkreis anlegen' }))
    await user.type(within(circuits).getByLabelText('Bezeichnung'), 'F11')
    await user.selectOptions(within(circuits).getByLabelText('Feld'), 'Feld 1')
    await user.click(within(circuits).getByRole('button', { name: 'Anlegen' }))

    await user.click(within(circuits).getByRole('button', { name: 'Stromkreis anlegen' }))
    expect(within(circuits).getByLabelText<HTMLSelectElement>('Feld').value).toBe('f-1')

    await client.synchronise()
    const [created] = server.operations()
    expect(created?.patches).toContainEqual({ field: 'boardSectionId', from: null, to: 'f-1' })
    // After F2 and F10, which share position 0.
    expect(created?.patches).toContainEqual({ field: 'position', from: null, to: 1 })
  })

  it('moves a circuit within its section and numbers the section afresh', async () => {
    const { client } = await mount('/verteiler/b-1')
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'F2 nach unten' }))

    // F2 and F10 both stood at 0, and F2 came first by its name. A swap of
    // the two numbers would have moved nothing; numbered afresh, F10 keeps
    // its 0 and F2 gets the 1, and only that one change is written.
    await waitFor(() => {
      expect(tableRows().map((row) => row[0])).toEqual(['Ohne Feld', 'Q1', 'Feld 1', 'F10', 'F2'])
    })

    await client.synchronise()
    expect(server.operations().map((operation) => [operation.recordId, operation.patches])).toEqual(
      [['k-2', [{ field: 'position', from: 0, to: 1 }]]],
    )
  })

  it('says what goes with it before it is deleted', async () => {
    const { client, router } = await mount('/verteiler/b-1')
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Verteiler löschen' }))
    expect(screen.getByRole('alert').textContent).toBe(
      'Mit dem Verteiler gehen 1 Feld und 3 Stromkreise samt ihren Betriebsmitteln.',
    )

    await user.click(screen.getByRole('button', { name: 'Löschen' }))
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/anlagen/i-1')
    })

    await client.synchronise()
    expect(server.operations().map((operation) => [operation.entity, operation.kind])).toEqual([
      ['distribution_boards', 'delete'],
    ])
  })
})

describe('a circuit in the office', () => {
  it('lists the equipment on it and takes more', async () => {
    const { client } = await mount('/stromkreise/k-2')
    const user = userEvent.setup()

    const facts = await screen.findByRole('region', { name: 'Stromkreis' })
    expect(within(facts).getByText('Feld 1')).toBeDefined()
    expect(within(facts).getByText('Typ A 30 mA')).toBeDefined()

    const equipment = screen.getByRole('region', { name: 'Betriebsmittel' })
    await user.click(within(equipment).getByRole('button', { name: 'Betriebsmittel anlegen' }))
    await user.type(within(equipment).getByLabelText('Bezeichnung'), 'Steckdose Arbeitsplatte')
    await user.type(within(equipment).getByLabelText('Typ'), '20 EUC-914')
    await user.click(within(equipment).getByRole('button', { name: 'Anlegen' }))

    await client.synchronise()
    expect(server.all('equipment')).toEqual([
      expect.objectContaining({
        circuitId: 'k-2',
        designation: 'Steckdose Arbeitsplatte',
        model: '20 EUC-914',
        position: 0,
      }),
    ])
  })
})
