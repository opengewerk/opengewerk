import 'fake-indexeddb/auto'

import { readFormValues, type RecordState } from '@opengewerk/domain'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { SyncClient } from '../../sync/client.js'
import { SyncProvider } from '../../sync/provider.js'
import { openLocalStore } from '../../sync/store.js'
import { TestServer } from '../../sync/test-server.js'
import { SiteJobScreen } from './jobs.js'
import { SiteProtocolScreen } from './protocol.js'

/**
 * #79 as it happens on site: the protocol of an initial verification started
 * at the installation of a job, without a network, measured circuit by
 * circuit out of the chart, signed by the tester and sent afterwards.
 */

let server: TestServer
let counter = 0

function circuit(part: Record<string, unknown>): RecordState {
  return {
    distributionBoardId: 'b-1',
    boardSectionId: null,
    consumer: null,
    overcurrentDevice: 'circuit_breaker',
    tripCharacteristic: 'b',
    ratedCurrentMilli: 16_000,
    rcdType: 'a',
    ratedResidualCurrentMilli: 30,
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
  jobs: [
    {
      id: 'j-1',
      customerId: 'c-1',
      siteId: 's-1',
      installationId: 'i-1',
      kind: 'installation',
      status: 'active',
      designation: 'Neubau Elektroinstallation',
      number: 'AU-2026-0007',
    },
  ],
  distribution_boards: [
    { id: 'b-1', installationId: 'i-1', kind: 'main_distribution', designation: 'HV', position: 0 },
  ],
  circuits: [
    circuit({ id: 'k-2', designation: 'F2', consumer: 'Licht Flur', ratedCurrentMilli: 10_000 }),
    circuit({ id: 'k-1', designation: 'F1', consumer: 'Steckdosen Küche' }),
  ],
}

async function mount(path: string) {
  for (const [entity, list] of Object.entries(rows)) {
    for (const row of list) {
      server.put(entity, row)
    }
  }

  const client = await SyncClient.start({
    store: await openLocalStore(`site-protocol${String((counter += 1))}`),
    transport: server,
    writer: server,
    deviceId: 'geraet-im-keller',
    entities: [
      'customers',
      'sites',
      'installations',
      'jobs',
      'distribution_boards',
      'board_sections',
      'circuits',
      'form_records',
      'attachments',
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
        path: '/auftraege/$jobId/pruefprotokolle/$recordId',
        component: SiteProtocolScreen,
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

  return { client, router }
}

/** The block of a circuit, found by what its summary line says. */
function blockOf(heading: string): HTMLElement {
  const block = screen.getByText(heading).closest('details')

  if (!block) {
    throw new Error(`No block for ${heading}.`)
  }

  return block
}

/** Two strokes on the pad, as in the report on site. */
function signOn(pad: Element): void {
  Object.assign(pad, {
    getBoundingClientRect: () => ({
      left: 0,
      top: 0,
      width: 500,
      height: 200,
      right: 500,
      bottom: 200,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
    setPointerCapture: () => {},
  })

  fireEvent.pointerDown(pad, { pointerId: 1, clientX: 50, clientY: 150 })
  fireEvent.pointerMove(pad, { pointerId: 1, clientX: 120, clientY: 60 })
  fireEvent.pointerUp(pad, { pointerId: 1, clientX: 120, clientY: 60 })
}

beforeEach(() => {
  server = new TestServer()
})

describe('a test protocol on site (#79)', () => {
  it('is started without a network, measured out of the chart, signed and sent as written', async () => {
    const user = userEvent.setup()
    const { client, router } = await mount('/auftraege/j-1')

    server.offline = true

    await user.click(
      await screen.findByRole('button', {
        name: 'Prüfprotokoll Erstprüfung nach DIN VDE 0100-600 anlegen',
      }),
    )
    await screen.findByRole('heading', { name: 'Prüfprotokoll Erstprüfung nach DIN VDE 0100-600' })

    expect(router.state.location.pathname).toMatch(/^\/auftraege\/j-1\/pruefprotokolle\//)

    // One block for every circuit of the chart, in its order, nothing typed.
    expect(blockOf('F1 Steckdosen Küche')).toBeTruthy()
    expect(blockOf('F2 Licht Flur')).toBeTruthy()
    expect(within(blockOf('F1 Steckdosen Küche')).getByText(/B 16 A, 30 mA/)).toBeTruthy()

    // Not before it is complete.
    expect(screen.getByText('Prüfer fehlt.')).toBeTruthy()

    await user.type(screen.getByLabelText('Prüfer'), 'Paul Prüfer')
    await user.selectOptions(screen.getByLabelText('Anlass'), 'Neuanlage')
    await user.selectOptions(screen.getByLabelText('Netzform'), 'TN-S')

    for (const label of [
      'Basisschutz, Schutz gegen direktes Berühren',
      'Auswahl und Einstellung der Schutz- und Überwachungseinrichtungen',
      'Leiterquerschnitte und Verlegung der Kabel und Leitungen',
      'Kennzeichnung von Stromkreisen, Schutz- und Neutralleitern',
      'Brandabschottungen und Schutz gegen thermische Einflüsse',
      'Unterlagen vorhanden, Stromkreisverzeichnis und Schaltpläne',
      'Prüftaste der Fehlerstromschutzeinrichtungen',
      'Funktion von Schalt-, Steuer- und Verriegelungseinrichtungen',
    ]) {
      await user.selectOptions(screen.getByLabelText(label), 'in Ordnung')
    }

    // The section is called "Ergebnis" as well; the list is the one to choose in.
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Ergebnis' }),
      'Mängel festgestellt',
    )

    // 0,85 MΩ is below the 1 MΩ of the standard. It is shown, with where the
    // limit comes from, and it is written down all the same.
    const kitchen = within(blockOf('F1 Steckdosen Küche'))

    await user.type(kitchen.getByLabelText('Isolationswiderstand Riso in MΩ'), '0,85')
    await user.type(kitchen.getByLabelText('Schleifenimpedanz Zs in Ω'), '0,78')

    expect(
      kitchen.getByText(
        'Außerhalb des Grenzwerts, mindestens 1,00 MΩ. Quelle: DIN VDE 0100-600 (VDE 0100-600):2017-06, Tabelle 6.1.',
      ),
    ).toBeTruthy()
    // 230 V over five times 16 A.
    expect(kitchen.getByText(/^Innerhalb des Grenzwerts, höchstens 2,87 Ω\./)).toBeTruthy()
    expect(screen.getByText(/1 Wert außerhalb/)).toBeTruthy()

    // A figure that does not read is not taken.
    await user.type(kitchen.getByLabelText('Auslösezeit tΔ in ms'), 'schnell')
    expect(kitchen.getByText('Eine Zahl, etwa 0,85.')).toBeTruthy()
    await user.clear(kitchen.getByLabelText('Auslösezeit tΔ in ms'))
    await user.type(kitchen.getByLabelText('Auslösezeit tΔ in ms'), '23')

    expect(screen.getByRole('button', { name: 'Unterschreiben' })).toHaveProperty('disabled', true)
    expect(screen.getByText('Erst speichern, dann unterschreiben.')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Speichern' }))
    await screen.findByText(
      'Das Protokoll ist vollständig. Mit der Unterschrift wird es festgeschrieben.',
    )

    await user.click(screen.getByRole('button', { name: 'Unterschreiben' }))

    // The name of the tester is there already.
    expect(screen.getByLabelText('Name')).toHaveProperty('value', 'Paul Prüfer')
    signOn(screen.getByRole('img', { name: 'Unterschriftsfeld' }))
    await user.click(screen.getByRole('button', { name: 'Unterschreiben' }))

    // Signed on the device, fixed, before any server has heard of it.
    expect(
      await screen.findByRole('img', { name: 'Unterschrift des Prüfers, Paul Prüfer' }),
    ).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Speichern' })).toBeNull()
    expect(screen.queryByLabelText('Prüfer')).toBeNull()
    expect(server.operations()).toEqual([])

    // The network comes back.
    await client.synchronise()
    server.offline = false
    await client.synchronise()

    const sent = server.operations()

    expect(sent.map((operation) => `${operation.entity} ${operation.kind}`)).toEqual([
      'form_records create',
      'form_records update',
      'form_records update',
    ])

    const signed = Object.fromEntries(
      (sent.at(-1)?.patches ?? []).map((patch) => [patch.field, patch.to]),
    )
    const values = readFormValues(signed['values'])

    expect(signed['status']).toBe('signed')
    expect(values?.['tester_signature']).toMatchObject({ name: 'Paul Prüfer' })
    expect(values?.['circuits']).toEqual([
      {
        circuitId: 'k-1',
        circuit: {
          designation: 'F1',
          consumer: 'Steckdosen Küche',
          tripCharacteristic: 'b',
          ratedCurrentMilli: 16_000,
          ratedResidualCurrentMilli: 30,
        },
        values: { insulation_resistance: 850, loop_impedance: 780, rcd_trip_time: 23_000 },
      },
      {
        circuitId: 'k-2',
        circuit: {
          designation: 'F2',
          consumer: 'Licht Flur',
          tripCharacteristic: 'b',
          ratedCurrentMilli: 10_000,
          ratedResidualCurrentMilli: 30,
        },
        values: {},
      },
    ])
  })
})
