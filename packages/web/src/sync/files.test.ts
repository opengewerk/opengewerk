import 'fake-indexeddb/auto'

import { createHash } from 'node:crypto'

import { beforeEach, describe, expect, it } from 'vitest'

import { SyncClient } from './client.js'
import { openLocalStore } from './store.js'
import { TestServer } from './test-server.js'
import { RequestRefused } from './transport.js'

/**
 * The files of #77 on their way through the sync client: kept on the device,
 * sent ahead of the version that names them, and kept waiting without a
 * network like everything else made in a cellar.
 */

let server: TestServer
let counter = 0

async function start() {
  return await SyncClient.start({
    store: await openLocalStore(`dateien${String((counter += 1))}`),
    transport: server,
    writer: server,
    deviceId: 'handy',
    entities: ['attachments', 'attachment_versions'],
    onSignedOut: () => {},
  })
}

const photo = new TextEncoder().encode('ein Foto vom Typenschild').buffer as ArrayBuffer

function hashOf(bytes: ArrayBuffer): string {
  return createHash('sha256').update(new Uint8Array(bytes)).digest('hex')
}

/** An attachment at a job with one version of the file, as the screens make them. */
async function attach(client: SyncClient, sha256: string, sizeBytes: number) {
  const attachment = await client.create('attachments', { jobId: 'j-1', title: 'Typenschild' })

  if (attachment.outcome !== 'queued') {
    throw new Error('The attachment was refused on the device.')
  }

  await client.create('attachment_versions', {
    attachmentId: attachment.id,
    sha256,
    fileName: 'Typenschild.jpg',
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

  it('goes up ahead of the version that names it', async () => {
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

    expect(server.operations().map((operation) => operation.entity)).toEqual([
      'attachments',
      'attachment_versions',
    ])

    // Not tried again: the answer would be the same.
    server.refuseUploads = null
    await client.synchronise()
    expect(server.uploaded.size).toBe(0)
  })

  it('stays on the device over a 403, which refuses the request and not the file (#254)', async () => {
    const client = await start()

    server.refuseUploads = new RequestRefused(403, 'Kein Zugang zu diesem Betrieb.', {})

    const { sha256, sizeBytes } = await client.keepFile(photo, 'image/jpeg')

    await attach(client, sha256, sizeBytes)
    await client.synchronise()

    expect(client.status().trouble).toBe('Kein Zugang zu diesem Betrieb.')
    expect(server.sent).toEqual([])

    server.refuseUploads = null
    await client.synchronise()

    expect([...server.uploaded.keys()]).toEqual([sha256])
    expect(client.status().pending).toBe(0)
  })

  it('is read back from the device, made here or fetched once', async () => {
    const client = await start()
    const { sha256 } = await client.keepFile(photo, 'image/jpeg')
    const preview = new TextEncoder().encode('kleines Bild').buffer as ArrayBuffer

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
    const name = 'vor-den-dateien'

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
          key: 'customers::c-1',
          entity: 'customers',
          id: 'c-1',
          values: { id: 'c-1', name: 'Familie Berg', version: 1, deletedAt: null },
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

    expect(await store.readAll('customers')).toEqual([
      { id: 'c-1', name: 'Familie Berg', version: 1, deletedAt: null },
    ])

    await store.keepFile({ sha256: hashOf(photo), bytes: photo, mediaType: 'image/jpeg' }, true)

    expect((await store.waitingFiles()).map((file) => file.sha256)).toEqual([hashOf(photo)])

    store.close()
  })
})
