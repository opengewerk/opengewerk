import 'fake-indexeddb/auto'

import {
  contactParentText,
  type Operation,
  type OperationReceipt,
  type RecordState,
  type RoleKey,
} from '@opengewerk/domain'
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
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CustomerScreen } from '../office/screens/customers.js'
import { SiteJobScreen } from '../site/screens/jobs.js'
import type { DirectWriter } from '../sync/client.js'
import { SyncClient } from '../sync/client.js'
import { SyncProvider } from '../sync/provider.js'
import { openLocalStore } from '../sync/store.js'
import type { PullResult, SyncTransport } from '../sync/transport.js'
import { NewContactForm } from './contacts.js'
import { titleOf } from './naming.js'

/**
 * The contacts of #121 on screen: at the customer and the site in the office,
 * at the job on site.
 *
 * The stand in for the server takes what the outbox sends and hands it back on
 * the next pull, and it notes what came straight at a route, which is how
 * master data is corrected.
 */

type Row = Record<string, unknown>

class Server implements SyncTransport, DirectWriter {
  readonly sent: Operation[][] = []
  readonly patched: { entity: string; id: string; values: Row }[] = []
  readonly removed: { entity: string; id: string }[] = []
  offline = false
  private readonly tables = new Map<string, Map<string, Row>>()
  private changed = new Map<string, Set<string>>()
  private cursor = 1

  put(entity: string, row: Row): void {
    const table = this.tables.get(entity) ?? new Map<string, Row>()
    const id = String(row['id'])

    table.set(id, row)
    this.tables.set(entity, table)
    this.changed.set(entity, (this.changed.get(entity) ?? new Set()).add(id))
  }

  push(_deviceId: string, operations: readonly Operation[]) {
    if (this.offline) {
      return Promise.reject(new TypeError('Failed to fetch'))
    }

    this.sent.push([...operations])

    for (const operation of operations) {
      const current = this.tables.get(operation.entity)?.get(operation.recordId) ?? {
        id: operation.recordId,
        deletedAt: null,
        version: 0,
      }

      this.put(operation.entity, {
        ...current,
        ...Object.fromEntries(operation.patches.map((patch) => [patch.field, patch.to])),
        version: Number(current['version'] ?? 0) + 1,
      })
    }

    return Promise.resolve(
      operations.map((operation): OperationReceipt => ({
        operationId: operation.id,
        outcome: 'applied',
        reason: null,
        fields: [],
      })),
    )
  }

  pull(): Promise<PullResult> {
    const changes = [...this.changed].map(([entity, ids]) => ({
      entity,
      rows: [...ids].map((id) => this.tables.get(entity)?.get(id) as RecordState),
    }))

    this.changed = new Map()
    this.cursor += 1

    return Promise.resolve({ changes, cursor: this.cursor, hasMore: false })
  }

  conflicts() {
    return Promise.resolve([])
  }

  resolve() {
    return Promise.resolve()
  }

  patch(entity: string, id: string, values: Readonly<Row>) {
    this.patched.push({ entity, id, values: { ...values } })

    const current = this.tables.get(entity)?.get(id) ?? {}

    this.put(entity, {
      ...current,
      ...values,
      version: Number(current['version'] ?? 0) + 1,
    })

    return Promise.resolve(undefined)
  }

  remove(entity: string, id: string) {
    this.removed.push({ entity, id })

    const current = this.tables.get(entity)?.get(id) ?? {}

    this.put(entity, { ...current, deletedAt: '2026-09-23T12:00:00.000Z' })

    return Promise.resolve(undefined)
  }

  created(entity: string): Row[] {
    return this.sent
      .flat()
      .filter((operation) => operation.kind === 'create' && operation.entity === entity)
      .map((operation) =>
        Object.fromEntries(operation.patches.map((patch) => [patch.field, patch.to])),
      )
  }
}

let server: Server
let answers: Map<string, unknown>
let counter = 0

function signedInAs(...roles: RoleKey[]) {
  answers.set('/api/auth/get-session', {
    user: { id: 'u-1', email: 'u-1@nord.example.de', name: 'u-1' },
    session: { activeTenantId: 't-1' },
  })
  answers.set('/auth/tenants', [{ id: 't-1', name: 'Elektro Nord GmbH', roles }])
}

function contact(id: string, over: Row): Row {
  return {
    id,
    customerId: null,
    siteId: null,
    givenName: null,
    familyName: 'Ohne',
    role: null,
    email: null,
    phone: null,
    version: 1,
    deletedAt: null,
    ...over,
  }
}

