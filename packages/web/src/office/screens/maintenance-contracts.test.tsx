import 'fake-indexeddb/auto'

import { addDays, addMonths, type IsoDate, type RecordState } from '@opengewerk/domain'
import { date, today } from '@opengewerk/platform-web/format'
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
import { act, render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { aTenantChoice } from '../../session/test-tenants.js'
import { SyncClient } from '../../sync/client.js'
import { ContractsCard } from './contract-card.js'
import {
  MaintenanceContractList,
  MaintenanceContractScreen,
  NewMaintenanceContractScreen,
} from './maintenance-contracts.js'

/**
 * Maintenance contracts in the office (#294): the list, a contract with its
 * term and the notice, a new one out of an issued quote with what it takes
 * over and the note of § 309 Nr. 9 BGB for a consumer, and the card at a
 * customer, a site and an installation.
 */

let server: TestServer
let counter = 0
let roles: readonly string[] = ['office']
const posted: { path: string; body: unknown }[] = []
const asked: string[] = []
const on = today() as IsoDate
// Begun eleven months ago with a first term of two years: the end is thirteen months away.
const startsOn = addMonths(on, -11)
const firstEnd = addDays(addMonths(startsOn, 24), -1)

const contract = {
  id: 'wv-1',
  tenantId: 't-1',
  number: 'WV-2026-0003',
  designation: 'Wartung Elektroanlage Rheinstraße 12',
  customerId: 'c-1',
  siteId: 's-1',
  quoteId: 'q-1',
  installationIds: ['i-1'],
  services: 'Sichtprüfung der Verteiler\nAuslöseprüfung der Fehlerstrom-Schutzeinrichtungen',
  startsOn,
  firstVisitOn: startsOn,
  intervalMonths: 6,
  termMonths: 24,
  renewal: 'fixed',
  renewalMonths: 12,
  noticeMonths: 3,
  priceKind: 'flat',
  flatCents: 48_000,
  paymentRhythm: 'visit',
  cancelledOn: null,
  endsOn: null,
  createdAt: '2026-01-01T08:00:00Z',
  updatedAt: '2026-01-01T08:00:00Z',
}

const rows: Readonly<Record<string, RecordState[]>> = {
  customers: [
    { id: 'c-1', kind: 'property_management', name: 'Hausverwaltung Süd GmbH', isBusiness: true },
    { id: 'c-2', kind: 'private', name: 'Familie Weber', isBusiness: false },
  ],
  sites: [
    { id: 's-1', customerId: 'c-1', designation: 'Rheinstraße 12' },
    { id: 's-2', customerId: 'c-2', designation: 'Birkenweg 7' },
  ],
  installations: [
    { id: 'i-1', siteId: 's-1', kind: 'meter_cabinet', designation: 'Zählerschrank, Keller' },
    { id: 'p-1', siteId: 's-2', kind: 'pv_system', designation: 'PV-Anlage Dach' },
    { id: 'p-2', siteId: 's-2', kind: 'battery', designation: 'Speicher Keller' },
  ],
  documents: [
    {
      id: 'q-1',
      customerId: 'c-1',
      siteId: 's-1',
      kind: 'quote',
      status: 'issued',
      number: 'AN-2025-0298',
      documentDate: '2025-12-12',
      subject: 'Wartung Elektroanlage',
    },
    {
      id: 'q-2',
      customerId: 'c-2',
      siteId: 's-2',
      kind: 'quote',
      status: 'issued',
      number: 'AN-2026-0436',
      documentDate: '2026-10-28',
      subject: 'Wartung PV-Anlage',
    },
  ],
  document_lines: [
    {
      id: 'l-1',
      documentId: 'q-2',
      kind: 'item',
      position: 1,
      designation: 'Sichtprüfung der Module',
      netCents: 0,
    },
    {
      id: 'l-2',
      documentId: 'q-2',
      kind: 'item',
      position: 2,
      designation: 'Wartung PV-Anlage, je Wartung',
      netCents: 18_900,
    },
  ],
  jobs: [
    {
      id: 'j-1',
      customerId: 'c-1',
      siteId: 's-1',
      kind: 'service',
      status: 'completed',
      number: 'AU-2026-0161',
      designation: 'Wartung Elektroanlage Rheinstraße 12',
      maintenanceContractId: 'wv-1',
      maintenanceDueOn: startsOn,
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
    store: await openLocalStore(`office-contracts${String((counter += 1))}`),
    transport: server,
    writer: server,
    deviceId: 'office',
    entities: ['customers', 'sites', 'installations', 'documents', 'document_lines', 'jobs'],
    onSignedOut: () => {},
  })

  await client.synchronise()

  const root = createRootRoute()
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({
        getParentRoute: () => root,
        path: '/wartungsvertraege',
        component: MaintenanceContractList,
      }),
      createRoute({
        getParentRoute: () => root,
        path: '/wartungsvertraege/neu/$quoteId',
        component: NewMaintenanceContractScreen,
      }),
      createRoute({
        getParentRoute: () => root,
        path: '/wartungsvertraege/$contractId',
        component: MaintenanceContractScreen,
      }),
      createRoute({
        getParentRoute: () => root,
        path: '/karte',
        component: () => (
          <ContractsCard filter={{ installationId: 'i-1' }} title="Wartungsvertrag" />
        ),
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
  posted.length = 0
  asked.length = 0
  roles = ['office']

  vi.stubGlobal('fetch', (path: string, init?: RequestInit) => {
    asked.push(path)
    const answer = (status: number, body: unknown) =>
      Promise.resolve(
        new Response(JSON.stringify(body), {
          status,
          headers: { 'Content-Type': 'application/json' },
        }),
      )

    if (path === '/api/auth/get-session') {
      return answer(200, {
        user: { id: 'u-1', email: 'buero@nord.example.de', name: 'Jonas Brandt' },
        session: { activeTenantId: 't-1' },
      })
    }

    if (path === '/auth/tenants') {
      return answer(200, [aTenantChoice([...roles])])
    }

    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>

      posted.push({ path, body })

      return answer(
        201,
        path.endsWith('/notice') ? { ...contract, ...body } : { ...contract, ...body, id: 'wv-9' },
      )
    }

    if (path === '/maintenance-contracts' || path === '/maintenance-contracts?installationId=i-1') {
      return answer(200, [contract])
    }

    if (path === '/maintenance-contracts?quoteId=q-2') {
      return answer(200, [])
    }

    if (path === '/maintenance-contracts/wv-1') {
      return answer(200, contract)
    }

    return answer(404, {})
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the maintenance contracts of the office (#294)', () => {
  it('lists each with its customer, interval, next maintenance and where it stands', async () => {
    await mount('/wartungsvertraege')

    const row = (await screen.findByText('WV-2026-0003')).closest('tr') as HTMLElement

    expect(within(row).getByText('Hausverwaltung Süd GmbH')).toBeTruthy()
    expect(within(row).getByText('alle 6 Monate')).toBeTruthy()
    expect(within(row).getByText(date(addMonths(startsOn, 12)))).toBeTruthy()
    expect(within(row).getByText(`Läuft bis ${date(firstEnd)}`)).toBeTruthy()
  })

  it('shows a contract with its services, its maintenances and the last day for a notice', async () => {
    await mount('/wartungsvertraege/wv-1')

    expect(
      await screen.findByText('Auslöseprüfung der Fehlerstrom-Schutzeinrichtungen'),
    ).toBeTruthy()
    expect(screen.getByRole('link', { name: 'AU-2026-0161' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Zählerschrank, Keller' })).toBeTruthy()
    expect(screen.getByText('480,00 € netto je Wartung, Pauschale')).toBeTruthy()
    expect(screen.getByText(date(addDays(addMonths(addDays(firstEnd, 1), -3), -1)))).toBeTruthy()
  })

  it('takes a notice on the day it came and says when the contract ends', async () => {
    const user = userEvent.setup()
    await mount('/wartungsvertraege/wv-1')

    await user.click(await screen.findByRole('button', { name: 'Kündigen' }))

    const dialog = await screen.findByRole('dialog', { name: 'Wartungsvertrag kündigen' })

    expect(within(dialog).getByText(`Endet am ${date(firstEnd)}.`)).toBeTruthy()

    await user.click(within(dialog).getByRole('button', { name: 'Kündigen' }))

    expect(posted).toEqual([
      { path: '/maintenance-contracts/wv-1/notice', body: { receivedOn: on } },
    ])
  })

  it('offers no notice and no change to a technician', async () => {
    roles = ['technician']
    await mount('/wartungsvertraege/wv-1')

    await screen.findByText('Auslöseprüfung der Fehlerstrom-Schutzeinrichtungen')
    // The rights come with the businesses of the person; before they are here
    // nobody may do anything, so the check waits for them.
    await waitFor(() => {
      expect(asked).toContain('/auth/tenants')
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })

    expect(screen.queryByRole('button', { name: 'Kündigen' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Bearbeiten' })).toBeNull()
  })

  it('makes a new one out of a quote with its lines and total, and names § 309 Nr. 9 BGB for a consumer', async () => {
    const user = userEvent.setup()
    await mount('/wartungsvertraege/neu/q-2')

    const designation = await screen.findByLabelText(/Bezeichnung/)

    expect((designation as HTMLInputElement).value).toBe('Wartung PV-Anlage')
    expect((screen.getByLabelText('Enthaltene Leistungen') as HTMLTextAreaElement).value).toBe(
      'Sichtprüfung der Module\nWartung PV-Anlage, je Wartung',
    )
    expect((screen.getByLabelText('Pauschale netto in Euro') as HTMLInputElement).value).toBe(
      '189,00',
    )
    expect(screen.queryByRole('note')).toBeNull()

    const term = screen.getByLabelText(/Laufzeit in Monaten/)

    await user.clear(term)
    await user.type(term, '36')

    expect(screen.getByRole('note').textContent).toContain(
      'eine Laufzeit über 24 Monate (Buchst. a)',
    )

    await user.click(screen.getByRole('checkbox', { name: /^PV-Anlage Dach/ }))
    await user.click(screen.getByRole('button', { name: 'Speichern' }))

    expect(posted[0]).toMatchObject({
      path: '/maintenance-contracts',
      body: {
        quoteId: 'q-2',
        designation: 'Wartung PV-Anlage',
        installationIds: ['p-1'],
        termMonths: 36,
        renewal: 'indefinite',
        noticeMonths: 1,
        priceKind: 'flat',
        flatCents: 18_900,
      },
    })
  })

  it('shows the contracts of an installation in its card', async () => {
    await mount('/karte')

    expect(
      await screen.findByRole('link', {
        name: 'WV-2026-0003 Wartung Elektroanlage Rheinstraße 12',
      }),
    ).toBeTruthy()
    expect(
      screen.getByText(`alle 6 Monate, nächste am ${date(addMonths(startsOn, 12))}`),
    ).toBeTruthy()
  })
})
