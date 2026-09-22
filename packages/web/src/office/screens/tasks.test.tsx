import 'fake-indexeddb/auto'

import type { Operation, OperationReceipt, RecordState, RoleKey } from '@opengewerk/domain'
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

import { inWorkingOrder, isOverdue, responsibleFor } from '../../app/tasks.js'
import type { DirectWriter } from '../../sync/client.js'
import { SyncClient } from '../../sync/client.js'
import { SyncProvider } from '../../sync/provider.js'
import { openLocalStore } from '../../sync/store.js'
import type { PullResult, SyncTransport } from '../../sync/transport.js'
import { MyTasks } from '../../site/screens/tasks.js'
import { JobScreen } from './jobs.js'
import { TaskListScreen } from './tasks.js'

/**
 * The tasks of #80 on screen: on the job they hang on, in the office's own
 * list, and at the top of the start screen on site.
 *
 * The stand in for the server takes what the outbox sends and hands it back
 * on the next pull, so a task written here is on the screen afterwards and
 * not only in a list of sent operations.
 */

type Row = Record<string, unknown>

class Server implements SyncTransport, DirectWriter {
  readonly sent: Operation[][] = []
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

  patch() {
    return Promise.resolve(undefined)
  }

  remove() {
    return Promise.resolve(undefined)
  }

  operationsOn(entity: string): Operation[] {
    return this.sent.flat().filter((operation) => operation.entity === entity)
  }
}

let server: Server
let answers: Map<string, unknown>
let counter = 0

/** A day relative to today, so the tests do not age. */
function daysFromToday(days: number): string {
  const at = new Date()
  at.setDate(at.getDate() + days)

  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(at)
}

function signedInAs(userId: string, ...roles: RoleKey[]) {
  answers.set('/api/auth/get-session', {
    user: { id: userId, email: `${userId}@nord.example.de`, name: userId },
    session: { activeTenantId: 't-1' },
  })
  answers.set('/auth/tenants', [{ id: 't-1', name: 'Elektro Nord GmbH', roles }])
}

const customer = {
  id: 'c-1',
  kind: 'business',
  name: 'Hausverwaltung Nordblick',
  version: 1,
  deletedAt: null,
}

const job = {
  id: 'j-1',
  customerId: 'c-1',
  siteId: 's-1',
  installationId: null,
  parentJobId: null,
  kind: 'service',
  status: 'active',
  designation: 'Zählerschrank Lindenweg',
  description: null,
  number: null,
  version: 1,
  deletedAt: null,
}

function task(id: string, over: Row = {}): Row {
  return {
    id,
    title: 'Material bestellen',
    notes: null,
    dueOn: daysFromToday(3),
    assigneeUserId: 'britta',
    status: 'open',
    customerId: 'c-1',
    siteId: 's-1',
    jobId: 'j-1',
    createdBy: 'max',
    version: 1,
    deletedAt: null,
    ...over,
  }
}

