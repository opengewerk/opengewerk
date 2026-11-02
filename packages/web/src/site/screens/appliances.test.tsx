import 'fake-indexeddb/auto'

import { readFormValues, type RecordState } from '@opengewerk/domain'
import { today } from '@opengewerk/platform-web/format'
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
import { SiteAppliancesScreen, SiteNewApplianceScreen } from './appliances.js'
import { SiteJobScreen } from './jobs.js'
import { SiteProtocolScreen } from './protocol.js'

/**
 * The appliances of a site tested on site after DGUV Vorschrift 3 (#303):
 * the card on the job, the list at the site, a tap that opens the draft of
 * today or starts a test from the last one, a new appliance tested right
 * after it is made, the limits worked out of the appliance, and the way to
 * the next one once a test is signed.
 */

let server: TestServer
let counter = 0

const signature = {
  name: 'Anna Weber',
  path: 'M100,300L240,120L400,280',
  signedAt: '2026-01-10T10:00:00.000Z',
}

/** The last test of the extension lead, signed in January. */
const lastYear = {
  tester: 'Anna Weber',
  instrument: 'Benning ST 760, 21044817',
  test_kind: 'recurring',
  current_method: 'differential',
  housing: 'ok',
  cord: 'ok',
  plug: 'ok',
  markings: 'ok',
  suitability: 'ok',
  protective_conductor: 520,
  function: 'ok',
  safety_devices: 'not_applicable',
  verdict: 'passed',
  next_inspection_months: 12_000,
  tester_signature: signature,
}

function rows(): Readonly<Record<string, RecordState[]>> {
  return {
    customers: [{ id: 'c-1', kind: 'business', name: 'Hausverwaltung Süd GmbH' }],
    sites: [{ id: 's-1', customerId: 'c-1', designation: 'Rheinstraße 12' }],
    jobs: [
      {
        id: 'j-1',
        customerId: 'c-1',
        siteId: 's-1',
        installationId: null,
        kind: 'service',
        status: 'active',
        designation: 'Geräte prüfen',
        number: 'AU-2026-0190',
      },
    ],
    appliances: [
      {
        id: 'a-2',
        siteId: 's-1',
        inventoryNumber: '002',
        designation: 'Verlängerungsleitung 25 m',
        protectionClass: 'I',
        mobility: 'portable',
        location: 'Werkstatt',
        cordLengthMilli: 25_000,
      },
      {
        id: 'a-1',
        siteId: 's-1',
        inventoryNumber: '001',
        designation: 'Bohrhammer',
        protectionClass: 'II',
        mobility: 'portable',
        location: 'Werkstatt',
        cordLengthMilli: null,
      },
    ],
    form_records: [
      {
        id: 'p-1',
        definitionKey: 'dguv-v3',
        definitionVersion: 1,
        installationId: null,
        applianceId: 'a-2',
        jobId: null,
        performedOn: '2026-01-10',
        status: 'signed',
        values: JSON.stringify(lastYear),
      },
    ],
  }
}

