import type { Operation, OperationId, RecordState, SyncConflict } from '@opengewerk/domain'

/**
 * Where a device keeps what it knows while it has no network.
 *
 * IndexedDB and not `localStorage`: the latter is synchronous, capped at a few
 * megabytes, and stores strings, so every read of a customer list would parse
 * the whole list again on the main thread. A basement with four hundred
 * circuits is not a corner case here, it is a Tuesday.
 *
 * The shape is deliberately small. Records as they came off the wire, the
 * outbox, the conflicts and two pieces of bookkeeping. Anything derived is
 * derived at read time, because a derived value in here is a value that can
 * disagree with the one it came from and no migration will ever notice.
 */

/** The record as it travels: flat, and only values JSON survives unchanged. */
export type StoredRecord = RecordState

interface RecordRow {
  /** `entity` and `id` joined, so a record has one key in one store. */
  readonly key: string
  readonly entity: string
  readonly id: string
  readonly values: StoredRecord
}

interface MetaRow {
  readonly key: string
  readonly value: string | number
}

export interface LocalStore {
  /** Everything of one kind, deleted rows included. Filtering is the caller's. */
  readAll(entity: string): Promise<readonly StoredRecord[]>
  write(entity: string, records: readonly StoredRecord[]): Promise<void>

  readOutbox(): Promise<readonly Operation[]>
  queue(operation: Operation): Promise<void>
  dequeue(ids: readonly OperationId[]): Promise<void>

  readConflicts(): Promise<readonly SyncConflict[]>
  writeConflicts(conflicts: readonly SyncConflict[]): Promise<void>
  dropConflict(id: string): Promise<void>

  readMeta(key: string): Promise<string | number | null>
  writeMeta(key: string, value: string | number): Promise<void>

  /** Everything of this tenant, gone. What signing out has to do. */
  clear(): Promise<void>
  close(): void
}

const recordStore = 'records'
const outboxStore = 'outbox'
const conflictStore = 'conflicts'
const metaStore = 'meta'

function keyOf(entity: string, id: string): string {
  // A separator that cannot appear in either half, so that two different
  // pairs can never produce the same key: a table name is lower case letters
  // and underscores, a UUID is hex and hyphens, and neither holds a colon.
  // Not a control character, however tempting: a NUL byte in a source file
  // makes git treat the whole file as binary and stop showing its diff.
  return `${entity}::${id}`
}

function promised<Value>(request: IDBRequest<Value>): Promise<Value> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      resolve(request.result)
    }
    request.onerror = () => {
      reject(request.error ?? new Error('Die lokale Ablage hat die Anfrage abgelehnt.'))
    }
  })
}

function finished(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => {
      resolve()
    }
    transaction.onabort = () => {
      reject(transaction.error ?? new Error('Die lokale Ablage hat den Vorgang abgebrochen.'))
    }
    transaction.onerror = () => {
      reject(transaction.error ?? new Error('Die lokale Ablage hat den Vorgang abgebrochen.'))
    }
  })
}

/**
 * An operation on its way into the store.
 *
 * `recordedAt` is a `Date` in the model and has to stay one when it comes back
 * out, because the outbox is sorted by it. IndexedDB can hold a `Date`, but
 * only through the structured clone, and that clone is what a branded id does
 * not survive as anything but the string it already is. Writing the round trip
 * out here beats discovering a string where the sort expects a date.
 */
function toStored(operation: Operation) {
  return { ...operation, recordedAt: operation.recordedAt.toISOString() }
}

function fromStored(row: unknown): Operation {
  const stored = row as Operation & { recordedAt: string }

  return { ...stored, recordedAt: new Date(stored.recordedAt) }
}

