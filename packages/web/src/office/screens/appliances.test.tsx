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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { aTenantChoice } from '../../session/test-tenants.js'
import { SyncClient } from '../../sync/client.js'
import { ApplianceRegisterScreen, ApplianceScreen, NewApplianceScreen } from './appliances.js'
import { ProtocolScreen } from './protocols.js'

/**
 * The register of appliances in the office (#303): the appliances of a site
 * with the result of their last test and the day of the next, filtered;
 * a new appliance through the outbox; an appliance with its protocols, of
 * the form of the register only.
 */

let server: TestServer
let counter = 0

const signature = { name: 'Anna Weber', path: 'M1,1L2,2', signedAt: '2025-11-04T10:00:00.000Z' }

function signedTest(id: string, applianceId: string, performedOn: string, verdict: string) {
  return {
    id,
    definitionKey: 'dguv-v3',
    definitionVersion: 1,
    installationId: null,
    applianceId,
    jobId: null,
    performedOn,
    status: 'signed',
    values: JSON.stringify({
      tester: 'Anna Weber',
      test_kind: 'recurring',
      verdict,
      ...(verdict === 'defects' ? { defects: 'Anschlussleitung beschädigt.' } : {}),
      next_inspection_months: 12_000,
      tester_signature: signature,
    }),
  }
}

const rows: Readonly<Record<string, RecordState[]>> = {
  customers: [{ id: 'c-1', kind: 'business', name: 'Hausverwaltung Süd GmbH' }],
  sites: [{ id: 's-1', customerId: 'c-1', designation: 'Rheinstraße 12' }],
  appliances: [
    {
      id: 'a-1',
      siteId: 's-1',
      inventoryNumber: '004',
      designation: 'Heizlüfter',
      manufacturer: 'Stiebel Eltron',
      protectionClass: 'I',
      mobility: 'portable',
      location: 'Hausmeisterbüro',
      cordLengthMilli: 1_800,
    },
    {
      id: 'a-2',
      siteId: 's-1',
      inventoryNumber: '005',
      designation: 'Kaffeemaschine',
      protectionClass: 'I',
      mobility: 'portable',
      location: 'Hausmeisterbüro',
      cordLengthMilli: null,
    },
    {
      id: 'a-3',
      siteId: 's-1',
      inventoryNumber: '008',
      designation: 'Kabeltrommel 50 m',
      protectionClass: 'I',
      mobility: 'portable',
      location: 'Garage',
      cordLengthMilli: 50_000,
    },
  ],
  form_records: [
    signedTest('p-1', 'a-1', '2099-01-02', 'defects'),
    signedTest('p-2', 'a-2', '2020-01-10', 'passed'),
  ],
}

async function mount(path: string) {
  for (const [entity, list] of Object.entries(rows)) {
    for (const row of list) {
      server.put(entity, row)
    }
  }

  const client = await SyncClient.start({
    store: await openLocalStore(`office-appliances${String((counter += 1))}`),
    transport: server,
    writer: server,
    deviceId: 'office',
    entities: ['customers', 'sites', 'installations', 'appliances', 'form_records', 'attachments'],
    onSignedOut: () => {},
  })

  await client.synchronise()

  const root = createRootRoute()
  const at = (route: string, component: () => React.JSX.Element) =>
    createRoute({ getParentRoute: () => root, path: route, component })
  const router = createRouter({
    routeTree: root.addChildren([
      at('/objekte/$siteId/geraete', ApplianceRegisterScreen),
      at('/objekte/$siteId/geraete/neu', NewApplianceScreen),
      at('/geraete/$applianceId', ApplianceScreen),
      at('/pruefprotokolle/$recordId', ProtocolScreen),
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

  // Somebody of the office, who may change the installations and so the register.
  const answers = new Map<string, unknown>([
    [
      '/api/auth/get-session',
      {
        user: { id: 'u-1', email: 'britta@nord.example.de', name: 'Britta Büro' },
        session: { activeTenantId: 't-1' },
      },
    ],
    ['/auth/tenants', [aTenantChoice(['office'])]],
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

describe('the register of appliances in the office (#303)', () => {
  it('lists every appliance with its last result and the day of its next test, the due one marked', async () => {
    await mount('/objekte/s-1/geraete')

    const table = await screen.findByRole('table', { name: 'Geräte am Objekt' })
    const lines = within(table)
      .getAllByRole('row')
      .slice(1)
      .map((row) => row.textContent ?? '')

    expect(lines[0]).toContain('Heizlüfter')
    expect(lines[0]).toContain('Mängel')
    expect(lines[1]).toContain('Keine Mängel')
    expect(lines[1]).toContain('10.01.2021, fällig')
    expect(lines[2]).toContain('noch nicht geprüft')
  })

  it('narrows the list to what is open', async () => {
    const user = userEvent.setup()

    await mount('/objekte/s-1/geraete')
    await user.click(await screen.findByRole('button', { name: 'Mit Mängeln' }))

    const table = screen.getByRole('table', { name: 'Geräte am Objekt' })

    expect(within(table).getAllByRole('row')).toHaveLength(2)
    expect(within(table).getByText('Heizlüfter')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Noch nicht geprüft' }))

    expect(within(table).getByText('Kabeltrommel 50 m')).toBeTruthy()
    expect(within(table).queryByText('Heizlüfter')).toBeNull()
  })

  it('makes an appliance at the site through the outbox, its lead in millimetres', async () => {
    const user = userEvent.setup()
    const { client, router } = await mount('/objekte/s-1/geraete/neu')

    await user.type(await screen.findByLabelText(/Bezeichnung/), 'Bohrhammer')
    await user.type(screen.getByLabelText('Inventarnummer'), '001')
    await user.selectOptions(screen.getByLabelText(/Schutzklasse/), 'II')
    await user.type(screen.getByLabelText('Länge der Anschlussleitung in m'), '4,5')
    await user.click(
      within(screen.getByRole('region', { name: 'Gerät anlegen' })).getByRole('button', {
        name: 'Gerät anlegen',
      }),
    )
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/objekte/s-1/geraete')
    })

    expect(
      client.list('appliances').find((row) => row['designation'] === 'Bohrhammer'),
    ).toMatchObject({
      siteId: 's-1',
      inventoryNumber: '001',
      protectionClass: 'II',
      mobility: 'portable',
      cordLengthMilli: 4_500,
    })
  })

  it('offers at an appliance the test of the register only, and from its last one', async () => {
    await mount('/geraete/a-2')

    const protocols = await screen.findByRole('region', { name: 'Prüfprotokolle' })

    expect(
      within(protocols).getByRole('button', {
        name: 'Prüfprotokoll Geräteprüfung nach DGUV Vorschrift 3 anlegen',
      }),
    ).toBeTruthy()
    expect(within(protocols).queryByRole('button', { name: /DIN VDE/ })).toBeNull()
    expect(within(protocols).getByText('Mit dem Protokoll vom 10.01.2020 als Vorlage')).toBeTruthy()
  })

  it('says on an appliance with defects what the last test found', async () => {
    await mount('/geraete/a-1')

    expect(
      await screen.findByText(
        /Letzte Prüfung am 02.01.2099: Mängel festgestellt\. Anschlussleitung beschädigt\./,
      ),
    ).toBeTruthy()
  })
})
