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
import { HistoryPanel } from './history.js'

/**
 * The card "Verlauf" (#313): the appointments to come on top, the history
 * newest first with who and where, and the two dialogs that write a call and
 * a note down, for whoever keeps customers.
 */

let server: TestServer
let counter = 0
let rights: readonly string[] | null = null
const posted: { path: string; body: unknown }[] = []

const sites: RecordState[] = [
  { id: 's-1', customerId: 'c-1', designation: 'Rheinstraße 12' },
  { id: 's-2', customerId: 'c-1', designation: 'Wohnpark Neckarau, Haus 3' },
]

const items = [
  {
    type: 'appointment',
    at: '2999-11-09T07:00:00.000Z',
    endsAt: '2999-11-09T09:00:00.000Z',
    id: 'a-1',
    jobId: 'j-1',
    jobDesignation: 'Störung Treppenhauslicht',
    siteId: 's-1',
    userIds: ['jonas'],
    series: false,
  },
  {
    type: 'appointment',
    at: '2026-10-28T07:00:00.000Z',
    endsAt: '2026-10-28T10:30:00.000Z',
    id: 'a-2',
    jobId: 'j-2',
    jobDesignation: 'Prüfung Haus 3',
    siteId: 's-2',
    userIds: ['jonas'],
    series: false,
  },
  {
    type: 'entry',
    at: '2026-11-04T08:12:00.000Z',
    entry: {
      id: 'e-1',
      customerId: 'c-1',
      siteId: 's-1',
      kind: 'call',
      direction: 'incoming',
      counterpart: 'Sabine Keller',
      text: 'Das Treppenhauslicht flackert wieder.',
      happenedAt: '2026-11-04T08:12:00.000Z',
      createdBy: 'britta',
    },
  },
  {
    type: 'mail',
    at: '2026-10-23T09:02:00.000Z',
    id: 'm-1',
    kind: 'document',
    subject: 'Angebot AN-2026-0436',
    recipient: 'buchhaltung@hv-sued.de',
    status: 'sent',
    siteId: null,
  },
]

async function mount(subject: { customerId: string } | { siteId: string }) {
  const client = await SyncClient.start({
    store: await openLocalStore(`history${String((counter += 1))}`),
    transport: server,
    writer: server,
    deviceId: 'office',
    entities: ['customers', 'sites'],
    onSignedOut: () => {},
  })

  await client.synchronise()

  const root = createRootRoute()
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({
        getParentRoute: () => root,
        path: '/',
        component: () => (
          <HistoryPanel
            subject={subject}
            customerId="c-1"
            sites={'siteId' in subject ? [sites[0] as RecordState] : sites}
          />
        ),
      }),
    ]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
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
}

beforeEach(() => {
  server = new TestServer()
  posted.length = 0
  rights = null

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
      return answer(200, [
        aTenantChoice(['office'], rights === null ? {} : { rights: [...rights] }),
      ])
    }

    if (path === '/tasks/assignees') {
      return answer(200, [
        { userId: 'jonas', name: 'Jonas Weber' },
        { userId: 'britta', name: 'Britta Büro' },
      ])
    }

    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>

      posted.push({ path, body })

      return answer(201, { id: 'e-9', ...body })
    }

    if (path.startsWith('/communications?')) {
      return answer(200, path.includes('siteId') ? items.slice(2, 3) : items)
    }

    return answer(404, {})
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the history at a customer (#313)', () => {
  it('shows the appointment to come on top, and below the history newest first with who and where', async () => {
    await mount({ customerId: 'c-1' })

    const coming = await screen.findByRole('region', { name: 'Kommt' })

    expect(within(coming).getByRole('link', { name: 'Störung Treppenhauslicht' })).toBeTruthy()
    expect(within(coming).getByText(/Jonas Weber/)).toBeTruthy()

    const list = await screen.findByRole('list', { name: 'Verlauf' })
    const lines = within(list).getAllByRole('listitem')

    expect(lines.map((line) => line.textContent?.split(' · ')[0])).toEqual([
      'Anruf, eingehend',
      'Termin',
      'E-Mail',
    ])
    expect(
      within(lines[0] as HTMLElement).getByText(/Britta Büro · am Objekt Rheinstraße 12/),
    ).toBeTruthy()
    expect(
      within(lines[0] as HTMLElement).getByText(
        'Sabine Keller: Das Treppenhauslicht flackert wieder.',
      ),
    ).toBeTruthy()
    expect(within(lines[2] as HTMLElement).getByText(/Beleg, verschickt/)).toBeTruthy()
  })

  it('writes a call down with its direction, the counterpart and when it was', async () => {
    const user = userEvent.setup()

    await mount({ customerId: 'c-1' })
    await user.click(await screen.findByRole('button', { name: 'Anruf eintragen' }))

    const dialog = await screen.findByRole('dialog', { name: 'Anruf eintragen' })

    await user.click(within(dialog).getByRole('radio', { name: /Ausgehend/ }))
    await user.type(within(dialog).getByLabelText('Gesprächspartner'), 'Sabine Keller')
    await user.selectOptions(within(dialog).getByLabelText('Objekt'), 'Rheinstraße 12')
    await user.type(within(dialog).getByLabelText(/Inhalt/), 'Termin am Montag bestätigt.')
    await user.click(within(dialog).getByRole('button', { name: 'Eintragen' }))

    await waitFor(() => {
      expect(posted).toHaveLength(1)
    })
    expect(posted[0]).toMatchObject({
      path: '/communications',
      body: {
        customerId: 'c-1',
        siteId: 's-1',
        kind: 'call',
        direction: 'outgoing',
        counterpart: 'Sabine Keller',
        text: 'Termin am Montag bestätigt.',
      },
    })
    expect(Date.parse((posted[0]?.body as { happenedAt: string }).happenedAt)).not.toBeNaN()
  })

  it('writes nothing without a content', async () => {
    const user = userEvent.setup()

    await mount({ customerId: 'c-1' })
    await user.click(await screen.findByRole('button', { name: 'Notiz' }))

    const dialog = await screen.findByRole('dialog', { name: 'Notiz schreiben' })

    await user.click(within(dialog).getByRole('button', { name: 'Eintragen' }))

    expect(await within(dialog).findByText('Ein Eintrag braucht einen Inhalt.')).toBeTruthy()
    expect(posted).toEqual([])
  })

  it('offers no entry to whoever does not keep customers', async () => {
    rights = ['customer.read']
    await mount({ customerId: 'c-1' })

    expect(await screen.findByRole('list', { name: 'Verlauf' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Anruf eintragen' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Notiz' })).toBeNull()
  })
})

describe('the history at a site (#313)', () => {
  it('writes a note at the site, without a direction', async () => {
    const user = userEvent.setup()

    await mount({ siteId: 's-1' })
    await user.click(await screen.findByRole('button', { name: 'Notiz' }))

    const dialog = await screen.findByRole('dialog', { name: 'Notiz schreiben' })

    expect(within(dialog).queryByLabelText('Gesprächspartner')).toBeNull()
    await user.type(within(dialog).getByLabelText(/Inhalt/), 'Schlüssel beim Hausmeister.')
    await user.click(within(dialog).getByRole('button', { name: 'Eintragen' }))

    await waitFor(() => {
      expect(posted).toHaveLength(1)
    })
    expect(posted[0]?.body).toMatchObject({
      customerId: 'c-1',
      siteId: 's-1',
      kind: 'note',
      direction: null,
      counterpart: null,
      text: 'Schlüssel beim Hausmeister.',
    })
  })
})
