import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { InRouter } from '../in-router.js'
import { InProbe } from '../probe-application.js'
import type { StockRow } from '../session/stock.js'
import { type StockScreenProps, StoreScreen, StoresScreen } from './stock.js'

/**
 * The stores of the office as the foundation draws them (ADR 0011,
 * opengewerk#298): the list with what lies below the minimum and below zero,
 * one store with its stock and bookings, and the bookings the office makes.
 * The words of the bookings and whether one may book are the application's.
 */

interface Call {
  readonly path: string
  readonly method: string
  readonly body: unknown
}

let calls: Call[]
let answers: Map<string, { status: number; body: unknown }>

function serverSays(method: string, path: string, body: unknown, status = 200): void {
  answers.set(`${method} ${path}`, { status, body })
}

function sent(method: string, path: string): unknown[] {
  return calls.filter((call) => call.method === method && call.path === path).map((c) => c.body)
}

function inQueries(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  return (
    <QueryClientProvider client={client}>
      <InProbe>
        <InRouter>{node}</InRouter>
      </InProbe>
    </QueryClientProvider>
  )
}

const screenProps: Omit<StockScreenProps, 'mayWrite'> = {
  words: {
    kinds: {
      receipt: 'Zugang',
      withdrawal: 'Abgang',
      transfer_in: 'Umlagerung',
      transfer_out: 'Umlagerung',
      count: 'Zählung',
    },
    unit: (unit) => (unit === 'metre' ? 'm' : 'Stk.'),
  },
  paths: { stores: '/lager', store: (id) => `/lager/${id}`, article: (id) => `/artikel/${id}` },
  vehicles: true,
}

const cable: StockRow = {
  articleId: 'a-1042',
  number: '1042',
  designation: 'Mantelleitung NYM-J 3 × 1,5 mm²',
  unit: 'metre',
  storeArticleId: 's-a-1',
  bin: 'Fach 1',
  minimumMilli: 50_000,
  levelMilli: -12_000,
}

const breaker: StockRow = {
  articleId: 'a-2101',
  number: '2101',
  designation: 'Leitungsschutzschalter B16, 1-polig',
  unit: 'piece',
  storeArticleId: 's-a-2',
  bin: 'Schublade 2',
  minimumMilli: 6000,
  levelMilli: 4000,
}

