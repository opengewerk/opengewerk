import 'fake-indexeddb/auto'

import {
  type GroupBlock,
  inspectionDueAfter,
  type IsoDate,
  type MeasurementField,
  readFormValues,
  type RecordState,
} from '@opengewerk/domain'
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
import { fireEvent, render, screen, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SyncClient } from '../../sync/client.js'
import { SiteJobScreen } from './job.js'
import { shortLimit, SiteProtocolScreen } from './protocol.js'
import { aTenantChoice } from '../../session/test-tenants.js'

describe('the limit in short beside a measured value', () => {
  const field: MeasurementField = {
    kind: 'measurement',
    key: 'zs',
    label: 'Schleifenimpedanz',
    unit: 'ohm',
    decimals: 2,
    limit: { kind: 'at_most', rule: 'probe.limit' },
  }

  it('says how a value stands to its limit, rounded towards the strict side', () => {
    expect(shortLimit(field, 2_875)).toBe('≤ 2,87 Ω')
    expect(shortLimit({ ...field, limit: { kind: 'at_least', rule: 'probe.limit' } }, 2_875)).toBe(
      '≥ 2,88 Ω',
    )
    // Reaching the limit is outside already (opengewerk-haustechnik#93).
    expect(shortLimit({ ...field, limit: { kind: 'below', rule: 'probe.limit' } }, 2_875)).toBe(
      '< 2,88 Ω',
    )
  })
})

/**
 * #79 as it happens on site, over the steps of the boards "Prüfprotokoll,
 * Messen je Stromkreis" and "Prüfprotokoll, Übersicht und Ergebnis" (#219):
 * the protocol of an initial verification started at the installation of a
 * job, without a network, section by section and circuit by circuit out of
 * the chart, signed by the tester and sent afterwards.
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
  customers: [
    { id: 'c-1', kind: 'private', name: 'Familie Berg' },
    {
      id: 'c-2',
      kind: 'private',
      name: 'Familie Sonne',
      street: 'Sonnenweg',
      houseNumber: '1',
      postalCode: '68535',
      city: 'Edingen-Neckarhausen',
      country: 'DE',
    },
  ],
  sites: [
    { id: 's-1', customerId: 'c-1', designation: 'Einfamilienhaus' },
    { id: 's-2', customerId: 'c-2', designation: 'Wohnhaus Sonne' },
  ],
  installations: [
    { id: 'i-1', siteId: 's-1', kind: 'meter_cabinet', designation: 'Zählerschrank' },
    // A PV system with its battery and its meter (#304).
    { id: 'i-2', siteId: 's-2', kind: 'pv_system', designation: 'PV-Anlage Dach' },
    {
      id: 'i-3',
      siteId: 's-2',
      kind: 'battery',
      designation: 'Speicher Keller',
      manufacturer: 'BYD',
      model: 'HVS 7.7',
      serialNumber: 'B-77-1',
      pvSystemId: 'i-2',
    },
    {
      id: 'i-4',
      siteId: 's-2',
      kind: 'meter',
      designation: 'Zweirichtungszähler',
      serialNumber: '1EMH0012345678',
      pvSystemId: 'i-2',
    },
  ],
  inverters: [
    {
      id: 'w-1',
      installationId: 'i-2',
      designation: 'WR 1',
      manufacturer: 'SMA',
      model: 'Sunny Tripower 8.0',
      serialNumber: '3001234567',
      ratedPowerW: 8000,
      position: 0,
    },
  ],
  pv_strings: [{ id: 'st-1', inverterId: 'w-1', designation: 'String 1', position: 0 }],
  pv_modules: [
    { id: 'm-1', pvStringId: 'st-1', ratedPowerW: 430, position: 0 },
    { id: 'm-2', pvStringId: 'st-1', ratedPowerW: 430, position: 1 },
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
    {
      id: 'j-2',
      customerId: 'c-2',
      siteId: 's-2',
      installationId: 'i-2',
      kind: 'installation',
      status: 'active',
      designation: 'PV-Anlage mit Speicher',
      number: 'AU-2026-0008',
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
      'inverters',
      'pv_strings',
      'pv_modules',
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

/** Starts a protocol at the job, the way the button on the job's screen does. */
async function start(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(
    await screen.findByRole('button', {
      name: 'Prüfprotokoll Erstprüfung nach DIN VDE 0100-600 anlegen',
    }),
  )
  await screen.findByRole('list', { name: 'Abschnitte' })
}