async function mount(path: string, component?: () => ReactNode) {
  server.put('customers', {
    id: 'c-1',
    kind: 'property_management',
    name: 'Hausverwaltung Nordblick',
    version: 1,
    deletedAt: null,
  })
  server.put('sites', {
    id: 's-1',
    customerId: 'c-1',
    designation: 'Elbchaussee 140',
    version: 1,
    deletedAt: null,
  })
  server.put('jobs', {
    id: 'j-1',
    customerId: 'c-1',
    siteId: 's-1',
    installationId: null,
    parentJobId: null,
    kind: 'service',
    status: 'active',
    designation: 'Klingelanlage tauschen',
    description: null,
    number: null,
    version: 1,
    deletedAt: null,
  })
  server.put(
    'contacts',
    contact('k-1', {
      customerId: 'c-1',
      givenName: 'Petra',
      familyName: 'Zander',
      role: 'Bauleitung',
      phone: '040 / 123-45',
      email: 'zander@nordblick.example.de',
    }),
  )
  server.put('contacts', contact('k-2', { customerId: 'c-1', familyName: 'Albers' }))
  server.put(
    'contacts',
    contact('k-3', { siteId: 's-1', givenName: 'Ole', familyName: 'Jensen', role: 'Hausmeister' }),
  )

  const client = await SyncClient.start({
    store: await openLocalStore(`kontakte${String((counter += 1))}`),
    transport: server,
    writer: server,
    deviceId: 'geraet',
    entities: ['customers', 'sites', 'jobs', 'contacts', 'documents', 'tasks'],
    onSignedOut: () => {},
  })

  await client.synchronise()

  const root = createRootRoute()
  const empty = (at: string) =>
    createRoute({ getParentRoute: () => root, path: at, component: () => null })
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({
        getParentRoute: () => root,
        path: '/kunden/$customerId',
        component: CustomerScreen,
      }),
      createRoute({
        getParentRoute: () => root,
        path: '/auftraege/$jobId',
        component: SiteJobScreen,
      }),
      createRoute({
        getParentRoute: () => root,
        path: '/start',
        component: component ?? (() => null),
      }),
      empty('/'),
      empty('/objekte/$siteId'),
      empty('/auftraege'),
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

  return { client }
}

/** The list of contacts under a heading, found by what the section is called. */
async function contactsSection() {
  return within(await screen.findByRole('region', { name: 'Ansprechpartner' }))
}

/** The part of a list that a heading opens, the customer's or the site's. */
function group(heading: HTMLElement) {
  const part = heading.closest('section')

  if (!part) {
    throw new Error('Die Überschrift steht in keinem Abschnitt.')
  }

  return within(part)
}

