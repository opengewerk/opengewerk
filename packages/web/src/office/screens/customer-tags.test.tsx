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

import { type DirectWriter, SyncClient } from '../../sync/client.js'
import { SyncProvider } from '../../sync/provider.js'
import { openLocalStore } from '../../sync/store.js'
import { TestServer } from '../../sync/test-server.js'
import { CustomerList, CustomerScreen, EditCustomerScreen } from './customers.js'
import { SiteScreen } from './sites.js'
import { aTenantChoice } from '../../session/test-tenants.js'

/**
 * The tags at customers and sites (#314), as the boards "Kunden, nach einem
 * Tag gefiltert", "Kundenakte mit Bestandskunde und Tags", "Kunde bearbeiten:
 * Tags" and "Objekt mit Tags" draw them: in the list with a choice by tag and
 * the chips Bestandskunde and Neukunde, in the head of the record, and in the
 * form, where a tag is found or made.
 */

/** A writer that takes a change of master data, as the route would. */
const writer: DirectWriter = {
  patch: (entity, id, values) => {
    const current = server.all(entity).find((row) => row['id'] === id) ?? {}

    server.put(entity, {
      ...current,
      ...values,
      id,
      version: Number(current['version'] ?? 1) + 1,
    })

    return Promise.resolve()
  },
  remove: () => Promise.reject(new TypeError('Failed to fetch')),
}

let server: TestServer
let counter = 0
let calls: { method: string; path: string; body: unknown }[]
let roles: string[]
let tagAnswer: { status: number; body: unknown }
let syncClient: SyncClient

function windowOf(width: number) {
  vi.stubGlobal('matchMedia', (query: string) => {
    const least = /min-width:\s*([\d.]+)rem/.exec(query)

    return {
      matches: least ? width >= Number(least[1]) * 16 : false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }
  })
}

function customer(id: string, name: string, kind: string) {
  return {
    id,
    name,
    kind,
    postalCode: '68159',
    city: 'Mannheim',
    country: 'DE',
    isBusiness: kind !== 'private',
    isConstructionServiceRecipient: false,
    createdAt: '2024-03-12T09:00:00.000Z',
    version: 1,
    deletedAt: null,
  }
}

function link(entity: 'customer_tags' | 'site_tags', id: string, owner: string, tagId: string) {
  const field = entity === 'customer_tags' ? 'customerId' : 'siteId'

  server.put(entity, { id, [field]: owner, tagId, version: 1, deletedAt: null })
}

/** The business of the boards: three tags, three customers, one completed job. */
function business() {
  server.put('tags', { id: 't-wallbox', name: 'Wallbox', version: 1, deletedAt: null })
  server.put('tags', { id: 't-rahmen', name: 'Rahmenvertrag', version: 1, deletedAt: null })
  server.put('tags', { id: 't-smart', name: 'Smart Home', version: 1, deletedAt: null })
  server.put('customers', customer('c-hv', 'Hausverwaltung Süd GmbH', 'property_management'))
  server.put('customers', customer('c-weber', 'Weber, Familie', 'private'))
  server.put('customers', customer('c-kita', 'Kita Sonnenschein e.V.', 'business'))
  link('customer_tags', 'ct-1', 'c-hv', 't-rahmen')
  link('customer_tags', 'ct-2', 'c-hv', 't-wallbox')
  link('customer_tags', 'ct-3', 'c-weber', 't-wallbox')
  server.put('jobs', {
    id: 'j-1',
    customerId: 'c-hv',
    designation: 'Zählerschrank erneuern',
    kind: 'project',
    status: 'completed',
    version: 1,
  })
}

