import 'fake-indexeddb/auto'

import type {
  Operation,
  OperationId,
  OperationReceipt,
  RecordState,
  SyncConflict,
} from '@opengewerk/platform-domain'
import { syncRules } from '@opengewerk/platform-domain'
import { probePolicies } from '@opengewerk/platform-domain/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { DirectWriter, SyncClient } from './client.js'
import { SyncClient as Client, inTransmissions, refusalFor, refusalText } from './client.js'
import { byRecord, project } from './projection.js'
import { openLocalStore } from './store.js'
import type { ChangedRows, PullResult, SyncTransport } from './transport.js'
import { RequestRefused } from './transport.js'

// The client with the rules of an application that belongs to nobody: shelves
// are master data, notes and parcels are what work produces, a letter is
// written while it is a draft, its lines and its seal follow it, and a visit
// is whoever's it is. A test that ran green with the records of a real
// application would not show that the client knows none of them.
const rules = syncRules(probePolicies)

const entities = ['shelves', 'notes', 'parcels', 'letters', 'letter_lines', 'letter_seals']

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
  /**
   * Refuses a push alone, the way the server refuses a transmission over one
   * operation in it, while pulling goes on as usual.
   */
  refusing: ((operations: readonly Operation[]) => Error | null) | null = null

  push(_deviceId: string, operations: readonly Operation[]) {
    if (this.refuse) {
      return Promise.reject(this.refuse)
    }

    const refusal = this.refusing?.(operations) ?? null

    if (refusal) {
      return Promise.reject(refusal)
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
    rules,
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
  const at = new Date('2026-10-02T08:00:00Z')

  function operation(part: Partial<Operation>): Operation {
    return {
      id: operationId('op-1'),
      entity: 'shelves',
      recordId: 's-1',
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
      [operation({ kind: 'create', patches: [{ field: 'name', from: null, to: 'Hall' }] })],
      's-1',
      rules.policyFor,
    )

    // The id is not in the patches and must not be: the server keeps that
    // column and refuses a patch naming it. It travels as `recordId`.
    expect(created).toEqual({ name: 'Hall', id: 's-1' })
  })

  it('starts a record made here in the state its policy names', () => {
    const created = project(
      null,
      [
        operation({
          entity: 'letters',
          recordId: 'letter-1',
          kind: 'create',
          patches: [{ field: 'subject', from: null, to: 'About the hall' }],
        }),
      ],
      'letter-1',
      rules.policyFor,
    )

    // The state is the server's to write and travels in no patch. The policy
    // says what it will be, so the gates that ask for it get an answer.
    expect(created).toEqual({ status: 'draft', subject: 'About the hall', id: 'letter-1' })
  })

  it('lays a change over what the server said without losing the rest', () => {
    const shown = project(
      row({ id: 's-1', name: 'Hall', place: 'ground floor' }),
      [operation({ patches: [{ field: 'name', from: 'Hall', to: 'Hall, left' }] })],
      's-1',
      rules.policyFor,
    )

    expect(shown?.['name']).toBe('Hall, left')
    expect(shown?.['place']).toBe('ground floor')
  })

  it('applies two queued changes in the order they were recorded', () => {
    const shown = project(
      row({ id: 's-1', name: 'Hall' }),
      [
        operation({
          id: operationId('op-2'),
          recordedAt: new Date('2026-10-02T09:00:00Z'),
          patches: [{ field: 'name', from: 'A', to: 'B' }],
        }),
        operation({ patches: [{ field: 'name', from: 'Hall', to: 'A' }] }),
      ],
      's-1',
      rules.policyFor,
    )

    expect(shown?.['name']).toBe('B')
  })

  it('shows nothing for a record the outbox deletes', () => {
    expect(
      project(row({ id: 's-1' }), [operation({ kind: 'delete' })], 's-1', rules.policyFor),
    ).toBeNull()
  })

  it('groups an outbox by the record each operation belongs to', () => {
    const grouped = byRecord([
      operation({}),
      operation({ id: operationId('op-2') }),
      operation({ id: operationId('op-3'), entity: 'notes', recordId: 'n-1' }),
    ])

    expect(grouped.get('shelves::s-1')).toHaveLength(2)
    expect(grouped.get('notes::n-1')).toHaveLength(1)
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

    const made = await client.create('shelves', { name: 'Hall', kind: 'wood' })

    expect(made.outcome).toBe('queued')
    expect(client.list('shelves').map((entry) => entry['name'])).toEqual(['Hall'])
    expect(client.status().pending).toBe(1)
    expect(client.status().state).toBe('offline')
  })

  it('keeps the outbox over a restart, which is the whole point of it', async () => {
    const name = 'restart'
    const first = await start(transport, name)

    transport.refuse = new TypeError('Failed to fetch')
    await first.create('shelves', { name: 'Hall', kind: 'wood' })
    first.stop()

    const again = await start(transport, name)

    expect(again.status().pending).toBe(1)
    expect(again.list('shelves').map((entry) => entry['name'])).toEqual(['Hall'])
  })

  it('refuses a change to master data instead of queueing one it cannot keep', async () => {
    const client = await start(transport)

    await holding(client, transport, {
      entity: 'shelves',
      rows: [row({ id: 's-1', name: 'Hall', kind: 'wood' })],
    })

    transport.refuse = new TypeError('Failed to fetch')
    writer.refuse = new TypeError('Failed to fetch')

    const tried = await client.update('shelves', 's-1', { name: 'Hall, left' })

    // ADR 0005 lets somebody on the road add master data and not correct it.
    // Refusing here, with the form still open, beats an outbox entry that can
    // never land and a person who finds out two hours later.
    expect(tried).toEqual({ outcome: 'refused', reason: 'online_only', fields: [] })
    expect(client.status().pending).toBe(0)
    expect(client.needsConnection('shelves')).toBe(true)
    expect(client.needsConnection('notes')).toBe(false)
  })

  it('refuses a line whose parent has left the state its gate names', async () => {
    const client = await start(transport)

    await holding(
      client,
      transport,
      {
        entity: 'letters',
        rows: [row({ id: 'letter-1', status: 'sent', number: 'L-2026-0001' })],
      },
      { entity: 'letter_lines', rows: [row({ id: 'line-1', letterId: 'letter-1', words: 10 })] },
    )

    const tried = await client.update('letter_lines', 'line-1', { words: 20 })

    // The rule sits on the letter, not on the line, and the device works out
    // the same answer the server would, because the decision lives where both
    // can ask it and the device already holds the letter.
    expect(tried).toEqual({ outcome: 'refused', reason: 'record_is_fixed', fields: ['status'] })
  })

  it('lets a line be written while its parent is still in that state', async () => {
    const client = await start(transport)

    await holding(
      client,
      transport,
      { entity: 'letters', rows: [row({ id: 'letter-1', status: 'draft', number: null })] },
      { entity: 'letter_lines', rows: [row({ id: 'line-1', letterId: 'letter-1', words: 10 })] },
    )

    expect((await client.update('letter_lines', 'line-1', { words: 20 })).outcome).toBe('queued')
  })

  /**
   * A new line exists only in the operation that creates it, so the letter
   * it belongs to has to be read from there. Read from the stored record, as
   * it once was, every new line looked like one without a parent and was
   * refused before it left the device.
   */
  it('finds the parent of a new line in what the line is created with', async () => {
    const client = await start(transport)

    await holding(client, transport, {
      entity: 'letters',
      rows: [
        row({ id: 'letter-1', status: 'draft', number: null }),
        row({ id: 'letter-2', status: 'sent', number: 'L-2026-0001' }),
      ],
    })

    const line = { text: 'One more line', words: 3 }

    expect((await client.create('letter_lines', { ...line, letterId: 'letter-1' })).outcome).toBe(
      'queued',
    )
    expect(await client.create('letter_lines', { ...line, letterId: 'letter-2' })).toEqual({
      outcome: 'refused',
      reason: 'record_is_fixed',
      fields: ['status'],
    })
  })

  /**
   * A letter made on this device has no state until the server answers. The
   * gates that ask for one found nothing there and refused, and a record
   * written in a cellar turned down its own first line as already fixed.
   */
  it('lets a record made on the device take lines and changes before the server has it', async () => {
    const client = await start(transport)

    transport.refuse = new TypeError('Failed to fetch')

    const letter = await client.create('letters', {
      subject: 'About the hall',
      shelfId: 's-1',
      writtenOn: '2026-10-02',
    })

    if (letter.outcome !== 'queued') {
      throw new Error('The letter itself was refused')
    }

    expect(client.get('letters', letter.id)?.['status']).toBe('draft')

    const results = [
      await client.update('letters', letter.id, { opening: 'As agreed on the phone.' }),
      await client.create('letter_lines', {
        letterId: letter.id,
        position: 1,
        text: 'The shelf is full.',
        words: 4,
      }),
      await client.create('letter_seals', {
        letterId: letter.id,
        sealedBy: 'Erika Berg',
        sealedAt: '2026-10-02T12:32:00.000Z',
        shape: 'M100,300L200,120',
      }),
    ]

    expect(results.map((result) => result.outcome)).toEqual(['queued', 'queued', 'queued'])

    // The state is what the device assumes, not what it sends: the field is
    // the server's, and naming it in a patch is refused. The first exchange
    // is the failing one still under way; after a failure the client waits to
    // be asked again, so the network coming back is a second call.
    await client.synchronise()
    transport.refuse = null
    await client.synchronise()

    const created = transport.sent
      .flat()
      .find((operation) => operation.entity === 'letters' && operation.kind === 'create')

    expect(created?.patches.map((patch) => patch.field)).not.toContain('status')
  })

  it('never sends a field the server keeps, whatever a form hands it', async () => {
    const client = await start(transport)

    await holding(client, transport, {
      entity: 'parcels',
      rows: [row({ id: 'p-1', title: 'For the hall', number: 'P-0001' })],
    })

    await client.update('parcels', 'p-1', {
      title: 'For the hall, second floor',
      // What a form carrying the whole record would send back. The server
      // refuses the entire transmission over one of the columns it keeps
      // everywhere, so an outbox that let them through would stop working
      // altogether.
      id: 'p-1',
      version: 1,
      tenantId: 'tenant',
      updatedAt: '2026-10-02T00:00:00.000Z',
      // And what the policy of this entity reserves: sent, it would come back
      // as a conflict about a field nobody here meant to change.
      number: 'P-0002',
    })

    expect(transport.sent.at(-1)?.[0]?.patches.map((patch) => patch.field)).toEqual(['title'])
  })
})

