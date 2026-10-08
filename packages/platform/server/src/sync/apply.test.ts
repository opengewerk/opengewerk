import type { Operation, OperationReceipt, SyncValue, TenantId } from '@opengewerk/platform-domain'
import { eq, sql } from 'drizzle-orm'
import type { Pool } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { type ProbeFoundation, probeFoundation } from '../authentication/probe-application.js'
import { Database, type TenantTransaction } from '../database/database.js'
import { newId } from '../database/identifier.js'
import {
  closeConflict,
  OperationRefused,
  openConflicts,
  serverSync,
  type SyncCheck,
  type SyncCheckContext,
  UnknownFieldError,
} from './apply.js'
import {
  letterLines,
  letters,
  letterSeals,
  notes,
  nothing,
  probeSyncMade,
  probeSyncRules,
  shelves,
} from './probe-sync.js'
import { syncTables } from './tables.js'

/**
 * The sync on the server, for records no application of the organisation has
 * (ADR 0010): shelves, notes on them, letters and their lines. Whatever the
 * mechanism does here it does without knowing an entity by name, and what the
 * probe application adds is the kind of thing every application adds: a rule
 * it asks before the database does, and a figure the server puts in.
 */

const north = { id: newId<'tenant'>(), name: 'Mandant Nord' }
const south = { id: newId<'tenant'>(), name: 'Mandant Süd' }

/** Whoever sent a transmission, in the words of the probe application. */
interface Courier {
  readonly name: string
}

const courier: Courier = { name: 'Olga' }

/** A note needs a text, which its form asks before anything is queued. */
const noteText: SyncCheck<Courier> = ({ operation, values }) =>
  operation.entity === 'notes' && 'text' in values && String(values['text']).trim() === ''
    ? { kind: 'client', message: 'Eine Notiz braucht einen Text.' }
    : null

/** A closed shelf takes no new notes: a conflict about the one note, and the rest lands. */
const closedShelf: SyncCheck<Courier> = async ({ tx, operation, values }) => {
  if (operation.entity !== 'notes' || typeof values['shelfId'] !== 'string') {
    return null
  }

  const [shelf] = await tx
    .select({ closed: shelves.closed })
    .from(shelves)
    .where(eq(shelves.id, values['shelfId'] as never))

  return shelf?.closed ? { kind: 'conflict', reason: 'record_is_fixed', fields: ['shelfId'] } : null
}

/**
 * What a device may not keep is taken out on the way in: a private note keeps
 * its place and loses its words. The kind of thing an application does with a
 * field it takes and does not store, the place of somebody without consent.
 */
const privateText: SyncCheck<Courier> = ({ operation, values }) => {
  if (operation.entity === 'notes' && String(values['text'] ?? '').startsWith('privat:')) {
    values['text'] = '(privat)'
  }

  return null
}

/** Who sent a note, written into nothing but this list, so that a test can see the sender arrive. */
const senders: string[] = []

/**
 * What followed a written operation, in the order it was written: the entity,
 * the kind and what the operation wrote of its text, its total or its seal.
 */
const followed: string[] = []

/**
 * What follows a seal, as an application follows a signature: the letter is
 * sealed in the same transaction, and takes no second seal. A letter nobody
 * can deliver is refused only then, from what the seal writes.
 */
async function sealTheLetter({ tx, operation, values }: SyncCheckContext<Courier>) {
  followed.push(
    [
      operation.entity,
      operation.kind,
      String(values['text'] ?? values['total'] ?? values['sealedBy'] ?? ''),
    ].join(':'),
  )

  if (operation.entity !== 'letter_seals') {
    return
  }

  // The seal is written by now and found, as an application counts the
  // signatures of a record with the new one among them.
  const [seal] = await tx
    .select({ id: letterSeals.id })
    .from(letterSeals)
    .where(eq(letterSeals.id, operation.recordId as never))

  if (!seal) {
    throw new Error('The seal is not written yet')
  }

  const letterId = values['letterId'] as never
  const [letter] = await tx
    .select({ subject: letters.subject })
    .from(letters)
    .where(eq(letters.id, letterId))

  if (letter?.subject === 'Unzustellbar') {
    throw new Error('Dieser Brief lässt sich nicht zustellen.')
  }

  await tx.update(letters).set({ status: 'sealed' }).where(eq(letters.id, letterId))
}

