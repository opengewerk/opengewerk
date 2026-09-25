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
import { BoardScreen, CircuitScreen } from './structure.js'

/**
 * #70 in the office: a board written down with its sections and circuits,
 * the way the chart on its door will list them, on the screen of the
 * structure the canvas draws (#219): the tree at the left, what is selected
 * at the right.
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

/** The circuits in the tree, top to bottom, as their codes. */
function treeCodes(): string[] {
  const tree = screen.getByRole('region', { name: 'Struktur der Anlage' })

  return within(tree)
    .getAllByRole('link')
    .map((link) => link.textContent)
    .filter((label) => /^[A-Z]\d/.test(label))
    .map((label) => label.replace(/^([A-Z]\d+).*$/, '$1'))
}

beforeEach(() => {
  server = new TestServer()
  // Somebody from the office, who may change an installation and its
  // structure: the buttons for it are only there for that right (#219).
  const answers = new Map<string, unknown>([
    [
      '/api/auth/get-session',
      {
        user: { id: 'u-1', email: 'u-1@nord.example.de', name: 'u-1' },
        session: { activeTenantId: 't-1' },
      },
    ],
    ['/auth/tenants', [{ id: 't-1', name: 'Elektro Nord GmbH', roles: ['office'] }]],
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

describe('the boards of an installation', () => {
  it('are listed with what is on them, and a new one goes at the end', async () => {
    await mount('/anlagen/i-1')
    const user = userEvent.setup()

    const boards = await screen.findByRole('region', { name: 'Verteiler' })
    expect(within(boards).getByRole('link', { name: /HV/ }).closest('li')?.textContent).toContain(
      'Hauptverteilung, Keller, 3 Stromkreise',
    )
    // The chart is in the head of the record, as a button with a printer.
    expect(screen.getByRole('link', { name: 'Stromkreisverzeichnis' }).getAttribute('href')).toBe(
      '/installations/i-1/circuit-chart',
    )

    // The small button in the head of the card makes way for the form, whose
    // own button is called the same.
    await user.click(await within(boards).findByRole('button', { name: 'Verteiler anlegen' }))
    await user.type(within(boards).getByLabelText('Bezeichnung'), 'UV Küche')
    await user.click(within(boards).getByRole('button', { name: 'Verteiler anlegen' }))
    // Waited for rather than synchronised at once: the save reaches the
    // outbox a step after the click, and a round started before it would
    // find nothing to send.
    await waitFor(() => {
      expect(server.operations()).toHaveLength(1)
    })

    const [created] = server.operations()
    expect(
      Object.fromEntries(created?.patches.map((patch) => [patch.field, patch.to]) ?? []),
    ).toEqual({
      designation: 'UV Küche',
      // The installation has its main distribution, so the next one starts
      // as a sub distribution.
      kind: 'sub_distribution',
      installationId: 'i-1',
      position: 1,
    })
  })
})

describe('a board in the office', () => {
  it('shows its sections and the circuits on it directly, and the rest in the tree', async () => {
    await mount('/verteiler/b-1')

    await screen.findByRole('table', { name: 'Felder des Verteilers' })

    // In the tree: on the board first, then each section, each in the order
    // of the board, F2 before F10.
    expect(treeCodes()).toEqual(['Q1', 'F2', 'F10'])

    const fields = screen.getByRole('table', { name: 'Felder des Verteilers' })
    expect(within(fields).getByRole('cell', { name: 'Feld 1' })).toBeDefined()

    const direct = screen.getByRole('table', { name: 'Stromkreise ohne Feld' })
    expect(within(direct).getByRole('link', { name: 'Q1' })).toBeDefined()
    expect(within(direct).queryByRole('link', { name: 'F2' })).toBeNull()

    expect(screen.getByRole('link', { name: 'Stromkreisverzeichnis' }).getAttribute('href')).toBe(
      '/installations/i-1/circuit-chart?board=b-1',
    )
  })

  it('puts the next circuit into the section the last one went into', async () => {
    const { client, router } = await mount('/verteiler/b-1')
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Stromkreis' }))
    await user.type(screen.getByLabelText('Bezeichnung'), 'F11')
    await user.selectOptions(screen.getByLabelText('Feld'), 'Feld 1')
    await user.click(screen.getByRole('button', { name: 'Stromkreis anlegen' }))

    // The new circuit is what is selected next, and the next new one starts
    // in its section.
    await waitFor(() => {
      expect(router.state.location.pathname).toMatch(/^\/stromkreise\//)
    })
    await user.click(await screen.findByRole('button', { name: 'Stromkreis' }))
    expect(screen.getByLabelText<HTMLSelectElement>('Feld').value).toBe('f-1')

    await client.synchronise()
    const [created] = server.operations()
    expect(created?.patches).toContainEqual({ field: 'boardSectionId', from: null, to: 'f-1' })
    // After F2 and F10, which share position 0.
    expect(created?.patches).toContainEqual({ field: 'position', from: null, to: 1 })
  })

  it('moves a circuit within its section and numbers the section afresh', async () => {
    const { client } = await mount('/stromkreise/k-2')
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'F2 nach unten' }))

    // F2 and F10 both stood at 0, and F2 came first by its name. A swap of
    // the two numbers would have moved nothing; numbered afresh, F10 keeps
    // its 0 and F2 gets the 1, and only that one change is written.
    await waitFor(() => {
      expect(treeCodes()).toEqual(['Q1', 'F10', 'F2'])
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

    const question = screen.getByRole('alertdialog', { name: 'HV löschen?' })
    expect(question.textContent).toContain(
      'Mit dem Verteiler gehen 1 Feld und 3 Stromkreise samt ihren Betriebsmitteln.',
    )

    await user.click(within(question).getByRole('button', { name: 'Löschen' }))
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
    await mount('/stromkreise/k-2')
    const user = userEvent.setup()

    const detail = await screen.findByRole('region', { name: 'F2, Steckdosen Küche' })
    // Board and section in the line under the name.
    expect(within(detail).getByText('HV, Feld 1')).toBeDefined()

    // The two cards in the words of the canvas: the device in a word, the
    // RCD on one line, the cable by type and size on lines of their own.
    const protection = within(detail).getByRole('region', { name: 'Schutzeinrichtung' })
    expect(within(protection).getByText('LS-Schalter')).toBeDefined()
    expect(within(protection).getByText('Typ A, 30 mA')).toBeDefined()
    expect(within(protection).getByText('16 A')).toBeDefined()
    const cable = within(detail).getByRole('region', { name: 'Leitung und Verbraucher' })
    expect(within(cable).getByText('NYM-J')).toBeDefined()
    expect(within(cable).getByText('3 × 2,5 mm²')).toBeDefined()
    expect(within(cable).getByText('18,5 m')).toBeDefined()

    const equipment = screen.getByRole('region', { name: 'Betriebsmittel' })
    await user.click(
      await within(equipment).findByRole('button', { name: 'Betriebsmittel anlegen' }),
    )
    await user.type(within(equipment).getByLabelText('Bezeichnung'), 'Steckdose Arbeitsplatte')
    await user.type(within(equipment).getByLabelText('Typ'), '20 EUC-914')
    await user.click(within(equipment).getByRole('button', { name: 'Betriebsmittel anlegen' }))

    // Waited for rather than synchronised at once: the save reaches the
    // outbox a step after the click, and a round started before it would
    // find nothing to send.
    await waitFor(() => {
      expect(server.operations()).toHaveLength(1)
    })
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

describe('the structure on a phone', () => {
  it('lists the equipment as boxes and still asks before one goes', async () => {
    // 390 pixels: no band from 600 on matches.
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
    server.put('equipment', {
      id: 'e-1',
      circuitId: 'k-2',
      designation: 'Steckdose Arbeitsplatte',
      kind: 'Steckdose',
      manufacturer: 'Busch-Jaeger',
      model: '20 EUC-914',
      serialNumber: null,
      position: 0,
    })
    await mount('/stromkreise/k-2')
    const user = userEvent.setup()

    // A box per piece, the rest of its row in a line under the name, and no
    // table that would have to be pushed sideways.
    const equipment = await screen.findByRole('region', { name: 'Betriebsmittel' })
    expect(within(equipment).queryByRole('table')).toBeNull()
    const [box] = within(
      within(equipment).getByRole('list', { name: 'Betriebsmittel des Stromkreises' }),
    ).getAllByRole('listitem')
    expect(box?.textContent).toContain('Steckdose Arbeitsplatte')
    expect(box?.textContent).toContain('Steckdose · Busch-Jaeger · 20 EUC-914')

    // The question stands beside the list, so it opens here too. The
    // buttons come once the rights of the session are known.
    await user.click(
      await within(box as HTMLElement).findByRole('button', {
        name: 'Steckdose Arbeitsplatte entfernen',
      }),
    )
    expect(
      screen.getByRole('alertdialog', { name: 'Steckdose Arbeitsplatte entfernen?' }),
    ).toBeDefined()
  })
})