describe('the rules a client is started with', () => {
  it('are the ones it decides by, and no others', async () => {
    // The same record under two lists: master data in one, ordinary work in
    // the other. A client that asked anything but what it was handed would
    // answer the same for both.
    const transport = new Recorded()
    const lenient = await Client.start({
      store: await openLocalStore('lenient'),
      transport,
      writer: new Writing(),
      rules: syncRules({ shelves: { create: true, change: 'merge' } }),
      deviceId: 'device',
      entities: ['shelves'],
      onSignedOut: () => {},
    })
    const strict = await start(new Recorded(), 'strict')

    expect(lenient.needsConnection('shelves')).toBe(false)
    expect(strict.needsConnection('shelves')).toBe(true)

    await holding(lenient, transport, {
      entity: 'shelves',
      rows: [row({ id: 's-1', name: 'Hall' })],
    })
    await lenient.update('shelves', 's-1', { name: 'Hall, left' })

    expect(transport.sent.at(-1)?.[0]?.patches).toEqual([
      { field: 'name', from: 'Hall', to: 'Hall, left' },
    ])
  })

  it('refuse a kind of record they do not name, before anything is queued', async () => {
    const client = await start(new Recorded())

    expect(await client.create('ledgers', { name: 'Nobody knows these' })).toEqual({
      outcome: 'refused',
      reason: 'unknown_entity',
      fields: [],
    })
    expect(client.status().pending).toBe(0)
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
      rules,
      deviceId: 'device',
      entities: known,
      onSignedOut: () => {},
    })
  }

  const seal = row({ id: 'seal-1', letterId: 'letter-1', sealedBy: 'Erika Berg' })

  it('asks from the beginning once when it knows a kind of record the last build did not', async () => {
    const older = await startWith(['shelves'], 'upgrade')

    transport.pulls = [
      {
        changes: [
          { entity: 'shelves', rows: [row({ id: 's-1', name: 'Hall', kind: 'wood' })] },
          { entity: 'letter_seals', rows: [seal] },
        ],
        cursor: 7,
        hasMore: false,
      },
    ]
    await older.synchronise()
    older.stop()

    const newer = await startWith(['shelves', 'letter_seals'], 'upgrade')

    transport.pulls = [
      {
        changes: [{ entity: 'letter_seals', rows: [seal] }],
        cursor: 7,
        hasMore: false,
      },
    ]
    await newer.synchronise()

    expect(transport.asked).toEqual([0, 0])
    expect(newer.list('letter_seals').map((entry) => entry['sealedBy'])).toEqual(['Erika Berg'])
  })

  it('keeps its place when it knows nothing the last build did not', async () => {
    const first = await startWith(['shelves'], 'same-build')

    transport.pulls = [{ changes: [], cursor: 7, hasMore: false }]
    await first.synchronise()
    first.stop()

    await (await startWith(['shelves'], 'same-build')).synchronise()

    expect(transport.asked).toEqual([0, 7])
  })

  it('asks from the beginning after a build that kept no list, and only the once', async () => {
    const store = await openLocalStore('before-the-list')

    await store.writeMeta('cursor', 7)
    store.close()

    const first = await startWith(['shelves'], 'before-the-list')

    transport.pulls = [{ changes: [], cursor: 9, hasMore: false }]
    await first.synchronise()
    first.stop()

    await (await startWith(['shelves'], 'before-the-list')).synchronise()

    expect(transport.asked).toEqual([0, 9])
  })

  it('starts again after going back to a build that knew less and forward once more', async () => {
    const both = ['shelves', 'letter_seals']

    const first = await startWith(both, 'back-and-forth')

    transport.pulls = [{ changes: [], cursor: 5, hasMore: false }]
    await first.synchronise()
    first.stop()

    const back = await startWith(['shelves'], 'back-and-forth')

    transport.pulls = [{ changes: [], cursor: 8, hasMore: false }]
    await back.synchronise()
    back.stop()

    await (await startWith(both, 'back-and-forth')).synchronise()

    // The build in the middle dropped whatever seals arrived between 5 and 8,
    // so the third asks from the beginning and not from 8.
    expect(transport.asked).toEqual([0, 5, 0])
  })
})

