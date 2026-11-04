import 'fake-indexeddb/auto'

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
import { CustomerPrivacyPanel } from './customer-privacy.js'

/**
 * The card "Datenschutz" in the file of a customer (#845): the request for
 * deletion that runs, with what holds the customer, and the dialog that
 * records one, for whoever may change customers.
 */

let server: TestServer
let counter = 0
let roles: readonly ('office' | 'technician')[] = ['office']
let running: unknown = null
const posted: { path: string; body: unknown }[] = []

const view = {
  request: {
    id: 'r-1',
    customerId: 'c-1',
    receivedOn: '2026-11-01',
    channel: 'email',
    status: 'open',
    answerDueOn: '2026-12-01',
    restrictedAt: null,
    erasedAt: null,
    createdBy: 'bruno',
    createdAt: '2026-11-04T08:00:00.000Z',
  },
  customerName: 'Ute Petersen',
  holds: [],
  answer: 'erase',
  dueOn: '2026-11-01',
}

async function mount() {
  const client = await SyncClient.start({
    store: await openLocalStore(`customer-privacy${String((counter += 1))}`),
    transport: server,
    writer: server,
    deviceId: 'office',
    entities: ['customers'],
    onSignedOut: () => {},
  })

  await client.synchronise()

  const root = createRootRoute()
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({
        getParentRoute: () => root,
        path: '/',
        component: () => <CustomerPrivacyPanel customerId="c-1" customerName="Ute Petersen" />,
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
  roles = ['office']
  running = null
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-04T10:00:00Z') })

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
        user: { id: 'u-1', email: 'buero@nord.example.de', name: 'Bruno Büro' },
        session: { activeTenantId: 't-1' },
      })
    }

    if (path === '/auth/tenants') {
      return answer(200, [aTenantChoice([...roles])])
    }

    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>

      posted.push({ path, body })
      running = view

      return answer(201, view)
    }

    if (path === '/privacy/requests?customerId=c-1') {
      return answer(200, { running })
    }

    return answer(404, {})
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('the card "Datenschutz" (#845)', () => {
  it('says there is no request, and records one with the day it came in and how', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) })

    await mount()

    const card = (await screen.findByText('Keine Löschanfrage.')).closest('section') as HTMLElement

    await user.click(within(card).getByRole('button', { name: 'Löschanfrage erfassen' }))

    const dialog = await screen.findByRole('dialog', { name: 'Löschanfrage erfassen' })

    expect(dialog.textContent).toContain('Ute Petersen bittet um das Löschen der Daten.')
    await user.clear(within(dialog).getByLabelText(/Eingegangen am/))
    await user.type(within(dialog).getByLabelText(/Eingegangen am/), '2026-11-01')
    await user.selectOptions(within(dialog).getByLabelText('Weg'), 'letter')
    await user.click(within(dialog).getByRole('button', { name: 'Erfassen' }))

    await waitFor(() => {
      expect(posted).toEqual([
        {
          path: '/privacy/requests',
          body: { customerId: 'c-1', receivedOn: '2026-11-01', channel: 'letter' },
        },
      ])
    })
    expect(
      await screen.findByText('Löschanfrage vom 01.11.2026 per E-Mail, Antwort bis 01.12.2026.'),
    ).toBeTruthy()
  })

  it('refuses a day in the future before anything is sent', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) })

    await mount()
    await user.click(await screen.findByRole('button', { name: 'Löschanfrage erfassen' }))

    const dialog = await screen.findByRole('dialog', { name: 'Löschanfrage erfassen' })

    await user.clear(within(dialog).getByLabelText(/Eingegangen am/))
    await user.type(within(dialog).getByLabelText(/Eingegangen am/), '2026-11-05')
    await user.click(within(dialog).getByRole('button', { name: 'Erfassen' }))

    expect((await within(dialog).findByRole('alert')).textContent).toContain('Zukunft')
    expect(posted).toEqual([])
  })

  it('shows the request that runs with what holds the customer', async () => {
    running = {
      ...view,
      holds: [{ kind: 'retention', until: '2034-12-31' }],
      answer: 'restrict',
    }

    await mount()

    expect(
      await screen.findByText('Löschanfrage vom 01.11.2026 per E-Mail, Antwort bis 01.12.2026.'),
    ).toBeTruthy()
    expect(screen.getByText('Belege sind bis 31.12.2034 aufzubewahren.')).toBeTruthy()
    expect(screen.getByText('Offen')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Löschanfrage erfassen' })).toBeNull()
  })

  it('offers no recording to whoever may not change customers', async () => {
    roles = ['technician']

    await mount()

    expect(await screen.findByText('Keine Löschanfrage.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Löschanfrage erfassen' })).toBeNull()
  })
})
