import 'fake-indexeddb/auto'

import { openLocalStore } from '@opengewerk/platform-web/sync'
import { TestServer } from '@opengewerk/platform-web/testing'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { stopwatchName, SyncClient } from './client.js'
import { siteTransport } from './transport.js'

// The sync client is the foundation's and is tested there, with records no
// application has. What is held here is the binding: that the client of this
// application decides by its own policies, keeps what its screens rely on a
// device to keep, and that the site asks the server what only the site asks.

let counter = 0

async function start(server: TestServer, entities: readonly string[], name?: string) {
  return await SyncClient.start({
    store: await openLocalStore(name ?? `binding${String((counter += 1))}`),
    transport: server,
    writer: server,
    deviceId: 'device',
    entities,
    onSignedOut: () => {},
  })
}

describe('the sync client of this application', () => {
  it('starts a report made in a cellar as a draft, and takes its first line', async () => {
    const server = new TestServer()
    const client = await start(server, ['documents', 'document_lines'])

    server.offline = true

    const report = await client.create('documents', {
      kind: 'time_and_material_report',
      customerId: 'c-1',
      documentDate: '2026-10-02',
    })

    if (report.outcome !== 'queued') {
      throw new Error('The report itself was refused')
    }

    // The status is the server's to write. That a document starts as a draft
    // is what the policy of this application says, and the gate of a line
    // asks for exactly that.
    expect(client.get('documents', report.id)?.['status']).toBe('draft')
    expect(
      (
        await client.create('document_lines', {
          documentId: report.id,
          position: 1,
          designation: 'Arbeitszeit',
          quantityMilli: 2500,
          unit: 'hour',
          unitPriceCents: 0,
        })
      ).outcome,
    ).toBe('queued')
  })

  it('refuses a position on a document that has been issued', async () => {
    const server = new TestServer()

    server.put('documents', { id: 'd-1', status: 'issued', number: 'RE-2026-0001' })

    const client = await start(server, ['documents', 'document_lines'])

    await client.synchronise()

    expect(
      await client.create('document_lines', { documentId: 'd-1', designation: 'Nachtrag' }),
    ).toEqual({ outcome: 'refused', reason: 'record_is_fixed', fields: ['status'] })
  })

  it('corrects a customer only with a connection, and writes an installation through the outbox', async () => {
    const client = await start(new TestServer(), ['customers', 'installations'])

    expect(client.needsConnection('customers')).toBe(true)
    expect(client.needsConnection('installations')).toBe(false)
  })

  it('never sends the number of a job, which the server draws from its range', async () => {
    const server = new TestServer()

    server.put('jobs', { id: 'j-1', designation: 'Zählertausch', number: 'AU-2026-0001' })

    const client = await start(server, ['jobs'])

    await client.synchronise()
    await client.update('jobs', 'j-1', { designation: 'Zählerwechsel', number: 'AU-2026-0099' })
    await client.synchronise()

    expect(server.operations().map((operation) => operation.patches)).toEqual([
      [{ field: 'designation', from: 'Zählertausch', to: 'Zählerwechsel' }],
    ])
  })

  it('knows no record of another application', async () => {
    const client = await start(new TestServer(), [])

    expect(await client.create('shelves', { name: 'Regal' })).toEqual({
      outcome: 'refused',
      reason: 'unknown_entity',
      fields: [],
    })
  })
})

describe('the stopwatch a device keeps for itself', () => {
  it('is found after an update, under the name it has always been stored by', async () => {
    // A stopwatch that was running when the device took the new build over is
    // somebody's working time. The client keeps it under the name the build
    // before stored it by.
    const store = await openLocalStore('running-stopwatch')

    await store.writeMeta('stopwatch', '{"kind":"work","startedAt":"2026-10-02T06:00:00.000Z"}')
    store.close()

    const client = await start(new TestServer(), ['time_entries'], 'running-stopwatch')

    expect(stopwatchName).toBe('stopwatch')
    expect(client.kept(stopwatchName)).toBe(
      '{"kind":"work","startedAt":"2026-10-02T06:00:00.000Z"}',
    )
  })

  it('is kept over a restart and let go when it stops', async () => {
    const first = await start(new TestServer(), ['time_entries'], 'stopwatch-restart')

    await first.keep(stopwatchName, '{"kind":"travel"}')
    first.stop()

    const again = await start(new TestServer(), ['time_entries'], 'stopwatch-restart')

    expect(again.kept(stopwatchName)).toBe('{"kind":"travel"}')

    await again.keep(stopwatchName, null)

    expect(again.kept(stopwatchName)).toBeNull()
  })
})

describe('the transport of the site', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('asks for the values of the ways into a site with its pull, and only there', async () => {
    const asked: string[] = []

    vi.stubGlobal('fetch', (path: string) => {
      asked.push(path)

      return Promise.resolve(
        new Response(JSON.stringify({ changes: [], cursor: 5, hasMore: false }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    })

    const transport = siteTransport()

    expect(await transport.pull(5)).toEqual({ changes: [], cursor: 5, hasMore: false })
    await transport.conflicts()

    expect(asked).toEqual(['/sync?since=5&access=values', '/sync/conflicts'])
  })
})