describe('a device handed to somebody who sees less, or more', () => {
  let transport: Recorded

  beforeEach(() => {
    transport = new Recorded()
  })

  async function startOn(name: string) {
    return await Client.start({
      store: await openLocalStore(name),
      transport,
      writer: new Writing(),
      rules,
      deviceId: 'tablet',
      entities: ['shelves', 'visits'],
      onSignedOut: () => {},
    })
  }

  const theirs = row({ id: 'v-1', userId: 'u-desk' })
  const mine = row({ id: 'v-2', userId: 'u-road' })

  it('lets go of the rows of the others, and asks again from the start', async () => {
    // Somebody who reads every visit pulled first, and with it everybody's.
    const desk = await startOn('shared-tablet')

    transport.pulls = [
      {
        changes: [
          { entity: 'shelves', rows: [row({ id: 's-1', name: 'Hall', kind: 'wood' })] },
          { entity: 'visits', rows: [theirs, mine] },
        ],
        cursor: 9,
        hasMore: false,
        narrowed: { visits: 'all' },
      },
    ]
    await desk.synchronise()
    desk.stop()

    // Then somebody who reads only their own, on the same tablet and in the
    // same tenant.
    const road = await startOn('shared-tablet')

    transport.pulls = [
      { changes: [], cursor: 9, hasMore: false, narrowed: { visits: 'user:u-road' } },
      {
        changes: [
          { entity: 'shelves', rows: [row({ id: 's-1', name: 'Hall', kind: 'wood' })] },
          { entity: 'visits', rows: [mine] },
        ],
        cursor: 9,
        hasMore: false,
        narrowed: { visits: 'user:u-road' },
      },
    ]
    await road.synchronise()

    expect(transport.asked).toEqual([0, 9, 0])
    expect(road.list('visits').map((entry) => entry['id'])).toEqual(['v-2'])
    expect(road.list('shelves').map((entry) => entry['id'])).toEqual(['s-1'])

    // What the store holds went too, not only what is in memory.
    road.stop()

    const again = await startOn('shared-tablet')

    expect(again.list('visits').map((entry) => entry['id'])).toEqual(['v-2'])
  })

  it('keeps everything while the server narrows the same way, or says nothing', async () => {
    const first = await startOn('same-person')

    transport.pulls = [
      {
        changes: [{ entity: 'visits', rows: [mine] }],
        cursor: 4,
        hasMore: false,
        narrowed: { visits: 'user:u-road' },
      },
      { changes: [], cursor: 4, hasMore: false, narrowed: { visits: 'user:u-road' } },
      { changes: [], cursor: 4, hasMore: false },
    ]
    await first.synchronise()
    await first.synchronise()
    await first.synchronise()

    expect(transport.asked).toEqual([0, 4, 4])
    expect(first.list('visits')).toHaveLength(1)
  })

  /**
   * Whether the device holds every row, for what the rows add up to (#314):
   * from the answer of the server, kept across a start, and never assumed
   * before one said so.
   */
  it('knows whether it holds every row of an entity from the last answer', async () => {
    const device = await startOn('holds-all')

    expect(device.holdsAll('visits')).toBe(false)

    transport.pulls = [{ changes: [], cursor: 2, hasMore: false, narrowed: { visits: 'all' } }]
    await device.synchronise()

    expect(device.holdsAll('visits')).toBe(true)
    device.stop()

    const again = await startOn('holds-all')

    expect(again.holdsAll('visits')).toBe(true)

    transport.pulls = [
      { changes: [], cursor: 2, hasMore: false, narrowed: { visits: 'user:u-road' } },
      { changes: [], cursor: 2, hasMore: false, narrowed: { visits: 'user:u-road' } },
    ]
    await again.synchronise()

    expect(again.holdsAll('visits')).toBe(false)
  })

  /**
   * Not before the pull after a change has run through (#444): the device
   * dropped what it held and asks from the start, and until the last page is
   * in, the rows it counts are a part.
   */
  it('says it holds every row only once the pull after a change has run through', async () => {
    const device = await startOn('holds-all-later')

    transport.pulls = [
      {
        changes: [{ entity: 'visits', rows: [mine] }],
        cursor: 4,
        hasMore: false,
        narrowed: { visits: 'user:u-road' },
      },
    ]
    await device.synchronise()

    // Given a role that sees all: the answer says so, and the pull from the
    // start that follows breaks off.
    const pull = transport.pull.bind(transport)
    let calls = 0

    transport.pull = (since: number) => {
      calls += 1

      return calls === 2 ? Promise.reject(new TypeError('Failed to fetch')) : pull(since)
    }
    transport.pulls = [{ changes: [], cursor: 4, hasMore: false, narrowed: { visits: 'all' } }]
    await device.synchronise()

    expect(transport.asked).toEqual([0, 4])
    expect(device.holdsAll('visits')).toBe(false)
    device.stop()

    // Not after a start either, and not between two pages of the next pull.
    const again = await startOn('holds-all-later')
    const seen: boolean[] = []

    expect(again.holdsAll('visits')).toBe(false)

    transport.pull = (since: number) => {
      seen.push(again.holdsAll('visits'))

      return pull(since)
    }
    transport.pulls = [
      {
        changes: [{ entity: 'visits', rows: [theirs] }],
        cursor: 7,
        hasMore: true,
        narrowed: { visits: 'all' },
      },
      {
        changes: [{ entity: 'visits', rows: [mine] }],
        cursor: 9,
        hasMore: false,
        narrowed: { visits: 'all' },
      },
    ]
    await again.synchronise()

    expect(seen).toEqual([false, false])
    expect(again.holdsAll('visits')).toBe(true)
    expect(again.list('visits').map((entry) => entry['id'])).toEqual(['v-1', 'v-2'])
  })
})

