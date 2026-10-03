import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { Database, dispositionFor, FileStore, newId } from '@opengewerk/platform-server'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  allowApplicationLogin,
  applicationDatabaseUrl,
  applyMigrations,
  connect,
  resetSchema,
} from '../database/test-database.js'
import { ApiModule } from './api.module.js'
import { binary } from './test-binary.js'
import { as, testIdentities as identities } from './test-identity.js'

/**
 * The files of a business's records (#77): the bytes stored ahead by hash, the
 * attachment and its versions through the outbox, and handed out again by
 * version, to the business they belong to and to nobody else.
 */

const north = { id: newId<'tenant'>(), name: 'Elektro Nord GmbH' }
const south = { id: newId<'tenant'>(), name: 'Elektro Süd GmbH' }

let admin: Pool
let database: Database
let app: INestApplication
let storageRoot: string
let customerId: string
let jobId: string

const office = () => as(north.id, 'office')
const technician = () => as(north.id, 'technician')
const neighbour = () => as(south.id, 'office')

/** The smallest PNG there is, one transparent pixel. */
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)
const plan = Buffer.from('%PDF-1.7\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n')
const notes = Buffer.from('Zähler 1: 12345 kWh\n')

function hashOf(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function http() {
  return request(app.getHttpServer())
}

async function upload(bytes: Buffer, mediaType: string, identity = office(), expected = 200) {
  const answer = await http()
    .put(`/files/${hashOf(bytes)}`)
    .set('x-test-identity', identity)
    .set('Content-Type', 'application/octet-stream')
    .set('X-Media-Type', mediaType)
    .send(bytes)
    .expect(expected)

  return answer.body as { sha256: string; sizeBytes: number; mediaType: string }
}

type Values = Record<string, string | number | boolean | null>

function creating(entity: string, recordId: string, values: Values) {
  return {
    id: newId<'operation'>(),
    entity,
    recordId,
    kind: 'create',
    baseVersion: null,
    patches: Object.entries(values).map(([field, to]) => ({ field, from: null, to })),
    recordedAt: new Date().toISOString(),
  }
}

async function push(operations: unknown[], identity = office(), expected = 201) {
  const answer = await http()
    .post('/sync')
    .set('x-test-identity', identity)
    .send({ deviceId: 'handy', operations })
    .expect(expected)

  return answer.body as {
    receipts: { outcome: string; reason: string | null; fields: string[] }[]
    message?: string
  }
}

/** An attachment at the job and a first version of it, as a device sends them. */
function attachmentWithVersion(
  bytes: Buffer,
  fileName: string,
  mediaType: string,
  sizeBytes = bytes.byteLength,
) {
  const attachment = newId<'attachment'>()
  const version = newId<'attachment-version'>()

  return {
    attachment,
    version,
    operations: [
      creating('attachments', attachment, { customerId, jobId, title: fileName }),
      creating('attachment_versions', version, {
        attachmentId: attachment,
        sha256: hashOf(bytes),
        fileName,
        mediaType,
        sizeBytes,
      }),
    ],
  }
}

beforeAll(async () => {
  admin = await connect()
  await resetSchema(admin)
  await applyMigrations()
  await allowApplicationLogin(admin)
  await admin.query('insert into tenants (id, name) values ($1, $2), ($3, $4)', [
    north.id,
    north.name,
    south.id,
    south.name,
  ])

  storageRoot = mkdtempSync(join(tmpdir(), 'opengewerk-attachments-'))
  database = Database.connect(applicationDatabaseUrl())

  const built = await Test.createTestingModule({
    imports: [ApiModule.create(database, identities, { files: new FileStore(storageRoot) })],
  }).compile()

  app = built.createNestApplication()
  await app.init()

  const customer = await http()
    .post('/customers')
    .set('x-test-identity', office())
    .send({ kind: 'private', name: 'Familie Berg' })
    .expect(201)
  customerId = (customer.body as { id: string }).id

  const job = await http()
    .post('/jobs')
    .set('x-test-identity', office())
    .send({ customerId, kind: 'service', designation: 'Zählerschrank' })
    .expect(201)
  jobId = (job.body as { id: string }).id
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
  rmSync(storageRoot, { recursive: true, force: true })
})

describe('the bytes of a file', () => {
  /**
   * The route is the foundation's and is tested there; this is the right this
   * application gives it, the one of the records, which a technician has.
   */
  it('are stored by a technician, and by nobody without a right to the records', async () => {
    await upload(notes, 'text/plain', technician())
    await upload(notes, 'text/plain', as(north.id), 403)
  })
})

describe('an attachment with its versions', () => {
  it('lands through the outbox once its file is there, with who stored it', async () => {
    await upload(plan, 'application/pdf')

    const sent = attachmentWithVersion(plan, 'Schaltplan.pdf', 'application/pdf')
    const { receipts } = await push(sent.operations)

    expect(receipts.map((receipt) => receipt.outcome)).toEqual(['applied', 'applied'])

    const { rows } = await admin.query(
      'select file_name, size_bytes::int as size, created_by from attachment_versions where id = $1',
      [sent.version],
    )

    expect(rows[0]).toEqual({
      file_name: 'Schaltplan.pdf',
      size: plan.byteLength,
      created_by: 'test',
    })
  })

  it('is a conflict about the version alone when its file never arrived', async () => {
    const never = Buffer.from('nie hochgeladen')
    const sent = attachmentWithVersion(never, 'Foto.jpg', 'image/jpeg')
    const { receipts } = await push(sent.operations)

    // The attachment lands; the version waits for its file, and nothing else
    // in the transmission goes down with it.
    expect(receipts.map((receipt) => [receipt.outcome, receipt.reason, receipt.fields])).toEqual([
      ['applied', null, []],
      ['conflict', 'record_missing', ['sha256']],
    ])
  })

  it('is refused for the transmission when it says what only a broken client says', async () => {
    await upload(notes, 'text/plain')

    const wrongSize = attachmentWithVersion(notes, 'Notizen.txt', 'text/plain', 1)

    expect((await push(wrongSize.operations, office(), 400)).message).toMatch(/Größe/)

    const unrecorded = attachmentWithVersion(notes, 'Notizen.txt', 'Text/Plain')

    expect((await push(unrecorded.operations, office(), 400)).message).toMatch(/Typ der Datei/)

    const homeless = newId<'attachment'>()

    expect(
      (await push([creating('attachments', homeless, { title: 'Nirgends' })], office(), 400))
        .message,
    ).toMatch(/hängt an einem Kunden/)
  })

  it('keeps every version readable, and a later one does not push out the first', async () => {
    await upload(notes, 'text/plain')
    await upload(plan, 'application/pdf')

    const first = attachmentWithVersion(notes, 'Aufmaß.txt', 'text/plain')
    const second = newId<'attachment-version'>()

    await push([
      ...first.operations,
      creating('attachment_versions', second, {
        attachmentId: first.attachment,
        sha256: hashOf(plan),
        fileName: 'Aufmaß.pdf',
        mediaType: 'application/pdf',
        sizeBytes: plan.byteLength,
      }),
    ])

    const old = await http()
      .get(`/attachments/versions/${first.version}/content`)
      .set('x-test-identity', technician())
      .buffer(true)
      .parse(binary)
      .expect(200)

    expect(old.body).toEqual(notes)
    expect(old.headers['content-type']).toMatch(/^text\/plain/)
    expect(old.headers['content-disposition']).toBe(dispositionFor('text/plain', 'Aufmaß.txt'))
    expect(old.headers['cache-control']).toBe('no-store')

    const newer = await http()
      .get(`/attachments/versions/${second}/content`)
      .set('x-test-identity', office())
      .expect(200)

    expect(newer.headers['content-type']).toBe('application/pdf')
    expect(newer.headers['content-disposition']).toMatch(/^inline; /)
  })

  it('is not handed out to another business, not even by the id of its version', async () => {
    await upload(png, 'image/png')

    const sent = attachmentWithVersion(png, 'Typenschild.png', 'image/png')
    await push(sent.operations)

    await http()
      .get(`/attachments/versions/${sent.version}/content`)
      .set('x-test-identity', neighbour())
      .expect(404)

    // Knowing the hash is no way in either: a version of the other business
    // naming it finds no file of its own.
    const theirs = newId<'attachment'>()
    const otherCustomer = await http()
      .post('/customers')
      .set('x-test-identity', neighbour())
      .send({ kind: 'private', name: 'Süd' })
      .expect(201)
    const { receipts } = await push(
      [
        creating('attachments', theirs, {
          customerId: (otherCustomer.body as { id: string }).id,
          title: 'Fremd',
        }),
        creating('attachment_versions', newId<'attachment-version'>(), {
          attachmentId: theirs,
          sha256: hashOf(png),
          fileName: 'Fremd.png',
          mediaType: 'image/png',
          sizeBytes: png.byteLength,
        }),
      ],
      neighbour(),
    )

    expect(receipts[1]).toMatchObject({ outcome: 'conflict', reason: 'record_missing' })
  })

  it('is no longer handed out once it has been removed', async () => {
    await upload(notes, 'text/plain')

    const sent = attachmentWithVersion(notes, 'Alt.txt', 'text/plain')
    await push(sent.operations)
    await push([
      {
        ...creating('attachments', sent.attachment, {}),
        kind: 'delete',
        baseVersion: 1,
        patches: [],
      },
    ])

    await http()
      .get(`/attachments/versions/${sent.version}/content`)
      .set('x-test-identity', office())
      .expect(404)
  })

  it('shows the preview of a photo, and has none for other files', async () => {
    await upload(png, 'image/png')
    await upload(plan, 'application/pdf')

    const photo = attachmentWithVersion(plan, 'Plan.pdf', 'application/pdf')
    const withPreview = {
      ...photo.operations[1],
      patches: [
        ...(photo.operations[1]?.patches ?? []),
        { field: 'previewSha256', from: null, to: hashOf(png) },
      ],
    }

    await push([photo.operations[0], withPreview])

    const preview = await http()
      .get(`/attachments/versions/${photo.version}/preview`)
      .set('x-test-identity', office())
      .expect(200)

    expect(preview.headers['content-type']).toBe('image/png')

    const plain = attachmentWithVersion(notes, 'Ohne.txt', 'text/plain')
    await upload(notes, 'text/plain')
    await push(plain.operations)

    await http()
      .get(`/attachments/versions/${plain.version}/preview`)
      .set('x-test-identity', office())
      .expect(404)
  })
})