async function mount(path: string, tasks: Row[], component?: () => ReactNode) {
  server.put('customers', customer)
  server.put('jobs', job)

  for (const row of tasks) {
    server.put('tasks', row)
  }

  const client = await SyncClient.start({
    store: await openLocalStore(`aufgaben${String((counter += 1))}`),
    transport: server,
    writer: server,
    deviceId: 'geraet',
    entities: ['customers', 'jobs', 'documents', 'tasks'],
    onSignedOut: () => {},
  })

  await client.synchronise()

  const root = createRootRoute()
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({ getParentRoute: () => root, path: '/auftraege/$jobId', component: JobScreen }),
      createRoute({ getParentRoute: () => root, path: '/aufgaben', component: TaskListScreen }),
      createRoute({
        getParentRoute: () => root,
        path: '/start',
        component: component ?? (() => null),
      }),
      createRoute({
        getParentRoute: () => root,
        path: '/kunden/$customerId',
        component: () => null,
      }),
      createRoute({ getParentRoute: () => root, path: '/objekte/$siteId', component: () => null }),
      createRoute({ getParentRoute: () => root, path: '/auftraege', component: () => null }),
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

beforeEach(() => {
  server = new Server()
  answers = new Map()
  answers.set('/tasks/assignees', [
    { userId: 'britta', name: 'Britta Büro', active: true },
    { userId: 'max', name: 'Max Monteur', active: true },
    { userId: 'gerd', name: 'Gerd Gesperrt', active: false },
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

describe('the order of a list of tasks', () => {
  it('puts what is open first, the one due soonest on top, and what is done last', () => {
    const ordered = inWorkingOrder([
      task('a', { status: 'done', dueOn: '2026-09-01' }),
      task('b', { dueOn: '2026-09-30' }),
      task('c', { status: 'done', dueOn: '2026-09-20' }),
      task('d', { dueOn: '2026-09-10' }),
    ] as RecordState[])

    expect(ordered.map((row) => row['id'])).toEqual(['d', 'b', 'c', 'a'])
  })

  it('calls a task overdue only while it is open and past its day', () => {
    expect(isOverdue(task('a', { dueOn: '2026-09-01' }) as RecordState, '2026-09-02')).toBe(true)
    expect(isOverdue(task('a', { dueOn: '2026-09-02' }) as RecordState, '2026-09-02')).toBe(false)
    expect(
      isOverdue(task('a', { dueOn: '2026-09-01', status: 'done' }) as RecordState, '2026-09-02'),
    ).toBe(false)
  })

  it('says "du" for one\'s own, the name for somebody else and a plain word without names', () => {
    const people = [{ userId: 'britta', name: 'Britta Büro', active: true }]

    expect(responsibleFor(task('a') as RecordState, 'britta', people)).toBe('du')
    expect(responsibleFor(task('a') as RecordState, 'max', people)).toBe('Britta Büro')
    expect(responsibleFor(task('a') as RecordState, 'max', [])).toBe('jemand anderes')
  })
})

describe('the tasks of a job in the office', () => {
  it('lists them where they hang, with the day, who does it and what is overdue', async () => {
    signedInAs('max', 'office')
    await mount('/auftraege/j-1', [
      task('t-1', { title: 'Zählerplatz ausmessen', dueOn: daysFromToday(-2) }),
      task('t-2', { title: 'Material bestellen', assigneeUserId: 'max' }),
    ])

    const section = within(await screen.findByRole('region', { name: 'Aufgaben' }))
    const items = await section.findAllByRole('listitem')

    expect(items.map((item) => item.textContent)).toEqual([
      expect.stringContaining('Zählerplatz ausmessen'),
      expect.stringContaining('Material bestellen'),
    ])
    expect(items[0]?.textContent).toContain('überfällig')
    expect(items[0]?.textContent).toContain('verantwortlich: Britta Büro')
    expect(items[1]?.textContent).toContain('verantwortlich: du')
  })

  it('marks one done through the outbox', async () => {
    signedInAs('max', 'office')
    await mount('/auftraege/j-1', [task('t-1')])

    const section = within(await screen.findByRole('region', { name: 'Aufgaben' }))
    await userEvent.setup().click(await section.findByRole('button', { name: 'Erledigt' }))

    await waitFor(() => {
      expect(server.operationsOn('tasks').at(-1)?.patches).toEqual([
        expect.objectContaining({ field: 'status', to: 'done' }),
      ])
    })
  })

  it('writes a new one that takes the job, its customer and its site, for the writer', async () => {
    signedInAs('max', 'office')
    await mount('/auftraege/j-1', [])

    const section = within(await screen.findByRole('region', { name: 'Aufgaben' }))
    const person = userEvent.setup()
    await person.click(await section.findByRole('button', { name: 'Aufgabe anlegen' }))
    await person.type(await section.findByLabelText('Was zu tun ist'), 'Prüfprotokoll nachreichen')
    await person.click(section.getByRole('button', { name: 'Aufgabe anlegen' }))

    await waitFor(() => {
      expect(server.operationsOn('tasks')).toHaveLength(1)
    })

    const created = Object.fromEntries(
      (server.operationsOn('tasks')[0]?.patches ?? []).map((patch) => [patch.field, patch.to]),
    )

    expect(created).toMatchObject({
      title: 'Prüfprotokoll nachreichen',
      assigneeUserId: 'max',
      status: 'open',
      customerId: 'c-1',
      siteId: 's-1',
      jobId: 'j-1',
    })
    expect(created['createdBy']).toBeUndefined()
  })

  it('offers only people who can still be given one', async () => {
    signedInAs('max', 'office')
    await mount('/auftraege/j-1', [])

    const section = within(await screen.findByRole('region', { name: 'Aufgaben' }))
    await userEvent.setup().click(await section.findByRole('button', { name: 'Aufgabe anlegen' }))

    const choice = (await section.findByLabelText('Verantwortlich')) as HTMLSelectElement

    await waitFor(() => {
      expect([...choice.options].map((option) => option.text)).toEqual([
        'Britta Büro',
        'Max Monteur (du)',
      ])
    })
  })
})

describe('the office list of tasks', () => {
  it("shows one's own first and what is open with the others, and leaves out what is done", async () => {
    signedInAs('max', 'office')
    await mount('/aufgaben', [
      task('t-1', { title: 'Eigene Aufgabe', assigneeUserId: 'max' }),
      task('t-2', { title: 'Aufgabe von Britta' }),
      task('t-3', { title: 'Längst erledigt', assigneeUserId: 'max', status: 'done' }),
    ])

    const mine = within(await screen.findByRole('region', { name: 'Deine Aufgaben' }))
    const others = within(screen.getByRole('region', { name: 'Offen bei anderen' }))

    expect(await mine.findByText('Eigene Aufgabe')).toBeDefined()
    expect(await others.findByText('Aufgabe von Britta')).toBeDefined()
    expect(screen.queryByText('Längst erledigt')).toBeNull()
  })
})

describe('the start screen on site', () => {
  it('lists what is open for whoever holds the device', async () => {
    signedInAs('max', 'technician')
    await mount(
      '/start',
      [
        task('t-1', { title: 'Für Max', assigneeUserId: 'max' }),
        task('t-2', { title: 'Für Britta' }),
      ],
      () => <MyTasks />,
    )

    const mine = within(await screen.findByRole('region', { name: 'Deine Aufgaben' }))

    expect(await mine.findByText('Für Max')).toBeDefined()
    expect(mine.queryByText('Für Britta')).toBeNull()
  })

  it('shows nothing when nothing is open for them', async () => {
    signedInAs('max', 'technician')
    await mount('/start', [task('t-2', { title: 'Für Britta' })], () => <MyTasks />)

    await waitFor(() => {
      expect(screen.queryByRole('region', { name: 'Deine Aufgaben' })).toBeNull()
    })
  })
})