describe('an exchange with the server', () => {
  let transport: Recorded

  beforeEach(() => {
    transport = new Recorded()
  })

  /**
   * Between sending and fetching back (#181). The outbox lets go of an
   * operation when the server answers, and the row arrives only with the pull
   * after that; a pull held up here is a slow mobile network.
   */
  describe('between sending and the pull that brings the rows back', () => {
    function holdThePull(): () => void {
      let release: () => void = () => undefined
      const held = new Promise<void>((resolve) => {
        release = resolve
      })
      const pull = transport.pull.bind(transport)

      transport.pull = async (since: number) => {
        await held

        return pull(since)
      }

      return release
    }

    it('keeps a record made here in view, and no longer as waiting', async () => {
      const client = await start(transport)
      const release = holdThePull()
      const made = await client.create('shelves', { name: 'Hall', kind: 'wood' })

      if (made.outcome !== 'queued') {
        throw new Error('The shelf was refused on the device.')
      }

      // Answered and out of the outbox, with the pull still on its way.
      await vi.waitFor(() => {
        expect(client.status().pending).toBe(0)
      })

      expect(client.isPending('shelves', made.id)).toBe(false)
      expect(client.get('shelves', made.id)?.['name']).toBe('Hall')
      expect(client.list('shelves').map((record) => record['id'])).toEqual([made.id])

      transport.pulls = [
        {
          changes: [
            { entity: 'shelves', rows: [row({ id: made.id, name: 'Hall', kind: 'wood' })] },
          ],
          cursor: 2,
          hasMore: false,
        },
      ]
      release()
      await client.synchronise()

      expect(client.list('shelves').map((record) => record['name'])).toEqual(['Hall'])
    })

    it('keeps a changed value, instead of showing the old one until the pull', async () => {
      const client = await start(transport)

      await holding(client, transport, {
        entity: 'parcels',
        rows: [row({ id: 'p-1', title: 'For the hall' })],
      })

      holdThePull()
      await client.update('parcels', 'p-1', { title: 'For the hall, left' })

      // Answered and out of the outbox, with the pull still on its way.
      await vi.waitFor(() => {
        expect(client.status().pending).toBe(0)
      })

      expect(client.get('parcels', 'p-1')?.['title']).toBe('For the hall, left')
    })

    it('shows nothing of an operation the server did not apply', async () => {
      const client = await start(transport)

      await holding(client, transport, {
        entity: 'parcels',
        rows: [row({ id: 'p-1', title: 'For the hall' })],
      })

      transport.receipts = (operations) =>
        operations.map((operation) => ({
          operationId: operation.id,
          outcome: 'conflict' as const,
          reason: 'changed_elsewhere' as const,
          fields: ['title'],
        }))
      holdThePull()
      await client.update('parcels', 'p-1', { title: 'For the hall, left' })

      // Answered and out of the outbox, with the pull still on its way.
      await vi.waitFor(() => {
        expect(client.status().pending).toBe(0)
      })

      expect(client.get('parcels', 'p-1')?.['title']).toBe('For the hall')
    })
  })

  it('empties the outbox for every operation it got a receipt for', async () => {
    const client = await start(transport)

    await client.create('shelves', { name: 'Hall', kind: 'wood' })
    await client.synchronise()

    expect(client.status().pending).toBe(0)
    expect(client.status().state).toBe('synced')
  })

  it('takes a refused operation off the outbox and goes back to what the server holds', async () => {
    const client = await start(transport)

    await holding(client, transport, {
      entity: 'parcels',
      rows: [row({ id: 'p-1', title: 'For the hall', state: 'open' })],
    })

    transport.receipts = (operations) =>
      operations.map((operation) => ({
        operationId: operation.id,
        outcome: 'conflict' as const,
        reason: 'changed_elsewhere',
        fields: ['title'],
      }))
    transport.open = [{ id: 'k-1', entity: 'parcels', recordId: 'p-1' } as unknown as SyncConflict]

    await client.update('parcels', 'p-1', { title: 'For the hall, left' })

    expect(client.get('parcels', 'p-1')?.['title']).toBe('For the hall, left')

    await client.synchronise()

    // This is why the outbox is laid over the server state instead of written
    // into it. The server refused, so nothing about the record changed there
    // and the next delta brings nothing down. Written into the local copy, the
    // change would sit on the screen as a value that exists nowhere else, for
    // ever, and no synchronisation would ever correct it.
    expect(client.get('parcels', 'p-1')?.['title']).toBe('For the hall')
    expect(client.status().pending).toBe(0)
    expect(client.status().state).toBe('conflict')
    expect(client.status().conflicts).toHaveLength(1)
  })

  it('corrects master data at its own route, not through the outbox', async () => {
    const client = await start(transport)

    await holding(client, transport, {
      entity: 'shelves',
      rows: [row({ id: 's-1', name: 'Hall', kind: 'wood' })],
    })

    const saved = await client.update('shelves', 's-1', { name: 'Hall, left' })

    // `change: 'never'` in the policy means "not without a connection", not
    // "never". Reading it the other way leaves nobody able to correct an
    // address at all, which is what it did until this test existed.
    expect(saved.outcome).toBe('queued')
    expect(writer.patched).toEqual([
      { entity: 'shelves', id: 's-1', values: { name: 'Hall, left' } },
    ])
    expect(client.status().pending).toBe(0)
  })

  it('removes master data at its own route as well', async () => {
    const client = await start(transport)

    await holding(client, transport, {
      entity: 'shelves',
      rows: [row({ id: 's-1', name: 'Hall', kind: 'wood' })],
    })

    expect((await client.remove('shelves', 's-1')).outcome).toBe('queued')
    expect(writer.removed).toEqual(['shelves/s-1'])
    expect(transport.sent).toEqual([])
  })

  it('writes what the work produced through the outbox, not at a route', async () => {
    const client = await start(transport)

    await holding(client, transport, {
      entity: 'notes',
      rows: [row({ id: 'n-1', title: 'Shelf by the door', kind: 'remark' })],
    })

    await client.update('notes', 'n-1', { title: 'Shelf by the window' })

    expect(writer.patched).toEqual([])
    expect(transport.sent.at(-1)?.[0]?.entity).toBe('notes')
  })

  it('keeps asking as long as the server says there is more', async () => {
    const client = await start(transport)

    transport.pulls = [
      {
        changes: [{ entity: 'shelves', rows: [row({ id: 's-1', name: 'A' })] }],
        cursor: 1,
        hasMore: true,
      },
      {
        changes: [{ entity: 'shelves', rows: [row({ id: 's-2', name: 'B' })] }],
        cursor: 2,
        hasMore: false,
      },
    ]

    await client.synchronise()

    expect(client.list('shelves')).toHaveLength(2)
  })

  it('ignores a kind of record this build has no screen for', async () => {
    const client = await start(transport)

    // An older client talking to a newer server is the ordinary case during an
    // update, not a fault. It has nothing to show those rows on.
    await holding(client, transport, { entity: 'ledgers', rows: [row({ id: 'z-1' })] })

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

  describe('refused with a session that is still good (#254)', () => {
    const untrusted =
      'Diese Anfrage kommt von einer fremden Adresse. Sie wird nur von der Adresse ' +
      'angenommen, unter der die Instanz erreichbar ist (TRUSTED_ORIGINS).'

    async function watched() {
      const signedOut = vi.fn()
      const client = await Client.start({
        store: await openLocalStore(`t${String((counter += 1))}`),
        transport,
        writer,
        rules,
        deviceId: 'device',
        entities,
        onSignedOut: signedOut,
      })

      return { client, signedOut }
    }

    it('stays open over a 403 and shows the sentence it came with', async () => {
      const { client, signedOut } = await watched()

      transport.refuse = new RequestRefused(403, untrusted)
      await client.synchronise()

      expect(signedOut).not.toHaveBeenCalled()
      expect(client.status().trouble).toBe(untrusted)
    })

    it('takes a 401 for the end of the session', async () => {
      const { client, signedOut } = await watched()

      transport.refuse = new RequestRefused(401, 'Keine gültige Anmeldung.')
      await client.synchronise()

      expect(signedOut).toHaveBeenCalledOnce()
      expect(client.status().trouble).toBe('Die Anmeldung ist abgelaufen.')
    })

    it('gives a refused direct write the reason the server gave, not a missing network', async () => {
      const { client, signedOut } = await watched()
      const missing = 'Regale ändern darf dieser Zugang nicht.'

      await holding(client, transport, {
        entity: 'shelves',
        rows: [row({ id: 's-1', name: 'Hall', kind: 'wood' })],
      })
      writer.refuse = new RequestRefused(403, missing)

      const tried = await client.update('shelves', 's-1', { name: 'Hall, left' })

      expect(signedOut).not.toHaveBeenCalled()
      expect(tried.outcome === 'refused' ? refusalFor(tried) : null).toBe(missing)

      writer.refuse = new TypeError('Failed to fetch')

      const offline = await client.update('shelves', 's-1', { name: 'Hall, left' })

      expect(offline.outcome === 'refused' ? refusalFor(offline) : null).toBe(
        refusalText.online_only,
      )
    })

    it('takes a 401 at a direct write for the end of the session as well', async () => {
      const { client, signedOut } = await watched()

      await holding(client, transport, {
        entity: 'shelves',
        rows: [row({ id: 's-1', name: 'Hall', kind: 'wood' })],
      })
      writer.refuse = new RequestRefused(401, 'Keine gültige Anmeldung.')

      await client.update('shelves', 's-1', { name: 'Hall, left' })

      expect(signedOut).toHaveBeenCalledOnce()
    })
  })

  it('hides a record the server has marked as deleted', async () => {
    const client = await start(transport)

    await holding(client, transport, {
      entity: 'shelves',
      rows: [row({ id: 's-1', name: 'Hall', deletedAt: '2026-10-02T10:00:00.000Z' })],
    })

    expect(client.list('shelves')).toEqual([])
    expect(client.get('shelves', 's-1')).toBeNull()
  })

  it('takes a decided conflict off the list', async () => {
    const client = await start(transport)

    transport.open = [{ id: 'k-1', entity: 'parcels', recordId: 'p-1' } as unknown as SyncConflict]
    await client.synchronise()

    expect(client.status().state).toBe('conflict')

    await client.resolveConflict('k-1')

    expect(transport.resolved).toEqual(['k-1'])
    expect(client.status().conflicts).toEqual([])
    expect(client.status().state).toBe('synced')
  })
})

describe('a large outbox (#202)', () => {
  let transport: Recorded

  beforeEach(() => {
    transport = new Recorded()
  })

  /** Four hundred thousand characters: two fit in a transmission, three do not. */
  const long = 'x'.repeat(400_000)

  function operation(name: string, recordedAt: string): Operation {
    return {
      id: operationId(`op-${name}`),
      entity: 'shelves',
      recordId: `s-${name}`,
      kind: 'create',
      baseVersion: null,
      patches: [{ field: 'name', from: null, to: name }],
      recordedAt: new Date(recordedAt),
      deviceId: 'device' as Operation['deviceId'],
    }
  }

  /** Three new shelves written without a network, each longer than most transmissions. */
  async function writtenInTheCellar(client: SyncClient): Promise<void> {
    transport.refuse = new TypeError('Failed to fetch')

    for (const name of ['Erste', 'Zweite', 'Dritte']) {
      await client.create('shelves', { name: `${name} ${long}`, kind: 'wood' })
    }

    // Until the round the last entry started has failed, without a network.
    // A failed round asks for no other, so an exchange asked for while it
    // runs would end with it.
    await client.synchronise()
    transport.refuse = null
  }

  it('is cut where the next operation would not fit, and never reordered', () => {
    const first = operation('a', '2026-10-02T08:00:00Z')
    const second = operation('b', '2026-10-02T08:01:00Z')
    const third = operation('c', '2026-10-02T08:02:00Z')
    const size = JSON.stringify(first).length

    expect(inTransmissions([first, second, third], size * 2)).toEqual([[first, second], [third]])
    // One larger than a part goes alone rather than not at all.
    expect(inTransmissions([first, second], size - 1)).toEqual([[first], [second]])
    expect(inTransmissions([])).toEqual([])
  })

  it('goes out in parts, in the order it was written', async () => {
    const client = await start(transport)

    await writtenInTheCellar(client)
    await client.synchronise()

    expect(transport.sent.map((part) => part.length)).toEqual([2, 1])
    expect(transport.sent.flat().map((sent) => String(sent.patches[0]?.to).split(' ')[0])).toEqual([
      'Erste',
      'Zweite',
      'Dritte',
    ])
    expect(client.status().pending).toBe(0)
  })

  it('keeps what a part brought in when a later part is refused over one operation', async () => {
    const client = await start(transport)

    await writtenInTheCellar(client)
    transport.refusing = (operations) => {
      const named = operations.find((sent) => String(sent.patches[0]?.to).startsWith('Dritte'))

      return named
        ? new RequestRefused(400, 'Unbekanntes Feld: quatsch', {
            statusCode: 400,
            message: 'Unbekanntes Feld: quatsch',
            operationId: named.id,
          })
        : null
    }
    await client.synchronise()

    // The first part is in and out of the outbox; the third waits with its sentence.
    expect(transport.sent.map((part) => part.length)).toEqual([2])
    expect(client.status().pending).toBe(1)
    expect(String(client.status().refused?.operation.patches[0]?.to)).toMatch(/^Dritte /)
  })
})

/**
 * An operation the server refuses outright, over which it refuses the whole
 * transmission and names it (#120). Before, the device sent the same stack
 * again at every exchange, got the same answer and pulled nothing, and there
 * was no way to let the one entry go.
 */
describe('an operation the server refuses outright', () => {
  let transport: Recorded

  beforeEach(() => {
    transport = new Recorded()
  })

  /** The answer the server gives, naming the first operation that writes this. */
  function refusingWhat(field: string, value: string) {
    return (operations: readonly Operation[]) => {
      const named = operations.find((operation) =>
        operation.patches.some((patch) => patch.field === field && patch.to === value),
      )

      return named
        ? new RequestRefused(400, 'Unbekanntes Feld: quatsch', {
            statusCode: 400,
            message: 'Unbekanntes Feld: quatsch',
            operationId: named.id,
          })
        : null
    }
  }

  it('is held with its sentence, and the device goes on pulling', async () => {
    const client = await start(transport)

    transport.refusing = refusingWhat('name', 'Kaputt')
    transport.pulls = [
      {
        changes: [{ entity: 'parcels', rows: [row({ id: 'p-1', title: 'For tomorrow' })] }],
        cursor: 5,
        hasMore: false,
      },
    ]

    await client.create('shelves', { name: 'Kaputt', kind: 'wood' })
    await client.create('shelves', { name: 'Hall', kind: 'wood' })
    await client.synchronise()

    const { refused } = client.status()

    expect(client.status().state).toBe('refused')
    expect(refused?.message).toBe('Unbekanntes Feld: quatsch')
    expect(refused?.operation.patches).toContainEqual({ field: 'name', from: null, to: 'Kaputt' })

    // Nothing behind it got out, and nothing was lost: both entries wait.
    expect(transport.sent).toEqual([])
    expect(client.status().pending).toBe(2)

    // The work of the next day still arrives. Before, a refused push ended the
    // exchange, and the pull behind it never ran.
    expect(client.get('parcels', 'p-1')?.['title']).toBe('For tomorrow')
  })

  it('lets a person let it go, and then sends what waited behind it', async () => {
    const client = await start(transport)

    transport.refusing = refusingWhat('name', 'Kaputt')

    await client.create('shelves', { name: 'Kaputt', kind: 'wood' })
    await client.create('shelves', { name: 'Hall', kind: 'wood' })
    await client.synchronise()

    const refused = client.status().refused

    expect(refused).not.toBeNull()

    await client.discard(refused?.operation.id ?? operationId('none'))

    expect(transport.sent).toHaveLength(1)
    expect(transport.sent[0]?.map((operation) => operation.patches)).toEqual([
      [
        { field: 'name', from: null, to: 'Hall' },
        { field: 'kind', from: null, to: 'wood' },
      ],
    ])
    expect(client.status().state).toBe('synced')
    expect(client.status().refused).toBeNull()
    expect(client.status().pending).toBe(0)
  })

  it('takes the later changes of a record with it when it let go of its create', async () => {
    const client = await start(transport)

    transport.refusing = refusingWhat('title', 'Shelf')

    const made = await client.create('notes', { title: 'Shelf' })

    expect(made.outcome).toBe('queued')

    await client.update('notes', made.outcome === 'queued' ? made.id : '', {
      title: 'Shelf by the door',
    })
    await client.create('notes', { title: 'Rack' })
    await client.synchronise()

    await client.discard(client.status().refused?.operation.id ?? operationId('none'))

    // The change to a record that never reached the server can land nowhere.
    // Sent, it would only have come back as a conflict about nothing.
    expect(transport.sent.flat().map((operation) => operation.patches[0]?.to)).toEqual(['Rack'])
    expect(client.status().pending).toBe(0)
  })

  it('keeps an answer that names nothing this device holds as trouble, as before', async () => {
    const client = await start(transport)

    transport.refusing = () =>
      new RequestRefused(400, 'Die Liste der Vorgänge fehlt.', { statusCode: 400 })

    await client.create('shelves', { name: 'Hall', kind: 'wood' })
    await client.synchronise()

    // A refusal without a name comes from a client speaking the wrong protocol,
    // which the next build fixes. There is no entry to let go of.
    expect(client.status().refused).toBeNull()
    expect(client.status().trouble).toBe('Die Liste der Vorgänge fehlt.')
    expect(client.status().state).toBe('offline')
  })
})

/**
 * State that belongs to a device alone: a stretch of time that is still
 * running is the case it exists for. It becomes a record when it ends, and
 * until then it must survive a locked phone and never travel.
 */
describe('what a device keeps for itself', () => {
  async function keeping(name: string, keeps: readonly string[] = ['timer']) {
    const transport = new Recorded()
    const client = await Client.start({
      store: await openLocalStore(name),
      transport,
      writer: new Writing(),
      rules,
      deviceId: 'device',
      entities,
      keeps,
      onSignedOut: () => {},
    })

    return { client, transport }
  }

  it('is there after a restart, and gone once it was let go', async () => {
    const { client } = await keeping('kept')

    expect(client.kept('timer')).toBeNull()

    await client.keep('timer', '{"since":"08:00"}')

    expect(client.kept('timer')).toBe('{"since":"08:00"}')
    client.stop()

    const { client: again } = await keeping('kept')

    expect(again.kept('timer')).toBe('{"since":"08:00"}')

    await again.keep('timer', null)
    again.stop()

    expect((await keeping('kept')).client.kept('timer')).toBeNull()
  })

  it('is found where a build before this one stored it', async () => {
    // Stored under the name itself, among the bookkeeping of the local store.
    // A device that was updated while something was kept finds it again.
    const store = await openLocalStore('kept-before')

    await store.writeMeta('timer', '{"since":"07:30"}')
    store.close()

    expect((await keeping('kept-before')).client.kept('timer')).toBe('{"since":"07:30"}')
  })

  it('tells whoever watches the client that it changed', async () => {
    const { client } = await keeping('kept-watched')
    const before = client.version()
    let told = 0

    client.subscribe(() => {
      told += 1
    })
    await client.keep('timer', 'running')

    expect(told).toBe(1)
    expect(client.version()).toBeGreaterThan(before)
  })

  it('never travels', async () => {
    const { client, transport } = await keeping('kept-here')

    await client.keep('timer', 'running')
    await client.synchronise()

    expect(transport.sent).toEqual([])
    expect(client.status().pending).toBe(0)
  })

  it('is refused under a name the client was not started with', async () => {
    // Written, it would be there until the page is loaded again and then
    // gone: the start reads back what it was told to.
    const { client } = await keeping('kept-unnamed')

    expect(() => client.kept('clock')).toThrow(/not started to keep this: clock/)
    await expect(client.keep('clock', 'x')).rejects.toThrow(/not started to keep this: clock/)
  })

  it('cannot take a name the client keeps its own bookkeeping under', async () => {
    for (const name of ['cursor', 'entities', 'narrowed', 'narrowed-settled']) {
      await expect(keeping(`kept-${name}`, [name]), name).rejects.toThrow(
        /keeps its own bookkeeping under this name/,
      )
    }
  })
})
