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

import { SyncClient } from '../sync/client.js'
import { SyncProvider } from '../sync/provider.js'
import { openLocalStore } from '../sync/store.js'
import { TestServer } from '../sync/test-server.js'
import { OfficeShell } from './shell.js'
import { initialsOf } from '../app/who.js'

/**
 * The shell of the office as the canvas draws it (#217): the header in slate
 * with the business and the person, the navigation beside the screen and, on
 * a phone, behind "Menü". And no strip when there is nothing to do.
 */

let answers: Map<string, unknown>
let counter = 0

async function mount(path = '/', seed: (server: TestServer) => void = () => {}) {
  const server = new TestServer()
  seed(server)
  const client = await SyncClient.start({
    store: await openLocalStore(`huelle${String((counter += 1))}`),
    transport: server,
    writer: server,
    deviceId: 'office-computer',
    entities: ['tasks'],
    onSignedOut: () => {},
  })

  await client.synchronise()

  const root = createRootRoute({ component: OfficeShell })
  const page = (title: string) => () => <h1>{title}</h1>
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({ getParentRoute: () => root, path: '/', component: page('Kunden') }),
      createRoute({ getParentRoute: () => root, path: '/auftraege', component: page('Aufträge') }),
      createRoute({ getParentRoute: () => root, path: '/konto', component: page('Konto') }),
      createRoute({ getParentRoute: () => root, path: '/konflikte', component: page('Konflikte') }),
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
  localStorage.clear()
  delete document.documentElement.dataset.theme
  answers = new Map()
  answers.set('/api/auth/get-session', {
    user: { id: 'u-1', email: 'beate@nord.example.de', name: 'Beate Beispiel' },
    session: { activeTenantId: 't-1' },
  })
  answers.set('/auth/tenants', [{ id: 't-1', name: 'Elektro Nord GmbH', roles: ['owner'] }])
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

describe('the header of the office', () => {
  it('names the business and the person, and shows no strip when everything arrived', async () => {
    await mount()

    const header = await screen.findByRole('banner')
    expect(within(header).getByText('OpenGewerk')).toBeTruthy()
    expect(await within(header).findByText('Elektro Nord GmbH')).toBeTruthy()
    expect(
      await within(header).findByRole('button', { name: 'Beate Beispiel, Konto und Darstellung' }),
    ).toBeTruthy()

    // Everything arrived: said quietly under "Abgleich", no bar over the page.
    expect(screen.queryByText(/Alles abgeglichen/)).toBeNull()
    expect(screen.getAllByText('Abgeglichen, gerade eben').length).toBeGreaterThan(0)
  })

  it('opens the person with light and dark, the account and signing out', async () => {
    await mount()
    const user = userEvent.setup()

    await user.click(
      await screen.findByRole('button', { name: 'Beate Beispiel, Konto und Darstellung' }),
    )

    expect(screen.getByText('beate@nord.example.de · Inhaber')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Konto' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Abmelden' })).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Dunkel' }))
    expect(document.documentElement.dataset.theme).toBe('dark')

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('button', { name: 'Abmelden' })).toBeNull()
  })

  it('makes two letters of a name for the round badge', () => {
    expect(initialsOf('Moritz Kohm')).toBe('MK')
    expect(initialsOf('Anna Maria Weber')).toBe('AW')
    expect(initialsOf('Beate')).toBe('B')
    expect(initialsOf('  ')).toBe('?')
  })
})

describe('the navigation of the office', () => {
  it('lists the work beside the screen and marks where you are', async () => {
    await mount('/auftraege')

    const nav = await screen.findByRole('navigation', { name: 'Hauptbereiche' })
    expect(within(nav).getByRole('link', { name: 'Kunden' })).toBeTruthy()
    expect(within(nav).getByRole('link', { name: 'Aufträge' }).getAttribute('aria-current')).toBe(
      'page',
    )
    expect(within(nav).getByRole('link', { name: 'Abgleich' })).toBeTruthy()
  })

  it('counts the open tasks of the person beside "Aufgaben", in words for a reader', async () => {
    await mount('/', (server) => {
      const task = (id: string, assigneeUserId: string, status: string) => ({
        id,
        title: 'Material bestellen',
        dueOn: '2026-09-30',
        assigneeUserId,
        status,
        version: 1,
        deletedAt: null,
      })
      server.put('tasks', task('t-1', 'u-1', 'open'))
      server.put('tasks', task('t-2', 'u-1', 'open'))
      server.put('tasks', task('t-3', 'u-1', 'done'))
      server.put('tasks', task('t-4', 'u-2', 'open'))
    })

    const nav = await screen.findByRole('navigation', { name: 'Hauptbereiche' })

    expect(
      await within(nav).findByRole('link', { name: 'Aufgaben, 2 für dich offen' }),
    ).toBeTruthy()
    // Nothing waits in the outbox, so "Abgleich" carries no figure.
    expect(within(nav).getByRole('link', { name: 'Abgleich' })).toBeTruthy()
  })

  it('opens behind "Menü" on a phone and closes when an entry is followed', async () => {
    const router = await mount()
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Menü' }))

    const drawer = screen.getByRole('dialog', { name: 'Menü' })
    expect(within(drawer).getByRole('group', { name: 'Darstellung' })).toBeTruthy()

    await user.click(within(drawer).getByRole('link', { name: 'Aufträge' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/auftraege')
    })
    expect(screen.queryByRole('dialog', { name: 'Menü' })).toBeNull()
  })

  it('closes on Escape', async () => {
    await mount()
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Menü' }))
    expect(screen.getByRole('dialog', { name: 'Menü' })).toBeTruthy()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Menü' })).toBeNull()
  })
})
