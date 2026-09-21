import 'fake-indexeddb/auto'

import type {
  Operation,
  OperationId,
  OperationReceipt,
  RecordState,
  SyncConflict,
} from '@opengewerk/domain'
import { beforeEach, describe, expect, it } from 'vitest'

import type { DirectWriter, SyncClient } from './client.js'
import { SyncClient as Client } from './client.js'
import { byRecord, project } from './projection.js'
import { openLocalStore } from './store.js'
import type { ChangedRows, PullResult, SyncTransport } from './transport.js'
import { RequestRefused } from './transport.js'

const entities = [
  'customers',
  'sites',
  'installations',
  'jobs',
  'documents',
  'document_lines',
  'document_signatures',
]

const operationId = (value: string) => value as unknown as OperationId

/**
 * A server that answers whatever the test tells it to, and writes down what it
 * was asked. The point of the whole layer is what it does without a server, so
 * a test that needed one would be testing the wrong half.
 */
class Recorded implements SyncTransport {
  readonly sent: Operation[][] = []

  receipts: (operations: readonly Operation[]) => readonly OperationReceipt[] = (operations) =>
    operations.map((operation) => ({
      operationId: operation.id,
      outcome: 'applied' as const,
      reason: null,
      fields: [],
    }))

  pulls: PullResult[] = []
  open: SyncConflict[] = []
  readonly resolved: string[] = []
  /** The cursor of every pull, in order. */
  readonly asked: number[] = []
  refuse: Error | null = null

  push(_deviceId: string, operations: readonly Operation[]) {
    if (this.refuse) {
      return Promise.reject(this.refuse)
    }

    this.sent.push([...operations])

    return Promise.resolve(this.receipts(operations))
  }

  pull(since: number) {
    if (this.refuse) {
      return Promise.reject(this.refuse)
    }

    this.asked.push(since)

    return Promise.resolve(this.pulls.shift() ?? { changes: [], cursor: since, hasMore: false })
  }

  conflicts() {
    return this.refuse ? Promise.reject(this.refuse) : Promise.resolve(this.open)
  }

  resolve(id: string) {
    this.resolved.push(id)

    return Promise.resolve()
  }
}

/**
 * The second way a change reaches the server, for the records that may not
 * wait in an outbox. It says yes or throws, and both are worth a test.
 */
class Writing implements DirectWriter {
  readonly patched: { entity: string; id: string; values: unknown }[] = []
  readonly removed: string[] = []
  refuse: Error | null = null

  patch(entity: string, id: string, values: Readonly<Record<string, unknown>>) {
    if (this.refuse) {
      return Promise.reject(this.refuse)
    }

    this.patched.push({ entity, id, values })

    return Promise.resolve(undefined)
  }

  remove(entity: string, id: string) {
    this.removed.push(`${entity}/${id}`)

    return Promise.resolve(undefined)
  }
}

let counter = 0
let writer = new Writing()

async function start(transport: SyncTransport, name?: string) {
  const store = await openLocalStore(name ?? `t${String((counter += 1))}`)

  writer = new Writing()

  return await Client.start({
    store,
    transport,
    writer,
    deviceId: name ? `device-${name}` : 'device',
    entities,
    onSignedOut: () => {},
  })
}

function row(values: Partial<RecordState> & { id: string }): RecordState {
  return { version: 1, deletedAt: null, changeSequence: 1, ...values }
}

/**
 * Puts records into the client the way they really arrive, through a pull.
 * A back door that wrote straight into its memory would be a back door the
 * production code has to keep open for the tests.
 */
async function holding(
  client: SyncClient,
  transport: Recorded,
  ...changes: readonly ChangedRows[]
): Promise<void> {
  transport.pulls = [{ changes, cursor: 1, hasMore: false }]

  await client.synchronise()
}

