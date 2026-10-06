import 'fake-indexeddb/auto'

import { createHash } from 'node:crypto'

import {
  attachmentVersionPolicy,
  largestFileBytes,
  type RecordState,
  syncRules,
} from '@opengewerk/platform-domain'
import { probePolicies } from '@opengewerk/platform-domain/testing'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SyncClient } from '../sync/client.js'
import { SyncProvider } from '../sync/provider.js'
import { openLocalStore } from '../sync/store.js'
import { TestServer } from '../sync/test-server.js'
import {
  addAttachment,
  addVersion,
  openVersion,
  prepareVersion,
  type ShrinkPicture,
  usePreview,
  useVersions,
  versionLine,
  versionPath,
  versionsByAttachment,
} from './files.js'

/**
 * The files in the records of an application on a device
 * (opengewerk-haustechnik#97), for an application that is nobody's: a scan
 * filed under a shelf. What becomes of a chosen file before anything is
 * queued, the two records it makes through the outbox with the bytes going up
 * ahead, the versions newest first, and where a preview and a file come from.
 *
 * A browser in a test has no canvas that draws, so making a picture smaller is
 * handed in: a photo becomes a thousand bytes, a preview a hundred.
 */

const rules = syncRules({
  ...probePolicies,
  attachments: { create: true, change: 'merge' },
  attachment_versions: attachmentVersionPolicy,
})

/** The same application with files only the office keeps: a device may make none. */
const readOnly = syncRules({
  ...probePolicies,
  attachments: { create: false, change: 'never' },
  attachment_versions: { create: false, change: 'never' },
})

let server: TestServer
let counter = 0
let asked: { readonly longEdge: number; readonly quality: number }[]

const shrink: ShrinkPicture = (_file, longEdge, quality) => {
  asked.push({ longEdge, quality })

  return Promise.resolve(new Uint8Array(longEdge > 1000 ? 1000 : 100).fill(7).buffer)
}

async function start(over: { readonly rules?: typeof rules } = {}) {
  return await SyncClient.start({
    store: await openLocalStore(`ablage${String((counter += 1))}`),
    transport: server,
    writer: server,
    rules: over.rules ?? rules,
    deviceId: 'phone',
    entities: ['shelves', 'attachments', 'attachment_versions'],
    onSignedOut: () => {},
  })
}

function hashOf(bytes: ArrayBuffer | Uint8Array): string {
  return createHash('sha256')
    .update(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes))
    .digest('hex')
}

function created(entity: string) {
  return server
    .operations()
    .filter((operation) => operation.kind === 'create' && operation.entity === entity)
    .map((operation) => ({
      id: operation.recordId,
      ...Object.fromEntries(operation.patches.map((patch) => [patch.field, patch.to])),
    }))
}

const plan = new File(['%PDF-1.7 Schaltplan'], 'Schaltplan Lager.pdf', {
  type: 'application/pdf',
})
const photo = new File([new Uint8Array(5000).fill(1)], 'regal.vorn.jpg', { type: 'image/jpeg' })
const smallPhoto = new File([new Uint8Array(400).fill(1)], 'etikett.jpg', { type: 'image/jpeg' })
const drawing = new File([new Uint8Array(3000).fill(2)], 'Skizze.png', { type: 'image/png' })

