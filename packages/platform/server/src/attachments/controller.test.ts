import 'reflect-metadata'

import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { type DynamicModule, type INestApplication, Module } from '@nestjs/common'
import { APP_FILTER, APP_GUARD } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import type { MemberIdentity, TenantId } from '@opengewerk/platform-domain'
import { eq } from 'drizzle-orm'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { AUTHORIZATION, AuthorizationGuard } from '../api/authorization.js'
import { databaseErrors } from '../api/database-errors.js'
import { TRUSTED_ORIGINS } from '../api/handed-in.js'
import { IDENTITY_SOURCE } from '../api/identity.js'
import { SameOriginGuard } from '../api/origin.js'
import { headerIdentities, testIdentityHeader } from '../api/test-identity.js'
import {
  probeAuthorization,
  type ProbeFoundation,
  probeFoundation,
} from '../authentication/probe-application.js'
import { Database, type TenantTransaction } from '../database/database.js'
import { newId } from '../database/identifier.js'
import {
  checkViolation,
  foreignKeyViolation,
  insufficientPrivilege,
  refusedBy,
} from '../database/test-database.js'
import { fileParts } from '../files/controller.js'
import { storedMediaType } from '../files/media-type.js'
import { fileRowFor } from '../files/rows.js'
import { FileStore } from '../files/store.js'
import {
  type ProbeAttachmentColumns,
  probeAttachments,
  probeAttachmentVersions,
  probeSyncAccess,
  probeSyncMade,
  type ProbeSyncRight,
} from '../sync/probe-sync.js'
import {
  attachmentGone,
  attachmentParts,
  type AttachmentReading,
  type AttachmentRoutes,
} from './controller.js'

/**
 * The files of the records of an application, handed out by version
 * (opengewerk-haustechnik#97), on an application that is nobody's: a scan
 * filed under a shelf, the scan of a letter, or both. What the routes hold: a
 * version is found by its id and never by hash, in its own tenant alone, and
 * only while nobody removed its file; every version stays readable; what is
 * neither a picture nor a PDF is handed out to be saved; and the application
 * may look at a file before it is handed out. And what the database holds
 * under them: a version is written once, by whoever the request says, and a
 * file is marked and never removed.
 */

const north = { id: newId<'tenant'>() as TenantId, name: 'Mandant Nord' }
const south = { id: newId<'tenant'>() as TenantId, name: 'Mandant Süd' }

const people = {
  // Reads the records and writes letters.
  lena: { tenant: north.id, rights: ['members.read', 'notes.write', 'letters.write'] },
  // Reads the records and writes no letters.
  kai: { tenant: north.id, rights: ['members.read', 'notes.write'] },
  // Writes notes and may not read the records.
  nora: { tenant: north.id, rights: ['notes.write'] },
  // Reads the records of the other tenant.
  sven: { tenant: south.id, rights: ['members.read', 'notes.write', 'letters.write'] },
} as const satisfies Record<string, { tenant: TenantId; rights: readonly ProbeSyncRight[] }>

type Person = keyof typeof people

/** The smallest PNG there is, one transparent pixel. */
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)
const plan = Buffer.from('%PDF-1.7\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n')
const laterPlan = Buffer.from('%PDF-1.7\n2 0 obj << >> endobj\ntrailer << >>\n%%EOF\n')
const readings = Buffer.from('Zähler 1: 12345 kWh\n')
const page = Buffer.from('<!doctype html><script>alert(1)</script>')

const scanGone = 'Diesen Scan gibt es nicht oder nicht mehr.'

let foundation: ProbeFoundation
let admin: Pool
let database: Database
let store: FileStore
let storageRoot: string
/** The routes as the foundation words them, with nothing of the application in front. */
let plain: INestApplication
/** The routes of an application that looks at a file first and has its own sentence. */
let guarded: INestApplication

let shelf: string
let letter: string
let southShelf: string

/** What the application was shown before a file went out, in the order it was asked. */
const shown: Readonly<Record<string, unknown>>[] = []

function readable({ identity, attachment }: AttachmentReading): boolean {
  shown.push(attachment)

  // The scan of a letter is for whoever writes letters.
  return attachment['letterId'] === null || identity.rights.includes('letters.write')
}

