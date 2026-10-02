import 'fake-indexeddb/auto'

import { createHash } from 'node:crypto'

import { syncRules } from '@opengewerk/platform-domain'
import { probePolicies } from '@opengewerk/platform-domain/testing'
import { beforeEach, describe, expect, it } from 'vitest'

import { SyncClient } from './client.js'
import { openLocalStore } from './store.js'
import { TestServer } from './test-server.js'
import { RequestRefused } from './transport.js'

/**
 * The files of #77 on their way through the sync client: kept on the device,
 * sent ahead of the record that names them, and kept waiting without a
 * network like everything else made in a cellar.
 */

const rules = syncRules(probePolicies)

let server: TestServer
let counter = 0

async function start() {
  return await SyncClient.start({
    store: await openLocalStore(`files${String((counter += 1))}`),
    transport: server,
    writer: server,
    rules,
    deviceId: 'phone',
    entities: ['notes', 'parcels'],
    onSignedOut: () => {},
  })
}

const photo = new TextEncoder().encode('a photo of a label').buffer as ArrayBuffer

function hashOf(bytes: ArrayBuffer): string {
  return createHash('sha256').update(new Uint8Array(bytes)).digest('hex')
}

/** A note and a parcel that names the file, the way a screen makes two records for one photo. */
async function attach(client: SyncClient, sha256: string, sizeBytes: number) {
  const note = await client.create('notes', { title: 'Label' })

  if (note.outcome !== 'queued') {
    throw new Error('The note was refused on the device.')
  }

  await client.create('parcels', {
    noteId: note.id,
    sha256,
    fileName: 'label.jpg',
    mediaType: 'image/jpeg',
    sizeBytes,
  })
}

beforeEach(() => {
  server = new TestServer()
})

describe('a file made on the device', () => {
  it('is named by its SHA-256, the name the server stores it under', async () => {
    const client = await start()

    expect(await client.keepFile(photo, 'image/jpeg')).toEqual({
      sha256: hashOf(photo),
      sizeBytes: photo.byteLength,
    })
  })

  it('goes up ahead of the record that names it', async () => {
    const client = await start()
    const { sha256, sizeBytes } = await client.keepFile(photo, 'image/jpeg')

    await attach(client, sha256, sizeBytes)
    await client.synchronise()

    expect(server.log[0]).toBe(`upload ${sha256.slice(0, 8)}`)
    expect(server.log.slice(1).every((entry) => entry.startsWith('push '))).toBe(true)
    expect(new Uint8Array(server.uploaded.get(sha256)?.bytes ?? new ArrayBuffer(0))).toEqual(
      new Uint8Array(photo),
    )
    expect(client.status().pending).toBe(0)
  })

  it('waits on the device without a network, and goes up once there is one', async () => {
    const client = await start()

    server.offline = true

    const { sha256, sizeBytes } = await client.keepFile(photo, 'image/jpeg')

    await attach(client, sha256, sizeBytes)
    await client.synchronise()

    expect(server.uploaded.size).toBe(0)
    expect(server.sent).toEqual([])
    expect(client.status().pending).toBe(2)

    server.offline = false
    await client.synchronise()

    expect([...server.uploaded.keys()]).toEqual([sha256])
    expect(client.status().pending).toBe(0)

    // Sent once and not again: the next exchange has nothing left to upload.
    await client.synchronise()
    expect(server.log.filter((entry) => entry.startsWith('upload'))).toHaveLength(1)
  })

  it('is let go when the server refuses it, and the rest of the outbox still goes', async () => {
    const client = await start()

    server.refuseUploads = new RequestRefused(413, 'Die Datei ist größer als 25 MB.', {})

    const { sha256, sizeBytes } = await client.keepFile(photo, 'image/jpeg')

    await attach(client, sha256, sizeBytes)
    await client.synchronise()

    expect(server.operations().map((operation) => operation.entity)).toEqual(['notes', 'parcels'])

    // Not tried again: the answer would be the same.
    server.refuseUploads = null
    await client.synchronise()
    expect(server.uploaded.size).toBe(0)
  })

  it('stays on the device over a 403, which refuses the request and not the file (#254)', async () => {
    const client = await start()

    server.refuseUploads = new RequestRefused(403, 'Kein Zugang zu diesem Mandanten.', {})

    const { sha256, sizeBytes } = await client.keepFile(photo, 'image/jpeg')

    await attach(client, sha256, sizeBytes)
    await client.synchronise()

    expect(client.status().trouble).toBe('Kein Zugang zu diesem Mandanten.')
    expect(server.sent).toEqual([])

    server.refuseUploads = null
    await client.synchronise()

    expect([...server.uploaded.keys()]).toEqual([sha256])
    expect(client.status().pending).toBe(0)
  })

  it('stays on the device over a 401 as well, and the session is asked for again', async () => {
    let signedOut = 0
    const client = await SyncClient.start({
      store: await openLocalStore(`files${String((counter += 1))}`),
      transport: server,
      writer: server,
      rules,
      deviceId: 'phone',
      entities: ['notes', 'parcels'],
      onSignedOut: () => {
        signedOut += 1
      },
    })

    server.refuseUploads = new RequestRefused(401, 'Keine gültige Anmeldung.', {})

    const { sha256, sizeBytes } = await client.keepFile(photo, 'image/jpeg')

    await attach(client, sha256, sizeBytes)
    await client.synchronise()

    expect(signedOut).toBeGreaterThan(0)
    expect(server.sent).toEqual([])

    server.refuseUploads = null
    await client.synchronise()

    expect([...server.uploaded.keys()]).toEqual([sha256])
  })

  it('is read back from the device, made here or fetched once', async () => {
    const client = await start()
    const { sha256 } = await client.keepFile(photo, 'image/jpeg')
    const preview = new TextEncoder().encode('a small picture').buffer as ArrayBuffer

    await client.rememberFile(hashOf(preview), preview, 'image/jpeg')

    expect(new Uint8Array((await client.readFile(sha256))?.bytes ?? new ArrayBuffer(0))).toEqual(
      new Uint8Array(photo),
    )
    expect((await client.readFile(hashOf(preview)))?.mediaType).toBe('image/jpeg')
    expect(await client.readFile('0'.repeat(64))).toBeNull()

    // A fetched file is nothing to upload.
    await client.synchronise()
    expect(server.uploaded.has(hashOf(preview))).toBe(false)
  })
})

