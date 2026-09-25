import 'fake-indexeddb/auto'

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
import { CustomerList, CustomerScreen, NewCustomerScreen } from './customers.js'

/**
 * The customers as the canvas draws them (#219): the list at every width of
 * the board "Breiten und Auflösungen" (#218), the record, and a new customer
 * on a screen of its own. And the country of a customer (#144): the form
 * wrote Germany into every customer and had no field for anything else, while
 * the country decides whether the customer gets an e-invoice.
 */

let server: TestServer
let counter = 0

/** A window of this width, as far as `matchMedia` is asked about it. */
function windowOf(width: number) {
  vi.stubGlobal('matchMedia', (query: string) => {
    const least = /min-width:\s*([\d.]+)rem/.exec(query)

    return {
      matches: least ? width >= Number(least[1]) * 16 : false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }
  })
}

function customer(id: string, name: string, kind: string, city: string) {
  return {
    id,
    name,
    kind,
    postalCode: '22301',
    city,
    country: 'DE',
    isBusiness: kind !== 'private',
    isConstructionServiceRecipient: false,
    createdAt: '2024-03-12T09:00:00.000Z',
    version: 1,
    deletedAt: null,
  }
}

async function mount(path: string) {
  const client = await SyncClient.start({
    store: await openLocalStore(`kunden${String((counter += 1))}`),
    transport: server,
    writer: server,
    deviceId: 'office-computer',
    entities: ['customers', 'sites', 'jobs'],
    onSignedOut: () => {},
  })

  await client.synchronise()

  const root = createRootRoute()
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({ getParentRoute: () => root, path: '/', component: CustomerList }),
      createRoute({
        getParentRoute: () => root,
        path: '/kunden/neu',
        component: NewCustomerScreen,
      }),
      createRoute({
        getParentRoute: () => root,
        path: '/kunden/$customerId',
        component: CustomerScreen,
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

  return router
}

beforeEach(() => {
  server = new TestServer()
  windowOf(1280)
  vi.stubGlobal('fetch', (path: string) => {
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

    return Promise.resolve(
      new Response(JSON.stringify(answers.get(path) ?? {}), {
        status: answers.has(path) ? 200 : 404,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the list of customers', () => {
  it('shows every column from 1024 pixels on, and the one action leads to a new customer', async () => {
    server.put('customers', customer('c-1', 'Familie Berg', 'private', 'Hamburg'))
    server.put('sites', { id: 's-1', customerId: 'c-1', designation: 'Wohnhaus', version: 1 })
    server.put('jobs', {
      id: 'j-1',
      customerId: 'c-1',
      designation: 'Wallbox',
      kind: 'service',
      status: 'active',
      version: 1,
    })
    const router = await mount('/')
    const user = userEvent.setup()

    const table = await screen.findByRole('table', { name: 'Alle Kunden des Betriebs' })

    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual(['Name', 'Art', 'Ort', 'Objekte', 'Offen'])
    expect(await within(table).findByRole('cell', { name: '22301 Hamburg' })).toBeDefined()
    // In the head, and read out once more whenever the search changes it.
    expect(screen.getAllByText('1 Eintrag')).toHaveLength(2)

    await user.click(screen.getByRole('button', { name: 'Neuer Kunde' }))
    expect(router.state.location.pathname).toBe('/kunden/neu')
  })

  it('says so when a search finds nothing, rather than that there is no customer (#223)', async () => {
    server.put('customers', customer('c-1', 'Familie Berg', 'private', 'Hamburg'))
    await mount('/')
    const user = userEvent.setup()

    await screen.findByRole('table', { name: 'Alle Kunden des Betriebs' })
    await user.type(screen.getByLabelText('Kunden durchsuchen'), 'Zwickau')

    expect(await screen.findByText('Für „Zwickau“ gibt es keinen Treffer.')).toBeDefined()
  })

  it('turns into one card per customer on a phone', async () => {
    windowOf(390)
    server.put('customers', customer('c-1', 'Familie Berg', 'private', 'Hamburg'))
    await mount('/')

    const card = await screen.findByRole('link', { name: /Familie Berg/ })

    expect(card.textContent).toContain('Privat · 22301 Hamburg')
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('shows the selected customer beside the list from 1600 pixels on', async () => {
    windowOf(1920)
    server.put('customers', customer('c-1', 'Familie Berg', 'private', 'Hamburg'))
    server.put(
      'customers',
      customer('c-2', 'Hausverwaltung Nordblick', 'property_management', 'Hamburg'),
    )
    const router = await mount('/')
    const user = userEvent.setup()

    // The first row is selected until another is.
    expect(
      await screen.findByRole('complementary', { name: 'Vorschau: Familie Berg' }),
    ).toBeDefined()

    await user.click(screen.getByRole('link', { name: 'Hausverwaltung Nordblick' }))

    expect(
      await screen.findByRole('complementary', { name: 'Vorschau: Hausverwaltung Nordblick' }),
    ).toBeDefined()
    expect(router.state.location.pathname).toBe('/')

    // One column fewer beside the preview.
    expect(screen.getAllByRole('columnheader').map((cell) => cell.textContent)).not.toContain(
      'Objekte',
    )
  })

  it('says how the first customer comes about while there is none', async () => {
    await mount('/')

    expect(await screen.findByRole('heading', { name: 'Noch kein Kunde angelegt' })).toBeDefined()
    expect(screen.getAllByText('0 Einträge')).not.toHaveLength(0)
  })
})

describe('the record of a customer', () => {
  it('carries the kind, the facts and the objects with what runs there', async () => {
    server.put(
      'customers',
      customer('c-1', 'Hausverwaltung Nordblick', 'property_management', 'Hamburg'),
    )
    server.put('sites', {
      id: 's-1',
      customerId: 'c-1',
      designation: 'Elbchaussee 140',
      version: 1,
    })
    server.put('jobs', {
      id: 'j-1',
      customerId: 'c-1',
      siteId: 's-1',
      designation: 'Klingelanlage',
      kind: 'service',
      status: 'active',
      version: 1,
    })
    await mount('/kunden/c-1')

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Hausverwaltung Nordblick' }),
    ).toBeDefined()
    expect(screen.getByText('Kunde seit 12.03.2024 · 1 Objekt · 1 Auftrag läuft')).toBeDefined()

    const facts = screen.getByRole('region', { name: 'Stammdaten' })

    expect(within(facts).getByText('Nein, § 13b UStG')).toBeDefined()

    const sites = screen.getByRole('table', { name: 'Objekte des Kunden' })

    expect(within(sites).getByRole('link', { name: 'Elbchaussee 140' })).toBeDefined()
    expect(
      within(screen.getByRole('table', { name: 'Aufträge des Kunden' })).getByText('Laufend'),
    ).toBeDefined()
  })
})

describe('a new customer', () => {
  it('is in Germany unless the office picks another country', async () => {
    const router = await mount('/kunden/neu')
    const user = userEvent.setup()

    expect(await screen.findByRole('heading', { level: 1, name: 'Neuer Kunde' })).toBeDefined()
    expect((screen.getByLabelText('Land') as HTMLSelectElement).value).toBe('DE')

    await user.type(screen.getByLabelText('Name'), 'Familie Gruber')
    await user.selectOptions(screen.getByLabelText('Land'), 'Österreich')
    await user.click(screen.getByRole('button', { name: 'Kunde anlegen' }))

    await waitFor(() => {
      expect(server.all('customers')).toHaveLength(1)
    })
    expect(server.all('customers')[0]).toMatchObject({ name: 'Familie Gruber', country: 'AT' })
    await waitFor(() => {
      expect(router.state.location.pathname).toMatch(/^\/kunden\/[0-9a-f-]+$/)
    })
  })
})