async function mount(path: string) {
  for (const [entity, list] of Object.entries(rows())) {
    for (const row of list) {
      server.put(entity, row)
    }
  }

  const client = await SyncClient.start({
    store: await openLocalStore(`site-appliances${String((counter += 1))}`),
    transport: server,
    writer: server,
    deviceId: 'geraet-in-der-werkstatt',
    entities: ['customers', 'sites', 'installations', 'jobs', 'appliances', 'form_records'],
    onSignedOut: () => {},
  })

  await client.synchronise()

  const root = createRootRoute()
  const at = (route: string, component: () => React.JSX.Element) =>
    createRoute({ getParentRoute: () => root, path: route, component })
  const router = createRouter({
    routeTree: root.addChildren([
      at('/auftraege/$jobId', SiteJobScreen),
      at('/auftraege/$jobId/geraete', SiteAppliancesScreen),
      at('/auftraege/$jobId/geraete/neu', SiteNewApplianceScreen),
      at('/auftraege/$jobId/pruefprotokolle/$recordId', SiteProtocolScreen),
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

describe('the appliances of a site on site (#303)', () => {
  it('are reached from the job, in the order of their numbers, each with how it stands', async () => {
    const user = userEvent.setup()

    await mount('/auftraege/j-1')

    const card = await screen.findByRole('region', { name: 'Geräte nach DGUV Vorschrift 3' })

    expect(within(card).getByText('2 Geräte am Objekt, heute noch keines geprüft.')).toBeTruthy()

    await user.click(within(card).getByRole('button', { name: 'Geräte prüfen' }))

    const list = await screen.findByRole('list', { name: 'Geräte am Objekt' })
    const names = within(list)
      .getAllByRole('button')
      .map((row) => row.textContent ?? '')

    expect(names[0]).toContain('Bohrhammer')
    expect(names[0]).toContain('Noch nicht geprüft')
    expect(names[1]).toContain('Verlängerungsleitung 25 m')
    expect(names[1]).toContain('Geprüft am 10.01.2026')
  })

  it('starts the test of an appliance from its last one, keeping what describes the test and nothing found', async () => {
    const user = userEvent.setup()
    const { client, router } = await mount('/auftraege/j-1/geraete')

    await user.click(await screen.findByRole('button', { name: /Verlängerungsleitung 25 m/ }))
    await waitFor(() => {
      expect(router.state.location.pathname).toMatch(/^\/auftraege\/j-1\/pruefprotokolle\//)
    })

    const made = client.list('form_records').find((record) => record['id'] !== 'p-1')

    expect(made).toMatchObject({
      definitionKey: 'dguv-v3',
      applianceId: 'a-2',
      jobId: 'j-1',
      status: 'draft',
      performedOn: today(),
    })
    expect(made && 'installationId' in made ? made['installationId'] : undefined).toBeUndefined()
    expect(readFormValues(made?.['values'])).toEqual({
      tester: 'Anna Weber',
      instrument: 'Benning ST 760, 21044817',
      test_kind: 'recurring',
      current_method: 'differential',
      next_inspection_months: 12_000,
    })
  })

  it('opens the draft of today instead of starting a second test', async () => {
    const user = userEvent.setup()
    const { client, router } = await mount('/auftraege/j-1/geraete')

    await user.click(await screen.findByRole('button', { name: /Bohrhammer/ }))
    await waitFor(() => {
      expect(router.state.location.pathname).toMatch(/pruefprotokolle\//)
    })

    const first = router.state.location.pathname

    await router.navigate({ to: '/auftraege/j-1/geraete' })
    await user.click(await screen.findByRole('button', { name: /Bohrhammer/ }))
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(first)
    })
    expect(
      client.list('form_records').filter((record) => record['applianceId'] === 'a-1'),
    ).toHaveLength(1)
  })

  it('judges a measured value by the limit worked out of the appliance', async () => {
    const user = userEvent.setup()

    await mount('/auftraege/j-1/geraete')
    await user.click(await screen.findByRole('button', { name: /Verlängerungsleitung 25 m/ }))
    await user.click(
      await screen
        .findByRole('link', { name: /Messen/ })
        .catch(() => screen.findByRole('button', { name: /Messen/ })),
    )

    // 0,3 Ω up to 5 m and 0,1 Ω for each of the three lengths of 7,5 m begun beyond.
    const resistance = await screen.findByLabelText(/Schutzleiterwiderstand RPE/)

    await user.type(resistance, '0,65')

    expect(await screen.findByText(/Außerhalb des Grenzwerts, höchstens 0,60 Ω/)).toBeTruthy()
    expect(screen.getByText('≥ 1,00 MΩ')).toBeTruthy()
  })

  it('makes an appliance that is missing and tests it right away, without a template', async () => {
    const user = userEvent.setup()
    const { client, router } = await mount('/auftraege/j-1/geraete/neu')

    await user.type(await screen.findByLabelText('Bezeichnung'), 'Kabeltrommel 50 m')
    await user.type(screen.getByLabelText('Inventarnummer'), '008')
    await user.type(screen.getByLabelText('Länge der Anschlussleitung in m'), '50')
    await user.click(screen.getByRole('button', { name: 'Anlegen und prüfen' }))
    await waitFor(() => {
      expect(router.state.location.pathname).toMatch(/pruefprotokolle\//)
    })

    const appliance = client
      .list('appliances')
      .find((row) => row['designation'] === 'Kabeltrommel 50 m')

    expect(appliance).toMatchObject({
      siteId: 's-1',
      inventoryNumber: '008',
      protectionClass: 'I',
      mobility: 'portable',
      cordLengthMilli: 50_000,
    })
    expect(
      client.list('form_records').find((record) => record['applianceId'] === appliance?.['id']),
    ).toMatchObject({ definitionKey: 'dguv-v3', values: '{}' })
  })

  it('refuses a lead that is no figure before anything is made', async () => {
    const user = userEvent.setup()
    const { client } = await mount('/auftraege/j-1/geraete/neu')

    await user.type(await screen.findByLabelText('Bezeichnung'), 'Kabeltrommel')
    await user.type(screen.getByLabelText('Länge der Anschlussleitung in m'), 'lang')
    await user.click(screen.getByRole('button', { name: 'Anlegen und prüfen' }))

    expect(
      await screen.findByText('Die Länge der Anschlussleitung ist eine Zahl in Metern, etwa 1,5.'),
    ).toBeTruthy()
    expect(client.list('appliances')).toHaveLength(2)
  })
})
