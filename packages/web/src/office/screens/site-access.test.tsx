import 'fake-indexeddb/auto'

import type { RecordState, RoleKey } from '@opengewerk/domain'
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

import { SyncClient } from '../../sync/client.js'
import { SyncProvider } from '../../sync/provider.js'
import { openLocalStore } from '../../sync/store.js'
import { TestServer } from '../../sync/test-server.js'
import { SiteScreen } from './sites.js'
import { aTenantChoice } from '../../session/test-tenants.js'

/**
 * "Zugang" at a site in the office (#286), the boards "Objekt mit Zugang:
 * verdeckt, angezeigt, nicht mehr lesbar" and "Zugang bearbeiten": what each
 * way in opens and its hint, the value hidden until the office asks the route
 * for it, which answers with the value and keeps who saw it. Nothing of a
 * value lies on the device.
 */

let server: TestServer
let counter = 0
let roles: RoleKey[]
let calls: { key: string; body: unknown }[]
let reveal: () => Promise<Response>

const safe = {
  id: 'a-1',
  siteId: 's-1',
  designation: 'Schlüsseltresor Hof',
  hint: 'Links neben dem Hoftor.',
  valueSetAt: '2026-09-27T08:00:00.000Z',
  valueState: 'readable',
}

function answer(body: unknown, status = 200): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
}

async function mount(accesses: readonly RecordState[] = [safe]) {
  server.put('customers', { id: 'c-1', kind: 'private', name: 'Familie Berg' })
  server.put('sites', { id: 's-1', customerId: 'c-1', designation: 'Einfamilienhaus Berg' })

  for (const access of accesses) {
    server.put('site_accesses', access)
  }

  const client = await SyncClient.start({
    store: await openLocalStore(`office-access${String((counter += 1))}`),
    transport: server,
    writer: server,
    deviceId: 'office-computer',
    entities: ['customers', 'sites', 'installations', 'jobs', 'site_accesses'],
    onSignedOut: () => {},
  })

  await client.synchronise()

  const root = createRootRoute()
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({ getParentRoute: () => root, path: '/objekte/$siteId', component: SiteScreen }),
    ]),
    history: createMemoryHistory({ initialEntries: ['/objekte/s-1'] }),
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

  await screen.findByRole('heading', { name: 'Einfamilienhaus Berg' })

  return client
}

/** The card, once the roles are known and it shows. */
function accessCard() {
  return screen.findByRole('region', { name: 'Zugang' })
}

function sent(method: string) {
  return calls.filter((call) => call.key.startsWith(`${method} /sites/`))
}