beforeEach(() => {
  calls = []
  answers = new Map()
  serverSays('GET', '/stores', [
    {
      id: 'store',
      name: 'Lager Edingen',
      location: null,
      vehicle: false,
      plate: null,
      articles: 214,
      belowMinimum: 3,
      belowZero: 0,
    },
    {
      id: 'van',
      name: 'Transporter HD-OG 412',
      location: null,
      vehicle: true,
      plate: 'HD-OG 412',
      articles: 38,
      belowMinimum: 1,
      belowZero: 1,
    },
  ])
  serverSays('GET', '/stores/van', {
    id: 'van',
    name: 'Transporter HD-OG 412',
    location: null,
    vehicle: true,
    plate: 'HD-OG 412',
    stock: [cable, breaker],
  })
  serverSays('GET', '/stores/store', {
    id: 'store',
    name: 'Lager Edingen',
    location: null,
    vehicle: false,
    plate: null,
    stock: [{ ...cable, levelMilli: 240_000, minimumMilli: null }],
  })
  serverSays('GET', '/stores/van/movements?offset=0&limit=20', {
    total: 1,
    rows: [
      {
        id: 'm-1',
        kind: 'transfer_in',
        quantity_milli: 35_000,
        created_at: '2026-10-30T15:40:00.000Z',
        booked_by: 'britta',
        reason: null,
        article_number: '1042',
        article_designation: cable.designation,
        article_unit: 'metre',
        counterpart_name: 'Lager Edingen',
        supplier_name: null,
      },
    ],
  })

  vi.stubGlobal('fetch', (path: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'

    calls.push({
      path,
      method,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body,
    })

    const answer = answers.get(`${method} ${path}`) ?? { status: 200, body: {} }

    return Promise.resolve(
      new Response(JSON.stringify(answer.body), {
        status: answer.status,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the stores', () => {
  it('list each with its kind, below the minimum and below zero, and offer a new one to whoever may book', async () => {
    render(inQueries(<StoresScreen {...screenProps} mayWrite />))

    const table = await screen.findByRole('table')
    const van = (await within(table).findByRole('link', { name: 'Transporter HD-OG 412' })).closest(
      'tr',
    ) as HTMLElement

    expect(within(van).getByText('Fahrzeug, HD-OG 412')).toBeTruthy()
    expect(within(van).getAllByText('1')).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Neuer Lagerort' })).toBeTruthy()
  })

  it('offer nothing to book to whoever may not', async () => {
    render(inQueries(<StoresScreen {...screenProps} mayWrite={false} />))

    await screen.findByRole('link', { name: 'Lager Edingen' })
    expect(screen.queryByRole('button', { name: 'Neuer Lagerort' })).toBeNull()
  })

  it('make a vehicle with its number plate', async () => {
    serverSays('POST', '/stores', { id: 'caddy' }, 201)
    render(inQueries(<StoresScreen {...screenProps} mayWrite />))

    await userEvent.click(await screen.findByRole('button', { name: 'Neuer Lagerort' }))
    await userEvent.type(screen.getByLabelText('Bezeichnung'), 'Caddy')
    await userEvent.click(screen.getByLabelText('Servicefahrzeug'))
    await userEvent.type(screen.getByLabelText('Kennzeichen'), 'HD-OG 77')
    await userEvent.click(screen.getByRole('button', { name: 'Anlegen' }))

    await waitFor(() => {
      expect(sent('POST', '/stores')).toEqual([
        { name: 'Caddy', location: '', vehicle: true, plate: 'HD-OG 77' },
      ])
    })
  })
})

describe('a store', () => {
  it('warns of what lies below zero, shows its stock and its bookings in the words of the application', async () => {
    render(
      inQueries(
        <StoreScreen
          {...screenProps}
          mayWrite
          storeId="van"
          findArticles={() => Promise.resolve([])}
        />,
      ),
    )

    expect(await screen.findByText(/steht bei -12 m/)).toBeTruthy()
    expect(screen.getByText('Unter Mindestbestand')).toBeTruthy()
    expect(await screen.findByText('aus Lager Edingen')).toBeTruthy()
    expect(screen.getByText('Umlagerung')).toBeTruthy()
  })

  it('moves an article in from another store, out of that one', async () => {
    serverSays('POST', '/stores/store/transfers', [{}, {}], 201)
    render(
      inQueries(
        <StoreScreen
          {...screenProps}
          mayWrite
          storeId="van"
          findArticles={() => Promise.resolve([])}
        />,
      ),
    )

    await userEvent.click(await screen.findByRole('button', { name: 'Umlagern' }))
    // The article first, then the stores that hold it, each with its stock.
    await userEvent.selectOptions(screen.getByLabelText('Artikel'), 'a-1042')
    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Lager Edingen, Bestand 240 m' })).toBeTruthy()
    })
    await userEvent.selectOptions(screen.getByLabelText('Aus'), 'store')
    await userEvent.type(screen.getByLabelText('Menge'), '50')
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Umlagern' }),
    )

    await waitFor(() => {
      expect(sent('POST', '/stores/store/transfers')).toEqual([
        { articleId: 'a-1042', quantityMilli: 50_000, toStoreId: 'van' },
      ])
    })
  })

  it('counts with a reason and sets the stock to what was found', async () => {
    serverSays('POST', '/stores/van/counts', {}, 201)
    render(
      inQueries(
        <StoreScreen
          {...screenProps}
          mayWrite
          storeId="van"
          findArticles={() => Promise.resolve([])}
        />,
      ),
    )

    await screen.findByText(/steht bei -12 m/)
    // The one at the head; the warning offers its own, for the article it names.
    await userEvent.click(screen.getAllByRole('button', { name: 'Zählen' })[0] as HTMLElement)
    await userEvent.selectOptions(screen.getByLabelText('Artikel'), 'a-1042')
    await userEvent.type(screen.getByLabelText('Gezählt'), '8')
    await userEvent.type(screen.getByLabelText('Grund'), 'Rolle nachgemessen')
    await userEvent.click(screen.getByRole('button', { name: 'Bestand setzen' }))

    await waitFor(() => {
      expect(sent('POST', '/stores/van/counts')).toEqual([
        { articleId: 'a-1042', quantityMilli: 8000, reason: 'Rolle nachgemessen' },
      ])
    })
  })

  it('offers nothing to book to whoever may not', async () => {
    render(
      inQueries(
        <StoreScreen
          {...screenProps}
          mayWrite={false}
          storeId="van"
          findArticles={() => Promise.resolve([])}
        />,
      ),
    )

    await screen.findByText(/steht bei -12 m/)
    expect(screen.queryByRole('button', { name: 'Zugang buchen' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Zählen' })).toBeNull()
  })
})
