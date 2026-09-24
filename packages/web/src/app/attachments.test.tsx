import 'fake-indexeddb/auto'

import { createHash } from 'node:crypto'

import { largestAttachmentBytes, type RecordState, type RoleKey } from '@opengewerk/domain'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AttachmentsSection } from '../office/screens/attachments.js'
import { JobFiles } from '../site/screens/files.js'
import { SyncClient } from '../sync/client.js'
import { SyncProvider } from '../sync/provider.js'
import { openLocalStore } from '../sync/store.js'
import { TestServer } from '../sync/test-server.js'

/**
 * The files of #77 on screen: added in the office and on site, photos made
 * smaller with a preview, versions laid over each other, and everything
 * through the outbox with the bytes going up ahead.
 *
 * A browser in a test has no canvas that draws, so making a picture smaller
 * is put in place: a photo becomes a thousand bytes, a preview a hundred.
 */
vi.mock('./pictures.js', () => ({
  shrinkPicture: (_file: Blob, longEdge: number) =>
    Promise.resolve(new Uint8Array(longEdge > 1000 ? 1000 : 100).fill(7).buffer),
}))

let server: TestServer
let answers: Map<string, Response>
let counter = 0

function hashOf(bytes: ArrayBuffer | Uint8Array): string {
  return createHash('sha256')
    .update(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes))
    .digest('hex')
}

function signedInAs(...roles: RoleKey[]) {
  const json = (value: unknown) =>
    new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } })

  answers.set(
    '/api/auth/get-session',
    json({
      user: { id: 'u-1', email: 'u@nord.example.de', name: 'u' },
      session: { activeTenantId: 't-1' },
    }),
  )
  answers.set('/auth/tenants', json([{ id: 't-1', name: 'Elektro Nord GmbH', roles }]))
}

const job = {
  id: 'j-1',
  customerId: 'c-1',
  siteId: 's-1',
  installationId: 'a-1',
  kind: 'service',
  status: 'active',
  designation: 'Zählerschrank',
}

async function mount(content: ReactNode) {
  server.put('jobs', job)

  const client = await SyncClient.start({
    store: await openLocalStore(`ablage${String((counter += 1))}`),
    transport: server,
    writer: server,
    deviceId: 'geraet',
    entities: ['jobs', 'attachments', 'attachment_versions'],
    onSignedOut: () => {},
  })

  await client.synchronise()

  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <SyncProvider client={client}>{content}</SyncProvider>
    </QueryClientProvider>,
  )

  return client
}

function inTheOffice() {
  return (
    <AttachmentsSection
      field="jobId"
      id="j-1"
      home={{ customerId: 'c-1', siteId: 's-1', installationId: 'a-1', jobId: 'j-1' }}
      empty="Noch keine Datei."
    />
  )
}

/**
 * Waits until the device has queued this many versions. A file is read,
 * shrunk and hashed before its version goes into the outbox, and an exchange
 * asked for before that goes out without it (#206).
 */
async function queued(client: SyncClient, versions: number) {
  await waitFor(() => {
    expect(client.list('attachment_versions')).toHaveLength(versions)
  })
}

function created(entity: string) {
  return server
    .operations()
    .filter((operation) => operation.kind === 'create' && operation.entity === entity)
    .map((operation) =>
      Object.fromEntries(operation.patches.map((patch) => [patch.field, patch.to])),
    )
}

const plan = new File(['%PDF-1.7 Schaltplan'], 'Schaltplan.pdf', { type: 'application/pdf' })
const photo = new File([new Uint8Array(5000).fill(1)], 'foto.jpg', { type: 'image/jpeg' })

