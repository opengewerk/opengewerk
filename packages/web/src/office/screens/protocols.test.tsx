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
import { render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { SyncClient } from '../../sync/client.js'
import { SyncProvider } from '../../sync/provider.js'
import { openLocalStore } from '../../sync/store.js'
import { TestServer } from '../../sync/test-server.js'
import { InstallationScreen } from './installations.js'
import { ProtocolScreen } from './protocols.js'

/**
 * #79 in the office: a signed protocol found at its installation, read with
 * its verdicts and printed, and the next test started with it as template.
 */

let server: TestServer
let counter = 0

const kitchen = {
  designation: 'F1',
  consumer: 'Steckdosen Küche',
  tripCharacteristic: 'b',
  ratedCurrentMilli: 16_000,
  ratedResidualCurrentMilli: 30,
}

/** The protocol of the last test, as the site signed it. */
const signed = {
  tester: 'Paul Prüfer',
  instrument: 'Benning IT 130',
  occasion: 'new',
  earthing_system: 'tn_s',
  nominal_voltage: 230_000,
  basic_protection: 'ok',
  protective_devices: 'ok',
  conductors: 'ok',
  identification: 'ok',
  fire_protection: 'ok',
  documentation: 'ok',
  rcd_test_button: 'ok',
  switchgear: 'ok',
  verdict: 'defects',
  defects: 'Isolationswiderstand F1 zu gering.',
  circuits: [
    {
      circuitId: 'k-1',
      circuit: kitchen,
      values: { insulation_resistance: 850, loop_impedance: 780, remark: 'Feuchte Dose' },
    },
  ],
  tester_signature: {
    name: 'Paul Prüfer',
    path: 'M100,300L240,120L400,280',
    signedAt: '2026-09-24T10:00:00.000Z',
  },
}

const rows: Readonly<Record<string, RecordState[]>> = {
  customers: [{ id: 'c-1', kind: 'private', name: 'Familie Berg' }],
  sites: [{ id: 's-1', customerId: 'c-1', designation: 'Einfamilienhaus' }],
  installations: [
    { id: 'i-1', siteId: 's-1', kind: 'meter_cabinet', designation: 'Zählerschrank' },
  ],
  distribution_boards: [
    { id: 'b-1', installationId: 'i-1', kind: 'main_distribution', designation: 'HV', position: 0 },
  ],
  circuits: [
    {
      id: 'k-1',
      distributionBoardId: 'b-1',
      boardSectionId: null,
      designation: 'F1',
      consumer: 'Steckdosen Küche',
      tripCharacteristic: 'b',
      ratedCurrentMilli: 16_000,
      ratedResidualCurrentMilli: 30,
      position: 0,
    },
    {
      id: 'k-3',
      distributionBoardId: 'b-1',
      boardSectionId: null,
      designation: 'F3',
      consumer: 'Wallbox',
      tripCharacteristic: 'c',
      ratedCurrentMilli: 32_000,
      ratedResidualCurrentMilli: 30,
      position: 1,
    },
  ],
  form_records: [
    {
      id: 'p-1',
      definitionKey: 'vde-0100-600',
      definitionVersion: 1,
      installationId: 'i-1',
      jobId: null,
      performedOn: '2026-09-24',
      status: 'signed',
      values: JSON.stringify(signed),
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
    store: await openLocalStore(`office-protocols${String((counter += 1))}`),
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
        path: '/anlagen/$installationId',
        component: InstallationScreen,
      }),
      createRoute({
        getParentRoute: () => root,
        path: '/pruefprotokolle/$recordId',
        component: ProtocolScreen,
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

beforeEach(() => {
  server = new TestServer()
})

describe('a test protocol in the office (#79)', () => {
  it('is found at its installation and read with its verdicts, the signature and a way to print it', async () => {
    const user = userEvent.setup()

    await mount('/anlagen/i-1')

    const section = await screen.findByRole('region', { name: 'Prüfprotokolle' })

    await user.click(
      within(section).getByRole('link', {
        name: /Prüfprotokoll Erstprüfung nach DIN VDE 0100-600/,
      }),
    )
    await screen.findByRole('heading', {
      level: 1,
      name: 'Prüfprotokoll Erstprüfung nach DIN VDE 0100-600',
    })

    // Signed, so there is nothing to change and nothing to save.
    expect(screen.queryByRole('button', { name: 'Speichern' })).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.getByText('Benning IT 130')).toBeTruthy()
    expect(screen.getByText(/1 Wert außerhalb/)).toBeTruthy()
    // Under the table of what was measured, as the board writes it: the
    // circuit and the value, the verdict, and where the limit comes from.
    expect(
      screen.getByText(
        'F1, Isolationswiderstand Riso 0,85 MΩ: Außerhalb des Grenzwerts, mindestens 1,00 MΩ.',
      ),
    ).toBeTruthy()
    expect(
      screen.getByText(/Quelle: DIN VDE 0100-600 \(VDE 0100-600\):2017-06, Tabelle 6\.1\./),
    ).toBeTruthy()
    expect(screen.getByRole('img', { name: 'Unterschrift des Prüfers, Paul Prüfer' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Als PDF' }).getAttribute('href')).toBe(
      '/form-records/p-1/pdf',
    )
  })

  it('starts the next test with the last as its template, keeping what carries and measuring anew', async () => {
    const user = userEvent.setup()
    const { client, router } = await mount('/anlagen/i-1')

    await user.click(
      await screen.findByRole('button', { name: 'Mit dem Protokoll vom 24.09.2026 als Vorlage' }),
    )
    await waitFor(() => {
      expect(router.state.location.pathname).not.toBe('/anlagen/i-1')
    })

    const made = server.operations().find((operation) => operation.kind === 'create')
    const fields = Object.fromEntries((made?.patches ?? []).map((patch) => [patch.field, patch.to]))

    expect(fields['status']).toBe('draft')
    expect(fields['definitionKey']).toBe('vde-0100-600')
    // What describes the installation and the test comes along; what the
    // last test found, measured and signed does not.
    expect(readFormValues(fields['values'])).toEqual({
      tester: 'Paul Prüfer',
      instrument: 'Benning IT 130',
      earthing_system: 'tn_s',
      nominal_voltage: 230_000,
      circuits: [
        { circuitId: 'k-1', circuit: kitchen, values: {} },
        {
          circuitId: 'k-3',
          circuit: {
            designation: 'F3',
            consumer: 'Wallbox',
            tripCharacteristic: 'c',
            ratedCurrentMilli: 32_000,
            ratedResidualCurrentMilli: 30,
          },
          values: {},
        },
      ],
    })

    // The new one is a draft that can be written here.
    expect(await screen.findByRole('button', { name: 'Speichern' })).toBeTruthy()
    expect(screen.getByLabelText('Prüfer')).toHaveProperty('value', 'Paul Prüfer')
    expect(client.list('form_records')).toHaveLength(2)
  })

  it('takes the answers of a draft as buttons and saves them from its head, as the board draws it', async () => {
    const user = userEvent.setup()

    server.put('form_records', {
      id: 'p-3',
      definitionKey: 'vde-0100-600',
      definitionVersion: 1,
      installationId: 'i-1',
      jobId: null,
      performedOn: '2026-09-25',
      status: 'draft',
      values: JSON.stringify({
        tester: 'Paul Prüfer',
        basic_protection: 'ok',
        circuits: [
          {
            circuitId: 'k-1',
            circuit: kitchen,
            values: { loop_impedance: 3_410 },
          },
          {
            circuitId: 'k-3',
            circuit: {
              designation: 'F3',
              consumer: 'Wallbox',
              tripCharacteristic: 'c',
              ratedCurrentMilli: 32_000,
              ratedResidualCurrentMilli: 30,
            },
            values: {},
          },
        ],
      }),
    })

    await mount('/pruefprotokolle/p-3')

    // The day of the test as it is written, whatever the zone of the device.
    expect(await screen.findByText('25.09.2026')).toBeTruthy()

    // A test point, its three answers, the one given pressed.
    const point = screen.getByRole('group', { name: 'Basisschutz, Schutz gegen direktes Berühren' })
    expect(
      within(point).getByRole('button', { name: 'in Ordnung' }).getAttribute('aria-pressed'),
    ).toBe('true')
    await user.click(within(point).getByRole('button', { name: 'Mangel' }))

    // What was measured, a row per circuit, the value outside its limit said
    // in the row and in words under the table.
    const measured = screen.getByRole('table', { name: 'Stromkreise' })
    expect(within(measured).getByText('1 Wert außerhalb')).toBeTruthy()
    expect(within(measured).getByText('noch nichts eingetragen')).toBeTruthy()
    expect(
      screen.getByText(
        'F1, Schleifenimpedanz Zs 3,41 Ω: Außerhalb des Grenzwerts, höchstens 2,87 Ω.',
      ),
    ).toBeTruthy()

    // A row opens to its inputs, the remark among them.
    await user.click(within(measured).getByRole('button', { name: /F3 Wallbox/ }))
    await user.type(screen.getByLabelText('Bemerkung'), 'Noch nicht angeschlossen')

    await user.click(screen.getByRole('button', { name: 'Speichern' }))

    await waitFor(() => {
      expect(server.operations().some((operation) => operation.kind === 'update')).toBe(true)
    })
    const saved = server.operations().find((operation) => operation.kind === 'update')
    const values = readFormValues(
      saved?.patches.find((patch) => patch.field === 'values')?.to ?? null,
    )
    const blocks = values?.['circuits'] as readonly { circuitId: string; values: unknown }[]

    expect(values?.['basic_protection']).toBe('defect')
    expect(blocks.map((block) => [block.circuitId, block.values])).toEqual([
      ['k-1', { loop_impedance: 3_410 }],
      ['k-3', { remark: 'Noch nicht angeschlossen' }],
    ])
  })

  it('offers a draft the circuits the chart has gained since it was started', async () => {
    const user = userEvent.setup()

    server.put('form_records', {
      id: 'p-2',
      definitionKey: 'vde-0100-600',
      definitionVersion: 1,
      installationId: 'i-1',
      jobId: null,
      performedOn: '2026-09-25',
      status: 'draft',
      values: JSON.stringify({
        tester: 'Paul Prüfer',
        circuits: [
          { circuitId: 'k-1', circuit: kitchen, values: { insulation_resistance: 1_500 } },
        ],
      }),
    })

    await mount('/pruefprotokolle/p-2')

    expect(screen.queryByText('F3 Wallbox')).toBeNull()

    await user.click(await screen.findByRole('button', { name: 'Stromkreise übernehmen' }))

    // The Wallbox has a block now, and what was measured on F1 stays.
    expect(screen.getByText('F3 Wallbox')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Stromkreise übernehmen' })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Speichern' }))

    const saved = server.operations().find((operation) => operation.kind === 'update')
    const values = readFormValues(
      saved?.patches.find((patch) => patch.field === 'values')?.to ?? null,
    )
    const blocks = values?.['circuits'] as readonly { circuitId: string; values: unknown }[]

    expect(blocks.map((block) => [block.circuitId, block.values])).toEqual([
      ['k-1', { insulation_resistance: 1_500 }],
      ['k-3', {}],
    ])
  })

  it('lays the blocks out in the order of the chart, on the board first and then field by field', async () => {
    const user = userEvent.setup()
    const board = (part: Record<string, unknown>) => ({
      distributionBoardId: 'b-1',
      consumer: null,
      tripCharacteristic: 'b',
      ratedCurrentMilli: 16_000,
      ratedResidualCurrentMilli: 30,
      ...part,
    })

    // Two fields whose circuits share their places: sorted by place alone
    // they would come out F5, F7, F6, F8.
    server.put('board_sections', {
      id: 'f-2',
      distributionBoardId: 'b-1',
      designation: 'Feld 2',
      position: 1,
    })
    server.put('board_sections', {
      id: 'f-1',
      distributionBoardId: 'b-1',
      designation: 'Feld 1',
      position: 0,
    })
    server.put(
      'circuits',
      board({ id: 'k-7', boardSectionId: 'f-2', designation: 'F7', position: 0 }),
    )
    server.put(
      'circuits',
      board({ id: 'k-5', boardSectionId: 'f-1', designation: 'F5', position: 0 }),
    )
    server.put(
      'circuits',
      board({ id: 'k-8', boardSectionId: 'f-2', designation: 'F8', position: 1 }),
    )
    server.put(
      'circuits',
      board({ id: 'k-6', boardSectionId: 'f-1', designation: 'F6', position: 1 }),
    )

    await mount('/anlagen/i-1')
    await user.click(
      await screen.findByRole('button', {
        name: 'Prüfprotokoll Erstprüfung nach DIN VDE 0100-600 anlegen',
      }),
    )

    const made = server.operations().find((operation) => operation.kind === 'create')
    const values = readFormValues(
      made?.patches.find((patch) => patch.field === 'values')?.to ?? null,
    )
    const blocks = values?.['circuits'] as readonly { circuitId: string }[]

    expect(blocks.map((block) => block.circuitId)).toEqual([
      'k-1',
      'k-3',
      'k-5',
      'k-6',
      'k-7',
      'k-8',
    ])
  })
})