const sync = serverSync<Courier>({
  rules: probeSyncRules,
  tables: syncTables({ shelves, notes, letters, letterLines, letterSeals }),
  checks: [
    noteText,
    ({ operation, sender }) => {
      if (operation.entity === 'notes') {
        senders.push(sender.name)
      }

      return null
    },
    closedShelf,
    privateText,
  ],
  complete: ({ operation, values, current, sender }) => {
    if (operation.entity === 'letter_seals') {
      // Named after whoever sent it, whatever a device says.
      return { ...values, sealedBy: sender.name }
    }

    if (operation.entity !== 'letter_lines') {
      return values
    }

    const quantity = Number(values['quantity'] ?? current?.['quantity'] ?? 1)
    const price = Number(values['price'] ?? current?.['price'] ?? 0)

    return { ...values, total: quantity * price }
  },
  afterWrite: sealTheLetter,
})

let foundation: ProbeFoundation
let admin: Pool
let database: Database

function inTenant<Result>(
  tenantId: TenantId,
  work: (tx: TenantTransaction) => Promise<Result>,
  deviceId = 'probe-phone',
): Promise<Result> {
  return database.forTenant({ tenantId, userId: 'olga', reason: 'sync', deviceId }, work)
}

function operation(over: {
  entity: string
  recordId: string
  kind?: Operation['kind']
  patches?: { field: string; from?: SyncValue; to: SyncValue }[]
  deviceId?: string
}): Operation {
  return {
    id: newId<'operation'>(),
    entity: over.entity,
    recordId: over.recordId,
    kind: over.kind ?? 'create',
    baseVersion: null,
    patches: (over.patches ?? []).map((patch) => ({
      field: patch.field,
      from: patch.from ?? null,
      to: patch.to,
    })),
    recordedAt: new Date(),
    deviceId: over.deviceId ?? 'probe-phone',
  }
}

function send(tenantId: TenantId, operations: readonly Operation[]) {
  return inTenant(tenantId, (tx) => sync.applyOperations(tx, tenantId, operations, courier))
}

const outcomes = (receipts: readonly OperationReceipt[]) =>
  receipts.map(({ outcome, reason, fields }) => ({ outcome, reason, fields }))

beforeAll(async () => {
  foundation = await probeFoundation(probeSyncMade)
  admin = await foundation.kit.connect()
  database = Database.connect(foundation.kit.applicationDatabaseUrl())
}, 60_000)

beforeEach(async () => {
  await foundation.empty()
  await foundation.tenants(admin, [north, south])
  senders.length = 0
  followed.length = 0
})

afterAll(async () => {
  await database.close()
  await admin.end()
  foundation.remove()
})