beforeEach(() => {
  server = new TestServer()
  asked = []
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('a chosen file, before anything is queued', () => {
  it('is kept as it is when it is no picture, without a preview', async () => {
    const client = await start()
    const prepared = await prepareVersion(client, plan, { shrink })
    const bytes = await plan.arrayBuffer()

    expect(prepared).toEqual({
      sha256: hashOf(bytes),
      sizeBytes: bytes.byteLength,
      mediaType: 'application/pdf',
      fileName: 'Schaltplan Lager.pdf',
      previewSha256: null,
    })
    expect(asked).toEqual([])
    expect((await client.readFile(hashOf(bytes)))?.mediaType).toBe('application/pdf')
  })

  it('is made smaller when it is a photo, as a JPEG under the name without its ending, with a preview', async () => {
    const client = await start()
    const prepared = await prepareVersion(client, photo, { shrink })
    const smaller = new Uint8Array(1000).fill(7)
    const preview = new Uint8Array(100).fill(7)

    expect(prepared).toEqual({
      sha256: hashOf(smaller),
      sizeBytes: 1000,
      mediaType: 'image/jpeg',
      fileName: 'regal.vorn.jpg',
      previewSha256: hashOf(preview),
    })
    // The photo at the long edge and quality a photo is kept at, the preview at its own.
    expect(asked).toEqual([
      { longEdge: 2048, quality: 0.8 },
      { longEdge: 320, quality: 0.7 },
    ])
    // Both wait on the device, the preview as the JPEG it is.
    expect((await client.readFile(hashOf(smaller)))?.bytes.byteLength).toBe(1000)
    expect((await client.readFile(hashOf(preview)))?.mediaType).toBe('image/jpeg')
  })

  it('keeps a photo at its full size when somebody asks for that, and still draws the preview', async () => {
    const client = await start()
    const prepared = await prepareVersion(client, photo, { shrink, keepOriginal: true })
    const bytes = await photo.arrayBuffer()

    expect(prepared).toMatchObject({
      sha256: hashOf(bytes),
      sizeBytes: 5000,
      mediaType: 'image/jpeg',
      fileName: 'regal.vorn.jpg',
      previewSha256: hashOf(new Uint8Array(100).fill(7)),
    })
    expect(asked).toEqual([{ longEdge: 320, quality: 0.7 }])
  })

  it('keeps a photo as it is when the smaller one would not be smaller', async () => {
    const client = await start()
    const prepared = await prepareVersion(client, smallPhoto, { shrink })

    expect(prepared).toMatchObject({
      sha256: hashOf(await smallPhoto.arrayBuffer()),
      sizeBytes: 400,
      fileName: 'etikett.jpg',
    })
  })

  it('does not turn a drawing into a photo, and draws its preview all the same', async () => {
    const client = await start()
    const prepared = await prepareVersion(client, drawing, { shrink })

    expect(prepared).toMatchObject({
      sha256: hashOf(await drawing.arrayBuffer()),
      mediaType: 'image/png',
      fileName: 'Skizze.png',
      previewSha256: hashOf(new Uint8Array(100).fill(7)),
    })
    expect(asked).toEqual([{ longEdge: 320, quality: 0.7 }])
  })

  it('is kept as it is, without a preview, when the browser cannot decode the picture', async () => {
    const client = await start()
    const prepared = await prepareVersion(client, photo, { shrink: () => Promise.resolve(null) })

    expect(prepared).toMatchObject({
      sha256: hashOf(await photo.arrayBuffer()),
      mediaType: 'image/jpeg',
      previewSha256: null,
    })
  })

  it('is named and not kept when it is larger than the store takes, or empty', async () => {
    const client = await start()
    const huge = new File([new Uint8Array(largestFileBytes + 1)], 'Aufmaß.zip', {
      type: 'application/zip',
    })
    const empty = new File([], 'leer.txt', { type: 'text/plain' })

    const tooLarge = await prepareVersion(client, huge, { shrink })
    const nothing = await prepareVersion(client, empty, { shrink })

    expect(tooLarge).toEqual({
      problem: expect.stringMatching(/^Aufmaß\.zip: Die Datei ist größer/),
    })
    expect(nothing).toEqual({ problem: 'leer.txt: Die Datei ist leer.' })

    await client.synchronise()
    expect(server.uploaded.size).toBe(0)
  })
})

describe('a new file in the records', () => {
  it('is two records through the outbox, with what the application says of it, and its bytes go up ahead', async () => {
    const client = await start()

    expect(
      await addAttachment(client, { shelfId: 's-1', kind: 'plan' }, plan, { shrink }),
    ).toBeNull()
    await client.synchronise()

    const [attachment] = created('attachments')
    const bytes = await plan.arrayBuffer()

    expect(created('attachments')).toEqual([
      { id: attachment?.id, shelfId: 's-1', kind: 'plan', title: 'Schaltplan Lager' },
    ])
    expect(created('attachment_versions')).toEqual([
      {
        id: expect.any(String),
        attachmentId: attachment?.id,
        sha256: hashOf(bytes),
        sizeBytes: bytes.byteLength,
        mediaType: 'application/pdf',
        fileName: 'Schaltplan Lager.pdf',
      },
    ])
    expect(server.log[0]).toBe(`upload ${hashOf(bytes).slice(0, 8)}`)
    expect(server.log.slice(1).every((entry) => entry.startsWith('push '))).toBe(true)
  })

  it('waits on the device without a network and lands once there is one, the photo and its preview', async () => {
    const client = await start()

    server.offline = true

    expect(await addAttachment(client, { shelfId: 's-1' }, photo, { shrink })).toBeNull()
    await client.synchronise()

    expect(server.uploaded.size).toBe(0)
    expect(client.status().pending).toBe(2)
    expect(client.list('attachments').map((row) => row['title'])).toEqual(['regal.vorn'])

    server.offline = false
    await client.synchronise()

    expect(server.uploaded.size).toBe(2)
    expect(client.status().pending).toBe(0)
    expect(created('attachment_versions')[0]).toMatchObject({
      fileName: 'regal.vorn.jpg',
      mediaType: 'image/jpeg',
      sizeBytes: 1000,
    })
  })

  it('is called what the application calls a file whose name says nothing', async () => {
    const client = await start()
    const nameless = new File(['x'], '  ', { type: 'text/plain' })

    await addAttachment(client, { shelfId: 's-1' }, nameless, { shrink, untitled: 'Scan' })
    await addAttachment(client, { shelfId: 's-1' }, nameless, { shrink })

    expect(
      client
        .list('attachments')
        .map((row) => row['title'])
        .sort(),
    ).toEqual(['Datei', 'Scan'])
  })

  it('says why and queues nothing when the file cannot be kept', async () => {
    const client = await start()
    const empty = new File([], 'leer.txt', { type: 'text/plain' })

    expect(await addAttachment(client, { shelfId: 's-1' }, empty, { shrink })).toBe(
      'leer.txt: Die Datei ist leer.',
    )
    expect(client.list('attachments')).toEqual([])
    expect(client.status().pending).toBe(0)
  })

  it('says why and makes no version when a device may not make one', async () => {
    const client = await start({ rules: readOnly })
    const problem = await addAttachment(client, { shelfId: 's-1' }, plan, { shrink })

    expect(problem).toEqual(expect.any(String))
    expect(problem).not.toBe('')
    expect(client.list('attachments')).toEqual([])
    expect(client.list('attachment_versions')).toEqual([])
  })
})

describe('a new version of a file', () => {
  it('is laid over the ones before it, and the newest comes first', async () => {
    const client = await start()

    await addAttachment(client, { shelfId: 's-1' }, plan, { shrink })

    const [attachment] = client.list('attachments')
    const id = String(attachment?.['id'])
    const later = new File(['%PDF-1.7 Schaltplan, Stand Mai'], 'Schaltplan Mai.pdf', {
      type: 'application/pdf',
    })

    expect(await addVersion(client, id, later, { shrink })).toBeNull()
    expect(await addVersion(client, id, photo, { shrink }, { filedBy: 'desk' })).toBeNull()

    const versions = versionsByAttachment(client.list('attachment_versions')).get(id) ?? []

    expect(versions.map((version) => version['fileName'])).toEqual([
      'regal.vorn.jpg',
      'Schaltplan Mai.pdf',
      'Schaltplan Lager.pdf',
    ])
    // What the application writes on a version of its own goes with it.
    expect(versions[0]).toMatchObject({ filedBy: 'desk', attachmentId: id })
    expect(client.list('attachments')).toHaveLength(1)
  })

  it('says why and queues nothing when the file cannot be kept', async () => {
    const client = await start()
    const empty = new File([], 'leer.txt', { type: 'text/plain' })

    expect(await addVersion(client, 'd-1', empty, { shrink })).toBe('leer.txt: Die Datei ist leer.')
    expect(client.list('attachment_versions')).toEqual([])
  })
})

describe('the versions of the files on a device', () => {
  const version = (id: string, attachmentId: string): RecordState => ({ id, attachmentId })

  it('are sorted by file, each newest first, by the id a version was minted with', () => {
    const sorted = versionsByAttachment([
      version('0199-a', 'd-1'),
      version('0199-c', 'd-1'),
      version('0199-b', 'd-2'),
      version('0199-b', 'd-1'),
    ])

    expect(sorted.get('d-1')?.map((row) => row['id'])).toEqual(['0199-c', '0199-b', '0199-a'])
    expect(sorted.get('d-2')?.map((row) => row['id'])).toEqual(['0199-b'])
    expect(sorted.get('d-3')).toBeUndefined()
  })

  it('are read by a screen as the device holds them, the ones not sent yet among them', async () => {
    const client = await start()
    const wrapper = ({ children }: { readonly children: ReactNode }) => (
      <SyncProvider client={client}>{children}</SyncProvider>
    )

    server.offline = true
    await addAttachment(client, { shelfId: 's-1' }, plan, { shrink })

    const id = String(client.list('attachments')[0]?.['id'])
    const { result } = renderHook(() => useVersions(), { wrapper })

    await waitFor(() => {
      expect(result.current.get(id)).toHaveLength(1)
    })
  })
})

describe('the line under the name of a file', () => {
  it('says the name, the size and whether the version is up yet, and its number once there are several', async () => {
    const client = await start()

    server.offline = true
    await addAttachment(client, { shelfId: 's-1' }, plan, { shrink })

    const [waiting] = client.list('attachment_versions')

    expect(versionLine(client, waiting as RecordState, 1)).toBe(
      'Schaltplan Lager.pdf, 19 Byte, noch nicht übertragen',
    )
    expect(versionLine(client, waiting as RecordState, 3)).toBe(
      'Schaltplan Lager.pdf, 19 Byte, Fassung 3, noch nicht übertragen',
    )

    const landed: RecordState = {
      id: 'v-9',
      fileName: 'Übergabe.pdf',
      sizeBytes: 2048,
      createdAt: '2026-09-23T08:00:00.000Z',
    }

    expect(versionLine(client, landed, 1)).toMatch(/^Übergabe\.pdf, 2 kB, \d{2}\.\d{2}\.2026/)
    expect(versionLine(client, landed, 1)).not.toContain('noch nicht übertragen')
  })
})

describe('opening a version', () => {
  it('is from the device when it holds the file, and from the server by the id of the version otherwise', async () => {
    const client = await start()
    const opened = vi.fn()
    const urls = vi.fn(() => 'blob:local')

    vi.stubGlobal('open', opened)
    vi.spyOn(URL, 'createObjectURL').mockImplementation(urls)

    await addAttachment(client, { shelfId: 's-1' }, plan, { shrink })
    await openVersion(client, client.list('attachment_versions')[0] as RecordState)

    expect(opened).toHaveBeenLastCalledWith('blob:local', '_blank', 'noopener')

    await openVersion(client, { id: 'v 9/x', sha256: 'f'.repeat(64) })

    expect(opened).toHaveBeenLastCalledWith(
      '/attachments/versions/v%209%2Fx/content',
      '_blank',
      'noopener',
    )
    expect(versionPath('v-9', 'preview')).toBe('/attachments/versions/v-9/preview')

    vi.restoreAllMocks()
  })
})

describe('the preview of a version', () => {
  function shown(client: SyncClient, version: RecordState | undefined) {
    const wrapper = ({ children }: { readonly children: ReactNode }) => (
      <SyncProvider client={client}>{children}</SyncProvider>
    )

    return renderHook(() => usePreview(version), { wrapper })
  }

  beforeEach(() => {
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:preview')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('comes from the device for a photo taken here, without asking the server', async () => {
    const client = await start()
    const fetched = vi.fn()

    vi.stubGlobal('fetch', fetched)
    server.offline = true
    await addAttachment(client, { shelfId: 's-1' }, photo, { shrink })

    const { result } = shown(client, client.list('attachment_versions')[0])

    await waitFor(() => {
      expect(result.current).toBe('blob:preview')
    })
    expect(fetched).not.toHaveBeenCalled()
  })

  it('is fetched once by the id of the version, and kept on the device for the next time', async () => {
    const client = await start()
    const preview = new Uint8Array(100).fill(3)
    const fetched = vi.fn(() =>
      Promise.resolve(new Response(preview, { headers: { 'Content-Type': 'image/jpeg' } })),
    )
    const version: RecordState = { id: 'v-7', attachmentId: 'd-7', previewSha256: hashOf(preview) }

    vi.stubGlobal('fetch', fetched)

    const first = shown(client, version)

    await waitFor(() => {
      expect(first.result.current).toBe('blob:preview')
    })
    expect(fetched).toHaveBeenCalledTimes(1)
    expect(fetched.mock.calls[0]?.[0 as never]).toBe('/attachments/versions/v-7/preview')
    expect((await client.readFile(hashOf(preview)))?.bytes.byteLength).toBe(100)

    const second = shown(client, version)

    await waitFor(() => {
      expect(second.result.current).toBe('blob:preview')
    })
    expect(fetched).toHaveBeenCalledTimes(1)
  })

  it('is none for a version without one, and none while the server has no answer', async () => {
    const client = await start()
    const fetched = vi.fn(() => Promise.resolve(new Response('{}', { status: 404 })))

    vi.stubGlobal('fetch', fetched)

    const without = shown(client, { id: 'v-1', attachmentId: 'd-1', previewSha256: null })
    const unanswered = shown(client, {
      id: 'v-2',
      attachmentId: 'd-1',
      previewSha256: 'a'.repeat(64),
    })

    await waitFor(() => {
      expect(fetched).toHaveBeenCalledTimes(1)
    })
    expect(without.result.current).toBeNull()
    expect(unanswered.result.current).toBeNull()
    expect(shown(client, undefined).result.current).toBeNull()
  })
})
