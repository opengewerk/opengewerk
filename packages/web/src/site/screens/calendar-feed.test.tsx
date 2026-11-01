import 'fake-indexeddb/auto'

import { openLocalStore, SyncProvider } from '@opengewerk/platform-web/sync'
import { TestServer } from '@opengewerk/platform-web/testing'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SyncClient } from '../../sync/client.js'
import { SiteCalendarPanel } from './calendar-feed.js'

/**
 * The own appointments in the calendar of the phone (#291): an address made
 * on asking and shown this once, with the way into the calendar of the phone;
 * set up, it says so without the address; a new one and the end only after a
 * question; nothing without a network.
 */

let answers: Map<string, { status: number; body: unknown }>
let sent: { method: string; path: string }[]
let counter = 0

const address =
  'https://opengewerk.example.de/calendar/r7Kq2VnX0bLw9tJc4ZpE1sYhU8mDfG3aNo6iQ5kWvTy.ics'

function answer(method: string, path: string, body: unknown, status = 200) {
  answers.set(`${method} ${path}`, { status, body })
}

async function mount() {
  const server = new TestServer()
  const client = await SyncClient.start({
    store: await openLocalStore(`kalender${String((counter += 1))}`),
    transport: server,
    writer: server,
    deviceId: 'telefon',
    entities: [],
    onSignedOut: () => {},
  })

  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <SyncProvider client={client}>
        <SiteCalendarPanel />
      </SyncProvider>
    </QueryClientProvider>,
  )

  return within(screen.getByRole('region', { name: 'Kalender-Abo' }))
}

beforeEach(() => {
  answers = new Map()
  sent = []
  vi.stubGlobal('fetch', (path: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'

    if (method !== 'GET') {
      sent.push({ method, path })
    }

    const found = answers.get(`${method} ${path}`)

    return Promise.resolve(
      new Response(found?.status === 204 ? null : JSON.stringify(found?.body ?? {}), {
        status: found?.status ?? 404,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('the calendar on site', () => {
  it('makes an address on asking and shows it this once, with the way into the calendar of the phone', async () => {
    answer('GET', '/calendar/feed', { since: null })
    answer('POST', '/calendar/feed', { address, since: '2026-11-05T06:00:00.000Z' }, 201)

    const card = await mount()

    expect(
      card.getByText(
        'Wer die Adresse kennt, sieht deine Termine mit Kunde und Anschrift. Gib sie nicht weiter.',
      ),
    ).toBeTruthy()
    expect(card.queryByRole('status', { name: 'Deine Adresse' })).toBeNull()

    await userEvent.click(await card.findByRole('button', { name: 'Adresse erstellen' }))

    expect(await card.findByText(address)).toBeTruthy()
    expect(sent).toEqual([{ method: 'POST', path: '/calendar/feed' }])
    expect(card.getByRole('link', { name: 'Im Kalender öffnen' }).getAttribute('href')).toBe(
      'webcal://opengewerk.example.de/calendar/r7Kq2VnX0bLw9tJc4ZpE1sYhU8mDfG3aNo6iQ5kWvTy.ics',
    )
    expect(card.getByText('Eingerichtet am 05.11.2026')).toBeTruthy()
    expect(
      card.getByText(
        'Die Adresse steht nur jetzt hier. Brauchst du sie später wieder, erstellst du eine neue; die alte hört dann auf.',
      ),
    ).toBeTruthy()
  })

  it('says it is set up without showing an address it no longer has', async () => {
    answer('GET', '/calendar/feed', { since: '2026-11-01T09:00:00.000Z' })

    const card = await mount()

    expect(await card.findByText('Eingerichtet am 01.11.2026')).toBeTruthy()
    expect(card.queryByText(/\/calendar\//)).toBeNull()
    expect(card.queryByRole('button', { name: 'Adresse erstellen' })).toBeNull()
  })

  it('makes a new address only after asking, which ends the one before', async () => {
    answer('GET', '/calendar/feed', { since: '2026-11-01T09:00:00.000Z' })
    answer('POST', '/calendar/feed', { address, since: '2026-11-05T06:00:00.000Z' }, 201)

    const card = await mount()

    await userEvent.click(await card.findByRole('button', { name: 'Neue Adresse' }))

    const question = screen.getByRole('alertdialog', { name: 'Neue Adresse erstellen?' })

    expect(sent).toEqual([])

    await userEvent.click(within(question).getByRole('button', { name: 'Neue Adresse erstellen' }))

    expect(await card.findByText(address)).toBeTruthy()
    expect(sent).toEqual([{ method: 'POST', path: '/calendar/feed' }])
  })

  it('ends the subscription only after asking', async () => {
    answer('GET', '/calendar/feed', { since: '2026-11-01T09:00:00.000Z' })
    answer('DELETE', '/calendar/feed', null, 204)

    const card = await mount()

    await userEvent.click(await card.findByRole('button', { name: 'Abo beenden' }))

    const question = screen.getByRole('alertdialog', { name: 'Abo beenden?' })

    expect(sent).toEqual([])

    await userEvent.click(within(question).getByRole('button', { name: 'Abo beenden' }))

    await waitFor(() => {
      expect(sent).toEqual([{ method: 'DELETE', path: '/calendar/feed' }])
    })
    expect(await card.findByRole('button', { name: 'Adresse erstellen' })).toBeTruthy()
  })

  it('makes no address without a network, and says so', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)

    const card = await mount()

    expect(card.getByText('Zum Einrichten braucht es Netz.')).toBeTruthy()
    expect(
      (card.getByRole('button', { name: 'Adresse erstellen' }) as HTMLButtonElement).disabled,
    ).toBe(true)
    expect(sent).toEqual([])
  })
})
