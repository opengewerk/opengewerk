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
import { render, screen, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { aTenantChoice } from '../../session/test-tenants.js'
import { SyncClient } from '../../sync/client.js'
import { InstallationScreen } from './installations.js'
import { installationCheck, yieldForecastOf } from './sites.js'

/**
 * The papers of a PV system in the office (#305): the forecast of its yield
 * with its source among its facts and in its form, and the card with the
 * papers as the structure stands and the folder of every handover.
 */

let server: TestServer
let counter = 0
let handovers: Record<string, unknown>[] = []
const posted: string[] = []

const rows: Readonly<Record<string, RecordState[]>> = {
  customers: [{ id: 'c-1', kind: 'private', name: 'Familie Weber' }],
  sites: [{ id: 's-1', customerId: 'c-1', designation: 'Wohnhaus' }],
  installations: [
    {
      id: 'i-1',
      siteId: 's-1',
      kind: 'pv_system',
      designation: 'PV-Anlage Dach',
      yieldForecastKwh: 9120,
      yieldForecastSource: 'PV*SOL premium',
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
    store: await openLocalStore(`office-pv-documents${String((counter += 1))}`),
    transport: server,
    writer: server,
    deviceId: 'office',
    entities: [
      'customers',
      'sites',
      'installations',
      'jobs',
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

  return { client }
}

beforeEach(() => {
  server = new TestServer()
  handovers = []
  posted.length = 0

  vi.stubGlobal('fetch', (path: string, init?: RequestInit) => {
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
      return answer(200, [aTenantChoice(['office'])])
    }

    if (path === '/installations/i-1/handovers' && init?.method === 'POST') {
      const made = {
        id: 'h-1',
        handedOverOn: '2026-11-02',
        handedOverBy: 'Jonas Brandt',
        protocols: 2,
      }

      posted.push(path)
      handovers = [made]

      return answer(201, made)
    }

    if (path === '/installations/i-1/handovers') {
      return answer(200, handovers)
    }

    return answer(404, {})
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the forecast of the yield of a PV system (#305)', () => {
  it('stands among its facts with its source', async () => {
    await mount('/anlagen/i-1')

    expect(await screen.findByText('9.120 kWh im Jahr, PV*SOL premium')).toBeTruthy()
  })

  it('is read as a whole number of kilowatt hours, with or without points, and refused otherwise', () => {
    expect(yieldForecastOf('9120')).toBe(9120)
    expect(yieldForecastOf('9.120')).toBe(9120)
    expect(yieldForecastOf(' ')).toBeNull()
    expect(yieldForecastOf('9,5')).toBeUndefined()
    expect(yieldForecastOf('91.20')).toBeUndefined()
    expect(installationCheck({ kind: 'pv_system', yieldForecastKwh: '9.120' })).toBeNull()
    expect(installationCheck({ kind: 'pv_system', yieldForecastKwh: '9,5' })).toBe(
      'Die Ertragsprognose ist eine ganze Zahl von Kilowattstunden im Jahr.',
    )
    expect(installationCheck({ kind: 'pv_system', yieldForecastKwh: '0' })).toBe(
      'Die Ertragsprognose ist eine ganze Zahl von Kilowattstunden im Jahr.',
    )
  })
})

describe('the papers for the operator in the office (#305)', () => {
  it('lead to the papers as they stand, and hand over only after asking', async () => {
    const user = userEvent.setup()

    await mount('/anlagen/i-1')

    const card = await screen.findByRole('region', { name: 'Unterlagen für den Betreiber' })

    expect(
      within(card)
        .getByRole('link', { name: 'Stringplan und Komponentenliste' })
        .getAttribute('href'),
    ).toBe('/installations/i-1/pv-plan')
    expect(await within(card).findByText('Noch nicht übergeben.')).toBeTruthy()

    await user.click(await within(card).findByRole('button', { name: 'Übergeben' }))
    // Nothing is handed over before it is confirmed.
    expect(posted).toEqual([])
    expect(
      within(card).getByText(
        'Die Mappe wird mit dem heutigen Stand festgehalten und ändert sich danach nicht mehr.',
      ),
    ).toBeTruthy()

    await user.click(within(card).getByRole('button', { name: 'Jetzt übergeben' }))

    const folder = await within(card).findByRole('link', { name: 'Mappe vom 02.11.2026' })

    expect(posted).toEqual(['/installations/i-1/handovers'])
    expect(folder.getAttribute('href')).toBe('/installations/i-1/handovers/h-1/pdf')
    expect(within(card).getByText('Übergeben von Jonas Brandt, mit 2 Protokollen')).toBeTruthy()
  })
})
