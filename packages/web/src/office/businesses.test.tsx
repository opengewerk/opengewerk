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
import { AccountScreen } from './screens/account.js'
import { OfficeShell } from './shell.js'
import { aTenantChoice } from '../session/test-tenants.js'

/**
 * The switch between businesses without signing in again (#242), in the
 * header, in the menu on a phone and under "Konto", and a further business
 * for an owner (#142), as the boards "Betrieb wechseln in der Kopfleiste",
 * "Betrieb wechseln im Menü, Telefon" and "Konto" draw them. And the way into
 * the area of the instance for the people who run it (#188).
 */

interface Call {
  readonly method: string
  readonly path: string
  readonly body: unknown
}

let answers: Map<string, unknown>
let calls: Call[]
let assign: ReturnType<typeof vi.fn<(url: string | URL) => void>>
let counter = 0

function answer(method: string, path: string, value: unknown) {
  answers.set(`${method} ${path}`, value)
}

async function mount(path = '/') {
  const server = new TestServer()
  const client = await SyncClient.start({
    store: await openLocalStore(`betriebe${String((counter += 1))}`),
    transport: server,
    writer: server,
    deviceId: 'office-computer',
    entities: ['tasks'],
    onSignedOut: () => {},
  })

  const root = createRootRoute({ component: OfficeShell })
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({ getParentRoute: () => root, path: '/', component: () => <h1>Kunden</h1> }),
      createRoute({ getParentRoute: () => root, path: '/konto', component: AccountScreen }),
      createRoute({
        getParentRoute: () => root,
        path: '/instanz',
        component: () => <h1>Instanz</h1>,
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

const both = [
  aTenantChoice(['owner'], { name: 'Elektro Kohm GmbH' }),
  aTenantChoice(['office'], { id: 't-2', name: 'Elektro Nord KG' }),
]

beforeEach(() => {
  answers = new Map()
  calls = []
  answer('GET', '/api/auth/get-session', {
    user: {
      id: 'u-1',
      email: 'moritz@kohm.example.de',
      name: 'Moritz Kohm',
      twoFactorEnabled: true,
    },
    session: { activeTenantId: 't-1' },
  })
  answer('GET', '/auth/tenants', both)
  answer('POST', '/auth/tenant', { tenantId: 't-2' })
  answer('GET', '/push', { available: false, publicKey: null, occasions: [], devices: [] })
  answer('GET', '/auth/devices', [])
  answer('GET', '/auth/passkeys', [])

  vi.stubGlobal('fetch', (path: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const key = `${method} ${path}`

    calls.push({
      method,
      path,
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
    })

    return Promise.resolve(
      new Response(JSON.stringify(answers.get(key) ?? {}), {
        status: answers.has(key) ? 200 : 404,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  })

  assign = vi.fn<(url: string | URL) => void>()
  vi.spyOn(globalThis.location, 'assign').mockImplementation(assign)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('the business in the header', () => {
  it('opens the list of businesses and moves the session into the one chosen', async () => {
    await mount()
    const user = userEvent.setup()
    const header = await screen.findByRole('banner')

    await user.click(await within(header).findByRole('button', { name: 'Elektro Kohm GmbH' }))

    const menu = screen.getByRole('menu', { name: 'Betrieb wechseln' })
    const choices = within(menu).getAllByRole('menuitemradio')

    expect(choices.map((choice) => choice.getAttribute('aria-checked'))).toEqual(['true', 'false'])
    expect(choices[1]?.textContent).toContain('Büro')
    expect(within(menu).getByRole('menuitem', { name: 'Weiteren Betrieb anlegen' })).toBeTruthy()

    await user.click(choices[1] as HTMLElement)

    await waitFor(() => {
      expect(assign).toHaveBeenCalledWith('/')
    })
    expect(calls.find((call) => call.path === '/auth/tenant')?.body).toEqual({ tenantId: 't-2' })
  })

  it('stays a name for somebody in one business, the owner of it too', async () => {
    answer('GET', '/auth/tenants', [aTenantChoice(['owner'], { name: 'Elektro Kohm GmbH' })])
    await mount()

    const header = await screen.findByRole('banner')

    expect(await within(header).findByText('Elektro Kohm GmbH')).toBeTruthy()
    expect(within(header).queryByRole('button', { name: 'Elektro Kohm GmbH' })).toBeNull()
  })
})

describe('the business in the menu on a phone', () => {
  it('opens the list in place, with a new business for an owner', async () => {
    await mount()
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Menü' }))
    const drawer = screen.getByRole('dialog', { name: 'Menü' })

    await user.click(await within(drawer).findByRole('button', { name: 'Elektro Kohm GmbH' }))

    const menu = within(drawer).getByRole('menu', { name: 'Betrieb wechseln' })

    expect(within(menu).getAllByRole('menuitemradio')).toHaveLength(2)
    expect(
      within(menu).getByRole('menuitem', { name: 'Weiteren Betrieb anlegen' }).getAttribute('href'),
    ).toBe('/konto#betriebe')
  })
})

describe('the businesses under "Konto"', () => {
  it('mark the one worked in and switch to another', async () => {
    await mount('/konto')
    const user = userEvent.setup()

    const list = await screen.findByRole('list', { name: 'Deine Betriebe' })

    await waitFor(() => {
      expect(within(list).getAllByRole('listitem')).toHaveLength(2)
    })
    expect(within(list).getAllByRole('listitem')[0]?.textContent).toContain('Dieser Betrieb')

    await user.click(within(list).getByRole('button', { name: 'Zu Elektro Nord KG wechseln' }))

    await waitFor(() => {
      expect(assign).toHaveBeenCalledWith('/')
    })
  })

  it('create a further one for an owner, who can switch to it at once', async () => {
    answer('POST', '/tenants', { tenantId: 't-5', name: 'Kohm Solar GmbH' })
    await mount('/konto')
    const user = userEvent.setup()

    const name = await screen.findByLabelText('Name des Betriebs')
    const form = name.closest('form') as HTMLFormElement

    await user.click(within(form).getByRole('button', { name: 'Betrieb anlegen' }))
    expect(within(form).getByText('Der Name des Betriebs fehlt.')).toBeTruthy()

    await user.type(name, 'Kohm Solar GmbH')
    await user.click(within(form).getByRole('button', { name: 'Betrieb anlegen' }))

    expect(await screen.findByText(/ist angelegt. Du bist dort Inhaber./)).toBeTruthy()
    expect(calls.find((call) => call.path === '/tenants')?.body).toEqual({
      name: 'Kohm Solar GmbH',
    })

    await user.click(screen.getByRole('button', { name: 'Jetzt wechseln' }))

    await waitFor(() => {
      expect(calls.filter((call) => call.path === '/auth/tenant').at(-1)?.body).toEqual({
        tenantId: 't-5',
      })
    })
  })

  it('offer nothing to create to somebody who is no owner', async () => {
    answer('GET', '/auth/tenants', [
      aTenantChoice(['office'], { name: 'Elektro Kohm GmbH' }),
      aTenantChoice(['office'], { id: 't-2', name: 'Elektro Nord KG' }),
    ])
    await mount('/konto')

    const list = await screen.findByRole('list', { name: 'Deine Betriebe' })

    await waitFor(() => {
      expect(within(list).getAllByRole('listitem')).toHaveLength(2)
    })
    expect(screen.queryByText('Weiterer Betrieb')).toBeNull()
  })
})

describe('the way into the area of the instance', () => {
  it('is under the name for the people who run it', async () => {
    answer('GET', '/instance/access', { operator: true, secondFactor: true })
    await mount()
    const user = userEvent.setup()

    await user.click(
      await screen.findByRole('button', { name: 'Moritz Kohm, Konto und Darstellung' }),
    )

    expect(
      (await screen.findByRole('link', { name: 'Instanz verwalten' })).getAttribute('href'),
    ).toBe('/instanz')
  })

  it('is not there for anybody else', async () => {
    answer('GET', '/instance/access', { operator: false, secondFactor: true })
    await mount()
    const user = userEvent.setup()

    await user.click(
      await screen.findByRole('button', { name: 'Moritz Kohm, Konto und Darstellung' }),
    )
    await waitFor(() => {
      expect(calls.some((call) => call.path === '/instance/access')).toBe(true)
    })

    expect(screen.getByRole('link', { name: 'Konto' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Instanz verwalten' })).toBeNull()
  })
})