describe('the projection', () => {
  const at = new Date('2026-09-20T08:00:00Z')

  function operation(part: Partial<Operation>): Operation {
    return {
      id: operationId('op-1'),
      entity: 'customers',
      recordId: 'c-1',
      kind: 'update',
      baseVersion: 1,
      patches: [],
      recordedAt: at,
      deviceId: 'device',
      ...part,
    }
  }

  it('gives a record that has never been sent the id it was minted with', () => {
    const created = project(
      null,
      [operation({ kind: 'create', patches: [{ field: 'name', from: null, to: 'Meyer' }] })],
      'c-1',
    )

    // The id is not in the patches and must not be: the server keeps that
    // column and refuses a patch naming it. It travels as `recordId`.
    expect(created).toEqual({ name: 'Meyer', id: 'c-1' })
  })

  it('lays a change over what the server said without losing the rest', () => {
    const shown = project(
      row({ id: 'c-1', name: 'Meyer', phone: '0621' }),
      [operation({ patches: [{ field: 'name', from: 'Meyer', to: 'Meyer GmbH' }] })],
      'c-1',
    )

    expect(shown?.['name']).toBe('Meyer GmbH')
    expect(shown?.['phone']).toBe('0621')
  })

  it('applies two queued changes in the order they were recorded', () => {
    const shown = project(
      row({ id: 'c-1', name: 'Meyer' }),
      [
        operation({
          id: operationId('op-2'),
          recordedAt: new Date('2026-09-20T09:00:00Z'),
          patches: [{ field: 'name', from: 'A', to: 'B' }],
        }),
        operation({ patches: [{ field: 'name', from: 'Meyer', to: 'A' }] }),
      ],
      'c-1',
    )

    expect(shown?.['name']).toBe('B')
  })

  it('shows nothing for a record the outbox deletes', () => {
    expect(project(row({ id: 'c-1' }), [operation({ kind: 'delete' })], 'c-1')).toBeNull()
  })

  it('groups an outbox by the record each operation belongs to', () => {
    const grouped = byRecord([
      operation({}),
      operation({ id: operationId('op-2') }),
      operation({ id: operationId('op-3'), entity: 'sites', recordId: 's-1' }),
    ])

    expect(grouped.get('customers::c-1')).toHaveLength(2)
    expect(grouped.get('sites::s-1')).toHaveLength(1)
  })
})