/** The code the database refuses a write with. */
async function codeOf(write: Promise<unknown>): Promise<string> {
  return (await refusedBy(write)).code
}

function hashOf(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function as(person: Person): string {
  const { tenant, rights } = people[person]
  const identity: MemberIdentity<ProbeSyncRight> = {
    userId: person,
    tenantId: tenant,
    roles: [],
    rights: [...rights],
  }

  return JSON.stringify(identity)
}

function inTenant<Result>(
  person: Person,
  work: (tx: TenantTransaction) => Promise<Result>,
): Promise<Result> {
  return database.forTenant(
    { tenantId: people[person].tenant, userId: person, reason: 'probe', deviceId: 'probe-phone' },
    work,
  )
}

/** The bytes into the store and the row that makes them this person's tenant's. */
async function stored(person: Person, bytes: Buffer, declared: string): Promise<string> {
  const blob = await store.put(bytes)

  await inTenant(person, (tx) =>
    fileRowFor(tx, people[person].tenant, blob, storedMediaType(bytes, declared)),
  )

  return blob.sha256
}

/** A file at a place, as a device or a screen makes one. */
async function filed(
  person: Person,
  places: { shelfId?: string; letterId?: string },
  title = 'Scan',
): Promise<string> {
  const [row] = await inTenant(person, (tx) =>
    tx
      .insert(probeAttachments)
      .values({ tenantId: people[person].tenant, title, ...places } as never)
      .returning({ id: probeAttachments.id }),
  )

  return String(row?.id)
}

/** A version of a file, with its bytes stored ahead of it. */
async function version(
  person: Person,
  attachmentId: string,
  file: { bytes: Buffer; name: string; declared: string; preview?: Buffer },
): Promise<string> {
  const sha256 = await stored(person, file.bytes, file.declared)
  const previewSha256 = file.preview ? await stored(person, file.preview, 'image/png') : null
  const [row] = await inTenant(person, (tx) =>
    tx
      .insert(probeAttachmentVersions)
      .values({
        tenantId: people[person].tenant,
        attachmentId,
        sha256,
        fileName: file.name,
        mediaType: file.declared,
        sizeBytes: file.bytes.byteLength,
        previewSha256,
      } as never)
      .returning({ id: probeAttachmentVersions.id }),
  )

  return String(row?.id)
}

function fetched(
  app: INestApplication,
  versionId: string,
  which: 'content' | 'preview',
  person: Person,
) {
  return request(app.getHttpServer())
    .get(`/attachments/versions/${versionId}/${which}`)
    .set(testIdentityHeader, as(person))
    .buffer(true)
    .parse((response, done) => {
      const chunks: Buffer[] = []

      response.on('data', (chunk: Buffer) => chunks.push(chunk))
      response.on('end', () => {
        done(null, Buffer.concat(chunks))
      })
    })
}

/** The module of an application, as far as the files of its records go. */
@Module({})
class ProbeAttachmentModule {
  static create(
    on: Database,
    files: FileStore,
    routes: AttachmentRoutes<ProbeAttachmentColumns>,
  ): DynamicModule {
    const storing = fileParts({ access: probeSyncAccess, upload: 'notes.write', store: files })
    const reading = attachmentParts({
      access: probeSyncAccess,
      rights: { read: 'members.read' },
      routes,
    })

    return {
      module: ProbeAttachmentModule,
      controllers: [...storing.controllers, ...reading.controllers],
      providers: [
        { provide: Database, useValue: on },
        ...storing.providers,
        ...reading.providers,
        { provide: IDENTITY_SOURCE, useValue: headerIdentities<MemberIdentity<ProbeSyncRight>>() },
        { provide: AUTHORIZATION, useValue: probeAuthorization },
        { provide: TRUSTED_ORIGINS, useValue: [] },
        { provide: APP_GUARD, useClass: SameOriginGuard },
        { provide: APP_GUARD, useClass: AuthorizationGuard },
        { provide: APP_FILTER, useClass: databaseErrors().DatabaseExceptionFilter },
      ],
    }
  }
}

async function started(routes: AttachmentRoutes<ProbeAttachmentColumns>) {
  const app = (
    await Test.createTestingModule({
      imports: [ProbeAttachmentModule.create(database, store, routes)],
    }).compile()
  ).createNestApplication()

  await app.init()

  return app
}

const tables = { attachments: probeAttachments, attachmentVersions: probeAttachmentVersions }

beforeAll(async () => {
  foundation = await probeFoundation(probeSyncMade)
  admin = await foundation.kit.connect()
  database = Database.connect(foundation.kit.applicationDatabaseUrl())
  storageRoot = mkdtempSync(join(tmpdir(), 'attachment-routes-'))
  store = new FileStore(storageRoot)

  plain = await started({ tables })
  guarded = await started({ tables, readable, gone: scanGone })
}, 60_000)

beforeEach(async () => {
  await foundation.empty()
  await foundation.tenants(admin, [north, south])
  shown.length = 0

  shelf = newId<'shelf'>()
  letter = newId<'letter'>()
  southShelf = newId<'shelf'>()
  await admin.query('insert into shelves (id, tenant_id, label) values ($1, $2, $3)', [
    shelf,
    north.id,
    'Wareneingang',
  ])
  await admin.query('insert into letters (id, tenant_id, subject) values ($1, $2, $3)', [
    letter,
    north.id,
    'Lieferschein',
  ])
  await admin.query('insert into shelves (id, tenant_id, label) values ($1, $2, $3)', [
    southShelf,
    south.id,
    'Lager Süd',
  ])
})

afterAll(async () => {
  await plain.close()
  await guarded.close()
  await database.close()
  await admin.end()
  foundation.remove()
  rmSync(storageRoot, { recursive: true, force: true })
})

describe('the routes of the files', () => {
  it('are refused to an application whose catalogue lacks the right it names', () => {
    expect(() =>
      attachmentParts({
        access: probeSyncAccess,
        rights: { read: 'scans.read' as ProbeSyncRight },
        routes: { tables },
      }),
    ).toThrow('The catalogue lacks the right to read a file: scans.read')
  })
})

describe('a version of a file', () => {
  it('is handed out as it was stored, under the name it came with, and from no cache', async () => {
    const attachment = await filed('lena', { shelfId: shelf }, 'Schaltplan')
    const id = await version('lena', attachment, {
      bytes: plan,
      name: 'Schaltplan Lager.pdf',
      declared: 'application/pdf',
    })

    const answer = await fetched(plain, id, 'content', 'kai').expect(200)

    expect(Buffer.compare(answer.body as Buffer, plan)).toBe(0)
    expect(answer.headers['content-type']).toBe('application/pdf')
    expect(answer.headers['content-length']).toBe(String(plan.byteLength))
    expect(answer.headers['cache-control']).toBe('no-store')
    expect(answer.headers['content-disposition']).toBe(
      'inline; filename="Schaltplan Lager.pdf"; filename*=UTF-8\'\'Schaltplan%20Lager.pdf',
    )
  })

  it('is read only by whoever has the right the application named', async () => {
    const attachment = await filed('lena', { shelfId: shelf })
    const id = await version('lena', attachment, {
      bytes: png,
      name: 'Regal.png',
      declared: 'image/png',
      preview: png,
    })

    const content = await fetched(plain, id, 'content', 'nora').expect(403)
    const preview = await fetched(plain, id, 'preview', 'nora').expect(403)

    expect(JSON.parse(String(content.body))).toMatchObject({
      message: 'Das Recht members.read fehlt diesem Zugang.',
    })
    expect(JSON.parse(String(preview.body))).toMatchObject({ statusCode: 403 })
  })

  it('stays readable when a later one is laid over it', async () => {
    const attachment = await filed('lena', { shelfId: shelf }, 'Schaltplan')
    const first = await version('lena', attachment, {
      bytes: plan,
      name: 'Schaltplan.pdf',
      declared: 'application/pdf',
    })
    const second = await version('kai', attachment, {
      bytes: laterPlan,
      name: 'Schaltplan Stand Mai.pdf',
      declared: 'application/pdf',
    })

    const earlier = await fetched(plain, first, 'content', 'kai').expect(200)
    const later = await fetched(plain, second, 'content', 'kai').expect(200)

    expect(Buffer.compare(earlier.body as Buffer, plan)).toBe(0)
    expect(Buffer.compare(later.body as Buffer, laterPlan)).toBe(0)
    expect(earlier.headers['content-disposition']).toContain('filename="Schaltplan.pdf"')
    expect(later.headers['content-disposition']).toContain('filename="Schaltplan Stand Mai.pdf"')
  })

  it('is handed out to be saved when it is neither a picture nor a PDF, whatever it was declared as', async () => {
    const attachment = await filed('lena', { shelfId: shelf })
    const text = await version('lena', attachment, {
      bytes: readings,
      name: 'Zählerstände.txt',
      declared: 'text/plain',
    })
    // Declared as a picture and none: the store kept it as a byte stream.
    const disguised = await version('lena', attachment, {
      bytes: page,
      name: 'bild.png',
      declared: 'image/png',
    })
    const picture = await version('lena', attachment, {
      bytes: png,
      name: 'Regal.png',
      declared: 'image/png',
    })

    const saved = await fetched(plain, text, 'content', 'kai').expect(200)
    const refusedInPlace = await fetched(plain, disguised, 'content', 'kai').expect(200)
    const drawn = await fetched(plain, picture, 'content', 'kai').expect(200)

    expect(saved.headers['content-type']).toBe('text/plain')
    expect(saved.headers['content-disposition']).toBe(
      'attachment; filename="Z_hlerst_nde.txt"; filename*=UTF-8\'\'Z%C3%A4hlerst%C3%A4nde.txt',
    )
    expect(refusedInPlace.headers['content-type']).toBe('application/octet-stream')
    expect(refusedInPlace.headers['content-disposition']).toMatch(/^attachment; /)
    expect(drawn.headers['content-type']).toBe('image/png')
    expect(drawn.headers['content-disposition']).toMatch(/^inline; /)
  })

  it('is not handed out to another tenant, not even by its id, and a hash is no way in', async () => {
    const attachment = await filed('lena', { shelfId: shelf })
    const id = await version('lena', attachment, {
      bytes: plan,
      name: 'Schaltplan.pdf',
      declared: 'application/pdf',
      preview: png,
    })
    // The other tenant holds the same bytes, so its row for them is there.
    await stored('sven', plan, 'application/pdf')

    const content = await fetched(plain, id, 'content', 'sven').expect(404)
    const preview = await fetched(plain, id, 'preview', 'sven').expect(404)
    const byHash = await fetched(plain, hashOf(plan), 'content', 'lena').expect(404)

    expect(JSON.parse(String(content.body))).toMatchObject({ message: attachmentGone })
    expect(JSON.parse(String(preview.body))).toMatchObject({ message: attachmentGone })
    expect(JSON.parse(String(byHash.body))).toMatchObject({ message: attachmentGone })
    await fetched(plain, id, 'content', 'lena').expect(200)
  })

  it('is no longer handed out once its file has been removed from the records', async () => {
    const attachment = await filed('lena', { shelfId: shelf })
    const id = await version('lena', attachment, {
      bytes: png,
      name: 'Regal.png',
      declared: 'image/png',
      preview: png,
    })

    await fetched(plain, id, 'content', 'kai').expect(200)
    await fetched(plain, id, 'preview', 'kai').expect(200)

    await inTenant('lena', (tx) =>
      tx
        .update(probeAttachments)
        .set({ deletedAt: new Date() })
        .where(eq(probeAttachments.id, attachment as never)),
    )

    const content = await fetched(plain, id, 'content', 'kai').expect(404)

    expect(JSON.parse(String(content.body))).toMatchObject({ message: attachmentGone })
    await fetched(plain, id, 'preview', 'kai').expect(404)
  })

  it('shows the preview of a picture under a name of its own, and has none for other files', async () => {
    const attachment = await filed('lena', { shelfId: shelf })
    const photo = await version('lena', attachment, {
      bytes: plan,
      name: 'Regal vorn.jpg',
      declared: 'application/pdf',
      preview: png,
    })
    const document = await version('lena', attachment, {
      bytes: laterPlan,
      name: 'Schaltplan.pdf',
      declared: 'application/pdf',
    })

    const preview = await fetched(plain, photo, 'preview', 'kai').expect(200)

    expect(Buffer.compare(preview.body as Buffer, png)).toBe(0)
    expect(preview.headers['content-type']).toBe('image/png')
    expect(preview.headers['cache-control']).toBe('no-store')
    expect(preview.headers['content-disposition']).toContain(
      'filename="Vorschau Regal vorn.jpg.jpg"',
    )
    await fetched(plain, document, 'preview', 'kai').expect(404)
  })

  it('is not found under an id that is none, and nothing reaches the database', async () => {
    const answer = await fetched(plain, 'nicht-eine-kennung', 'content', 'kai').expect(404)

    expect(JSON.parse(String(answer.body))).toMatchObject({ message: attachmentGone })
    await fetched(plain, newId<'attachment-version'>(), 'content', 'kai').expect(404)
  })
})

describe('what the application looks at before a file is handed out', () => {
  it('is the file with its own columns, and a file it does not let through is answered like one that is not there', async () => {
    const atShelf = await filed('lena', { shelfId: shelf }, 'Regal')
    const atLetter = await filed('lena', { shelfId: shelf, letterId: letter }, 'Lieferschein')
    const open = await version('lena', atShelf, {
      bytes: png,
      name: 'Regal.png',
      declared: 'image/png',
      preview: png,
    })
    const closed = await version('lena', atLetter, {
      bytes: plan,
      name: 'Lieferschein.pdf',
      declared: 'application/pdf',
      preview: png,
    })

    await fetched(guarded, open, 'content', 'kai').expect(200)
    await fetched(guarded, closed, 'content', 'lena').expect(200)

    const content = await fetched(guarded, closed, 'content', 'kai').expect(404)
    const preview = await fetched(guarded, closed, 'preview', 'kai').expect(404)

    expect(JSON.parse(String(content.body))).toMatchObject({ message: scanGone })
    expect(JSON.parse(String(preview.body))).toMatchObject({ message: scanGone })
    expect(shown.map((attachment) => attachment['title'])).toEqual([
      'Regal',
      'Lieferschein',
      'Lieferschein',
      'Lieferschein',
    ])
    expect(shown[1]).toMatchObject({ id: atLetter, shelfId: shelf, letterId: letter })
  })

  it('is not asked about a file that is not there, and the sentence is the one of the application', async () => {
    const attachment = await filed('lena', { shelfId: shelf })
    const id = await version('lena', attachment, {
      bytes: plan,
      name: 'Schaltplan.pdf',
      declared: 'application/pdf',
    })

    const elsewhere = await fetched(guarded, id, 'content', 'sven').expect(404)
    const noPreview = await fetched(guarded, id, 'preview', 'lena').expect(404)

    expect(JSON.parse(String(elsewhere.body))).toMatchObject({ message: scanGone })
    expect(JSON.parse(String(noPreview.body))).toMatchObject({ message: scanGone })
    expect(shown).toEqual([])
  })
})

describe('a version in the database', () => {
  it('names who stored it from the request, whatever the row says', async () => {
    const attachment = await filed('lena', { shelfId: shelf })
    const sha256 = await stored('kai', plan, 'application/pdf')

    await inTenant('kai', (tx) =>
      tx.insert(probeAttachmentVersions).values({
        tenantId: north.id,
        attachmentId: attachment,
        sha256,
        fileName: 'Schaltplan.pdf',
        mediaType: 'application/pdf',
        sizeBytes: plan.byteLength,
        createdBy: 'lena',
      } as never),
    )

    const { rows } = await admin.query<{ created_by: string; version: number; sequence: string }>(
      'select created_by, version, change_sequence as sequence from attachment_versions',
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]?.created_by).toBe('kai')
    // Stamped for the sync like every row that travels.
    expect(rows[0]?.version).toBe(1)
    expect(Number(rows[0]?.sequence)).toBeGreaterThan(0)
  })

  it('is neither changed nor deleted, by the application or by the owner of the table', async () => {
    const attachment = await filed('lena', { shelfId: shelf })
    const id = await version('lena', attachment, {
      bytes: plan,
      name: 'Schaltplan.pdf',
      declared: 'application/pdf',
    })
    const other = await stored('lena', laterPlan, 'application/pdf')

    expect(
      await codeOf(
        inTenant('lena', (tx) =>
          tx
            .update(probeAttachmentVersions)
            .set({ sha256: other } as never)
            .where(eq(probeAttachmentVersions.id, id as never)),
        ),
      ),
    ).toBe(insufficientPrivilege)
    expect(
      await codeOf(
        inTenant('lena', (tx) =>
          tx.delete(probeAttachmentVersions).where(eq(probeAttachmentVersions.id, id as never)),
        ),
      ),
    ).toBe(insufficientPrivilege)

    // The owner walks past the grants and is stopped by the trigger.
    expect(
      await codeOf(
        admin.query('update attachment_versions set sha256 = $1 where id = $2', [other, id]),
      ),
    ).toBe('OG001')
    expect(await codeOf(admin.query('delete from attachment_versions where id = $1', [id]))).toBe(
      'OG001',
    )

    const { rows } = await admin.query<{ sha256: string }>(
      'select sha256 from attachment_versions where id = $1',
      [id],
    )

    expect(rows[0]?.sha256).toBe(hashOf(plan))
  })

  it('names bytes of its own tenant only, and a file of its own tenant only', async () => {
    const attachment = await filed('lena', { shelfId: shelf })
    const southAttachment = await filed('sven', { shelfId: southShelf })
    const own = await stored('lena', plan, 'application/pdf')
    const foreign = await stored('sven', laterPlan, 'application/pdf')

    const naming = (values: Record<string, unknown>) =>
      inTenant('lena', (tx) =>
        tx.insert(probeAttachmentVersions).values({
          tenantId: north.id,
          attachmentId: attachment,
          sha256: own,
          fileName: 'Schaltplan.pdf',
          mediaType: 'application/pdf',
          sizeBytes: plan.byteLength,
          ...values,
        } as never),
      )

    expect(await codeOf(naming({ sha256: foreign }))).toBe(foreignKeyViolation)
    expect(await codeOf(naming({ previewSha256: foreign }))).toBe(foreignKeyViolation)
    expect(await codeOf(naming({ attachmentId: southAttachment }))).toBe(foreignKeyViolation)
    await naming({})
  })
})