describe('applying what a device queued up', () => {
  it('creates a record and gives it its place in the stream of the tenant', async () => {
    const shelfId = newId<'shelf'>()
    const receipts = await send(north.id, [
      operation({
        entity: 'shelves',
        recordId: shelfId,
        patches: [{ field: 'label', to: 'Keller' }],
      }),
    ])

    expect(outcomes(receipts)).toEqual([{ outcome: 'applied', reason: null, fields: [] }])

    const pulled = await inTenant(north.id, (tx) => sync.changesSince(tx, 0))
    const rows = pulled.changes.find((change) => change.entity === 'shelves')?.rows ?? []

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      id: shelfId,
      label: 'Keller',
      version: 1,
      deviceId: 'probe-phone',
    })
    expect(Number(rows[0]?.['changeSequence'])).toBeGreaterThan(0)
    expect(pulled.cursor).toBe(Number(rows[0]?.['changeSequence']))
    expect(pulled.hasMore).toBe(false)
  })

  it('answers the same transmission twice with the receipt of the first, and writes nothing twice', async () => {
    const queued = [
      operation({
        entity: 'notes',
        recordId: newId<'note'>(),
        patches: [{ field: 'text', to: 'Zähler ablesen' }],
      }),
    ]

    await send(north.id, queued)
    const again = await send(north.id, queued)

    expect(outcomes(again)).toEqual([{ outcome: 'applied', reason: 'already_seen', fields: [] }])
    expect(await inTenant(north.id, (tx) => tx.select().from(notes))).toHaveLength(1)
  })

  it('takes two changes of different fields from two devices, and keeps the second of two on the same field for a person', async () => {
    const shelfId = newId<'shelf'>()
    const noteId = newId<'note'>()

    await send(north.id, [
      operation({
        entity: 'shelves',
        recordId: shelfId,
        patches: [{ field: 'label', to: 'Keller' }],
      }),
      operation({
        entity: 'notes',
        recordId: noteId,
        patches: [{ field: 'text', to: 'Zähler ablesen' }],
      }),
    ])

    // Two devices that saw the same note, each writing down something else.
    const first = await send(north.id, [
      operation({
        entity: 'notes',
        recordId: noteId,
        kind: 'update',
        patches: [{ field: 'text', from: 'Zähler ablesen', to: 'Zähler abgelesen' }],
        deviceId: 'phone-a',
      }),
    ])
    const second = await send(north.id, [
      operation({
        entity: 'notes',
        recordId: noteId,
        kind: 'update',
        patches: [{ field: 'text', from: 'Zähler ablesen', to: 'Zähler fehlt' }],
        deviceId: 'phone-b',
      }),
    ])
    // And a third that changes another field nobody touched.
    const third = await send(north.id, [
      operation({
        entity: 'notes',
        recordId: noteId,
        kind: 'update',
        patches: [{ field: 'shelfId', from: null, to: shelfId }],
        deviceId: 'phone-c',
      }),
    ])

    expect(outcomes(first)).toEqual([{ outcome: 'applied', reason: null, fields: [] }])
    expect(outcomes(second)).toEqual([
      { outcome: 'conflict', reason: 'changed_elsewhere', fields: ['text'] },
    ])
    expect(outcomes(third)).toEqual([{ outcome: 'applied', reason: null, fields: [] }])

    const [note] = await inTenant(north.id, (tx) => tx.select().from(notes))

    expect(note).toMatchObject({ text: 'Zähler abgelesen', shelfId, version: 3 })

    // The three pictures a person decides by: what the device wanted, what it
    // thought was there, and what was.
    const open = await inTenant(north.id, (tx) => openConflicts(tx, 'phone-b'))

    expect(open).toHaveLength(1)
    expect(open[0]).toMatchObject({
      entity: 'notes',
      recordId: noteId,
      reason: 'changed_elsewhere',
      fields: ['text'],
      wanted: { text: 'Zähler fehlt' },
      seen: { text: 'Zähler ablesen' },
      found: { text: 'Zähler abgelesen' },
      deviceId: 'phone-b',
    })

    // The conflict is the device's whose change it was (GHSA-4jfj-cxqw-qgpj): another
    // device of the tenant neither gets it nor closes it.
    expect(await inTenant(north.id, (tx) => openConflicts(tx, 'phone-a'))).toEqual([])
    expect(await inTenant(north.id, (tx) => closeConflict(tx, open[0]!.id, 'phone-a'))).toBe(false)

    expect(await inTenant(north.id, (tx) => closeConflict(tx, open[0]!.id, 'phone-b'))).toBe(true)
    expect(await inTenant(north.id, (tx) => closeConflict(tx, open[0]!.id, 'phone-b'))).toBe(false)
    expect(await inTenant(north.id, (tx) => openConflicts(tx, 'phone-b'))).toEqual([])
  })

  it('keeps master data to a connection: a change from a device is a conflict, online only', async () => {
    const shelfId = newId<'shelf'>()

    await send(north.id, [
      operation({
        entity: 'shelves',
        recordId: shelfId,
        patches: [{ field: 'label', to: 'Keller' }],
      }),
    ])
    const changed = await send(north.id, [
      operation({
        entity: 'shelves',
        recordId: shelfId,
        kind: 'update',
        patches: [{ field: 'label', from: 'Keller', to: 'Dachboden' }],
      }),
    ])

    expect(outcomes(changed)).toEqual([{ outcome: 'conflict', reason: 'online_only', fields: [] }])
  })

  it('lets a line be written while its letter is a draft, puts in the total, and keeps the line once the letter is sent', async () => {
    const letterId = newId<'letter'>()
    const lineId = newId<'letter-line'>()

    const written = await send(north.id, [
      operation({
        entity: 'letters',
        recordId: letterId,
        patches: [{ field: 'subject', to: 'Angebot' }],
      }),
      operation({
        entity: 'letter_lines',
        recordId: lineId,
        patches: [
          { field: 'letterId', to: letterId },
          { field: 'quantity', to: 3 },
          { field: 'price', to: 250 },
        ],
      }),
    ])

    expect(outcomes(written).map(({ outcome }) => outcome)).toEqual(['applied', 'applied'])
    expect(await inTenant(north.id, (tx) => tx.select().from(letterLines))).toMatchObject([
      { total: 750 },
    ])

    // The total is the server's: a device that sends one is refused it.
    const reaching = await send(north.id, [
      operation({
        entity: 'letter_lines',
        recordId: lineId,
        kind: 'update',
        patches: [{ field: 'total', from: 750, to: 1 }],
      }),
    ])

    expect(outcomes(reaching)).toEqual([
      { outcome: 'conflict', reason: 'set_by_server', fields: ['total'] },
    ])

    // Sent, which only the server does.
    await inTenant(north.id, (tx) =>
      tx.update(letters).set({ status: 'sent' }).where(eq(letters.id, letterId)),
    )

    const late = await send(north.id, [
      operation({
        entity: 'letter_lines',
        recordId: lineId,
        kind: 'update',
        patches: [{ field: 'quantity', from: 3, to: 4 }],
      }),
    ])

    expect(outcomes(late)).toEqual([
      { outcome: 'conflict', reason: 'record_is_fixed', fields: ['status'] },
    ])
  })

  it('asks the letter a line moves to, not the letter it leaves', async () => {
    const sent = newId<'letter'>()
    const draft = newId<'letter'>()
    const lineId = newId<'letter-line'>()

    await send(north.id, [
      operation({ entity: 'letters', recordId: sent, patches: [{ field: 'subject', to: 'Alt' }] }),
      operation({ entity: 'letters', recordId: draft, patches: [{ field: 'subject', to: 'Neu' }] }),
      operation({
        entity: 'letter_lines',
        recordId: lineId,
        patches: [
          { field: 'letterId', to: sent },
          { field: 'price', to: 100 },
        ],
      }),
    ])
    await inTenant(north.id, (tx) =>
      tx.update(letters).set({ status: 'sent' }).where(eq(letters.id, sent)),
    )

    const moved = await send(north.id, [
      operation({
        entity: 'letter_lines',
        recordId: lineId,
        kind: 'update',
        patches: [{ field: 'letterId', from: sent, to: draft }],
      }),
    ])

    expect(outcomes(moved)).toEqual([{ outcome: 'applied', reason: null, fields: [] }])
  })

  it('writes what a check of the application left of the values, not what the device sent', async () => {
    await send(north.id, [
      operation({
        entity: 'notes',
        recordId: newId<'note'>(),
        patches: [{ field: 'text', to: 'privat: Code 4711' }],
      }),
    ])

    expect(await inTenant(north.id, (tx) => tx.select().from(notes))).toMatchObject([
      { text: '(privat)' },
    ])
  })

  it('writes what the checks left also for an application that puts in no values of its own', async () => {
    const bare = serverSync<Courier>({
      rules: probeSyncRules,
      tables: syncTables({ shelves, notes, letters, letterLines }),
      checks: [privateText],
    })

    await inTenant(north.id, (tx) =>
      bare.applyOperations(
        tx,
        north.id,
        [
          operation({
            entity: 'notes',
            recordId: newId<'note'>(),
            patches: [{ field: 'text', to: 'privat: Code 4711' }],
          }),
        ],
        courier,
      ),
    )

    expect(await inTenant(north.id, (tx) => tx.select().from(notes))).toMatchObject([
      { text: '(privat)' },
    ])
  })

  it('marks a deleted record instead of removing it, so that a device that was away hears of it', async () => {
    const noteId = newId<'note'>()

    await send(north.id, [
      operation({
        entity: 'notes',
        recordId: noteId,
        patches: [{ field: 'text', to: 'Zähler ablesen' }],
      }),
    ])
    const { cursor } = await inTenant(north.id, (tx) => sync.changesSince(tx, 0))
    const deleted = await send(north.id, [
      operation({ entity: 'notes', recordId: noteId, kind: 'delete' }),
    ])

    expect(outcomes(deleted)).toEqual([{ outcome: 'applied', reason: null, fields: [] }])

    const later = await inTenant(north.id, (tx) => sync.changesSince(tx, cursor))
    const rows = later.changes.find((change) => change.entity === 'notes')?.rows ?? []

    expect(rows).toHaveLength(1)
    expect(rows[0]?.['deletedAt']).not.toBeNull()
  })

  it('records an entity nothing in the schema keeps as a conflict, not as an error', async () => {
    // Parcels have a policy and no table in this application.
    const receipts = await send(north.id, [
      operation({ entity: 'parcels', recordId: newId<'parcel'>(), patches: [] }),
    ])

    expect(outcomes(receipts)).toEqual([
      { outcome: 'conflict', reason: 'unknown_entity', fields: [] },
    ])
  })
})