describe('the store on a device from before the files', () => {
  it('keeps its records and gains the files', async () => {
    const name = 'before-the-files'

    // Version 1 as it was: records, outbox, conflicts and the meta store.
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(`opengewerk.${name}`, 1)

      request.onupgradeneeded = () => {
        const database = request.result
        const records = database.createObjectStore('records', { keyPath: 'key' })

        records.createIndex('entity', 'entity', { unique: false })
        database.createObjectStore('outbox', { keyPath: 'id' })
        database.createObjectStore('conflicts', { keyPath: 'id' })
        database.createObjectStore('meta', { keyPath: 'key' })
        records.put({
          key: 'shelves::s-1',
          entity: 'shelves',
          id: 's-1',
          values: { id: 's-1', name: 'Hall', version: 1, deletedAt: null },
        })
      }
      request.onsuccess = () => {
        request.result.close()
        resolve()
      }
      request.onerror = () => {
        reject(request.error ?? new Error('version 1 did not open'))
      }
    })

    const store = await openLocalStore(name)

    expect(await store.readAll('shelves')).toEqual([
      { id: 's-1', name: 'Hall', version: 1, deletedAt: null },
    ])

    await store.keepFile({ sha256: hashOf(photo), bytes: photo, mediaType: 'image/jpeg' }, true)

    expect((await store.waitingFiles()).map((file) => file.sha256)).toEqual([hashOf(photo)])

    store.close()
  })
})

describe('the stores on a device', () => {
  it('are named after the tenant, under the name every installation already has', async () => {
    // The name is what a device finds its outbox under after an update. One
    // that changed would leave what somebody wrote in a cellar behind in a
    // database nothing opens any more.
    const store = await openLocalStore('named-tenant')

    await store.writeMeta('cursor', 3)
    store.close()

    const opened = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('opengewerk.named-tenant')

      request.onsuccess = () => {
        resolve(request.result)
      }
      request.onerror = () => {
        reject(request.error ?? new Error('the store did not open'))
      }
    })

    expect([...opened.objectStoreNames]).toContain('outbox')
    opened.close()
  })
})