beforeEach(() => {
  server = new TestServer()
  answers = new Map()

  vi.stubGlobal('fetch', (path: string) =>
    Promise.resolve(answers.get(path)?.clone() ?? new Response('{}', { status: 404 })),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('a file added in the office', () => {
  it('hangs on the job and everything it is about, and its bytes go up ahead', async () => {
    signedInAs('office')
    const client = await mount(inTheOffice())

    await userEvent.upload(await screen.findByLabelText('Datei hinzufügen'), plan)
    await queued(client, 1)
    await client.synchronise()

    const bytes = await plan.arrayBuffer()

    expect(created('attachments')).toEqual([
      {
        customerId: 'c-1',
        siteId: 's-1',
        installationId: 'a-1',
        jobId: 'j-1',
        title: 'Schaltplan',
      },
    ])
    expect(created('attachment_versions')).toEqual([
      expect.objectContaining({
        sha256: hashOf(bytes),
        fileName: 'Schaltplan.pdf',
        mediaType: 'application/pdf',
        sizeBytes: bytes.byteLength,
      }),
    ])
    // Not a picture, so no preview.
    expect(created('attachment_versions')[0]).not.toHaveProperty('previewSha256')
    expect(server.log[0]).toBe(`upload ${hashOf(bytes).slice(0, 8)}`)
    expect(await screen.findByText('Schaltplan')).toBeDefined()
    expect(screen.getByText(/Schaltplan\.pdf, 19 Byte/)).toBeDefined()
  })

  it('makes a photo smaller and draws a preview, unless the original is kept', async () => {
    signedInAs('office')
    const client = await mount(inTheOffice())

    await userEvent.upload(await screen.findByLabelText('Datei hinzufügen'), photo)
    await queued(client, 1)
    await client.synchronise()

    const smaller = new Uint8Array(1000).fill(7)
    const preview = new Uint8Array(100).fill(7)

    expect(created('attachment_versions')[0]).toMatchObject({
      sha256: hashOf(smaller),
      fileName: 'foto.jpg',
      mediaType: 'image/jpeg',
      sizeBytes: 1000,
      previewSha256: hashOf(preview),
    })
    expect([...server.uploaded.keys()].sort()).toEqual([hashOf(smaller), hashOf(preview)].sort())

    await userEvent.click(screen.getByLabelText('Fotos in voller Größe behalten'))
    await userEvent.upload(screen.getByLabelText('Datei hinzufügen'), photo)
    await queued(client, 2)
    await client.synchronise()

    expect(created('attachment_versions')[1]).toMatchObject({ sizeBytes: 5000 })
  })

  it('names a file that is too large, and still adds the others', async () => {
    signedInAs('office')
    const client = await mount(inTheOffice())
    const huge = new File([new Uint8Array(largestAttachmentBytes + 1)], 'Scan.pdf', {
      type: 'application/pdf',
    })

    await userEvent.upload(await screen.findByLabelText('Datei hinzufügen'), [huge, plan])
    await queued(client, 1)
    await client.synchronise()

    expect((await screen.findByRole('alert')).textContent).toMatch(/^Scan\.pdf: .*größer als 25 MB/)
    expect(created('attachments').map((values) => values['title'])).toEqual(['Schaltplan'])
  })

  it('lays a new version over the first and keeps both', async () => {
    signedInAs('office')
    const client = await mount(inTheOffice())

    await userEvent.upload(await screen.findByLabelText('Datei hinzufügen'), plan)
    await userEvent.click(await screen.findByRole('button', { name: 'Neue Fassung' }))
    await userEvent.upload(
      screen.getByLabelText('Neue Fassung wählen'),
      new File(['%PDF-1.7 Schaltplan, geändert'], 'Schaltplan neu.pdf', {
        type: 'application/pdf',
      }),
    )
    await queued(client, 2)
    await client.synchronise()

    const versions = created('attachment_versions')

    expect(versions).toHaveLength(2)
    expect(versions[1]?.['attachmentId']).toBe(versions[0]?.['attachmentId'])
    expect(await screen.findByText(/Schaltplan neu\.pdf, .*Fassung 2/)).toBeDefined()
    expect(screen.getByText('Eine frühere Fassung')).toBeDefined()
  })

  it('is removed after asking, marked and not destroyed', async () => {
    signedInAs('office')
    const client = await mount(inTheOffice())

    await userEvent.upload(await screen.findByLabelText('Datei hinzufügen'), plan)
    // Pressed while the new file may still be on its way: since #181 it stays
    // the same element between sending and the pull that brings it back.
    await userEvent.click(await screen.findByRole('button', { name: 'Schaltplan entfernen' }))
    await userEvent.click(screen.getByRole('button', { name: 'Entfernen' }))
    await client.synchronise()

    expect(
      server
        .operations()
        .filter((operation) => operation.kind === 'delete')
        .map((o) => o.entity),
    ).toEqual(['attachments'])
    expect(await screen.findByText('Noch keine Datei.')).toBeDefined()
  })
})

describe('a photo taken on site', () => {
  it('waits on the device without a network, and shows there already', async () => {
    signedInAs('technician')
    const client = await mount(<JobFiles job={job as unknown as RecordState} />)

    server.offline = true

    await userEvent.upload(await screen.findByLabelText('Foto aufnehmen'), photo)

    await waitFor(() => {
      expect(client.status().pending).toBe(2)
    })
    expect(server.uploaded.size).toBe(0)
    expect(await screen.findByText(/foto\.jpg, 1 kB, noch nicht übertragen/)).toBeDefined()

    server.offline = false
    await client.synchronise()

    expect(server.uploaded.size).toBe(2)
    expect(client.status().pending).toBe(0)
  })

  it('is opened from the device, and a file only the server has from the server', async () => {
    signedInAs('technician')
    const opened = vi.fn()

    vi.stubGlobal('open', opened)
    server.put('attachments', { id: 'd-9', jobId: 'j-1', title: 'Übergabeprotokoll' })
    server.put('attachment_versions', {
      id: 'v-9',
      attachmentId: 'd-9',
      sha256: 'f'.repeat(64),
      fileName: 'Übergabe.pdf',
      mediaType: 'application/pdf',
      sizeBytes: 2048,
      previewSha256: null,
      createdAt: '2026-09-23T08:00:00.000Z',
    })

    await mount(<JobFiles job={job as unknown as RecordState} />)

    const list = within(await screen.findByRole('region', { name: 'Fotos und Dateien' }))

    await userEvent.click(await list.findByRole('button', { name: 'Öffnen' }))

    expect(opened).toHaveBeenCalledWith('/attachments/versions/v-9/content', '_blank', 'noopener')
  })
})

describe('a preview of a photo somebody else took', () => {
  it('is fetched once and kept on the device', async () => {
    signedInAs('office')

    const preview = new Uint8Array(100).fill(3)

    answers.set(
      '/attachments/versions/v-7/preview',
      new Response(preview, { headers: { 'Content-Type': 'image/jpeg' } }),
    )
    server.put('attachments', { id: 'd-7', jobId: 'j-1', title: 'Typenschild' })
    server.put('attachment_versions', {
      id: 'v-7',
      attachmentId: 'd-7',
      sha256: 'e'.repeat(64),
      fileName: 'Typenschild.jpg',
      mediaType: 'image/jpeg',
      sizeBytes: 900_000,
      previewSha256: hashOf(preview),
      createdAt: '2026-09-23T08:00:00.000Z',
    })

    const client = await mount(inTheOffice())

    expect(await screen.findByRole('img', { name: 'Vorschau von Typenschild' })).toBeDefined()
    expect((await client.readFile(hashOf(preview)))?.mediaType).toBe('image/jpeg')
  })
})