describe('what the application asks of an operation', () => {
  it('refuses the whole transmission over a mistake only the client can make, and names the operation', async () => {
    const fine = operation({
      entity: 'shelves',
      recordId: newId<'shelf'>(),
      patches: [{ field: 'label', to: 'Keller' }],
    })
    const blank = operation({
      entity: 'notes',
      recordId: newId<'note'>(),
      patches: [{ field: 'text', to: '   ' }],
    })

    const refused = await send(north.id, [fine, blank]).catch((error: unknown) => error)

    expect(refused).toBeInstanceOf(OperationRefused)
    expect((refused as OperationRefused).operationId).toBe(blank.id)
    expect((refused as OperationRefused).cause).toBeInstanceOf(UnknownFieldError)
    expect((refused as OperationRefused).message).toBe('Eine Notiz braucht einen Text.')
    // One transaction: the shelf before it is not there either.
    expect(await inTenant(north.id, (tx) => tx.select().from(shelves))).toEqual([])
  })

  it('keeps an operation a check of the application turns down for a person, and lets the rest land', async () => {
    const shelfId = newId<'shelf'>()

    await send(north.id, [
      operation({
        entity: 'shelves',
        recordId: shelfId,
        patches: [{ field: 'label', to: 'Keller' }],
      }),
    ])
    await inTenant(north.id, (tx) =>
      tx.update(shelves).set({ closed: true }).where(eq(shelves.id, shelfId)),
    )

    const receipts = await send(north.id, [
      operation({
        entity: 'notes',
        recordId: newId<'note'>(),
        patches: [
          { field: 'text', to: 'Zähler ablesen' },
          { field: 'shelfId', to: shelfId },
        ],
      }),
      operation({
        entity: 'notes',
        recordId: newId<'note'>(),
        patches: [{ field: 'text', to: 'Licht prüfen' }],
      }),
    ])

    expect(outcomes(receipts)).toEqual([
      { outcome: 'conflict', reason: 'record_is_fixed', fields: ['shelfId'] },
      { outcome: 'applied', reason: null, fields: [] },
    ])
    expect(await inTenant(north.id, (tx) => tx.select().from(notes))).toMatchObject([
      { text: 'Licht prüfen' },
    ])
  })

  it('asks the checks in the order the application gave, with whoever sent the transmission', async () => {
    await send(north.id, [
      operation({
        entity: 'notes',
        recordId: newId<'note'>(),
        patches: [{ field: 'text', to: 'Zähler ablesen' }],
      }),
    ])
    // A blank note is refused by the first check, before the second sees it.
    await send(north.id, [
      operation({
        entity: 'notes',
        recordId: newId<'note'>(),
        patches: [{ field: 'text', to: '' }],
      }),
    ]).catch(() => undefined)

    expect(senders).toEqual(['Olga'])
  })

  it('refuses a field the table does not have, with the name of the field', async () => {
    const refused = await send(north.id, [
      operation({
        entity: 'notes',
        recordId: newId<'note'>(),
        patches: [
          { field: 'text', to: 'Zähler ablesen' },
          { field: 'colour', to: 'rot' },
        ],
      }),
    ]).catch((error: unknown) => error)

    expect((refused as OperationRefused).cause).toBeInstanceOf(UnknownFieldError)
    expect((refused as OperationRefused).message).toBe('Unbekanntes Feld: colour')
  })
})