beforeEach(() => {
  server = new Server()
  answers = new Map()
  answers.set('/tasks/assignees', [])

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

describe('a contact by name', () => {
  it('is its given and family name wherever only its id is at hand', () => {
    expect(titleOf('contacts', { givenName: 'Ole', familyName: 'Jensen' } as RecordState)).toBe(
      'Ole Jensen',
    )
    expect(titleOf('contacts', { familyName: 'Albers' } as RecordState)).toBe('Albers')
  })
})

describe('the contacts at a customer in the office', () => {
  it('are the customer’s own, by family name, with phone and e-mail to tap', async () => {
    signedInAs('office')
    await mount('/kunden/c-1')

    const section = await contactsSection()
    const names = section.getAllByRole('listitem').map((item) => item.textContent)

    expect(names[0]).toMatch(/^Albers/)
    expect(names[1]).toMatch(/^Petra Zander/)
    expect(section.queryByText(/Jensen/)).toBeNull()
    expect(section.getByRole('link', { name: '040 / 123-45' }).getAttribute('href')).toBe(
      'tel:04012345',
    )
    expect(
      section.getByRole('link', { name: 'zander@nordblick.example.de' }).getAttribute('href'),
    ).toBe('mailto:zander@nordblick.example.de')
  })

  it('are created through the outbox, on the customer and only there', async () => {
    signedInAs('office')
    const { client } = await mount('/kunden/c-1')
    const section = await contactsSection()

    // "Anlegen" in the head of the card opens the form and makes way for the
    // one under it, which is called the same (#219).
    await userEvent.click(await section.findByRole('button', { name: 'Anlegen' }))
    await userEvent.type(section.getByLabelText(/Nachname/), 'Brandt')
    await userEvent.type(section.getByLabelText(/Rolle/), 'Buchhaltung')
    await userEvent.click(section.getByRole('button', { name: 'Anlegen' }))
    await client.synchronise()

    // Empty fields do not travel on a new record, and neither does a site:
    // the form on the customer's screen has no field for one.
    expect(server.created('contacts')).toEqual([
      { customerId: 'c-1', familyName: 'Brandt', role: 'Buchhaltung' },
    ])
    expect(await section.findByText('Brandt')).toBeDefined()
  })

  it('are corrected and removed straight at the server, the way master data is', async () => {
    signedInAs('office')
    await mount('/kunden/c-1')
    const section = await contactsSection()

    await userEvent.click(await section.findByRole('button', { name: 'Petra Zander bearbeiten' }))

    const role = section.getByLabelText(/Rolle/)

    await userEvent.clear(role)
    await userEvent.type(role, 'Kaufmännische Leitung')
    await userEvent.click(section.getByRole('button', { name: 'Speichern' }))

    await waitFor(() => {
      expect(server.patched).toHaveLength(1)
    })
    expect(server.patched[0]).toMatchObject({
      entity: 'contacts',
      id: 'k-1',
      values: { role: 'Kaufmännische Leitung', familyName: 'Zander' },
    })
    expect(server.sent).toEqual([])

    // Removing is in the form behind the pencil, with a question first, as
    // the canvas draws the card with a pencil and nothing else (#219).
    await userEvent.click(await section.findByRole('button', { name: 'Albers bearbeiten' }))
    await userEvent.click(section.getByRole('button', { name: 'Entfernen' }))

    const question = await screen.findByRole('alertdialog', { name: 'Albers entfernen?' })

    await userEvent.click(within(question).getByRole('button', { name: 'Entfernen' }))

    await waitFor(() => {
      expect(server.removed).toEqual([{ entity: 'contacts', id: 'k-2' }])
    })
    await waitFor(() => {
      expect(section.queryByText('Albers')).toBeNull()
    })
  })

  it('can be added but not corrected by somebody who may only create a customer', async () => {
    signedInAs('technician')
    await mount('/kunden/c-1')
    const section = await contactsSection()

    expect(await section.findByRole('button', { name: 'Anlegen' })).toBeDefined()
    expect(section.queryByRole('button', { name: /bearbeiten/ })).toBeNull()
    expect(section.queryByRole('button', { name: /entfernen/ })).toBeNull()
  })
})

describe('the contacts at a job on site', () => {
  it('are those of the customer and of the site, apart, and neither can be corrected here', async () => {
    signedInAs('technician')
    await mount('/auftraege/j-1')

    const section = await contactsSection()
    const atCustomer = group(section.getByRole('heading', { name: 'Beim Kunden' }))
    const atSite = group(section.getByRole('heading', { name: 'Am Objekt' }))

    expect(atCustomer.getByText(/Zander/)).toBeDefined()
    expect(atCustomer.queryByText(/Jensen/)).toBeNull()
    expect(atSite.getByText(/Jensen/)).toBeDefined()
    expect(atCustomer.getByRole('link', { name: '040 / 123-45' }).getAttribute('href')).toBe(
      'tel:04012345',
    )
    expect(section.queryByRole('button', { name: /bearbeiten|entfernen/ })).toBeNull()
  })

  it('are added at the site without a network, and wait on the device', async () => {
    signedInAs('technician')
    const { client } = await mount('/auftraege/j-1')
    const section = await contactsSection()

    server.offline = true

    await userEvent.click(
      await section.findByRole('button', { name: 'Ansprechpartner am Objekt anlegen' }),
    )
    await userEvent.type(section.getByLabelText(/Nachname/), 'Meyer')
    await userEvent.type(section.getByLabelText(/Rolle/), 'Mieterin')
    await userEvent.click(section.getByRole('button', { name: 'Anlegen' }))

    await waitFor(() => {
      expect(client.status().pending).toBe(1)
    })

    const waiting = client.list('contacts').find((row) => row['familyName'] === 'Meyer')

    expect(waiting).toMatchObject({ siteId: 's-1', role: 'Mieterin' })
    expect(waiting?.['customerId']).toBeUndefined()
    expect(await section.findByText(/noch nicht übertragen/)).toBeDefined()
  })
})

describe('the form for a new contact', () => {
  it('asks the rule before anything is queued', async () => {
    signedInAs('office')
    const { client } = await mount('/start', () => (
      <NewContactForm parent={{ customerId: '' }} onDone={() => {}} />
    ))

    await userEvent.type(await screen.findByLabelText(/Nachname/), 'Niemand')
    await userEvent.click(screen.getByRole('button', { name: 'Anlegen' }))

    expect((await screen.findByRole('alert')).textContent).toBe(contactParentText.none)
    expect(client.status().pending).toBe(0)
    expect(server.sent).toEqual([])
  })
})
