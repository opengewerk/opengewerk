import 'fake-indexeddb/auto'

import type { Operation, OperationReceipt, RecordState, SyncConflict } from '@opengewerk/domain'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { render, screen, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { ConflictScreen } from './conflicts.js'
import { DataTable } from './data-table.js'
import type { ListColumns } from './data-table.js'
import { EntrySuggestion } from './suggestion.js'
import { SyncStatusBar } from './sync-bar.js'
import { entryChoiceKey } from '../entry/entry.js'
import type { DirectWriter } from '../sync/client.js'
import { SyncClient } from '../sync/client.js'
import { text } from '../sync/fields.js'
import { SyncProvider } from '../sync/provider.js'
import { openLocalStore } from '../sync/store.js'
import type { PullResult, SyncTransport } from '../sync/transport.js'

/** A server that says yes and remembers what it was asked. */
class Quiet implements SyncTransport, DirectWriter {
  readonly sent: Operation[][] = []
  readonly patched: { entity: string; id: string; values: unknown }[] = []
  readonly resolved: string[] = []
  open: SyncConflict[] = []
  pulls: PullResult[] = []

  push(_deviceId: string, operations: readonly Operation[]) {
    this.sent.push([...operations])

    return Promise.resolve(
      operations.map((operation): OperationReceipt => ({
        operationId: operation.id,
        outcome: 'applied',
        reason: null,
        fields: [],
      })),
    )
  }

  pull(_since: number) {
    return Promise.resolve(this.pulls.shift() ?? { changes: [], cursor: 0, hasMore: false })
  }

  conflicts() {
    return Promise.resolve(this.open)
  }

  resolve(id: string) {
    this.resolved.push(id)
    this.open = this.open.filter((entry) => entry.id !== id)

    return Promise.resolve()
  }

  patch(entity: string, id: string, values: Readonly<Record<string, unknown>>) {
    this.patched.push({ entity, id, values })

    return Promise.resolve(undefined)
  }

  remove() {
    return Promise.resolve(undefined)
  }
}

let counter = 0

async function withClient(server: Quiet, rows: Record<string, RecordState[]> = {}) {
  const store = await openLocalStore(`screen${String((counter += 1))}`)

  server.pulls = [
    {
      changes: Object.entries(rows).map(([entity, entries]) => ({ entity, rows: entries })),
      cursor: 1,
      hasMore: false,
    },
  ]

  const client = await SyncClient.start({
    store,
    transport: server,
    writer: server,
    deviceId: 'device',
    entities: ['customers', 'jobs'],
    onSignedOut: () => {},
  })

  await client.synchronise()

  return client
}

function conflict(part: Partial<SyncConflict> = {}): SyncConflict {
  return {
    id: 'k-1',
    tenantId: 'mandant',
    operationId: 'op-1',
    entity: 'jobs',
    recordId: 'j-1',
    reason: 'changed_elsewhere',
    fields: ['designation'],
    wanted: { designation: 'Zählerwechsel' },
    seen: { designation: 'Zählertausch' },
    found: { designation: 'Zähler prüfen' },
    deviceId: 'device',
    recordedAt: new Date('2026-09-20T07:30:00Z'),
    resolvedAt: null,
    createdAt: new Date('2026-09-20T07:30:00Z'),
    updatedAt: new Date('2026-09-20T07:30:00Z'),
    ...part,
  } as SyncConflict
}

describe('the conflict screen', () => {
  let server: Quiet

  beforeEach(() => {
    server = new Quiet()
  })

  it('puts both versions beside each other, and what the device had seen', async () => {
    server.open = [conflict()]

    const client = await withClient(server, {
      jobs: [{ id: 'j-1', designation: 'Zähler prüfen', version: 2, deletedAt: null }],
    })

    render(
      <SyncProvider client={client}>
        <ConflictScreen />
      </SyncProvider>,
    )

    // Three columns and not two. The third is what explains the other two:
    // without it a person sees two values and no reason why anyone would have
    // typed either. Asked of the row rather than of the page, because the
    // heading says what the record is called now and that is one of the three.
    const row = within(screen.getByRole('row', { name: /Bezeichnung/ }))

    expect(row.getByText('Zählerwechsel')).toBeDefined()
    expect(row.getByText('Zähler prüfen')).toBeDefined()
    expect(row.getByText('Zählertausch')).toBeDefined()
  })

  it('lets the device win, and sends that as an ordinary change', async () => {
    server.open = [conflict()]

    const client = await withClient(server, {
      jobs: [{ id: 'j-1', designation: 'Zähler prüfen', version: 2, deletedAt: null }],
    })

    render(
      <SyncProvider client={client}>
        <ConflictScreen />
      </SyncProvider>,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Fassung vom Gerät übernehmen' }))

    // Deciding a conflict is not a back door. The decision leaves through the
    // outbox like any other change, so it passes the same rules and lands in
    // the same audit log.
    expect(server.sent.at(-1)?.[0]?.patches).toEqual([
      { field: 'designation', from: 'Zähler prüfen', to: 'Zählerwechsel' },
    ])
    expect(server.resolved).toEqual(['k-1'])
  })

  it('keeps the server version when that is what somebody decides', async () => {
    server.open = [conflict()]

    const client = await withClient(server, {
      jobs: [{ id: 'j-1', designation: 'Zähler prüfen', version: 2, deletedAt: null }],
    })

    render(
      <SyncProvider client={client}>
        <ConflictScreen />
      </SyncProvider>,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Stand im System behalten' }))

    expect(server.sent).toEqual([])
    expect(server.resolved).toEqual(['k-1'])
  })

  it('says so plainly when there is nothing to decide', async () => {
    const client = await withClient(server)

    render(
      <SyncProvider client={client}>
        <ConflictScreen />
      </SyncProvider>,
    )

    expect(screen.getByText(/Nichts zu entscheiden/)).toBeDefined()
  })
})

describe('the bar above every screen', () => {
  it('interrupts for a conflict and only for a conflict', async () => {
    const server = new Quiet()

    server.open = [conflict()]

    const client = await withClient(server)

    render(
      <SyncProvider client={client}>
        <SyncStatusBar />
      </SyncProvider>,
    )

    // `alert` is announced at once. Using it for the quiet states as well
    // would train people to ignore it, which is the opposite of the point.
    expect(screen.getByRole('alert').textContent).toContain('Ein Konflikt wartet')
  })

  it('says everything arrived when the outbox is empty', async () => {
    const client = await withClient(new Quiet())

    render(
      <SyncProvider client={client}>
        <SyncStatusBar />
      </SyncProvider>,
    )

    expect(screen.getByRole('status').textContent).toContain('Alles abgeglichen')
  })

  it('counts what is still on the device when the server cannot be reached', async () => {
    const server = new Quiet()
    const client = await withClient(server)

    server.push = () => Promise.reject(new TypeError('Failed to fetch'))

    await client.create('customers', { name: 'Meyer', kind: 'private' })
    await client.synchronise()

    render(
      <SyncProvider client={client}>
        <SyncStatusBar />
      </SyncProvider>,
    )

    expect(screen.getByRole('status').textContent).toContain('1 Änderung auf dem Gerät')
  })
})

describe('the suggestion to switch entry', () => {
  beforeEach(() => {
    globalThis.localStorage.clear()
  })

  it('offers the site entry to something with only a finger', () => {
    // happy-dom answers no to every media query, which is the "browser says
    // neither" case, so the traits are forced here instead.
    globalThis.matchMedia = ((query: string) =>
      ({ matches: query === '(pointer: coarse)' }) as MediaQueryList) as typeof matchMedia

    render(<EntrySuggestion here="office" />)

    expect(screen.getByRole('link', { name: 'Zur Baustellenansicht' })).toBeDefined()
  })

  it('never asks again once somebody has said they want to stay', async () => {
    globalThis.matchMedia = ((query: string) =>
      ({ matches: query === '(pointer: coarse)' }) as MediaQueryList) as typeof matchMedia

    const { unmount } = render(<EntrySuggestion here="office" />)

    await userEvent.click(screen.getByRole('button', { name: 'Hier bleiben' }))

    expect(globalThis.localStorage.getItem(entryChoiceKey)).toBe('office')

    unmount()
    render(<EntrySuggestion here="office" />)

    expect(screen.queryByRole('link', { name: 'Zur Baustellenansicht' })).toBeNull()
  })
})

describe('a list in the office', () => {
  const columns: ListColumns = [
    { id: 'name', accessorFn: (row) => text(row, 'name'), header: 'Name' },
    { id: 'city', accessorFn: (row) => text(row, 'city'), header: 'Ort' },
  ]

  const rows: RecordState[] = [
    { id: 'c-1', name: 'Meyer', city: 'Edingen' },
    { id: 'c-2', name: 'Schulz', city: 'Mannheim' },
  ]

  /**
   * A router around the list, because every row is a link and a link needs one.
   * A memory history rather than the address bar: the test is about the search
   * box, not about where a row leads.
   */
  function inARouter(element: React.ReactNode) {
    const root = createRootRoute({ component: () => element })

    return (
      <RouterProvider router={createRouter({ routeTree: root, history: createMemoryHistory() })} />
    )
  }

  it('narrows to what somebody typed, and says how many are left', async () => {
    render(
      inARouter(
        <DataTable
          caption="Kunden"
          rows={rows}
          columns={columns}
          searchLabel="Kunden suchen"
          hrefFor={(row) => `/kunden/${String(row['id'])}`}
          empty="Nichts da."
        />,
      ),
    )

    expect(await screen.findByText('2 Einträge')).toBeDefined()

    await userEvent.type(screen.getByLabelText('Kunden suchen'), 'Mannheim')

    expect(await screen.findByText('1 von 2 Einträgen')).toBeDefined()
    expect(screen.queryByText('Meyer')).toBeNull()
  })

  it('sends the slash key to the search box, the way every list does', async () => {
    render(
      inARouter(
        <DataTable
          caption="Kunden"
          rows={rows}
          columns={columns}
          searchLabel="Kunden suchen"
          hrefFor={(row) => `/kunden/${String(row['id'])}`}
          empty="Nichts da."
        />,
      ),
    )

    const search = await screen.findByLabelText('Kunden suchen')

    expect(document.activeElement).not.toBe(search)

    await userEvent.keyboard('/')

    expect(document.activeElement).toBe(search)
  })
})