describe('what follows a written operation', () => {
  /** A letter and a seal on it, as a device sends them in one transmission. */
  function letterWithSeal(subject: string, sealedBy?: string) {
    const letterId = newId<'letter'>()
    const sealId = newId<'letter-seal'>()

    return {
      letterId,
      sealId,
      operations: [
        operation({
          entity: 'letters',
          recordId: letterId,
          patches: [{ field: 'subject', to: subject }],
        }),
        operation({
          entity: 'letter_seals',
          recordId: sealId,
          patches: [
            { field: 'letterId', to: letterId },
            ...(sealedBy === undefined ? [] : [{ field: 'sealedBy', to: sealedBy }]),
          ],
        }),
      ],
    }
  }

  it('writes what comes of a seal in the same transaction, and the letter takes no second one', async () => {
    // A device that names somebody else: the server names the sender.
    const { letterId, sealId, operations } = letterWithSeal('Angebot', 'Jemand anderes')

    expect(outcomes(await send(north.id, operations))).toEqual([
      { outcome: 'applied', reason: null, fields: [] },
      { outcome: 'applied', reason: null, fields: [] },
    ])

    const [letter] = await inTenant(north.id, (tx) =>
      tx.select().from(letters).where(eq(letters.id, letterId)),
    )
    const [seal] = await inTenant(north.id, (tx) =>
      tx.select().from(letterSeals).where(eq(letterSeals.id, sealId)),
    )

    expect(letter?.status).toBe('sealed')
    expect(seal?.sealedBy).toBe('Olga')
    // Shown the values as they were written, the name the server put in among them.
    expect(followed).toEqual(['letters:create:', 'letter_seals:create:Olga'])

    // A second seal finds the letter sealed: a conflict, and nothing follows it.
    const second = operation({
      entity: 'letter_seals',
      recordId: newId<'letter-seal'>(),
      patches: [{ field: 'letterId', to: letterId }],
    })

    expect(outcomes(await send(north.id, [second]))).toEqual([
      { outcome: 'conflict', reason: 'record_is_fixed', fields: ['status'] },
    ])
    expect(await inTenant(north.id, (tx) => tx.select().from(letterSeals))).toHaveLength(1)
    expect(followed).toHaveLength(2)
  })

  it('is shown what the checks and the server made of the values, for a change and a deletion too', async () => {
    const noteId = newId<'note'>()
    const letterId = newId<'letter'>()

    await send(north.id, [
      operation({
        entity: 'notes',
        recordId: noteId,
        patches: [{ field: 'text', to: 'privat: Schlüssel unter der Matte' }],
      }),
      operation({
        entity: 'letters',
        recordId: letterId,
        patches: [{ field: 'subject', to: 'Rechnung' }],
      }),
      operation({
        entity: 'letter_lines',
        recordId: newId<'letter-line'>(),
        patches: [
          { field: 'letterId', to: letterId },
          { field: 'quantity', to: 3 },
          { field: 'price', to: 250 },
        ],
      }),
      operation({
        entity: 'notes',
        recordId: noteId,
        kind: 'update',
        patches: [{ field: 'text', from: '(privat)', to: 'Zähler ablesen' }],
      }),
      operation({ entity: 'notes', recordId: noteId, kind: 'delete' }),
    ])

    expect(followed).toEqual([
      'notes:create:(privat)',
      'letters:create:',
      'letter_lines:create:750',
      'notes:update:Zähler ablesen',
      'notes:delete:',
    ])
  })

  it('is not asked for an operation that was skipped or kept as a conflict', async () => {
    const shelfId = newId<'shelf'>()
    const queued = [
      operation({
        entity: 'shelves',
        recordId: shelfId,
        patches: [{ field: 'label', to: 'Keller' }],
      }),
    ]

    await send(north.id, queued)
    await inTenant(north.id, (tx) =>
      tx.update(shelves).set({ closed: true }).where(eq(shelves.id, shelfId)),
    )
    followed.length = 0

    // The same transmission again, and the same record made by another operation.
    const again = await send(north.id, queued)
    const anew = await send(north.id, [
      operation({
        entity: 'shelves',
        recordId: shelfId,
        patches: [{ field: 'label', to: 'Keller' }],
      }),
    ])
    const onTheClosedShelf = await send(north.id, [
      operation({
        entity: 'notes',
        recordId: newId<'note'>(),
        patches: [
          { field: 'text', to: 'Zu spät' },
          { field: 'shelfId', to: shelfId },
        ],
      }),
    ])

    expect(outcomes(again)).toEqual([{ outcome: 'applied', reason: 'already_seen', fields: [] }])
    expect(outcomes(anew)).toEqual([{ outcome: 'skipped', reason: 'already_there', fields: [] }])
    expect(outcomes(onTheClosedShelf)).toEqual([
      { outcome: 'conflict', reason: 'record_is_fixed', fields: ['shelfId'] },
    ])
    expect(followed).toEqual([])
  })

  it('refuses the transmission with what it throws, naming the operation, and takes back what went before', async () => {
    const before = operation({
      entity: 'notes',
      recordId: newId<'note'>(),
      patches: [{ field: 'text', to: 'Davor' }],
    })
    const { operations } = letterWithSeal('Unzustellbar')
    const seal = operations[1]
    const refused = await send(north.id, [before, ...operations]).catch((error: unknown) => error)

    expect(refused).toBeInstanceOf(OperationRefused)
    expect((refused as OperationRefused).operationId).toBe(seal?.id)
    expect((refused as OperationRefused).message).toBe('Dieser Brief lässt sich nicht zustellen.')
    expect(await inTenant(north.id, (tx) => tx.select().from(notes))).toEqual([])
    expect(await inTenant(north.id, (tx) => tx.select().from(letters))).toEqual([])
    expect(await inTenant(north.id, (tx) => tx.select().from(letterSeals))).toEqual([])
  })
})

