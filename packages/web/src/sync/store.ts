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

/**
 * The bytes of a file, under their SHA-256 (#77).
 *
 * An `ArrayBuffer` and not a `Blob`: both survive IndexedDB in a browser, but
 * only the buffer survives every structured clone a test runs in, and the
 * difference is one call when a screen needs a `Blob` for an address.
 */
export interface StoredFile {
  readonly sha256: string
  readonly bytes: ArrayBuffer
  readonly mediaType: string
}

export interface LocalStore {
  /** Everything of one kind, deleted rows included. Filtering is the caller's. */
  readAll(entity: string): Promise<readonly StoredRecord[]>
  write(entity: string, records: readonly StoredRecord[]): Promise<void>
  /** Every row of one kind, gone; the outbox keeps what it holds of it. */
  drop(entity: string): Promise<void>

  readOutbox(): Promise<readonly Operation[]>
  queue(operation: Operation): Promise<void>
  dequeue(ids: readonly OperationId[]): Promise<void>

  readConflicts(): Promise<readonly SyncConflict[]>
  writeConflicts(conflicts: readonly SyncConflict[]): Promise<void>
  dropConflict(id: string): Promise<void>

  readMeta(key: string): Promise<string | number | null>
  writeMeta(key: string, value: string | number): Promise<void>

  /**
   * A file kept on this device. `waiting` puts it on the list of uploads as
   * well, for a file made here that the server does not have yet; a preview
   * fetched from the server is kept without it.
   */
  keepFile(file: StoredFile, waiting: boolean): Promise<void>
  readFile(sha256: string): Promise<StoredFile | null>
  /** The files made here that still have to go up, oldest first. */
  waitingFiles(): Promise<readonly StoredFile[]>
  /** How many that is, without reading a single byte of them. */
  countWaitingFiles(): Promise<number>
  /** Off the list of uploads. The bytes stay, for the screens that show them. */
  fileSent(sha256: string): Promise<void>

  /** Everything of this tenant, gone. What signing out has to do. */
  clear(): Promise<void>
  close(): void
}

const recordStore = 'records'
const outboxStore = 'outbox'
const conflictStore = 'conflicts'
const metaStore = 'meta'
const fileStore = 'files'
const uploadStore = 'uploads'

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

  // Since version 2 (#77). The bytes in one store and the list of what still
  // has to go up in another, so that finding the waiting uploads does not read
  // every photo on the device to look at a flag.
  if (!database.objectStoreNames.contains(fileStore)) {
    database.createObjectStore(fileStore, { keyPath: 'sha256' })
  }

  if (!database.objectStoreNames.contains(uploadStore)) {
    database.createObjectStore(uploadStore, { keyPath: 'sha256' })
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
    // Version 2 added the files (#77). `upgrade` adds whatever is missing, so a
    // device on version 1 keeps its records and gains the two new stores.
    const request = indexedDB.open(`opengewerk.${tenantId}`, 2)

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

    async drop(entity) {
      const transaction = transact([recordStore], 'readwrite')
      const store = transaction.objectStore(recordStore)
      const keys = await promised<IDBValidKey[]>(store.index('entity').getAllKeys(entity))

      for (const key of keys) {
        store.delete(key)
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

    async keepFile(file, waiting) {
      const transaction = transact([fileStore, uploadStore], 'readwrite')

      transaction.objectStore(fileStore).put(file)

      if (waiting) {
        transaction.objectStore(uploadStore).put({ sha256: file.sha256, since: Date.now() })
      }

      await finished(transaction)
    },

    async readFile(sha256) {
      const transaction = transact([fileStore], 'readonly')
      const found = await promised<StoredFile | undefined>(
        transaction.objectStore(fileStore).get(sha256),
      )

      return found ?? null
    },

    async waitingFiles() {
      const listed = transact([uploadStore], 'readonly')
      const waiting = await promised<{ sha256: string; since: number }[]>(
        listed.objectStore(uploadStore).getAll(),
      )

      // A second transaction with every request made at once. A request made
      // after an `await` may find its transaction already committed.
      const reading = transact([fileStore], 'readonly')
      const store = reading.objectStore(fileStore)
      const found = await Promise.all(
        [...waiting]
          .sort((left, right) => left.since - right.since)
          .map(({ sha256 }) => promised<StoredFile | undefined>(store.get(sha256))),
      )

      return found.filter((file): file is StoredFile => file !== undefined)
    },

    async countWaitingFiles() {
      const transaction = transact([uploadStore], 'readonly')

      return await promised<number>(transaction.objectStore(uploadStore).count())
    },

    async fileSent(sha256) {
      const transaction = transact([uploadStore], 'readwrite')

      transaction.objectStore(uploadStore).delete(sha256)

      await finished(transaction)
    },

    async clear() {
      const names = [recordStore, outboxStore, conflictStore, metaStore, fileStore, uploadStore]
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
