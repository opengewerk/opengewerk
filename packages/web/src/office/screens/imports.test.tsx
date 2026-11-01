import 'fake-indexeddb/auto'
import { createHash } from 'node:crypto'

import type { ArticleImport, ImportSummary, RoleKey } from '@opengewerk/domain'
import { SyncProvider, openLocalStore } from '@opengewerk/platform-web/sync'
import { TestServer } from '@opengewerk/platform-web/testing'
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'
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
import { ImportScreen, NewImportScreen } from './imports.js'
import { SupplierScreen } from './suppliers.js'

/**
 * The screens of an import from DATANORM (#297), as the boards of version 79
 * draw them: the imports at the supplier, the files of a delivery going up one
 * after another, the preview with the selling prices of the markup or the
 * sentence that without one none comes about, the takeover and its progress,
 * and why an import broke off. Only for whoever keeps purchase prices.
 */

interface Call {
  readonly path: string
  readonly method: string
  readonly body?: unknown
}

let calls: Call[]
let answers: { readonly method: string; readonly test: RegExp; readonly body: unknown }[]
let server: TestServer
let counter = 0
let uploads: { readonly path: string; readonly size: number }[]

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

async function mount(path: string) {
  const client = await SyncClient.start({
    store: await openLocalStore(`importe${String((counter += 1))}`),
    transport: server,
    writer: server,
    deviceId: 'office-computer',
    entities: ['suppliers', 'contacts'],
    onSignedOut: () => {},
  })

  await client.synchronise()

  const root = createRootRoute()
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({
        getParentRoute: () => root,
        path: '/lieferanten/$supplierId',
        component: SupplierScreen,
      }),
      createRoute({
        getParentRoute: () => root,
        path: '/lieferanten/$supplierId/import',
        component: NewImportScreen,
      }),
      createRoute({
        getParentRoute: () => root,
        path: '/lieferanten/$supplierId/import/$importId',
        component: ImportScreen,
      }),
      createRoute({
        getParentRoute: () => root,
        path: '/einstellungen/aufschlag',
        component: () => null,
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

  return router
}

const summary: ImportSummary = {
  articles: 1284,
  created: 1032,
  linked: 18,
  updated: 214,
  unchanged: 12,
  removed: 8,
  renumbered: 3,
  shortCode: 'EGRN',
  sellingPrices: 1264,
  markup: 2200,
  unknownUnits: [{ text: 'Rol', articles: 2 }],
  problems: 1,
  problemLines: [{ file: 'DATANORM.001', line: 4711, reason: 'Der Preis ist keine Zahl.' }],
  files: [{ name: 'DATANORM.001', charset: 'cp850', lines: 1712 }],
  skipped: ['Liesmich.pdf'],
  longTextFiles: ['DATANORM.T01'],
  ignored: [{ letter: 'J', lines: 412 }],
  metals: [
    { metal: 'copper', articles: 312 },
    { metal: 'aluminium', articles: 18 },
    { metal: 'silver', articles: 41 },
    { metal: 'brass', articles: 6 },
  ],
  metalTables: [
    { metal: 'copper', articles: 96 },
    { metal: 'silver', articles: 104 },
    { metal: 'brass', articles: 31 },
  ],
  fileDate: '2026-10-01',
  samples: [
    {
      kind: 'created',
      supplierNumber: '5700131',
      number: '5700131',
      renumbered: false,
      designation: 'Mantelleitung NYM-J 5 × 2,5 mm²',
      unit: 'metre',
      listPrice: { cents: 138_000, priceBase: 1000 },
      netPrice: null,
      previousListPrice: null,
      sellingPrice: { cents: 168_360, priceBase: 1000 },
    },
    {
      kind: 'updated',
      supplierNumber: '5700123',
      number: '1042',
      renumbered: false,
      designation: 'Mantelleitung NYM-J 3 × 1,5 mm²',
      unit: 'metre',
      listPrice: { cents: 54_000, priceBase: 1000 },
      netPrice: null,
      previousListPrice: { cents: 52_600, priceBase: 1000 },
      sellingPrice: { cents: 65_880, priceBase: 1000 },
    },
  ],
}

function anImport(
  changes: Partial<Omit<ArticleImport, 'id'>> & { readonly id?: string } = {},
): ArticleImport {
  return {
    id: 'i-1',
    supplierId: 's-1',
    status: 'ready',
    files: [{ name: 'DATANORM.001', sha256: 'a'.repeat(64), bytes: 120_000 }],
    charset: null,
    validFrom: '2026-10-30',
    summary,
    problem: null,
    createdAt: '2026-10-30T09:12:00.000Z',
    appliedAt: null,
    progress: null,
    ...changes,
  } as ArticleImport
}

/** The stand in for a browser sending a file: it records the request and says yes. */
class FakeRequest {
  readonly upload: { onprogress: ((event: ProgressEvent) => void) | null } = { onprogress: null }
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  status = 0
  responseText = ''
  withCredentials = false
  private path = ''

  open(_method: string, path: string) {
    this.path = path
  }

  setRequestHeader() {}

  send(body: Blob) {
    uploads.push({ path: this.path, size: body.size })
    this.upload.onprogress?.({ lengthComputable: true, loaded: 1, total: 2 } as ProgressEvent)
    this.status = 200
    this.responseText = '{}'
    setTimeout(() => this.onload?.(), 0)
  }
}

beforeEach(() => {
  calls = []
  answers = []
  uploads = []
  server = new TestServer()
  server.put('suppliers', {
    id: 's-1',
    name: 'Elektro-Großhandel Rhein-Neckar GmbH',
    customerNumber: '448120',
    country: 'DE',
  })
  serverSays('GET', /^\/suppliers\/s-1\/(articles|metal-prices)\?/, {
    total: 0,
    current: [],
    rows: [],
  })
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: /min-width:\s*(37\.5|64)rem/.test(query),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
  vi.stubGlobal('XMLHttpRequest', FakeRequest)
  vi.stubGlobal('fetch', (path: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'

    calls.push({
      path,
      method,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    })

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
  onlineManager.setOnline(true)
})

describe('the imports at a supplier', () => {
  it('lists them, each opened by its date, and offers to read a new delivery', async () => {
    signedInAs('office')
    serverSays('GET', /^\/suppliers\/s-1\/imports$/, [
      anImport(),
      anImport({ id: 'i-0', status: 'applied', createdAt: '2026-09-01T08:00:00.000Z' }),
    ])
    const router = await mount('/lieferanten/s-1')

    const table = await screen.findByRole('table', { name: 'Importe des Lieferanten' })

    await waitFor(() => {
      expect(within(table).getByText('Vorschau bereit')).toBeTruthy()
    })
    expect(within(table).getByText('Übernommen')).toBeTruthy()
    expect(within(table).getAllByText('1.284')).toHaveLength(2)

    await userEvent.click(within(table).getByRole('link', { name: '01.09.2026' }))
    expect(router.state.location.pathname).toBe('/lieferanten/s-1/import/i-0')
  })

  it('are not shown to whoever reads purchase prices but does not keep them', async () => {
    // The office without "purchase.write": the markup and the metal prices, no import.
    const office = aTenantChoice(['office'])

    serverSays('GET', /^\/api\/auth\/get-session$/, {
      user: { id: 'u-1', email: 'britta@nord.example.de', name: 'Britta Büro' },
      session: { activeTenantId: 't-1' },
    })
    serverSays('GET', /^\/auth\/tenants$/, [
      { ...office, rights: office.rights.filter((right) => right !== 'purchase.write') },
    ])
    await mount('/lieferanten/s-1')

    await screen.findByRole('table', { name: 'Metallpreise des Lieferanten' })
    expect(screen.queryByRole('button', { name: 'Dateien einlesen' })).toBeNull()
    expect(calls.some((call) => call.path.endsWith('/imports'))).toBe(false)
  })
})

describe('the files of a delivery', () => {
  it('go up one after another under their hash, and reading starts once all are up', async () => {
    signedInAs('office')
    serverSays(
      'POST',
      /^\/suppliers\/s-1\/imports$/,
      anImport({ status: 'reading', summary: null }),
    )
    serverSays(
      'GET',
      /^\/suppliers\/s-1\/imports\/i-1$/,
      anImport({ status: 'reading', summary: null }),
    )
    const router = await mount('/lieferanten/s-1/import')
    const person = userEvent.setup()

    const first = new File(['A;N;5700123;00;Mantelleitung'], 'DATANORM.001')
    const second = new File(['P;A;5700123;1;99500'], 'DATPREIS.001')
    const hash = (content: string) => createHash('sha256').update(content).digest('hex')

    await person.upload(
      await screen.findByLabelText('Dateien der Lieferung', { selector: 'input' }),
      [first, second],
    )

    await waitFor(() => {
      expect(screen.getAllByText('Hochgeladen')).toHaveLength(2)
    })
    expect(uploads.map((upload) => upload.path)).toEqual([
      `/suppliers/s-1/imports/files/${hash('A;N;5700123;00;Mantelleitung')}`,
      `/suppliers/s-1/imports/files/${hash('P;A;5700123;1;99500')}`,
    ])

    await person.click(screen.getByRole('button', { name: 'Einlesen' }))

    await waitFor(() => {
      expect(calls.find((call) => call.method === 'POST')?.body).toEqual({
        files: [
          { name: 'DATANORM.001', sha256: hash('A;N;5700123;00;Mantelleitung') },
          { name: 'DATPREIS.001', sha256: hash('P;A;5700123;1;99500') },
        ],
      })
    })
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/lieferanten/s-1/import/i-1')
    })
  })

  it('refuse a file larger than an import takes, before it goes up', async () => {
    signedInAs('office')
    await mount('/lieferanten/s-1/import')

    const huge = new File(['x'], 'Sortiment.zip')

    Object.defineProperty(huge, 'size', { value: 200_000_001 })
    await userEvent.upload(
      await screen.findByLabelText('Dateien der Lieferung', { selector: 'input' }),
      huge,
    )

    expect(
      await screen.findByText('Größer als 200 MB, das nimmt ein Import nicht an.'),
    ).toBeTruthy()
    expect(uploads).toEqual([])
    expect((screen.getByRole('button', { name: 'Einlesen' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
  })
})

describe('the preview of an import', () => {
  it('shows what the import would do, the selling prices of the markup, what is left out, and takes it over', async () => {
    signedInAs('office')
    serverSays('GET', /^\/suppliers\/s-1\/imports\/i-1$/, anImport())
    serverSays('POST', /^\/suppliers\/s-1\/imports\/i-1\/apply$/, anImport({ status: 'applying' }))
    await mount('/lieferanten/s-1/import/i-1')

    expect(await screen.findByText('Vorschau bereit')).toBeTruthy()
    expect(screen.getByText('Lieferung vom 01.10.2026 · eingelesen am 30.10.2026')).toBeTruthy()
    expect(screen.getByText('1.032')).toBeTruthy()
    expect(
      screen.getAllByText(
        (_, element) =>
          element?.textContent ===
          'Aus den Einkaufspreisen entstehen 1.264 Verkaufspreise mit dem Aufschlag von 22 %. Artikel mit festem Verkaufspreis behalten ihn.',
      ).length,
    ).toBeGreaterThan(0)

    const samples = screen.getByRole('table', { name: 'Eine Auswahl der Artikel des Imports' })

    expect(within(samples).getByText('Mantelleitung NYM-J 3 × 1,5 mm²')).toBeTruthy()
    expect(within(samples).getByText('Neuer Preis')).toBeTruthy()
    expect(
      screen.getByText('DATANORM.T01 bringt nur Langtexte und wird nicht gebraucht.'),
    ).toBeTruthy()
    expect(screen.getByText('J-Sätze: 412 Zeilen.')).toBeTruthy()
    // The metals that come along, and the surcharge tables that do not (#782).
    expect(
      screen.getByText(
        (_, element) =>
          element?.tagName === 'P' &&
          element.textContent ===
            'Metall kommt mit: Kupfer bei 312, Aluminium bei 18, Silber bei 41 und Messing bei 6 Artikeln. ' +
              'Einen Metallzuschlag gibt es nur für ein Metall, für das beim Lieferanten ein Metallpreis steht.',
      ),
    ).toBeTruthy()
    expect(
      screen.getByText(
        'Kupfer bei 96, Silber bei 104 und Messing bei 31 Artikeln. Eine Staffel aus den Z-Sätzen wird noch nicht übernommen.',
      ),
    ).toBeTruthy()
    expect(screen.getByText('„Rol“ bei 2 Artikeln; sie kommen in Stück.')).toBeTruthy()
    expect(screen.getByText('DATANORM.001, Zeile 4.711: Der Preis ist keine Zahl.')).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: 'Übernehmen' }))

    await waitFor(() => {
      expect(calls.some((call) => call.method === 'POST' && call.path.endsWith('/apply'))).toBe(
        true,
      )
    })
    expect(await screen.findByText('Wird übernommen')).toBeTruthy()
  })

  it('says that without a markup no selling price comes about', async () => {
    signedInAs('office')
    serverSays(
      'GET',
      /^\/suppliers\/s-1\/imports\/i-1$/,
      anImport({ summary: { ...summary, markup: null, sellingPrices: 0 } }),
    )
    await mount('/lieferanten/s-1/import/i-1')

    expect(await screen.findByText('Ohne Aufschlag entsteht kein Verkaufspreis.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Aufschlag einstellen' })).toBeTruthy()
  })

  it('reads the files again with other characters, and is thrown away', async () => {
    signedInAs('office')
    serverSays('GET', /^\/suppliers\/s-1\/imports\/i-1$/, anImport())
    serverSays('PATCH', /^\/suppliers\/s-1\/imports\/i-1$/, anImport({ status: 'reading' }))
    serverSays(
      'POST',
      /^\/suppliers\/s-1\/imports\/i-1\/discard$/,
      anImport({ status: 'discarded' }),
    )
    await mount('/lieferanten/s-1/import/i-1')

    await userEvent.selectOptions(await screen.findByLabelText('Zeichensatz'), 'cp850')
    await userEvent.click(screen.getByRole('button', { name: 'Neu einlesen' }))

    await waitFor(() => {
      expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({
        validFrom: '2026-10-30',
        charset: 'cp850',
      })
    })
  })

  it('throws the preview away', async () => {
    signedInAs('office')
    serverSays('GET', /^\/suppliers\/s-1\/imports\/i-1$/, anImport())
    serverSays(
      'POST',
      /^\/suppliers\/s-1\/imports\/i-1\/discard$/,
      anImport({ status: 'discarded' }),
    )
    await mount('/lieferanten/s-1/import/i-1')

    await userEvent.click(await screen.findByRole('button', { name: 'Verwerfen' }))

    expect(await screen.findByText('Verworfen')).toBeTruthy()
    expect(screen.getByText('Was der Import getan hätte')).toBeTruthy()
    expect(calls.some((call) => call.method === 'POST' && call.path.endsWith('/apply'))).toBe(false)
  })
})

describe('an import at work and after it', () => {
  it('shows how far the takeover is', async () => {
    signedInAs('office')
    serverSays(
      'GET',
      /^\/suppliers\/s-1\/imports\/i-1$/,
      anImport({ status: 'applying', progress: { done: 38, total: 100 } }),
    )
    await mount('/lieferanten/s-1/import/i-1')

    expect(await screen.findByText('38 % übernommen')).toBeTruthy()
    expect(
      screen.getByRole('progressbar', { name: 'Übernahme' }).getAttribute('aria-valuenow'),
    ).toBe('38')
    expect(screen.queryByRole('button', { name: 'Übernehmen' })).toBeNull()
  })

  it('says why it broke off, and offers to read the files again', async () => {
    signedInAs('office')
    serverSays(
      'GET',
      /^\/suppliers\/s-1\/imports\/i-1$/,
      anImport({
        status: 'failed',
        summary: null,
        problem:
          'Die Übernahme ist abgebrochen. Übernommen wurde nichts, die Artikel sind, wie sie waren.',
      }),
    )
    await mount('/lieferanten/s-1/import/i-1')

    expect(
      await screen.findByText(
        'Die Übernahme ist abgebrochen. Übernommen wurde nichts, die Artikel sind, wie sie waren.',
      ),
    ).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Dateien neu einlesen' })).toBeTruthy()
  })

  it('is not shown to whoever does not keep purchase prices', async () => {
    signedInAs('technician')
    await mount('/lieferanten/s-1/import/i-1')

    expect(
      await screen.findByText('Einen Import aus DATANORM darf nur, wer Einkaufspreise pflegt.'),
    ).toBeTruthy()
    expect(calls.some((call) => call.path.includes('/imports'))).toBe(false)
  })
})