describe('a device without a network', () => {
  let transport: Recorded

  beforeEach(() => {
    transport = new Recorded()
  })

  it('shows what somebody entered, although nothing has been sent', async () => {
    const client = await start(transport)

    transport.refuse = new TypeError('Failed to fetch')

    const made = await client.create('customers', { name: 'Meyer', kind: 'private' })

    expect(made.outcome).toBe('queued')
    expect(client.list('customers').map((entry) => entry['name'])).toEqual(['Meyer'])
    expect(client.status().pending).toBe(1)
    expect(client.status().state).toBe('offline')
  })

  it('keeps the outbox over a restart, which is the whole point of it', async () => {
    const name = 'restart'
    const first = await start(transport, name)

    transport.refuse = new TypeError('Failed to fetch')
    await first.create('customers', { name: 'Meyer', kind: 'private' })
    first.stop()

    const again = await start(transport, name)

    expect(again.status().pending).toBe(1)
    expect(again.list('customers').map((entry) => entry['name'])).toEqual(['Meyer'])
  })

  it('refuses a change to master data instead of queueing one it cannot keep', async () => {
    const client = await start(transport)

    await holding(client, transport, {
      entity: 'customers',
      rows: [row({ id: 'c-1', name: 'Meyer', kind: 'private' })],
    })

    transport.refuse = new TypeError('Failed to fetch')
    writer.refuse = new TypeError('Failed to fetch')

    const tried = await client.update('customers', 'c-1', { name: 'Meyer GmbH' })

    // ADR 0005 lets a technician add a customer and not correct one. Refusing
    // here, with the form still open, beats an outbox entry that can never
    // land and a person who finds out two hours later.
    expect(tried).toEqual({ outcome: 'refused', reason: 'online_only', fields: [] })
    expect(client.status().pending).toBe(0)
    expect(client.needsConnection('customers')).toBe(true)
  })

  it('refuses a position whose document has been issued', async () => {
    const client = await start(transport)

    await holding(
      client,
      transport,
      { entity: 'documents', rows: [row({ id: 'd-1', status: 'issued', number: 'RE-2026-0001' })] },
      {
        entity: 'document_lines',
        rows: [row({ id: 'l-1', documentId: 'd-1', quantityMilli: 1000 })],
      },
    )

    const tried = await client.update('document_lines', 'l-1', { quantityMilli: 2000 })

    // The rule sits on the document, not on the line, and the device works out
    // the same answer the server would, because `decideMerge` lives in
    // `domain` and the device already holds the document.
    expect(tried).toEqual({ outcome: 'refused', reason: 'record_is_fixed', fields: ['status'] })
  })

  it('lets a position be written while its document is still a draft', async () => {
    const client = await start(transport)

    await holding(
      client,
      transport,
      { entity: 'documents', rows: [row({ id: 'd-1', status: 'draft', number: null })] },
      {
        entity: 'document_lines',
        rows: [row({ id: 'l-1', documentId: 'd-1', quantityMilli: 1000 })],
      },
    )

    expect((await client.update('document_lines', 'l-1', { quantityMilli: 2000 })).outcome).toBe(
      'queued',
    )
  })

  /**
   * A new line exists only in the operation that creates it, so the document
   * it belongs to has to be read from there. Read from the stored record, as
   * it once was, every new line looked like one without a document and was
   * refused before it left the device.
   */
  it('finds the document of a new position in what the position is created with', async () => {
    const client = await start(transport)

    await holding(client, transport, {
      entity: 'documents',
      rows: [
        row({ id: 'd-1', status: 'draft', number: null }),
        row({ id: 'd-2', status: 'issued', number: 'AN-2026-0001' }),
      ],
    })

    const line = { designation: 'Zählerschrank setzen', quantityMilli: 1000, unitPriceCents: 1 }

    expect((await client.create('document_lines', { ...line, documentId: 'd-1' })).outcome).toBe(
      'queued',
    )
    expect(await client.create('document_lines', { ...line, documentId: 'd-2' })).toEqual({
      outcome: 'refused',
      reason: 'record_is_fixed',
      fields: ['status'],
    })
  })

  /**
   * A document made on this device has no status until the server answers.
   * The gates that ask for one found nothing there and refused, and a report
   * written in a cellar turned down its own first line as already fixed.
   */
  it('lets a document made on the device take lines and changes before the server has it', async () => {
    const client = await start(transport)

    transport.refuse = new TypeError('Failed to fetch')

    const report = await client.create('documents', {
      kind: 'time_and_material_report',
      customerId: 'c-1',
      documentDate: '2026-09-21',
    })

    if (report.outcome !== 'queued') {
      throw new Error('The report itself was refused')
    }

    expect(client.get('documents', report.id)?.['status']).toBe('draft')

    const results = [
      await client.update('documents', report.id, { introText: 'Sicherungen getauscht.' }),
      await client.create('document_lines', {
        documentId: report.id,
        position: 1,
        designation: 'Arbeitszeit',
        quantityMilli: 2500,
        unit: 'hour',
        unitPriceCents: 0,
      }),
      await client.create('document_signatures', {
        documentId: report.id,
        signerName: 'Erika Berg',
        signedAt: '2026-09-21T12:32:00.000Z',
        deviceInfo: 'Testgerät',
        path: 'M100,300L200,120',
        contentFingerprint: 'fnv1a32:00000000:0',
      }),
    ]

    expect(results.map((result) => result.outcome)).toEqual(['queued', 'queued', 'queued'])

    // The status is what the device assumes, not what it sends: the field is
    // the server's, and naming it in a patch is refused. The first exchange
    // is the failing one still under way; after a failure the client waits to
    // be asked again, so the network coming back is a second call.
    await client.synchronise()
    transport.refuse = null
    await client.synchronise()

    const created = transport.sent
      .flat()
      .find((operation) => operation.entity === 'documents' && operation.kind === 'create')

    expect(created?.patches.map((patch) => patch.field)).not.toContain('status')
  })

  it('never sends a field the server keeps, whatever a form hands it', async () => {
    const client = await start(transport)

    await holding(client, transport, {
      entity: 'jobs',
      rows: [row({ id: 'j-1', designation: 'Zählertausch', status: 'active' })],
    })

    await client.update('jobs', 'j-1', {
      designation: 'Zählerwechsel',
      // What a form carrying the whole record would send back. The server
      // refuses the entire transmission over one of these, so an outbox that
      // let them through would stop working altogether.
      id: 'j-1',
      version: 1,
      tenantId: 'mandant',
      updatedAt: '2026-09-20T00:00:00.000Z',
    })

    expect(transport.sent.at(-1)?.[0]?.patches.map((patch) => patch.field)).toEqual(['designation'])
  })
})

