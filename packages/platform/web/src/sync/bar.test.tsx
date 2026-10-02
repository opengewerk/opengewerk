import 'fake-indexeddb/auto'

import type { Operation, OperationReceipt, SyncConflict } from '@opengewerk/platform-domain'
import { syncRules } from '@opengewerk/platform-domain'
import { probePolicies } from '@opengewerk/platform-domain/testing'
import { render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { Shell } from '../components/surface.js'
import { SyncStatusBar } from './bar.js'
import { type DirectWriter, SyncClient } from './client.js'
import { SyncProvider } from './provider.js'
import { openLocalStore } from './store.js'
import { type PullResult, RequestRefused, type SyncTransport } from './transport.js'

/** A server that says yes and remembers what it was asked. */
class Quiet implements SyncTransport, DirectWriter {
  readonly sent: Operation[][] = []
  open: SyncConflict[] = []
  pulls = 0

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

  pull(_since: number): Promise<PullResult> {
    this.pulls += 1

    return Promise.resolve({ changes: [], cursor: 0, hasMore: false })
  }

  conflicts() {
    return Promise.resolve(this.open)
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
}

let counter = 0

async function withClient(server: Quiet) {
  const client = await SyncClient.start({
    store: await openLocalStore(`bar${String((counter += 1))}`),
    transport: server,
    writer: server,
    rules: syncRules(probePolicies),
    deviceId: 'device',
    entities: ['shelves', 'notes'],
    onSignedOut: () => {},
  })

  await client.synchronise()

  return client
}

const conflict = { id: 'k-1', entity: 'notes', recordId: 'n-1' } as unknown as SyncConflict

/** The answer of a server that refuses a transmission over its first operation. */
function refusingTheFirst(_deviceId: string, operations: readonly Operation[]) {
  return Promise.reject(
    new RequestRefused(400, 'Unbekanntes Feld: quatsch', {
      statusCode: 400,
      message: 'Unbekanntes Feld: quatsch',
      operationId: operations[0]?.id,
    }),
  )
}

describe('the bar above every screen', () => {
  it('interrupts for a conflict and only for a conflict', async () => {
    const server = new Quiet()

    server.open = [conflict]

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

  it('counts the conflicts when there is more than one', async () => {
    const server = new Quiet()

    server.open = [conflict, { ...conflict, id: 'k-2' } as unknown as SyncConflict]

    const client = await withClient(server)

    render(
      <SyncProvider client={client}>
        <SyncStatusBar />
      </SyncProvider>,
    )

    expect(screen.getByRole('alert').textContent).toContain('2 Konflikte warten')
  })

  it('stops for an entry the server refused, ahead of any conflict', async () => {
    const server = new Quiet()

    server.open = [conflict]

    const client = await withClient(server)

    server.push = refusingTheFirst

    await client.create('shelves', { name: 'Hall', kind: 'wood' })
    await client.synchronise()

    render(
      <SyncProvider client={client}>
        <SyncStatusBar />
      </SyncProvider>,
    )

    // Ahead of the conflict, because deciding the conflict would not get out
    // either: a decision leaves through the same outbox.
    const bar = screen.getByRole('alert')

    expect(bar.textContent).toContain('Der Server nimmt eine Änderung nicht an')
    expect(bar.textContent).not.toContain('Konflikt')
  })

  it('draws the way to the conflicts where the application hands it one', async () => {
    const server = new Quiet()

    server.open = [conflict]

    const client = await withClient(server)

    render(
      <SyncProvider client={client}>
        <SyncStatusBar
          conflictsLink={(className) => (
            <a href="/conflicts" className={className}>
              Entscheiden
            </a>
          )}
        />
      </SyncProvider>,
    )

    // The two entries route there each in their own router, so the link is
    // the application's and only its look is the strip's.
    const link = screen.getByRole('link', { name: 'Entscheiden' })

    expect(link.getAttribute('href')).toBe('/conflicts')
    expect(link.className).not.toBe('')
  })

  it('shows no strip when the outbox is empty', async () => {
    // Everything arrived is not a thing to do. A bar over every screen said
    // nothing most of the time (#217).
    const client = await withClient(new Quiet())

    const { container } = render(
      <SyncProvider client={client}>
        <SyncStatusBar />
      </SyncProvider>,
    )

    expect(screen.queryByRole('status')).toBeNull()
    expect(container.textContent).toBe('')
  })

  it('counts what is still on the device when the server cannot be reached', async () => {
    const server = new Quiet()
    const client = await withClient(server)

    server.push = () => Promise.reject(new TypeError('Failed to fetch'))

    await client.create('shelves', { name: 'Hall', kind: 'wood' })
    await client.synchronise()

    render(
      <SyncProvider client={client}>
        <SyncStatusBar />
      </SyncProvider>,
    )

    expect(screen.getByRole('status').textContent).toContain('1 Änderung auf dem Gerät')
  })

  it('says the state first and the count under it on site, and both in one line in the office', async () => {
    const server = new Quiet()
    const client = await withClient(server)

    server.push = () => Promise.reject(new TypeError('Failed to fetch'))

    await client.create('shelves', { name: 'Hall', kind: 'wood' })
    await client.create('shelves', { name: 'Loft', kind: 'wood' })
    await client.synchronise()

    const { unmount } = render(
      <Shell entry="site">
        <SyncProvider client={client}>
          <SyncStatusBar />
        </SyncProvider>
      </Shell>,
    )

    // Two elements on site: the sentence that names the state, and the count.
    expect(screen.getByText('Keine Verbindung.').textContent).toBe('Keine Verbindung.')
    expect(screen.getByText('2 Änderungen auf dem Gerät.')).toBeDefined()
    unmount()

    render(
      <Shell entry="office">
        <SyncProvider client={client}>
          <SyncStatusBar />
        </SyncProvider>
      </Shell>,
    )

    expect(screen.getByRole('status').textContent).toContain(
      '2 Änderungen auf dem Gerät. Keine Verbindung. Die Änderungen bleiben auf dem Gerät.',
    )
  })

  it('tries again when somebody asks it to', async () => {
    const server = new Quiet()
    const client = await withClient(server)
    const push = server.push.bind(server)

    server.push = () => Promise.reject(new TypeError('Failed to fetch'))

    await client.create('shelves', { name: 'Hall', kind: 'wood' })
    await client.synchronise()

    render(
      <SyncProvider client={client}>
        <SyncStatusBar />
      </SyncProvider>,
    )

    server.push = push
    await userEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }))

    expect(server.sent.flat().map((operation) => operation.entity)).toEqual(['shelves'])
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('says nothing about the connection while a change is on its way (#223)', async () => {
    const server = new Quiet()
    const client = await withClient(server)

    // A send that has not answered yet: the change waits, nothing went wrong.
    server.push = () => new Promise(() => {})

    await client.create('shelves', { name: 'Hall', kind: 'wood' })
    void client.synchronise()

    const { container } = render(
      <SyncProvider client={client}>
        <SyncStatusBar />
      </SyncProvider>,
    )

    expect(client.status().pending).toBe(1)
    expect(screen.queryByRole('status')).toBeNull()
    expect(container.textContent).toBe('')
  })
})
