import 'fake-indexeddb/auto'

import type { RoleKey } from '@opengewerk/domain'
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

import type { ArticlePage, ArticleView } from '../../session/articles.js'
import { SyncClient } from '../../sync/client.js'
import { SyncProvider } from '../../sync/provider.js'
import { openLocalStore } from '../../sync/store.js'
import { TestServer } from '../../sync/test-server.js'
import {
  ArticleListScreen,
  ArticleScreen,
  EditArticleScreen,
  NewArticleScreen,
} from './articles.js'

/**
 * The catalogue in the office (#296): the list page by page from the server,
 * an article with its prices and suppliers, and the form, as the boards
 * `artikel_liste()`, `artikel_akte()` and `neuer_artikel()` draw them. The
 * catalogue is not on the device, so everything here comes through `fetch`.
 */

interface Call {
  readonly path: string
  readonly method: string
  readonly body: unknown
}

type Answer = (path: string) => { readonly status: number; readonly body: unknown } | undefined

let calls: Call[]
let answers: { readonly method: string; readonly test: RegExp; readonly answer: Answer }[]
let router: ReturnType<typeof makeRouter>
let server: TestServer
let counter = 0

function serverSays(method: string, test: RegExp, body: unknown, status = 200): void {
  answers.unshift({ method, test, answer: () => ({ status, body }) })
}

function signedInAs(...roles: RoleKey[]) {
  serverSays('GET', /^\/api\/auth\/get-session$/, {
    user: { id: 'u-1', email: 'britta@nord.example.de', name: 'Britta Büro' },
    session: { activeTenantId: 't-1' },
  })
  serverSays('GET', /^\/auth\/tenants$/, [{ id: 't-1', name: 'Elektro Nord GmbH', roles }])
}

function makeRouter(path: string) {
  const root = createRootRoute()

  return createRouter({
    routeTree: root.addChildren([
      createRoute({ getParentRoute: () => root, path: '/artikel', component: ArticleListScreen }),
      createRoute({
        getParentRoute: () => root,
        path: '/artikel/neu',
        component: NewArticleScreen,
      }),
      createRoute({
        getParentRoute: () => root,
        path: '/artikel/$articleId',
        component: ArticleScreen,
      }),
      createRoute({
        getParentRoute: () => root,
        path: '/artikel/$articleId/bearbeiten',
        component: EditArticleScreen,
      }),
      createRoute({
        getParentRoute: () => root,
        path: '/lieferanten/$supplierId',
        component: () => null,
      }),
    ]),
    history: createMemoryHistory({ initialEntries: [path] }),
  })
}

/**
 * The screens with the sync client under them: the suppliers to choose from
 * are master data on the device, the catalogue is not.
 */