beforeEach(() => {
  server = new TestServer()
  roles = ['office']
  calls = []
  reveal = () => answer({ state: 'readable', value: '4711' }, 201)
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: /min-width:\s*(37\.5|64)rem/.test(query),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
  vi.stubGlobal('fetch', (path: string, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${path}`

    calls.push({
      key,
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
    })

    if (key === 'GET /api/auth/get-session') {
      return answer({
        user: { id: 'u-1', email: 'britta@nord.example.de', name: 'Britta Büro' },
        session: { activeTenantId: 't-1' },
      })
    }

    if (key === 'GET /auth/tenants') {
      return answer([aTenantChoice(roles)])
    }

    if (key.startsWith('POST /sites/s-1/accesses/') && key.endsWith('/reveal')) {
      return reveal()
    }

    if (key === 'POST /sites/s-1/accesses') {
      return answer({ id: 'a-new' }, 201)
    }

    if (key.startsWith('PATCH /sites/s-1/accesses/') || key.startsWith('DELETE /sites/')) {
      return answer({})
    }

    return answer({}, 404)
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the ways into a site in the office', () => {
  it('hide the value until the office asks for it, and say when it was seen', async () => {
    await mount()
    const card = await accessCard()
    const user = userEvent.setup()

    expect(within(card).getByText('Schlüsseltresor Hof')).toBeTruthy()
    expect(within(card).getByText('Links neben dem Hoftor.')).toBeTruthy()
    expect(within(card).getByLabelText('verdeckt')).toBeTruthy()

    await user.click(within(card).getByRole('button', { name: 'Schlüsseltresor Hof anzeigen' }))

    expect(await within(card).findByText('4711')).toBeTruthy()
    expect(
      within(card).getByText(/^Angezeigt um \d\d:\d\d, steht im Änderungsprotokoll\.$/),
    ).toBeTruthy()
    expect(sent('POST').map((call) => call.key)).toEqual(['POST /sites/s-1/accesses/a-1/reveal'])

    await user.click(within(card).getByRole('button', { name: 'Schlüsseltresor Hof verbergen' }))

    expect(within(card).queryByText('4711')).toBeNull()
  })

  it('hide a shown value again when somebody else changed it meanwhile', async () => {
    const client = await mount()
    const card = await accessCard()
    const user = userEvent.setup()

    await user.click(within(card).getByRole('button', { name: 'Schlüsseltresor Hof anzeigen' }))

    expect(await within(card).findByText('4711')).toBeTruthy()

    server.put('site_accesses', { ...safe, valueSetAt: '2026-09-27T11:00:00.000Z' })
    await client.synchronise()

    await waitFor(() => {
      expect(within(card).queryByText('4711')).toBeNull()
    })
    expect(within(card).getByLabelText('verdeckt')).toBeTruthy()
    expect(within(card).queryByText(/^Angezeigt um/)).toBeNull()
  })

  it('give way to saying a shown value cannot be read any more', async () => {
    const client = await mount()
    const card = await accessCard()
    const user = userEvent.setup()

    await user.click(within(card).getByRole('button', { name: 'Schlüsseltresor Hof anzeigen' }))

    expect(await within(card).findByText('4711')).toBeTruthy()

    server.put('site_accesses', { ...safe, valueState: 'unreadable' })
    await client.synchronise()

    expect(
      await within(card).findByText(
        'Nicht mehr lesbar: der Schlüssel dieser Instanz hat sich geändert. Bitte den Wert neu eintragen.',
      ),
    ).toBeTruthy()
    expect(within(card).queryByText('4711')).toBeNull()
  })

  it('ask once for two quick clicks', async () => {
    let answerNow: (response: Response) => void = () => {}

    reveal = () =>
      new Promise<Response>((resolve) => {
        answerNow = resolve
      })
    await mount()
    const card = await accessCard()
    const user = userEvent.setup()
    const button = within(card).getByRole('button', { name: 'Schlüsseltresor Hof anzeigen' })

    // The second click comes while the route has not answered the first.
    await user.click(button)
    await user.click(button)

    expect(sent('POST').map((call) => call.key)).toEqual(['POST /sites/s-1/accesses/a-1/reveal'])

    answerNow(
      new Response(JSON.stringify({ state: 'readable', value: '4711' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    expect(await within(card).findByText('4711')).toBeTruthy()
  })

  it('say so when there is no connection to ask', async () => {
    reveal = () => Promise.reject(new TypeError('Failed to fetch'))
    await mount()
    const card = await accessCard()
    const user = userEvent.setup()

    await user.click(within(card).getByRole('button', { name: 'Schlüsseltresor Hof anzeigen' }))

    expect(
      await within(card).findByText(
        'Keine Verbindung. Ein Zugang wird im Büro nur mit Verbindung angezeigt.',
      ),
    ).toBeTruthy()
  })

  it('say when a value cannot be read any more, and offer nothing to show', async () => {
    await mount([
      { id: 'a-2', siteId: 's-1', designation: 'Alarmanlage', valueState: 'unreadable' },
    ])
    const card = await accessCard()

    expect(
      within(card).getByText(
        'Nicht mehr lesbar: der Schlüssel dieser Instanz hat sich geändert. Bitte den Wert neu eintragen.',
      ),
    ).toBeTruthy()
    expect(within(card).queryByRole('button', { name: 'Alarmanlage anzeigen' })).toBeNull()
  })

  it('are not there for a technician', async () => {
    roles = ['technician']
    await mount()
    await waitFor(() => {
      expect(calls.map((call) => call.key)).toContain('GET /auth/tenants')
    })

    expect(screen.queryByRole('region', { name: 'Zugang' })).toBeNull()
  })
})

describe('keeping the ways into a site', () => {
  it('adds one, and says first what is missing', async () => {
    await mount([])
    const card = await accessCard()
    const user = userEvent.setup()

    expect(within(card).getByText(/^Noch kein Zugang eingetragen\./)).toBeTruthy()

    await user.click(within(card).getByRole('button', { name: 'Hinzufügen' }))

    // The card is the form now, under its own title.
    expect(screen.getByRole('region', { name: 'Zugang hinzufügen' })).toBe(card)
    await user.type(within(card).getByLabelText('Bezeichnung'), '   ')
    await user.click(within(card).getByRole('button', { name: 'Speichern' }))

    expect(
      within(card).getByText('Ein Zugang braucht eine Bezeichnung, etwa „Schlüsseltresor Hof“.'),
    ).toBeTruthy()
    expect(sent('POST')).toEqual([])

    await user.clear(within(card).getByLabelText('Bezeichnung'))
    await user.type(within(card).getByLabelText('Bezeichnung'), 'Garage')
    await user.type(within(card).getByLabelText('Wert'), '0815')
    await user.type(within(card).getByLabelText('Hinweis'), 'Handsender im Briefkasten.')
    await user.click(within(card).getByRole('button', { name: 'Speichern' }))

    await waitFor(() => {
      expect(sent('POST')).toEqual([
        {
          key: 'POST /sites/s-1/accesses',
          body: { designation: 'Garage', hint: 'Handsender im Briefkasten.', value: '0815' },
        },
      ])
    })
  })

  it('changes one and keeps its value while the field stays empty', async () => {
    await mount()
    const card = await accessCard()
    const user = userEvent.setup()

    await user.click(within(card).getByRole('button', { name: 'Schlüsseltresor Hof bearbeiten' }))

    expect(screen.getByRole('region', { name: 'Zugang bearbeiten' })).toBe(card)

    const value = within(card).getByLabelText('Wert')

    expect((value as HTMLInputElement).value).toBe('')
    expect(value.getAttribute('placeholder')).toBe('unverändert')

    await user.clear(within(card).getByLabelText('Hinweis'))
    await user.type(within(card).getByLabelText('Hinweis'), 'Rechts neben dem Hoftor.')
    await user.click(within(card).getByRole('button', { name: 'Speichern' }))

    await waitFor(() => {
      expect(sent('PATCH')).toEqual([
        {
          key: 'PATCH /sites/s-1/accesses/a-1',
          body: { designation: 'Schlüsseltresor Hof', hint: 'Rechts neben dem Hoftor.', value: '' },
        },
      ])
    })
  })

  it('deletes one only after asking', async () => {
    await mount()
    const card = await accessCard()
    const user = userEvent.setup()

    await user.click(within(card).getByRole('button', { name: 'Schlüsseltresor Hof bearbeiten' }))
    await user.click(within(card).getByRole('button', { name: 'Löschen' }))

    const asked = screen.getByRole('alertdialog', { name: 'Zugang löschen?' })

    expect(sent('DELETE')).toEqual([])

    await user.click(within(asked).getByRole('button', { name: 'Löschen' }))

    await waitFor(() => {
      expect(sent('DELETE').map((call) => call.key)).toEqual(['DELETE /sites/s-1/accesses/a-1'])
    })
  })
})