/** A row of the overview, by the section it leads to. */
function row(section: string): HTMLElement {
  return within(screen.getByRole('list', { name: 'Abschnitte' })).getByRole('button', {
    name: new RegExp(`^${section} `),
  })
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

  // A technician, for whom the camera of "Foto zum Mangel" is there; every
  // other path of the API is not.
  const answers = new Map<string, unknown>([
    [
      '/api/auth/get-session',
      {
        user: { id: 'u-1', email: 'paul@nord.example.de', name: 'Paul Prüfer' },
        session: { activeTenantId: 't-1' },
      },
    ],
    ['/auth/tenants', [aTenantChoice(['technician'])]],
    ['/tasks/assignees', []],
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

describe('a test protocol on site (#79)', () => {
  it('is started without a network, measured circuit by circuit, signed and sent as written', async () => {
    const user = userEvent.setup()
    const { client, router } = await mount('/auftraege/j-1')

    server.offline = true

    await start(user)
    // The header says what it is, and the line under it which one.
    expect(screen.getByRole('heading', { name: 'Prüfprotokoll' })).toBeTruthy()
    expect(screen.getByText('Erstprüfung nach DIN VDE 0100-600, Zählerschrank')).toBeTruthy()
    expect(router.state.location.pathname).toMatch(/^\/auftraege\/j-1\/pruefprotokolle\//)

    // The overview: every section with how far it is, one block for every
    // circuit of the chart, nothing typed, and no signature before it is
    // complete.
    expect(row('Prüfung').textContent).toContain('noch nichts eingetragen')
    expect(row('Messen').textContent).toContain('0 von 2')
    expect(screen.getByText('Prüfer fehlt.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Unterschreiben' })).toHaveProperty('disabled', true)

    await user.click(row('Prüfung'))
    await user.type(await screen.findByLabelText('Prüfer'), 'Paul Prüfer')
    await user.selectOptions(screen.getByLabelText('Anlass'), 'Neuanlage')
    await user.selectOptions(screen.getByLabelText('Netzform'), 'TN-S')

    // Each step is saved when it is left, forward or back.
    await user.click(screen.getByRole('button', { name: 'Weiter zu Besichtigen' }))

    for (const label of [
      'Basisschutz, Schutz gegen direktes Berühren',
      'Auswahl und Einstellung der Schutz- und Überwachungseinrichtungen',
      'Leiterquerschnitte und Verlegung der Kabel und Leitungen',
      'Kennzeichnung von Stromkreisen, Schutz- und Neutralleitern',
      'Brandabschottungen und Schutz gegen thermische Einflüsse',
      'Unterlagen vorhanden, Stromkreisverzeichnis und Schaltpläne',
    ]) {
      await user.selectOptions(await screen.findByLabelText(label), 'in Ordnung')
    }

    await user.click(screen.getByRole('button', { name: 'Weiter zu Erproben' }))

    for (const label of [
      'Prüftaste der Fehlerstromschutzeinrichtungen',
      'Funktion von Schalt-, Steuer- und Verriegelungseinrichtungen',
    ]) {
      await user.selectOptions(await screen.findByLabelText(label), 'in Ordnung')
    }

    // From the last section to the first circuit, in the order of the chart.
    await user.click(screen.getByRole('button', { name: 'Weiter zu F1' }))
    expect(await screen.findByText('Messen, Stromkreis 1 von 2')).toBeTruthy()
    expect(screen.getByText('Steckdosen Küche')).toBeTruthy()
    expect(screen.getByText('B 16 A, 30 mA, 0 von 7 eingetragen')).toBeTruthy()
    expect(screen.getByText('Für diesen Wert gibt es keinen Grenzwert.')).toBeTruthy()
    // The limit in short beside the label, worked out of the circuit:
    // 230 V over five times 16 A.
    expect(screen.getByText('≤ 2,87 Ω')).toBeTruthy()
    expect(await screen.findByRole('button', { name: 'Foto zum Mangel' })).toBeTruthy()

    // 0,85 MΩ is below the 1 MΩ of the standard. It is shown, with where the
    // limit comes from, and it is written down all the same.
    await user.type(screen.getByLabelText('Isolationswiderstand Riso in MΩ'), '0,85')
    await user.type(screen.getByLabelText('Schleifenimpedanz Zs in Ω'), '0,78')

    expect(
      screen.getByText(
        'Außerhalb des Grenzwerts, mindestens 1,00 MΩ. Quelle: DIN VDE 0100-600 (VDE 0100-600):2017-06, Tabelle 6.1.',
      ),
    ).toBeTruthy()
    expect(screen.getByText('Innerhalb des Grenzwerts, höchstens 2,87 Ω.')).toBeTruthy()
    expect(screen.getByText('B 16 A, 30 mA, 2 von 7 eingetragen, 1 Wert außerhalb')).toBeTruthy()

    // A figure that does not read is not taken.
    await user.type(screen.getByLabelText('Auslösezeit tΔ in ms'), 'schnell')
    expect(screen.getByText('Eine Zahl, etwa 0,85.')).toBeTruthy()
    await user.clear(screen.getByLabelText('Auslösezeit tΔ in ms'))
    await user.type(screen.getByLabelText('Auslösezeit tΔ in ms'), '23')

    await user.click(screen.getByRole('button', { name: 'Weiter zu F2' }))
    expect(await screen.findByText('Messen, Stromkreis 2 von 2')).toBeTruthy()
    expect(screen.getByText('Licht Flur')).toBeTruthy()
    // Nothing of F1 on the next circuit, and a limit of its own.
    expect(screen.getByLabelText('Isolationswiderstand Riso in MΩ')).toHaveProperty('value', '')
    expect(screen.getByText('≤ 4,60 Ω')).toBeTruthy()

    // Back to F1, and what was typed there is there.
    await user.click(screen.getByRole('button', { name: 'Zu F1' }))
    expect(await screen.findByText('Messen, Stromkreis 1 von 2')).toBeTruthy()
    expect(screen.getByLabelText('Isolationswiderstand Riso in MΩ')).toHaveProperty('value', '0,85')

    await user.click(screen.getByRole('button', { name: 'Weiter zu F2' }))
    await user.click(await screen.findByRole('button', { name: 'Zur Übersicht' }))

    // The overview knows how far everything is.
    await screen.findByRole('list', { name: 'Abschnitte' })
    expect(row('Prüfung').textContent).toContain('vollständig')
    expect(row('Erproben').textContent).toContain('vollständig')
    expect(row('Messen').textContent).toContain('1 von 2, 1 Wert außerhalb')
    expect(row('Ergebnis').textContent).toContain('noch nichts eingetragen')
    expect(screen.getByText('Alles gespeichert.')).toBeTruthy()
    expect(screen.getByText('Ergebnis fehlt.')).toBeTruthy()

    // The section is called "Ergebnis" as well; the list is the one to choose in.
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Ergebnis' }),
      'Mängel festgestellt',
    )

    expect(screen.getByText('Nicht gespeicherte Änderungen.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Unterschreiben' })).toHaveProperty('disabled', true)
    expect(screen.getByText('Erst speichern, dann unterschreiben.')).toBeTruthy()

    // A new installation names the interval to its first recurring
    // inspection before it is signed (#814).
    await user.click(screen.getByRole('button', { name: 'Speichern' }))
    await screen.findByText('Prüffrist bis zur ersten Wiederholungsprüfung fehlt.')
    expect(screen.getByRole('button', { name: 'Unterschreiben' })).toHaveProperty('disabled', true)
    await user.type(
      screen.getByLabelText('Prüffrist bis zur ersten Wiederholungsprüfung in Mon.'),
      '48',
    )
    await user.click(screen.getByRole('button', { name: 'Speichern' }))
    await screen.findByText(
      'Das Protokoll ist vollständig. Mit der Unterschrift wird es festgeschrieben.',
    )
    expect(row('Ergebnis').textContent).toContain('eingetragen')

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

    // Created, saved on leaving each of the four steps that changed something
    // and twice with "Speichern", then signed; a step left unchanged sends nothing.
    expect(sent.map((operation) => `${operation.entity} ${operation.kind}`)).toEqual([
      'form_records create',
      ...Array.from({ length: 7 }, () => 'form_records update'),
    ])

    const signed = Object.fromEntries(
      (sent.at(-1)?.patches ?? []).map((patch) => [patch.field, patch.to]),
    )
    const values = readFormValues(signed['values'])

    expect(signed['status']).toBe('signed')
    expect(values?.['tester_signature']).toMatchObject({ name: 'Paul Prüfer' })
    expect(values?.['next_inspection_months']).toBe(48_000)
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

  it('measures a recurring inspection by the minimum of each way and says the day of the next one (#301)', async () => {
    const user = userEvent.setup()

    await mount('/auftraege/j-1')
    server.offline = true
    await user.click(
      await screen.findByRole('button', {
        name: 'Prüfprotokoll Wiederholungsprüfung nach DIN VDE 0105-100 anlegen',
      }),
    )
    await screen.findByRole('list', { name: 'Abschnitte' })
    expect(
      screen.getByText('Wiederholungsprüfung nach DIN VDE 0105-100, Zählerschrank'),
    ).toBeTruthy()

    await user.click(row('Messen'))
    // 1000 Ω and 300 Ω per volt of 230 V, without and with loads connected.
    expect(await screen.findByText('≥ 0,230 MΩ')).toBeTruthy()
    expect(screen.getByText('≥ 0,069 MΩ')).toBeTruthy()

    await user.type(
      screen.getByLabelText('Isolationswiderstand Riso ohne Verbraucher in MΩ'),
      '0,2',
    )
    expect(
      screen.getByText(
        /^Außerhalb des Grenzwerts, mindestens 0,230 MΩ\. Quelle: DGUV Information 203-072:2021-04, Tabelle 11/,
      ),
    ).toBeTruthy()
    await user.type(
      screen.getByLabelText('Isolationswiderstand Riso mit Verbrauchern in MΩ'),
      '0,2',
    )
    expect(screen.getByText(/^Innerhalb des Grenzwerts, mindestens 0,069 MΩ\./)).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Weiter zu F2' }))
    await user.click(await screen.findByRole('button', { name: 'Zur Übersicht' }))

    const performedOn = (screen.getByLabelText('Tag der Prüfung') as HTMLInputElement).value
    const due = inspectionDueAfter(performedOn as IsoDate, 48_000) ?? ''

    expect(screen.queryByText(/^Nächste Prüfung bis zum/)).toBeNull()
    await user.type(
      await screen.findByLabelText('Prüffrist bis zur nächsten Prüfung in Mon.'),
      '48',
    )
    expect(
      screen.getByText(
        `Nächste Prüfung bis zum ${due.slice(8, 10)}.${due.slice(5, 7)}.${due.slice(0, 4)}.`,
      ),
    ).toBeTruthy()
  })

  it('opens the measuring at the first circuit without a value', async () => {
    const user = userEvent.setup()

    await mount('/auftraege/j-1')
    server.offline = true
    await start(user)

    await user.click(row('Messen'))
    await user.type(await screen.findByLabelText('Isolationswiderstand Riso in MΩ'), '550')
    await user.click(screen.getByRole('button', { name: 'Weiter zu F2' }))
    await user.click(await screen.findByRole('button', { name: 'Zur Übersicht' }))

    await user.click(await screen.findByRole('button', { name: /^Messen / }))
    expect(await screen.findByText('Messen, Stromkreis 2 von 2')).toBeTruthy()
  })

  it('takes what was typed along when the screen is left by the header', async () => {
    const user = userEvent.setup()
    const { client, router } = await mount('/auftraege/j-1')

    server.offline = true
    await start(user)

    await user.click(row('Messen'))
    await user.type(await screen.findByLabelText('Isolationswiderstand Riso in MΩ'), '550')

    await router.navigate({ to: '/auftraege/$jobId', params: { jobId: 'j-1' } })

    await vi.waitFor(() => {
      const [record] = client.list('form_records')
      const blocks = readFormValues(record?.['values'])?.['circuits'] as
        readonly GroupBlock[] | undefined

      expect(blocks?.[0]?.values).toEqual({ insulation_resistance: 550_000 })
    })
  })
})

describe('the commissioning protocol after VDE-AR-N 4105 on site (#304)', () => {
  const title = 'Inbetriebsetzungsprotokoll nach VDE-AR-N 4105 anlegen'

  it('is offered at a PV system and not at a meter cabinet', async () => {
    await mount('/auftraege/j-1')
    await screen.findByRole('button', {
      name: 'Prüfprotokoll Erstprüfung nach DIN VDE 0100-600 anlegen',
    })

    expect(screen.queryByRole('button', { name: title })).toBeNull()
  })

  it('starts from the customer and the PV structure, and is signed by operator and business', async () => {
    const user = userEvent.setup()
    const { client } = await mount('/auftraege/j-2')

    server.offline = true
    await user.click(await screen.findByRole('button', { name: title }))
    await screen.findByRole('list', { name: 'Abschnitte' })
    expect(screen.getByRole('heading', { name: 'Inbetriebsetzung', level: 1 })).toBeTruthy()
    expect(screen.getByText('Protokoll nach VDE-AR-N 4105, PV-Anlage Dach')).toBeTruthy()
    expect(screen.getByLabelText('Tag der Inbetriebsetzung')).toBeTruthy()

    await user.click(row('Anlage'))
    expect(await screen.findByLabelText('Anlagenbetreiber')).toHaveProperty(
      'value',
      'Familie Sonne\nSonnenweg 1, 68535 Edingen-Neckarhausen',
    )
    expect(screen.getByLabelText('Wechselrichter')).toHaveProperty(
      'value',
      'WR 1, SMA Sunny Tripower 8.0, Seriennummer 3001234567, 8 kW',
    )
    expect(screen.getByLabelText('Speicher')).toHaveProperty(
      'value',
      'Speicher Keller, BYD HVS 7.7, Seriennummer B-77-1',
    )
    expect(screen.getByLabelText('Zählernummer')).toHaveProperty('value', '1EMH0012345678')
    expect(screen.getByLabelText('Maximale Scheinleistung SAmax in kVA')).toHaveProperty(
      'value',
      '8',
    )
    expect(screen.getByLabelText('Modulleistung in kWp')).toHaveProperty('value', '0,86')

    await user.type(
      screen.getByLabelText('Eintragung im Installateurverzeichnis'),
      'E-4711, Netze BW',
    )
    await user.selectOptions(screen.getByLabelText('Aufbau wie angemeldet'), 'ja')
    await user.click(screen.getByRole('button', { name: 'Weiter zu Messung und Schutz' }))

    await user.selectOptions(await screen.findByLabelText('Abrechnungsmessung geprüft'), 'ja')
    await user.type(screen.getByLabelText('Begrenzung der Einspeisung in %'), '70')
    expect(
      screen.getByText(/^Außerhalb des Grenzwerts, höchstens 60 %\. Quelle: § 9 Abs\. 2/),
    ).toBeTruthy()
    await user.clear(screen.getByLabelText('Begrenzung der Einspeisung in %'))
    await user.type(screen.getByLabelText('Begrenzung der Einspeisung in %'), '60')
    await user.selectOptions(
      screen.getByLabelText('Parametersatz der Erzeugungseinheiten'),
      'Kein Anschluss an das Mittelspannungsnetz',
    )
    await user.click(screen.getByRole('button', { name: 'Weiter zu Symmetrie' }))

    await user.selectOptions(
      await screen.findByLabelText('Eingehalten durch'),
      'Drehstromgenerator oder dreiphasigen Umrichter',
    )
    await user.click(screen.getByRole('button', { name: 'Weiter zu Blindleistung' }))
    await user.selectOptions(
      await screen.findByLabelText('Eingestellt'),
      'Q(U), Standardkennlinie belassen',
    )
    await user.click(screen.getByRole('button', { name: 'Zur Übersicht' }))

    await screen.findByRole('list', { name: 'Abschnitte' })
    // The signatures come in the step of signing, so neither is missing before it.
    expect(screen.queryByText('Unterschrift des Anlagenbetreibers fehlt.')).toBeNull()
    fireEvent.change(screen.getByLabelText('Erster Netzparallelbetrieb'), {
      target: { value: '2026-11-04' },
    })
    await user.selectOptions(screen.getByLabelText('Errichtet, eingewiesen und übergeben'), 'ja')
    await user.click(screen.getByRole('button', { name: 'Speichern' }))
    await screen.findByText(
      'Das Protokoll ist vollständig. Mit den Unterschriften wird es festgeschrieben.',
    )

    await user.click(screen.getByRole('button', { name: 'Unterschreiben' }))
    expect(
      screen.getByText(/^Mit den Unterschriften bestätigen Sie die Inbetriebsetzung/),
    ).toBeTruthy()

    // The operator first, named from the protocol, then the business.
    const [operator, business] = screen.getAllByLabelText('Name')

    expect(operator).toHaveProperty('value', 'Familie Sonne')
    expect(business).toHaveProperty('value', '')
    await user.type(business as HTMLElement, 'Paul Prüfer')

    const [operatorPad, businessPad] = screen.getAllByRole('img', { name: 'Unterschriftsfeld' })

    signOn(operatorPad as Element)
    await user.click(screen.getByRole('button', { name: 'Unterschreiben' }))
    expect(
      screen.getByText('Bitte im Feld „Unterschrift des Elektrofachbetriebs“ unterschreiben.'),
    ).toBeTruthy()

    signOn(businessPad as Element)
    await user.click(screen.getByRole('button', { name: 'Unterschreiben' }))
    expect(
      await screen.findByRole('img', {
        name: 'Unterschrift des Anlagenbetreibers, Familie Sonne',
      }),
    ).toBeTruthy()
    expect(
      screen.getByRole('img', { name: 'Unterschrift des Elektrofachbetriebs, Paul Prüfer' }),
    ).toBeTruthy()

    await client.synchronise()
    server.offline = false
    await client.synchronise()

    const sent = server.operations()
    const signed = Object.fromEntries(
      (sent.at(-1)?.patches ?? []).map((patch) => [patch.field, patch.to]),
    )
    const values = readFormValues(signed['values'])

    expect(signed['status']).toBe('signed')
    expect(values).toMatchObject({
      operator: 'Familie Sonne\nSonnenweg 1, 68535 Edingen-Neckarhausen',
      meter: '1EMH0012345678',
      apparent_power: 8000,
      active_power: 8000,
      module_power: 860,
      feed_in_limit: 60_000,
      grid_parallel_on: '2026-11-04',
      operator_signature: { name: 'Familie Sonne' },
      installer_signature: { name: 'Paul Prüfer' },
    })
  })
})

describe('the test of the DC side of a PV system on site (#305)', () => {
  it('measures string by string out of the PV structure, with the minimum of the standard', async () => {
    const user = userEvent.setup()
    const { client } = await mount('/auftraege/j-2')

    server.offline = true
    await user.click(
      await screen.findByRole('button', {
        name: 'Prüfprotokoll Gleichstromseite nach DIN EN IEC 62446-1 anlegen',
      }),
    )
    await screen.findByRole('list', { name: 'Abschnitte' })
    expect(row('Messen').textContent).toContain('0 von 1')

    await user.click(row('Messen'))
    expect(await screen.findByText('Messen, String 1 von 1')).toBeTruthy()
    expect(screen.getByText('WR 1, 2 Module, 0,86 kWp')).toBeTruthy()

    await user.type(screen.getByLabelText('Isolationswiderstand Riso in MΩ'), '0,8')
    expect(
      screen.getByText(
        'Außerhalb des Grenzwerts, mindestens 1,00 MΩ. Quelle: DIN EN IEC 62446-1 (VDE 0126-23-1):2019-04, Tabelle 2, Systemspannung ab 120 V.',
      ),
    ).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Zur Übersicht' }))
    await screen.findByRole('list', { name: 'Abschnitte' })

    await client.synchronise()
    server.offline = false
    await client.synchronise()

    const saved = Object.fromEntries(
      (server.operations().at(-1)?.patches ?? []).map((patch) => [patch.field, patch.to]),
    )

    expect(readFormValues(saved['values'])?.['strings']).toEqual([
      {
        circuitId: 'st-1',
        circuit: {
          designation: 'String 1',
          consumer: 'WR 1, 2 Module, 0,86 kWp',
          tripCharacteristic: null,
          ratedCurrentMilli: null,
          ratedResidualCurrentMilli: null,
        },
        values: { insulation_resistance: 800 },
      },
    ])
  })
})
