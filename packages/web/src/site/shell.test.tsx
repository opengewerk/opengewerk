import 'fake-indexeddb/auto'

import type { SyncConflict } from '@opengewerk/domain'
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

import { SyncClient } from '../sync/client.js'
import { SyncProvider } from '../sync/provider.js'
import { openLocalStore } from '../sync/store.js'
import { TestServer } from '../sync/test-server.js'
import { SiteHeader } from './header.js'
import { SiteShell } from './shell.js'

/**
 * The shell of the site as the boards draw it (#217): tabs at the bottom, a
 * menu from the bottom with light or dark and signing out, and the slate
 * header of a screen with its way back.
 */

/** A server with one conflict waiting, for the figure on the tab. */
function conflictServer(): TestServer {
  return Object.assign(new TestServer(), {
    conflicts: () => Promise.resolve([{ id: 'c-1' } as unknown as SyncConflict]),
  })
}

let counter = 0

async function mount(path = '/', server: TestServer = new TestServer()) {
  const client = await SyncClient.start({
    store: await openLocalStore(`baustelle${String((counter += 1))}`),
    transport: server,
    writer: server,
    deviceId: 'phone',
    entities: [],
    onSignedOut: () => {},
  })

  await client.synchronise()

  const root = createRootRoute({ component: SiteShell })
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({
        getParentRoute: () => root,
        path: '/',
        component: () => <h1>Offene Aufträge</h1>,
      }),
      createRoute({
        getParentRoute: () => root,
        path: '/auftraege/$jobId',
        component: () => (
          <SiteHeader title="Störung Treppenhauslicht" sub="Serviceeinsatz, Laufend" />
        ),
      }),
      createRoute({ getParentRoute: () => root, path: '/zeiten', component: () => <h1>Heute</h1> }),
      createRoute({
        getParentRoute: () => root,
        path: '/konflikte',
        component: () => <h1>Konflikte</h1>,
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

beforeEach(() => {
  localStorage.clear()
  delete document.documentElement.dataset.theme
  const answers = new Map<string, unknown>([
    [
      '/api/auth/get-session',
      {
        user: { id: 'u-1', email: 'anna@nord.example.de', name: 'Anna Weber' },
        session: { activeTenantId: 't-1' },
      },
    ],
    ['/auth/tenants', [{ id: 't-1', name: 'Elektro Nord GmbH', roles: ['technician'] }]],
  ])
  vi.stubGlobal('fetch', (path: string) =>
    Promise.resolve(
      new Response(JSON.stringify(answers.get(path) ?? {}), {
        status: answers.has(path) ? 200 : 404,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the tabs on site', () => {
  it('offer the jobs, the time, the conflicts and the menu, and keep the jobs lit on a job', async () => {
    await mount('/auftraege/j-1')

    const tabs = (await screen.findAllByRole('navigation', { name: 'Bereiche' }))[0]

    if (!tabs) {
      throw new Error('no tabs')
    }

    expect(within(tabs).getByRole('link', { name: 'Aufträge' }).getAttribute('aria-current')).toBe(
      'page',
    )
    expect(
      within(tabs).getByRole('link', { name: 'Zeiten' }).getAttribute('aria-current'),
    ).toBeNull()
    expect(within(tabs).getByRole('link', { name: 'Konflikte' })).toBeTruthy()
    expect(within(tabs).getByRole('button', { name: 'Menü' })).toBeTruthy()
  })

  it('carry the waiting conflicts on "Konflikte", in words for a reader', async () => {
    await mount('/', conflictServer())

    const tabs = (await screen.findAllByRole('navigation', { name: 'Bereiche' }))[0]

    if (!tabs) {
      throw new Error('no tabs')
    }

    expect(await within(tabs).findByRole('link', { name: 'Konflikte, einer wartet' })).toBeTruthy()
  })
})

describe('the menu on site', () => {
  it('opens from the bottom with light and dark, the office and signing out, and closes on Escape', async () => {
    await mount()
    const user = userEvent.setup()

    await user.click((await screen.findAllByRole('button', { name: 'Menü' }))[0] as HTMLElement)

    const sheet = screen.getByRole('dialog', { name: 'Menü' })
    expect(await within(sheet).findByText('Anna Weber')).toBeTruthy()
    expect(
      within(sheet)
        .getByRole('link', { name: /Zur Büroansicht/ })
        .getAttribute('href'),
    ).toBe('/')
    expect(within(sheet).getByRole('button', { name: 'Abmelden' })).toBeTruthy()

    await user.click(within(sheet).getByRole('button', { name: 'Dunkel' }))
    expect(document.documentElement.dataset.theme).toBe('dark')

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Menü' })).toBeNull()
  })
})

describe('the header of a screen on site', () => {
  it('names the screen and leads one step back', async () => {
    const router = await mount('/auftraege/j-1')
    const user = userEvent.setup()

    const header = await screen.findByRole('banner')
    expect(within(header).getByRole('heading', { name: 'Störung Treppenhauslicht' })).toBeTruthy()
    expect(within(header).getByText('Serviceeinsatz, Laufend')).toBeTruthy()

    await user.click(within(header).getByRole('link', { name: 'Zurück zu den Aufträgen' }))
    expect(router.state.location.pathname).toBe('/')
  })
})
