import 'fake-indexeddb/auto'

import type { RoleKey } from '@opengewerk/domain'
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'
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

import type { SupplierArticlePage } from '../../session/articles.js'
import { SyncClient } from '../../sync/client.js'
import { SyncProvider } from '../../sync/provider.js'
import { openLocalStore } from '../../sync/store.js'
import { TestServer } from '../../sync/test-server.js'
import { EditSupplierScreen, NewSupplierScreen, SupplierList, SupplierScreen } from './suppliers.js'
import { aTenantChoice } from '../../session/test-tenants.js'

/**
 * The suppliers in the office (#296), as the boards `lieferanten_liste()`,
 * `lieferant()` and `neuer_lieferant()` draw them: master data on the device,
 * created through the outbox and changed at the route, and beside it the
 * articles each sells, which come from the server a page at a time.
 */

type Row = Record<string, unknown>

/** The stand in for the server, which also takes a change at the route. */
class Server extends TestServer {
  readonly patched: { entity: string; id: string; values: Row }[] = []
  readonly removed: { entity: string; id: string }[] = []

  override patch(entity: string, id: string, values: Readonly<Row>) {
    if (this.offline) {
      return Promise.reject(new TypeError('Failed to fetch'))
    }

    this.patched.push({ entity, id, values: { ...values } })

    const current = this.row(entity, id) ?? {}

    this.put(entity, { ...current, ...values, version: Number(current['version'] ?? 0) + 1 })

    return Promise.resolve(undefined)
  }

  override remove(entity: string, id: string) {
    this.removed.push({ entity, id })

    const current = this.row(entity, id) ?? {}

    this.put(entity, { ...current, deletedAt: '2026-09-28T08:00:00.000Z' })

    return Promise.resolve(undefined)
  }
}

interface Call {
  readonly path: string
  readonly method: string
}

let calls: Call[]
let answers: { readonly method: string; readonly test: RegExp; readonly body: unknown }[]
let server: Server
let client: SyncClient
let router: ReturnType<typeof makeRouter>
let counter = 0

function serverSays(method: string, test: RegExp, body: unknown): void {
  answers.unshift({ method, test, body })
}

function signedInAs(...roles: RoleKey[]) {
  serverSays('GET', /^\/api\/auth\/get-session$/, {
    user: { id: 'u-1', email: 'britta@nord.example.de', name: 'Britta Büro' },
    session: { activeTenantId: 't-1' },
  })
  serverSays('GET', /^\/auth\/tenants$/, [aTenantChoice(roles)])
}

function makeRouter(path: string) {
  const root = createRootRoute()

  return createRouter({
    routeTree: root.addChildren([
      createRoute({ getParentRoute: () => root, path: '/lieferanten', component: SupplierList }),
      createRoute({
        getParentRoute: () => root,
        path: '/lieferanten/neu',
        component: NewSupplierScreen,
      }),
      createRoute({
        getParentRoute: () => root,
        path: '/lieferanten/$supplierId',
        component: SupplierScreen,
      }),
      createRoute({
        getParentRoute: () => root,
        path: '/lieferanten/$supplierId/bearbeiten',
        component: EditSupplierScreen,
      }),
      createRoute({
        getParentRoute: () => root,
        path: '/artikel/$articleId',
        component: () => null,
      }),
    ]),
    history: createMemoryHistory({ initialEntries: [path] }),
  })
}

async function mount(path: string) {
  client = await SyncClient.start({
    store: await openLocalStore(`lieferanten${String((counter += 1))}`),
    transport: server,
    writer: server,
    deviceId: 'office-computer',
    entities: ['suppliers', 'contacts'],
    onSignedOut: () => {},
  })

  await client.synchronise()
  router = makeRouter(path)

  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <SyncProvider client={client}>
        <RouterProvider router={router} />
      </SyncProvider>
    </QueryClientProvider>,
  )
}

/** What a supplier sells from the offset on, 30 in all. */
function sold(offset: number, purchase: boolean): SupplierArticlePage {
  const count = offset === 0 ? 25 : 5

  return {
    total: 30,
    rows: Array.from({ length: count }, (_, index) => ({
      supplierArticleId: `l-${String(offset + index)}`,
      supplierNumber: String(5700100 + offset + index),
      articleId: `a-${String(offset + index)}`,
      number: String(1000 + offset + index),
      designation: `Mantelleitung ${String(offset + index)}`,
      unit: 'metre' as const,
      frequent: false,
      purchase: purchase
        ? { unitPriceCents: 54, priceBase: 1 as const, validFrom: '2026-03-01' }
        : null,
    })),
  }
}