function upgrade(database: IDBDatabase): void {
  if (!database.objectStoreNames.contains(recordStore)) {
    const records = database.createObjectStore(recordStore, { keyPath: 'key' })
    // The only question ever asked of this store: everything of one kind.
    records.createIndex('entity', 'entity', { unique: false })
  }

  for (const name of [outboxStore, conflictStore]) {
    if (!database.objectStoreNames.contains(name)) {
      database.createObjectStore(name, { keyPath: 'id' })
    }
  }

  if (!database.objectStoreNames.contains(metaStore)) {
    database.createObjectStore(metaStore, { keyPath: 'key' })
  }
}

/**
 * Opens the store for one business on this device.
 *
 * The name carries the tenant, which is the isolation on the device: two
 * businesses on one laptop get two databases, and there is no query that could
 * accidentally reach across. The server has row level security for the same
 * job; here the boundary is the file.
 */
export async function openLocalStore(tenantId: string): Promise<LocalStore> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(`opengewerk.${tenantId}`, 1)

    request.onupgradeneeded = () => {
      upgrade(request.result)
    }
    request.onsuccess = () => {
      resolve(request.result)
    }
    request.onerror = () => {
      reject(request.error ?? new Error('Die lokale Ablage lässt sich nicht öffnen.'))
    }
  })

  function transact(names: readonly string[], mode: IDBTransactionMode): IDBTransaction {
    return database.transaction([...names], mode)
  }

  return {
    async readAll(entity) {
      const transaction = transact([recordStore], 'readonly')
      const rows = await promised<RecordRow[]>(
        transaction.objectStore(recordStore).index('entity').getAll(entity),
      )

      return rows.map((row) => row.values)
    },

    async write(entity, records) {
      const transaction = transact([recordStore], 'readwrite')
      const store = transaction.objectStore(recordStore)

      for (const values of records) {
        const id = String(values['id'])

        store.put({ key: keyOf(entity, id), entity, id, values } satisfies RecordRow)
      }

      await finished(transaction)
    },

    async readOutbox() {
      const transaction = transact([outboxStore], 'readonly')

      return (await promised<unknown[]>(transaction.objectStore(outboxStore).getAll())).map(
        fromStored,
      )
    },

    async queue(operation) {
      const transaction = transact([outboxStore], 'readwrite')

      transaction.objectStore(outboxStore).put(toStored(operation))

      await finished(transaction)
    },

    async dequeue(ids) {
      const transaction = transact([outboxStore], 'readwrite')
      const store = transaction.objectStore(outboxStore)

      for (const id of ids) {
        store.delete(id)
      }

      await finished(transaction)
    },

    async readConflicts() {
      const transaction = transact([conflictStore], 'readonly')

      return await promised<SyncConflict[]>(transaction.objectStore(conflictStore).getAll())
    },

    async writeConflicts(conflicts) {
      const transaction = transact([conflictStore], 'readwrite')
      const store = transaction.objectStore(conflictStore)

      // Replaced whole rather than merged. The server owns this list, so what
      // it last said is the answer, and a conflict that has disappeared there
      // has been decided by somebody, possibly on another device.
      store.clear()

      for (const conflict of conflicts) {
        store.put(conflict)
      }

      await finished(transaction)
    },

    async dropConflict(id) {
      const transaction = transact([conflictStore], 'readwrite')

      transaction.objectStore(conflictStore).delete(id)

      await finished(transaction)
    },

    async readMeta(key) {
      const transaction = transact([metaStore], 'readonly')
      const row = await promised<MetaRow | undefined>(transaction.objectStore(metaStore).get(key))

      return row?.value ?? null
    },

    async writeMeta(key, value) {
      const transaction = transact([metaStore], 'readwrite')

      transaction.objectStore(metaStore).put({ key, value } satisfies MetaRow)

      await finished(transaction)
    },

    async clear() {
      const names = [recordStore, outboxStore, conflictStore, metaStore]
      const transaction = transact(names, 'readwrite')

      for (const name of names) {
        transaction.objectStore(name).clear()
      }

      await finished(transaction)
    },

    close() {
      database.close()
    },
  }
}