/**
 * A device that already holds data and gets a new build. The cursor it kept
 * was moved by the old build, past every row of a kind the old build did not
 * know, and the new build must not trust it for those.
 */
describe('a new build on a device that already has data', () => {
  let transport: Recorded

  beforeEach(() => {
    transport = new Recorded()
  })

  async function startWith(known: readonly string[], name: string) {
    return await Client.start({
      store: await openLocalStore(name),
      transport,
      writer: new Writing(),
      deviceId: 'device',
      entities: known,
      onSignedOut: () => {},
    })
  }

  const signature = row({ id: 's-1', documentId: 'd-1', signerName: 'Erika Berg' })

  it('asks from the beginning once when it knows a kind of record the last build did not', async () => {
    const older = await startWith(['customers'], 'upgrade')

    transport.pulls = [
      {
        changes: [
          { entity: 'customers', rows: [row({ id: 'c-1', name: 'Meyer', kind: 'private' })] },
          { entity: 'document_signatures', rows: [signature] },
        ],
        cursor: 7,
        hasMore: false,
      },
    ]
    await older.synchronise()
    older.stop()

    const newer = await startWith(['customers', 'document_signatures'], 'upgrade')

    transport.pulls = [
      {
        changes: [{ entity: 'document_signatures', rows: [signature] }],
        cursor: 7,
        hasMore: false,
      },
    ]
    await newer.synchronise()

    expect(transport.asked).toEqual([0, 0])
    expect(newer.list('document_signatures').map((entry) => entry['signerName'])).toEqual([
      'Erika Berg',
    ])
  })

  it('keeps its place when it knows nothing the last build did not', async () => {
    const first = await startWith(['customers'], 'same-build')

    transport.pulls = [{ changes: [], cursor: 7, hasMore: false }]
    await first.synchronise()
    first.stop()

    await (await startWith(['customers'], 'same-build')).synchronise()

    expect(transport.asked).toEqual([0, 7])
  })

  it('asks from the beginning after a build that kept no list, and only the once', async () => {
    const store = await openLocalStore('before-the-list')

    await store.writeMeta('cursor', 7)
    store.close()

    const first = await startWith(['customers'], 'before-the-list')

    transport.pulls = [{ changes: [], cursor: 9, hasMore: false }]
    await first.synchronise()
    first.stop()

    await (await startWith(['customers'], 'before-the-list')).synchronise()

    expect(transport.asked).toEqual([0, 9])
  })

  it('starts again after going back to a build that knew less and forward once more', async () => {
    const both = ['customers', 'document_signatures']

    const first = await startWith(both, 'back-and-forth')

    transport.pulls = [{ changes: [], cursor: 5, hasMore: false }]
    await first.synchronise()
    first.stop()

    const back = await startWith(['customers'], 'back-and-forth')

    transport.pulls = [{ changes: [], cursor: 8, hasMore: false }]
    await back.synchronise()
    back.stop()

    await (await startWith(both, 'back-and-forth')).synchronise()

    // The build in the middle dropped whatever signatures arrived between 5
    // and 8, so the third asks from the beginning and not from 8.
    expect(transport.asked).toEqual([0, 5, 0])
  })
})