describe('a value of JSON or a list', () => {
  /** The details of a note as a device might write them by hand: keys unsorted, spaces. */
  const written = '{ "rooms": 3, "access": { "via": "Hof", "key": null } }'
  /** The same value in the text `jsonText` writes. */
  const asJsonText = '{"access":{"key":null,"via":"Hof"},"rooms":3}'

  async function noteWithDetails() {
    const noteId = newId<'note'>()

    await send(north.id, [
      operation({
        entity: 'notes',
        recordId: noteId,
        patches: [
          { field: 'text', to: 'Zähler ablesen' },
          { field: 'tags', to: '["Keller", "Zähler"]' },
          { field: 'details', to: written },
        ],
      }),
    ])

    return noteId
  }

  async function refusalOf(patch: { field: string; from?: SyncValue; to: SyncValue }) {
    const noteId = await noteWithDetails()
    const refused = await send(north.id, [
      operation({ entity: 'notes', recordId: noteId, kind: 'update', patches: [patch] }),
    ]).catch((error: unknown) => error)

    expect((refused as OperationRefused).cause).toBeInstanceOf(UnknownFieldError)

    return (refused as OperationRefused).message
  }

  it('writes it from its text into the column, and sends it back as the text jsonText writes', async () => {
    const noteId = await noteWithDetails()

    const [note] = await inTenant(north.id, (tx) => tx.select().from(notes))

    expect(note).toMatchObject({
      id: noteId,
      tags: ['Keller', 'Zähler'],
      details: { rooms: 3, access: { via: 'Hof', key: null } },
    })

    const pulled = await inTenant(north.id, (tx) => sync.changesSince(tx, 0))
    const [row] = pulled.changes.find((change) => change.entity === 'notes')?.rows ?? []

    expect(row).toMatchObject({ tags: '["Keller","Zähler"]', details: asJsonText })
  })

  it('compares what a value is and not how a device wrote it, and keeps a change made elsewhere for a person', async () => {
    const noteId = await noteWithDetails()

    // The device that wrote the note saw its own text, not the server's.
    const changed = await send(north.id, [
      operation({
        entity: 'notes',
        recordId: noteId,
        kind: 'update',
        patches: [{ field: 'details', from: written, to: '{"rooms": 4}' }],
        deviceId: 'phone-a',
      }),
    ])
    // A second device still held the first value, in the server's text.
    const stale = await send(north.id, [
      operation({
        entity: 'notes',
        recordId: noteId,
        kind: 'update',
        patches: [{ field: 'details', from: asJsonText, to: '{"rooms": 2}' }],
        deviceId: 'phone-b',
      }),
    ])

    expect(outcomes(changed)).toEqual([{ outcome: 'applied', reason: null, fields: [] }])
    expect(outcomes(stale)).toEqual([
      { outcome: 'conflict', reason: 'changed_elsewhere', fields: ['details'] },
    ])

    // Read from a row that holds a list beside it, which the merge reads as text as well.
    const [conflict] = await inTenant(north.id, (tx) => openConflicts(tx, 'phone-b'))

    expect(conflict).toMatchObject({
      wanted: { details: '{"rooms":2}' },
      seen: { details: asJsonText },
      found: { details: '{"rooms":4}' },
    })
  })

  it('refuses a text that is no JSON, before the merge and for the whole transmission', async () => {
    expect(await refusalOf({ field: 'details', from: written, to: 'drei Räume' })).toBe(
      'Dieses Feld nimmt nur JSON als Text: details',
    )
    expect(await refusalOf({ field: 'details', from: 'nicht gelesen', to: '{}' })).toBe(
      'Dieses Feld nimmt nur JSON als Text: details',
    )
  })

  it('refuses what is not a list for a column of a list, and what is not text', async () => {
    expect(await refusalOf({ field: 'tags', from: '["Keller","Zähler"]', to: '"Keller"' })).toBe(
      'Dieses Feld nimmt nur JSON als Text: tags',
    )
    expect(await refusalOf({ field: 'details', from: asJsonText, to: 4 })).toBe(
      'Dieses Feld nimmt nur JSON als Text: details',
    )
  })

  it('takes null and the text of null as nothing', async () => {
    const noteId = await noteWithDetails()

    const cleared = await send(north.id, [
      operation({
        entity: 'notes',
        recordId: noteId,
        kind: 'update',
        patches: [
          { field: 'details', from: asJsonText, to: 'null' },
          { field: 'tags', from: '["Keller","Zähler"]', to: null },
        ],
      }),
    ])

    // A device that kept the text of null saw nothing there, as the server does.
    const again = await send(north.id, [
      operation({
        entity: 'notes',
        recordId: noteId,
        kind: 'update',
        patches: [{ field: 'details', from: 'null', to: '{"rooms": 1}' }],
      }),
    ])

    expect(outcomes(cleared)).toEqual([{ outcome: 'applied', reason: null, fields: [] }])
    expect(outcomes(again)).toEqual([{ outcome: 'applied', reason: null, fields: [] }])

    const pulled = await inTenant(north.id, (tx) => sync.changesSince(tx, 0))
    const [row] = pulled.changes.find((change) => change.entity === 'notes')?.rows ?? []

    expect(row).toMatchObject({ tags: null, details: '{"rooms":1}' })
  })
})