async function mount(path: string) {
  const client = await SyncClient.start({
    store: await openLocalStore(`artikel${String((counter += 1))}`),
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

/** The rows the list asked for, as "offset limit search". */
function listCalls(): string[] {
  return calls
    .filter((call) => call.method === 'GET' && call.path.startsWith('/articles?'))
    .map((call) => {
      const query = new URLSearchParams(call.path.slice('/articles?'.length))

      return [query.get('offset'), query.get('limit'), query.get('search') ?? ''].join(' ').trim()
    })
}

function aPage(total: number, from: number, count: number): ArticlePage {
  return {
    total,
    rows: Array.from({ length: count }, (_, index) => ({
      id: `a-${String(from + index)}`,
      number: String(1000 + from + index),
      designation: `Mantelleitung ${String(from + index)}`,
      description: null,
      unit: 'metre' as const,
      groupOfGoods: 'Kabel und Leitungen',
      frequent: index === 0,
      priceCents: 92,
      priceBase: 1 as const,
      supplierName: 'Elektro-Großhandel Rhein-Neckar GmbH',
      suppliers: 1,
    })),
  }
}

const cable: ArticleView = {
  id: 'a-1',
  number: '1042',
  designation: 'Mantelleitung NYM-J 3 × 1,5 mm²',
  description: 'Grau, im Ring zu 100 m.',
  ean: '2001042000018',
  unit: 'metre',
  groupOfGoods: 'Kabel und Leitungen',
  frequent: true,
  prices: [
    { id: 'p-3', validFrom: '2026-10-01', unitPriceCents: 98, priceBase: 1 },
    { id: 'p-2', validFrom: '2026-03-01', unitPriceCents: 92, priceBase: 1 },
    { id: 'p-1', validFrom: '2025-09-01', unitPriceCents: 89, priceBase: 1 },
  ],
  suppliers: [
    {
      id: 'l-1',
      supplierId: 's-1',
      supplierName: 'Elektro-Großhandel Rhein-Neckar GmbH',
      supplierNumber: '5700123',
      purchasePrices: [{ id: 'e-1', validFrom: '2026-03-01', unitPriceCents: 54, priceBase: 1 }],
    },
  ],
}

beforeEach(() => {
  calls = []
  answers = []
  server = new TestServer()
  server.put('suppliers', { id: 's-1', name: 'Elektro-Großhandel Rhein-Neckar GmbH' })
  server.put('suppliers', { id: 's-2', name: 'Kurpfalz Elektrohandel KG' })
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-09-28T10:00:00Z') })
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: /min-width:\s*(37\.5|64)rem/.test(query),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))

  serverSays('GET', /^\/articles\/groups$/, ['Kabel und Leitungen', 'Schutzgeräte'])
  serverSays('GET', /^\/articles\?/, aPage(0, 0, 0))

  vi.stubGlobal('fetch', (path: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'

    calls.push({
      path,
      method,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body,
    })

    const found = answers.find((entry) => entry.method === method && entry.test.test(path))
    const answer = found?.answer(path) ?? { status: 200, body: {} }

    return Promise.resolve(
      new Response(JSON.stringify(answer.body), {
        status: answer.status,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('the list of articles', () => {
  it('asks the server a page at a time, and a search starts at the first page again', async () => {
    signedInAs('office')
    answers.unshift({
      method: 'GET',
      test: /^\/articles\?/,
      answer: (path) => {
        const offset = Number(new URLSearchParams(path.split('?')[1]).get('offset'))

        return { status: 200, body: aPage(30, offset, offset === 0 ? 25 : 5) }
      },
    })
    await mount('/artikel')

    await screen.findByText('1 bis 25 von 30')
    expect(screen.getByText('30 Einträge')).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: 'Weiter' }))
    await screen.findByText('26 bis 30 von 30')
    expect((screen.getByRole('button', { name: 'Weiter' }) as HTMLButtonElement).disabled).toBe(
      true,
    )

    await userEvent.type(screen.getByLabelText('Artikel durchsuchen'), 'NYM')

    await waitFor(() => {
      expect(listCalls().at(-1)).toBe('0 25 NYM')
    })
    expect(listCalls()).toContain('25 25')
  })

  it('names the units a price is for when they are more than one (#456)', async () => {
    signedInAs('office')

    const page = aPage(2, 0, 2)

    serverSays('GET', /^\/articles\?/, {
      ...page,
      rows: [
        page.rows[0],
        {
          ...page.rows[1],
          designation: 'Kabelbinder 200 × 4,8 mm',
          unit: 'piece',
          priceCents: 350,
          priceBase: 100,
        },
      ],
    })
    await mount('/artikel')

    const table = await screen.findByRole('table', { name: 'Artikel' })
    const ties = within(table).getByText('Kabelbinder 200 × 4,8 mm').closest('tr')
    const cable = within(table).getByText('Mantelleitung 0').closest('tr')

    expect(ties?.textContent).toMatch(/3,50\s€je 100 Stk\./)
    expect(cable?.textContent).not.toContain('je ')
  })

  it('says what an empty catalogue is for, and offers a new article only to whoever keeps them', async () => {
    signedInAs('technician')
    await mount('/artikel')

    await screen.findByText(/Noch kein Artikel\./)
    expect(screen.queryByRole('button', { name: 'Neuer Artikel' })).toBeNull()
  })
})

describe('an article', () => {
  it('shows the office the purchase price of today beside the supplier', async () => {
    signedInAs('office')
    serverSays('GET', /^\/articles\/a-1$/, cable)
    await mount('/artikel/a-1')

    const suppliers = await screen.findByRole('table', { name: 'Lieferanten und Einkaufspreise' })

    expect(within(suppliers).getByText('Einkaufspreis')).toBeTruthy()
    expect(within(suppliers).getByText('0,54 €')).toBeTruthy()

    const prices = screen.getByRole('table', { name: 'Verkaufspreis' })

    expect(within(prices).getByText('Kommt')).toBeTruthy()
    expect(within(prices).getByText('Gilt')).toBeTruthy()
  })

  it('shows prices per hundred with their unit, and compares purchase prices per unit (#456)', async () => {
    signedInAs('office')
    serverSays('GET', /^\/articles\/a-1$/, {
      ...cable,
      prices: [
        { id: 'p-2', validFrom: '2026-03-01', unitPriceCents: 9200, priceBase: 100 },
        { id: 'p-1', validFrom: '2025-09-01', unitPriceCents: 89, priceBase: 1 },
      ],
      suppliers: [
        {
          ...cable.suppliers[0],
          // 0,55 € per metre.
          purchasePrices: [
            { id: 'e-1', validFrom: '2026-03-01', unitPriceCents: 55, priceBase: 1 },
          ],
        },
        {
          id: 'l-2',
          supplierId: 's-2',
          supplierName: 'Kurpfalz Elektrohandel KG',
          supplierNumber: 'NYM315-100',
          // 54,00 € per 100 metres, 0,54 € a metre: the lower one, although
          // its figure is the larger.
          purchasePrices: [
            { id: 'e-2', validFrom: '2026-06-15', unitPriceCents: 5400, priceBase: 100 },
          ],
        },
      ],
    })
    await mount('/artikel/a-1')

    const prices = await screen.findByRole('table', { name: 'Verkaufspreis' })

    // Prices for different units: the column names none, each price its own.
    expect(within(prices).getByRole('columnheader', { name: 'Preis' })).toBeTruthy()
    expect(within(prices).getByText('je 100 m')).toBeTruthy()
    expect(within(prices).getByText('je 1 m')).toBeTruthy()
    expect(screen.getByText(/gilt, mit seiner Preiseinheit\./)).toBeTruthy()

    const suppliers = screen.getByRole('table', { name: 'Lieferanten und Einkaufspreise' })

    expect(within(suppliers).getByText('54,00 €').closest('span')?.className).toContain(
      'font-semibold',
    )
    expect(within(suppliers).getByText('0,55 €').className).not.toContain('font-semibold')

    // A new price starts at the unit of the newest one, so a price per 100
    // does not become one per metre because nobody looked at "Preis je".
    await userEvent.click(screen.getByRole('button', { name: 'Neuer Preis' }))

    expect((screen.getByLabelText('Preis je') as HTMLSelectElement).value).toBe('100')

    await userEvent.click(screen.getByRole('button', { name: 'Abbrechen' }))
    await userEvent.click(screen.getByRole('button', { name: 'Kurpfalz Elektrohandel KG ändern' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Neuer Einkaufspreis' }))

    expect((screen.getByLabelText('Preis je') as HTMLSelectElement).value).toBe('100')

    await userEvent.click(screen.getByRole('button', { name: 'Abbrechen' }))
    await userEvent.click(screen.getByRole('button', { name: 'Schließen' }))
    await userEvent.click(
      screen.getByRole('button', { name: 'Elektro-Großhandel Rhein-Neckar GmbH ändern' }),
    )
    await userEvent.click(await screen.findByRole('button', { name: 'Neuer Einkaufspreis' }))

    expect((screen.getByLabelText('Preis je') as HTMLSelectElement).value).toBe('1')
  })

  it('takes a new price for a hundred units (#456)', async () => {
    signedInAs('office')
    serverSays('GET', /^\/articles\/a-1$/, cable)
    serverSays('POST', /^\/articles\/a-1\/prices$/, { id: 'p-4' })
    await mount('/artikel/a-1')

    await userEvent.click(await screen.findByRole('button', { name: 'Neuer Preis' }))
    await userEvent.type(screen.getByLabelText('Preis in Euro'), '92,00')
    await userEvent.selectOptions(screen.getByLabelText('Preis je'), '100')
    await userEvent.click(screen.getByRole('button', { name: 'Preis anlegen' }))

    await waitFor(() => {
      expect(
        calls.find((call) => call.method === 'POST' && call.path === '/articles/a-1/prices')?.body,
      ).toMatchObject({ unitPriceCents: 9200, priceBase: 100 })
    })
  })

  it('opens one supplier over the table to change its number and its purchase prices', async () => {
    signedInAs('office')
    serverSays('GET', /^\/articles\/a-1$/, {
      ...cable,
      suppliers: [
        ...cable.suppliers,
        {
          id: 'l-2',
          supplierId: 's-2',
          supplierName: 'Kurpfalz Elektrohandel KG',
          supplierNumber: 'NYM315-100',
          purchasePrices: [
            { id: 'e-2', validFrom: '2026-06-15', unitPriceCents: 57, priceBase: 1 },
          ],
        },
      ],
    })
    serverSays('PATCH', /^\/articles\/a-1\/suppliers\/l-2$/, { id: 'l-2' })
    serverSays('DELETE', /^\/articles\/a-1\/suppliers\/l-2\/prices\/e-2$/, { id: 'e-2' })
    await mount('/artikel/a-1')

    const suppliers = await screen.findByRole('table', { name: 'Lieferanten und Einkaufspreise' })

    // The lower price of today stands out where two suppliers have one.
    expect(within(suppliers).getByText('0,54 €').className).toContain('font-semibold')
    expect(within(suppliers).getByText('0,57 €').className).not.toContain('font-semibold')

    await userEvent.click(
      within(suppliers).getByRole('button', { name: 'Kurpfalz Elektrohandel KG ändern' }),
    )

    const form = await screen.findByRole('region', { name: 'Kurpfalz Elektrohandel KG ändern' })
    const number = within(form).getByLabelText('Artikelnummer dort')

    await userEvent.clear(number)
    await userEvent.type(number, 'NYM315-50')
    await userEvent.click(within(form).getByRole('button', { name: 'Nummer speichern' }))
    await userEvent.click(
      within(form).getByRole('button', { name: 'Einkaufspreis ab 15.06.2026 entfernen' }),
    )

    await waitFor(() => {
      expect(calls.some((call) => call.method === 'DELETE')).toBe(true)
    })
    expect(calls.find((call) => call.method === 'PATCH')).toMatchObject({
      path: '/articles/a-1/suppliers/l-2',
      body: { supplierNumber: 'NYM315-50' },
    })
    expect(calls.find((call) => call.method === 'DELETE')?.path).toBe(
      '/articles/a-1/suppliers/l-2/prices/e-2',
    )
  })

  it('shows a technician the suppliers without a purchase price, and nothing to change', async () => {
    signedInAs('technician')
    serverSays('GET', /^\/articles\/a-1$/, {
      ...cable,
      suppliers: cable.suppliers.map((link) => ({ ...link, purchasePrices: null })),
    })
    await mount('/artikel/a-1')

    const suppliers = await screen.findByRole('table', { name: 'Lieferanten' })

    expect(within(suppliers).queryByText('Einkaufspreis')).toBeNull()
    expect(within(suppliers).getByText('5700123')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Bearbeiten' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Neuer Preis' })).toBeNull()
  })

  it('gives a technician on a phone the article to read, as the board draws it', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
    signedInAs('technician')
    serverSays('GET', /^\/articles\/a-1$/, {
      ...cable,
      suppliers: cable.suppliers.map((link) => ({ ...link, purchasePrices: null })),
    })
    await mount('/artikel/a-1')

    expect(await screen.findByText('Gilt seit 01.03.2026')).toBeTruthy()
    expect(screen.getByText('Ab 01.10.2026')).toBeTruthy()
    expect(screen.getByText('0,92 € je Meter')).toBeTruthy()
    // What held before is no business of whoever reads it on site.
    expect(screen.queryByText('0,89 € je Meter')).toBeNull()
    expect(screen.getByText('Artikelnummer dort: 5700123')).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('opens the form on a page of its own and sends only the article', async () => {
    signedInAs('office')
    serverSays('GET', /^\/articles\/a-1$/, cable)
    serverSays('PATCH', /^\/articles\/a-1$/, { id: 'a-1' })
    await mount('/artikel/a-1')

    await userEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }))
    await screen.findByRole('heading', { name: 'Mantelleitung NYM-J 3 × 1,5 mm² bearbeiten' })

    const designation = screen.getByLabelText('Bezeichnung')

    await userEvent.clear(designation)
    await userEvent.type(designation, 'Mantelleitung NYM-J 3 × 1,5 mm², Ring 50 m')
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/artikel/a-1')
    })

    const patch = calls.find((call) => call.method === 'PATCH')

    expect(patch?.path).toBe('/articles/a-1')
    expect(patch?.body).toMatchObject({
      number: '1042',
      designation: 'Mantelleitung NYM-J 3 × 1,5 mm², Ring 50 m',
      frequent: true,
    })
    expect(patch?.body).not.toHaveProperty('price')
  })
})

describe('a new article', () => {
  it('refuses an EAN with a wrong check digit before anything is sent', async () => {
    signedInAs('office')
    serverSays('POST', /^\/articles$/, { id: 'a-9' })
    await mount('/artikel/neu')

    await userEvent.type(await screen.findByLabelText(/^Nummer/), '1045')
    await userEvent.type(screen.getByLabelText(/^Bezeichnung/), 'Mantelleitung NYM-J 3 × 2,5 mm²')
    await userEvent.type(screen.getByLabelText('EAN'), '2001042000019')
    await userEvent.click(screen.getByRole('button', { name: 'Artikel anlegen' }))

    expect(await screen.findByText('Die Prüfziffer der EAN stimmt nicht.')).toBeTruthy()
    expect(calls.some((call) => call.method === 'POST')).toBe(false)

    await userEvent.clear(screen.getByLabelText('EAN'))
    await userEvent.type(screen.getByLabelText('EAN'), '2001042000018')
    await userEvent.type(screen.getByLabelText('Preis in Euro'), '1,34')
    await userEvent.click(screen.getByRole('button', { name: 'Artikel anlegen' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/artikel/a-9')
    })
    expect(calls.find((call) => call.method === 'POST')?.body).toMatchObject({
      number: '1045',
      ean: '2001042000018',
      frequent: false,
      price: { unitPriceCents: 134, validFrom: '2026-09-28' },
    })
  })

  it('is not there for whoever may not keep the catalogue', async () => {
    signedInAs('technician')
    await mount('/artikel/neu')

    expect(await screen.findByText(/Artikel anlegen darf dieser Zugang nicht/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Artikel anlegen' })).toBeNull()
  })
})