beforeEach(() => {
  calls = []
  answers = []
  server = new Server()
  server.put('suppliers', {
    id: 's-1',
    name: 'Elektro-Großhandel Rhein-Neckar GmbH',
    customerNumber: '448120',
    street: 'Industriestraße',
    houseNumber: '24',
    postalCode: '68169',
    city: 'Mannheim',
    country: 'DE',
    email: 'bestellung@egrn-elektro.de',
    phone: '0621 318 40-0',
    notes: 'Abholung bis 16 Uhr.',
  })
  server.put('suppliers', {
    id: 's-2',
    name: 'Kurpfalz Elektrohandel KG',
    postalCode: '69123',
    city: 'Heidelberg',
    country: 'DE',
  })
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: /min-width:\s*(37\.5|64)rem/.test(query),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
  vi.stubGlobal('fetch', (path: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'

    calls.push({ path, method })

    const found = answers.find((entry) => entry.method === method && entry.test.test(path))

    return Promise.resolve(
      new Response(JSON.stringify(found?.body ?? {}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  // The queries listen to the same event of the browser, once for all tests:
  // left offline, every later test would wait for a network forever.
  onlineManager.setOnline(true)
})

describe('the list of suppliers', () => {
  it('shows where each is, our number there and how many articles it sells, by name', async () => {
    signedInAs('office')
    serverSays('GET', /^\/suppliers\/article-counts$/, { 's-1': 214 })
    await mount('/lieferanten')

    const table = await screen.findByRole('table', { name: 'Alle Lieferanten des Betriebs' })
    const rows = within(table).getAllByRole('row').slice(1)

    expect(rows.map((row) => within(row).getAllByRole('cell')[0]?.textContent)).toEqual([
      'Elektro-Großhandel Rhein-Neckar GmbH',
      'Kurpfalz Elektrohandel KG',
    ])
    await waitFor(() => {
      expect(within(rows[0] as HTMLElement).getByText('214')).toBeTruthy()
    })
    expect(within(rows[0] as HTMLElement).getByText('448120')).toBeTruthy()
    expect(within(rows[1] as HTMLElement).getByText('nicht angegeben')).toBeTruthy()
    expect(within(rows[1] as HTMLElement).getByText('0')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Neuer Lieferant' })).toBeTruthy()
  })

  it('offers no new supplier to a technician', async () => {
    signedInAs('technician')
    await mount('/lieferanten')

    await screen.findByRole('table', { name: 'Alle Lieferanten des Betriebs' })
    expect(screen.queryByRole('button', { name: 'Neuer Lieferant' })).toBeNull()
  })
})

describe('a supplier', () => {
  it('shows its articles a page at a time, with the purchase price for the office', async () => {
    signedInAs('office')
    serverSays('GET', /^\/suppliers\/s-1\/articles\?offset=0&limit=25$/, sold(0, true))
    serverSays('GET', /^\/suppliers\/s-1\/articles\?offset=25&limit=25$/, sold(25, true))
    await mount('/lieferanten/s-1')

    const table = await screen.findByRole('table', { name: 'Artikel des Lieferanten' })

    await waitFor(() => {
      expect(within(table).getByText('Einkaufspreis')).toBeTruthy()
    })
    expect(within(table).getAllByText('0,54 €')).toHaveLength(25)
    expect(screen.getByText('Unsere Kundennummer dort: 448120 · 30 Artikel')).toBeTruthy()
    expect(screen.getByText('Industriestraße 24, 68169 Mannheim')).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: 'Weiter' }))
    await screen.findByText('26 bis 30 von 30')
    expect(calls.some((call) => call.path === '/suppliers/s-1/articles?offset=25&limit=25')).toBe(
      true,
    )
  })

  it('shows a technician its articles without a purchase price, and nothing to change', async () => {
    signedInAs('technician')
    serverSays('GET', /^\/suppliers\/s-1\/articles\?/, sold(0, false))
    await mount('/lieferanten/s-1')

    const table = await screen.findByRole('table', { name: 'Artikel des Lieferanten' })

    expect(within(table).queryByText('Einkaufspreis')).toBeNull()
    expect(within(table).getByText('5700100')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Bearbeiten' })).toBeNull()
  })
})

describe('the people at a supplier', () => {
  it('are kept by whoever keeps the suppliers, and hang on the supplier', async () => {
    signedInAs('office')
    serverSays('GET', /^\/suppliers\/s-1\/articles\?/, { total: 0, rows: [] })
    await mount('/lieferanten/s-1')

    const people = await screen.findByRole('region', { name: 'Ansprechpartner' })

    await userEvent.click(await within(people).findByRole('button', { name: 'Anlegen' }))
    await userEvent.type(within(people).getByLabelText(/^Nachname/), 'Stein')
    await userEvent.type(within(people).getByLabelText('Telefon'), '0621 318 40-12')
    await userEvent.click(within(people).getByRole('button', { name: 'Anlegen' }))

    await waitFor(() => {
      expect(server.operations().some((operation) => operation.entity === 'contacts')).toBe(true)
    })

    const created = server.operations().find((operation) => operation.entity === 'contacts')

    expect(
      Object.fromEntries(created?.patches.map((patch) => [patch.field, patch.to]) ?? []),
    ).toMatchObject({ supplierId: 's-1', familyName: 'Stein' })
  })

  it('are only read by a technician', async () => {
    signedInAs('technician')
    serverSays('GET', /^\/suppliers\/s-1\/articles\?/, { total: 0, rows: [] })
    server.put('contacts', {
      id: 'k-1',
      supplierId: 's-1',
      familyName: 'Stein',
      role: 'Innendienst',
    })
    await mount('/lieferanten/s-1')

    const people = await screen.findByRole('region', { name: 'Ansprechpartner' })

    expect(await within(people).findByText('Stein')).toBeTruthy()
    expect(within(people).queryByRole('button', { name: 'Anlegen' })).toBeNull()
  })
})

describe('the form of a supplier', () => {
  it('creates one through the outbox, also without a connection', async () => {
    signedInAs('office')
    await mount('/lieferanten/neu')
    server.offline = true

    await userEvent.type(await screen.findByLabelText(/^Name/), 'Leuchten Wagner GmbH')
    await userEvent.type(screen.getByLabelText(/^Unsere Kundennummer dort/), 'W-1188')
    await userEvent.type(screen.getByLabelText('Ort'), 'Ludwigshafen')
    await userEvent.click(screen.getByRole('button', { name: 'Lieferant anlegen' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toMatch(/^\/lieferanten\/[0-9a-f-]{36}$/)
    })
    expect(client.status().pending).toBe(1)

    server.offline = false
    await client.synchronise()

    const [created] = server.operations()

    expect(created?.entity).toBe('suppliers')
    expect(created?.kind).toBe('create')
    expect(
      Object.fromEntries(created?.patches.map((patch) => [patch.field, patch.to]) ?? []),
    ).toMatchObject({
      name: 'Leuchten Wagner GmbH',
      customerNumber: 'W-1188',
      city: 'Ludwigshafen',
      country: 'DE',
    })
  })

  it('refuses a customer number that is too long before anything is sent', async () => {
    signedInAs('office')
    await mount('/lieferanten/neu')

    await userEvent.type(await screen.findByLabelText(/^Name/), 'Leuchten Wagner GmbH')
    await userEvent.type(screen.getByLabelText(/^Unsere Kundennummer dort/), 'W'.repeat(41))
    await userEvent.click(screen.getByRole('button', { name: 'Lieferant anlegen' }))

    expect(await screen.findByText('Eine Kundennummer hat höchstens 40 Zeichen.')).toBeTruthy()
    expect(client.status().pending).toBe(0)
    expect(server.operations()).toHaveLength(0)
  })

  it('changes one at the route, and says so when there is no connection', async () => {
    signedInAs('office')
    await mount('/lieferanten/s-1/bearbeiten')

    const phone = await screen.findByLabelText('Telefon')

    await userEvent.clear(phone)
    await userEvent.type(phone, '0621 318 40-12')
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/lieferanten/s-1')
    })
    expect(server.patched).toHaveLength(1)
    expect(server.patched[0]?.values).toMatchObject({
      name: 'Elektro-Großhandel Rhein-Neckar GmbH',
      phone: '0621 318 40-12',
    })
    expect(server.operations()).toHaveLength(0)
  })

  it('is closed for changes while there is no connection', async () => {
    signedInAs('office')
    await mount('/lieferanten/s-1/bearbeiten')
    await screen.findByLabelText('Telefon')

    // What the browser says when the network goes, which the client listens to.
    act(() => {
      window.dispatchEvent(new Event('offline'))
    })

    expect(
      await screen.findByText(
        'Stammdaten werden nur mit Verbindung geändert. Gerade ist keine da.',
      ),
    ).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Speichern' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
  })

  it('removes one after a question, at the route', async () => {
    signedInAs('office')
    await mount('/lieferanten/s-2/bearbeiten')

    await userEvent.click(await screen.findByRole('button', { name: 'Lieferant löschen' }))

    const dialog = await screen.findByRole('alertdialog', {
      name: '„Kurpfalz Elektrohandel KG“ löschen?',
    })

    await userEvent.click(within(dialog).getByRole('button', { name: 'Löschen' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/lieferanten')
    })
    expect(server.removed).toEqual([{ entity: 'suppliers', id: 's-2' }])
  })
})