describe('an exchange with the server', () => {
  let transport: Recorded

  beforeEach(() => {
    transport = new Recorded()
  })

  it('empties the outbox for every operation it got a receipt for', async () => {
    const client = await start(transport)

    await client.create('customers', { name: 'Meyer', kind: 'private' })
    await client.synchronise()

    expect(client.status().pending).toBe(0)
    expect(client.status().state).toBe('synced')
  })

  it('takes a refused operation off the outbox and goes back to what the server holds', async () => {
    const client = await start(transport)

    await holding(client, transport, {
      entity: 'jobs',
      rows: [row({ id: 'j-1', designation: 'Zählertausch', status: 'active' })],
    })

    transport.receipts = (operations) =>
      operations.map((operation) => ({
        operationId: operation.id,
        outcome: 'conflict' as const,
        reason: 'changed_elsewhere',
        fields: ['designation'],
      }))
    transport.open = [{ id: 'k-1', entity: 'jobs', recordId: 'j-1' } as unknown as SyncConflict]

    await client.update('jobs', 'j-1', { designation: 'Zählerwechsel' })

    expect(client.get('jobs', 'j-1')?.['designation']).toBe('Zählerwechsel')

    await client.synchronise()

    // This is why the outbox is laid over the server state instead of written
    // into it. The server refused, so nothing about the record changed there
    // and the next delta brings nothing down. Written into the local copy, the
    // change would sit on the screen as a value that exists nowhere else, for
    // ever, and no synchronisation would ever correct it.
    expect(client.get('jobs', 'j-1')?.['designation']).toBe('Zählertausch')
    expect(client.status().pending).toBe(0)
    expect(client.status().state).toBe('conflict')
    expect(client.status().conflicts).toHaveLength(1)
  })

  it('corrects master data at its own route, not through the outbox', async () => {
    const client = await start(transport)

    await holding(client, transport, {
      entity: 'customers',
      rows: [row({ id: 'c-1', name: 'Meyer', kind: 'private' })],
    })

    const saved = await client.update('customers', 'c-1', { name: 'Meyer GmbH' })

    // `change: 'never'` in the policy means "not without a connection", not
    // "never". Reading it the other way leaves the office unable to correct an
    // address at all, which is what it did until this test existed.
    expect(saved.outcome).toBe('queued')
    expect(writer.patched).toEqual([
      { entity: 'customers', id: 'c-1', values: { name: 'Meyer GmbH' } },
    ])
    expect(client.status().pending).toBe(0)
  })

  it('writes what the work produced through the outbox, not at a route', async () => {
    const client = await start(transport)

    await holding(client, transport, {
      entity: 'installations',
      rows: [row({ id: 'a-1', designation: 'Zählerschrank', kind: 'meter_cabinet' })],
    })

    await client.update('installations', 'a-1', { designation: 'Zählerschrank UG' })

    expect(writer.patched).toEqual([])
    expect(transport.sent.at(-1)?.[0]?.entity).toBe('installations')
  })

  it('keeps asking as long as the server says there is more', async () => {
    const client = await start(transport)

    transport.pulls = [
      {
        changes: [{ entity: 'customers', rows: [row({ id: 'c-1', name: 'A' })] }],
        cursor: 1,
        hasMore: true,
      },
      {
        changes: [{ entity: 'customers', rows: [row({ id: 'c-2', name: 'B' })] }],
        cursor: 2,
        hasMore: false,
      },
    ]

    await client.synchronise()

    expect(client.list('customers')).toHaveLength(2)
  })

  it('ignores a kind of record this build has no screen for', async () => {
    const client = await start(transport)

    // An older client talking to a newer server is the ordinary case during an
    // update, not a fault. It has nothing to show those rows on.
    await holding(client, transport, { entity: 'zeitbuchungen', rows: [row({ id: 'z-1' })] })

    expect(client.status().trouble).toBeNull()
    expect(client.status().state).toBe('synced')
  })

  it('says what went wrong rather than looking synchronised', async () => {
    const client = await start(transport)

    transport.refuse = new RequestRefused(400, 'Unbekanntes Feld: quatsch')
    await client.synchronise()

    expect(client.status().trouble).toBe('Unbekanntes Feld: quatsch')
    expect(client.status().state).toBe('offline')
  })

  it('hides a record the server has marked as deleted', async () => {
    const client = await start(transport)

    await holding(client, transport, {
      entity: 'customers',
      rows: [row({ id: 'c-1', name: 'Meyer', deletedAt: '2026-09-20T10:00:00.000Z' })],
    })

    expect(client.list('customers')).toEqual([])
    expect(client.get('customers', 'c-1')).toBeNull()
  })

  it('takes a decided conflict off the list', async () => {
    const client = await start(transport)

    transport.open = [{ id: 'k-1', entity: 'jobs', recordId: 'j-1' } as unknown as SyncConflict]
    await client.synchronise()

    expect(client.status().state).toBe('conflict')

    await client.resolveConflict('k-1')

    expect(transport.resolved).toEqual(['k-1'])
    expect(client.status().conflicts).toEqual([])
    expect(client.status().state).toBe('synced')
  })
})