describe('a file in the database', () => {
  it('is held to its places by the check and the keys of the application as well, for every other way in', async () => {
    const filing = (values: Record<string, unknown>) =>
      inTenant('lena', (tx) =>
        tx
          .insert(probeAttachments)
          .values({ tenantId: north.id, title: 'Scan', ...values } as never),
      )

    expect(await refusedBy(filing({}))).toEqual({
      code: checkViolation,
      constraint: 'attachments_hang_somewhere',
    })
    // A shelf of another tenant is a key that points nowhere.
    expect(await refusedBy(filing({ shelfId: southShelf }))).toEqual({
      code: foreignKeyViolation,
      constraint: 'attachments_shelf',
    })
    await filing({ shelfId: shelf, letterId: letter })
  })

  it('is marked as deleted and never removed by the application', async () => {
    const attachment = await filed('lena', { shelfId: shelf })

    expect(
      await codeOf(
        inTenant('lena', (tx) =>
          tx.delete(probeAttachments).where(eq(probeAttachments.id, attachment as never)),
        ),
      ),
    ).toBe(insufficientPrivilege)

    await inTenant('lena', (tx) =>
      tx
        .update(probeAttachments)
        .set({ deletedAt: new Date() })
        .where(eq(probeAttachments.id, attachment as never)),
    )

    const { rows } = await admin.query<{ deleted: boolean; version: number }>(
      'select deleted_at is not null as deleted, version from attachments where id = $1',
      [attachment],
    )

    expect(rows).toEqual([{ deleted: true, version: 2 }])
  })

  it('is kept apart by tenant, and its changes and those of its versions are in the log', async () => {
    const attachment = await filed('lena', { shelfId: shelf }, 'Schaltplan')

    await version('lena', attachment, {
      bytes: plan,
      name: 'Schaltplan.pdf',
      declared: 'application/pdf',
    })

    const seenElsewhere = await inTenant('sven', async (tx) => ({
      attachments: await tx.select().from(probeAttachments),
      versions: await tx.select().from(probeAttachmentVersions),
    }))
    const { rows: logged } = await admin.query<{ table_name: string }>(
      `select distinct table_name from audit_entries
        where table_name in ('attachments', 'attachment_versions') order by table_name`,
    )

    expect(seenElsewhere).toEqual({ attachments: [], versions: [] })
    expect(logged.map((entry) => entry.table_name)).toEqual(['attachment_versions', 'attachments'])
  })
})