describe('what a device is sent', () => {
  it('sends a tenant its own records and nothing of the tenant next door', async () => {
    await send(north.id, [
      operation({
        entity: 'notes',
        recordId: newId<'note'>(),
        patches: [{ field: 'text', to: 'Nord' }],
      }),
    ])
    await send(south.id, [
      operation({
        entity: 'notes',
        recordId: newId<'note'>(),
        patches: [{ field: 'text', to: 'Süd' }],
      }),
    ])

    const pulled = await inTenant(north.id, (tx) => sync.changesSince(tx, 0))

    expect(pulled.changes.flatMap((change) => change.rows.map((row) => row['text']))).toEqual([
      'Nord',
    ])
  })

  it('narrows an entity for a device that may not hold all of it, and leaves the others whole', async () => {
    const keller = newId<'shelf'>()
    const boden = newId<'shelf'>()

    await send(north.id, [
      operation({
        entity: 'shelves',
        recordId: keller,
        patches: [{ field: 'label', to: 'Keller' }],
      }),
      operation({
        entity: 'shelves',
        recordId: boden,
        patches: [{ field: 'label', to: 'Dachboden' }],
      }),
      operation({
        entity: 'notes',
        recordId: newId<'note'>(),
        patches: [
          { field: 'text', to: 'Im Keller' },
          { field: 'shelfId', to: keller },
        ],
      }),
      operation({
        entity: 'notes',
        recordId: newId<'note'>(),
        patches: [
          { field: 'text', to: 'Auf dem Boden' },
          { field: 'shelfId', to: boden },
        ],
      }),
    ])

    // The device of somebody who works in the cellar, and holds no letters.
    const pulled = await inTenant(north.id, (tx) =>
      sync.changesSince(tx, 0, undefined, (entity) =>
        entity === 'notes'
          ? sql`${notes.shelfId} = ${keller}`
          : entity === 'letters'
            ? nothing
            : undefined,
      ),
    )
    const byEntity = Object.fromEntries(
      pulled.changes.map((change) => [
        change.entity,
        change.rows.map((row) => row['label'] ?? row['text']),
      ]),
    )

    expect(byEntity).toEqual({ shelves: ['Keller', 'Dachboden'], notes: ['Im Keller'] })
  })

  it('stops the cursor at the lowest entity that ran into its limit, and says to come back', async () => {
    const queued: Operation[] = []

    for (const label of ['A', 'B', 'C']) {
      queued.push(
        operation({
          entity: 'shelves',
          recordId: newId<'shelf'>(),
          patches: [{ field: 'label', to: label }],
        }),
      )
    }

    for (const text of ['eins', 'zwei', 'drei']) {
      queued.push(
        operation({
          entity: 'notes',
          recordId: newId<'note'>(),
          patches: [{ field: 'text', to: text }],
        }),
      )
    }

    await send(north.id, queued)

    const first = await inTenant(north.id, (tx) => sync.changesSince(tx, 0, 2))
    const shelfRows = first.changes.find((change) => change.entity === 'shelves')?.rows ?? []

    expect(first.hasMore).toBe(true)
    // The second shelf is where shelves stopped, and nothing behind it is skipped.
    expect(first.cursor).toBe(Number(shelfRows[1]?.['changeSequence']))

    // Asked again until nothing more waits, the way a device pulls.
    const seen = new Set<string>()
    let pull = first
    let pulls = 1

    for (;;) {
      for (const change of pull.changes) {
        for (const row of change.rows) {
          seen.add(String(row['label'] ?? row['text']))
        }
      }

      if (!pull.hasMore) {
        break
      }

      const from = pull.cursor
      pull = await inTenant(north.id, (tx) => sync.changesSince(tx, from, 2))
      pulls += 1
    }

    expect([...seen].sort()).toEqual(['A', 'B', 'C', 'drei', 'eins', 'zwei'])
    expect(pulls).toBeGreaterThan(1)
  })
})