async function mount(path: string) {
  const client = await SyncClient.start({
    store: await openLocalStore(`tags${String((counter += 1))}`),
    transport: server,
    writer,
    deviceId: 'office-computer',
    entities: ['customers', 'sites', 'jobs', 'tags', 'customer_tags', 'site_tags'],
    onSignedOut: () => {},
  })

  await client.synchronise()
  syncClient = client

  const root = createRootRoute()
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({ getParentRoute: () => root, path: '/', component: CustomerList }),
      createRoute({
        getParentRoute: () => root,
        path: '/kunden/$customerId',
        component: CustomerScreen,
      }),
      createRoute({
        getParentRoute: () => root,
        path: '/kunden/$customerId/bearbeiten',
        component: EditCustomerScreen,
      }),
      createRoute({ getParentRoute: () => root, path: '/objekte/$siteId', component: SiteScreen }),
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
  server = new TestServer()
  // The office holds every job, as its answer says.
  server.narrowed = { jobs: 'all' }
  calls = []
  roles = ['office']
  tagAnswer = { status: 200, body: { tagIds: [] } }
  windowOf(1280)
  vi.stubGlobal('fetch', (path: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'

    calls.push({
      method,
      path,
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
    })

    const answers = new Map<string, unknown>([
      [
        'GET /api/auth/get-session',
        {
          user: { id: 'u-1', email: 'u-1@nord.example.de', name: 'u-1' },
          session: { activeTenantId: 't-1' },
        },
      ],
      ['GET /auth/tenants', [aTenantChoice(roles)]],
    ])
    const key = `${method} ${path}`
    const put = method === 'PUT' && path.endsWith('/tags')

    return Promise.resolve(
      new Response(JSON.stringify(put ? tagAnswer.body : (answers.get(key) ?? {})), {
        status: put ? tagAnswer.status : answers.has(key) ? 200 : 404,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the list of customers with tags', () => {
  it('shows the tags beside the name and narrows to one tag, together with a chip', async () => {
    business()
    await mount('/')
    const user = userEvent.setup()

    const table = await screen.findByRole('table', { name: 'Alle Kunden des Betriebs' })

    expect(within(table).getAllByRole('row')).toHaveLength(4)
    expect(within(table).getByText('Rahmenvertrag')).toBeDefined()

    await user.selectOptions(screen.getByLabelText('Tag'), 'Wallbox')

    await waitFor(() => {
      expect(within(table).getAllByRole('row')).toHaveLength(3)
    })
    expect(screen.getByText('2 Einträge')).toBeDefined()

    await user.click(screen.getByRole('button', { name: 'Privat' }))

    await waitFor(() => {
      expect(within(table).getAllByRole('row')).toHaveLength(2)
    })
    expect(within(table).getByRole('link', { name: 'Weber, Familie' })).toBeDefined()
  })

  it('tells an existing customer from a new one by the jobs, as a group of its own', async () => {
    business()
    await mount('/')
    const user = userEvent.setup()

    const table = await screen.findByRole('table', { name: 'Alle Kunden des Betriebs' })
    // With the roles, which say whether the device holds every job.
    const group = await screen.findByRole('group', { name: 'Bestandskunde oder Neukunde' })

    await user.click(within(group).getByRole('button', { name: 'Bestandskunde' }))

    await waitFor(() => {
      expect(within(table).getAllByRole('row')).toHaveLength(2)
    })
    expect(within(table).getByRole('link', { name: 'Hausverwaltung Süd GmbH' })).toBeDefined()

    await user.click(within(group).getByRole('button', { name: 'Neukunde' }))

    await waitFor(() => {
      expect(within(table).getAllByRole('row')).toHaveLength(3)
    })

    // Pressed again, the group is off and every customer is back.
    await user.click(within(group).getByRole('button', { name: 'Neukunde' }))

    await waitFor(() => {
      expect(within(table).getAllByRole('row')).toHaveLength(4)
    })
  })

  it('finds a customer by the name of a tag', async () => {
    business()
    await mount('/')
    const user = userEvent.setup()

    const table = await screen.findByRole('table', { name: 'Alle Kunden des Betriebs' })

    await user.type(screen.getByLabelText('Kunden durchsuchen'), 'rahmen')

    await waitFor(() => {
      expect(within(table).getAllByRole('row')).toHaveLength(2)
    })
  })

  it('offers no choice by tag while the business has none', async () => {
    server.put('customers', customer('c-1', 'Familie Berg', 'private'))
    await mount('/')

    await screen.findByRole('table', { name: 'Alle Kunden des Betriebs' })

    expect(screen.queryByLabelText('Tag')).toBeNull()
  })

  it('puts the tags on the card of a customer on a phone', async () => {
    windowOf(390)
    business()
    await mount('/')

    const card = (await screen.findByText('Weber, Familie')).closest('a') as HTMLElement

    expect(within(card).getByText('Wallbox')).toBeDefined()
  })
})

describe('the record of a customer with tags', () => {
  it('says Bestandskunde beside the kind and shows the tags under the name', async () => {
    business()
    await mount('/kunden/c-hv')

    await screen.findByRole('heading', { level: 1, name: 'Hausverwaltung Süd GmbH' })

    expect(await screen.findByText('Bestandskunde')).toBeDefined()
    expect(screen.getByText('Rahmenvertrag')).toBeDefined()
    expect(screen.getByText('Wallbox')).toBeDefined()
  })

  it('says Neukunde while no job is completed', async () => {
    business()
    await mount('/kunden/c-weber')

    await screen.findByRole('heading', { level: 1, name: 'Weber, Familie' })

    expect(await screen.findByText('Neukunde')).toBeDefined()
  })
})

describe('the tags in the form of a customer', () => {
  it('finds a tag as it is typed, makes a new one, and saves the whole list', async () => {
    business()
    await mount('/kunden/c-hv/bearbeiten')
    const user = userEvent.setup()

    const field = await screen.findByRole('combobox', { name: 'Tag hinzufügen' })

    await user.type(field, 'Smart')

    const list = screen.getByRole('listbox', { name: 'Vorschläge' })

    expect(
      within(list)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Smart Homebei keinem Kunden', 'Neuen Tag „Smart“ anlegen'])

    // Enter takes the marked suggestion and does not send the form.
    await user.keyboard('{Enter}')

    expect(screen.getByRole('button', { name: 'Smart Home entfernen' })).toBeDefined()
    expect(calls.some((call) => call.method === 'PUT')).toBe(false)

    await user.type(field, 'Bergstraße')
    await user.click(screen.getByRole('option', { name: 'Neuen Tag „Bergstraße“ anlegen' }))
    await user.click(screen.getByRole('button', { name: 'Wallbox entfernen' }))
    await user.click(screen.getByRole('button', { name: 'Speichern' }))

    await waitFor(() => {
      expect(calls).toContainEqual({
        method: 'PUT',
        path: '/customers/c-hv/tags',
        body: { tagIds: ['t-rahmen', 't-smart'], newTags: ['Bergstraße'] },
      })
    })
  })

  it('does not ask the route when the tags stay as they are', async () => {
    business()
    const router = await mount('/kunden/c-hv/bearbeiten')
    const user = userEvent.setup()

    await screen.findByRole('combobox', { name: 'Tag hinzufügen' })
    await user.click(screen.getByRole('button', { name: 'Speichern' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/kunden/c-hv')
    })
    expect(calls.some((call) => call.method === 'PUT')).toBe(false)
  })
})

describe('the tags of a site', () => {
  it('shows them under the name and saves them with the site', async () => {
    business()
    server.put('sites', {
      id: 's-1',
      customerId: 'c-hv',
      designation: 'Rheinstraße 12',
      street: 'Rheinstraße',
      houseNumber: '12',
      postalCode: '68159',
      city: 'Mannheim',
      country: 'DE',
      version: 1,
      deletedAt: null,
    })
    link('site_tags', 'st-1', 's-1', 't-rahmen')
    await mount('/objekte/s-1')
    const user = userEvent.setup()

    await screen.findByRole('heading', { level: 1, name: 'Rheinstraße 12' })

    expect(screen.getByText('Rahmenvertrag')).toBeDefined()

    await user.click(await screen.findByRole('button', { name: 'Bearbeiten' }))
    await user.type(screen.getByRole('combobox', { name: 'Tag hinzufügen' }), 'Wall')
    await user.keyboard('{Enter}')
    await user.click(screen.getByRole('button', { name: 'Speichern' }))

    await waitFor(() => {
      expect(calls).toContainEqual({
        method: 'PUT',
        path: '/sites/s-1/tags',
        body: { tagIds: ['t-rahmen', 't-wallbox'], newTags: [] },
      })
    })
  })
})

describe('what a form and a device can know about tags', () => {
  it('offers Bestandskunde and Neukunde only on a device that holds every job', async () => {
    // The roles still say office, as they may for a while after a change;
    // the answer of the server says the device holds the part of a technician.
    server.narrowed = { jobs: 'jobs:0123456789abcdef' }
    business()
    await mount('/')

    await screen.findByRole('button', { name: 'Neuer Kunde' })

    expect(screen.queryByRole('group', { name: 'Bestandskunde oder Neukunde' })).toBeNull()
  })

  it('shows tags that arrive after the form opened, and sends nothing while they are untouched', async () => {
    server.put('tags', { id: 't-wallbox', name: 'Wallbox', version: 1, deletedAt: null })
    server.put('customers', customer('c-hv', 'Hausverwaltung Süd GmbH', 'property_management'))
    const router = await mount('/kunden/c-hv/bearbeiten')
    const user = userEvent.setup()

    await screen.findByRole('combobox', { name: 'Tag hinzufügen' })

    link('customer_tags', 'ct-late', 'c-hv', 't-wallbox')
    await syncClient.synchronise()

    expect(await screen.findByRole('button', { name: 'Wallbox entfernen' })).toBeDefined()

    await user.click(screen.getByRole('button', { name: 'Speichern' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/kunden/c-hv')
    })
    expect(calls.some((call) => call.method === 'PUT')).toBe(false)
  })

  it('says that the other fields are saved when the tags are refused', async () => {
    business()
    tagAnswer = {
      status: 422,
      body: {
        message: 'Einen der Tags gibt es nicht mehr. Die Seite neu laden und noch einmal wählen.',
      },
    }
    await mount('/kunden/c-hv/bearbeiten')
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Wallbox entfernen' }))
    await user.click(screen.getByRole('button', { name: 'Speichern' }))

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Die Angaben des Kunden sind gespeichert, seine Tags nicht. Einen der Tags gibt es nicht mehr. Die Seite neu laden und noch einmal wählen.',
    )
  })
})
