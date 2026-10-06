import { createHash } from 'node:crypto'

import {
  attachmentVersionPolicy,
  type Operation,
  type OperationReceipt,
  syncRules,
  type SyncValue,
  type TenantId,
} from '@opengewerk/platform-domain'
import { probeAttachmentRules, probePolicies } from '@opengewerk/platform-domain/testing'
import type { Pool } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { type ProbeFoundation, probeFoundation } from '../authentication/probe-application.js'
import { Database, type TenantTransaction } from '../database/database.js'
import { newId } from '../database/identifier.js'
import { OperationRefused, serverSync, UnknownFieldError } from '../sync/apply.js'
import {
  letters,
  probeAttachments,
  probeAttachmentVersions,
  probeSyncMade,
  shelves,
} from '../sync/probe-sync.js'
import { recordRulesCheck } from '../sync/record-rules.js'
import { syncTables } from '../sync/tables.js'
import {
  attachmentRecordRules,
  attachmentVersionFiles,
  attachmentVersionSizeMismatch,
} from './sync.js'

/**
 * What the sync asks of a file and of a version before the database does, on
 * an application that is nobody's (opengewerk-haustechnik#97): its devices
 * file a scan under a shelf, at a letter or at both, and lay versions over
 * it. A file on neither, and a version that says of its bytes what only a
 * broken client says, are mistakes of the device, refused with the sentence;
 * a version whose bytes never arrived is a conflict about that one version.
 */

const north = { id: newId<'tenant'>() as TenantId, name: 'Mandant Nord' }
const south = { id: newId<'tenant'>() as TenantId, name: 'Mandant Süd' }

const sync = serverSync<null>({
  // An application whose devices file scans, rename them and lay versions over them.
  rules: syncRules({
    ...probePolicies,
    attachments: { create: true, change: 'merge' },
    attachment_versions: attachmentVersionPolicy,
  }),
  tables: syncTables({
    shelves,
    letters,
    attachments: probeAttachments,
    attachmentVersions: probeAttachmentVersions,
  }),
  checks: [recordRulesCheck(attachmentRecordRules(probeAttachmentRules)), attachmentVersionFiles()],
})

let foundation: ProbeFoundation
let admin: Pool
let database: Database

let shelf: string
let letter: string

const hashOf = (text: string) => createHash('sha256').update(text).digest('hex')

const scan = { sha256: hashOf('scan'), sizeBytes: 4 }
const preview = { sha256: hashOf('preview'), sizeBytes: 7 }
/** Bytes only the other tenant has stored. */
const foreign = { sha256: hashOf('foreign'), sizeBytes: 7 }
/** Bytes nobody has stored. */
const missing = hashOf('never uploaded')

function inTenant<Result>(work: (tx: TenantTransaction) => Promise<Result>): Promise<Result> {
  return database.forTenant(
    { tenantId: north.id, userId: 'olga', reason: 'sync', deviceId: 'probe-phone' },
    work,
  )
}

function operation(over: {
  entity: 'attachments' | 'attachment_versions'
  recordId: string
  kind?: Operation['kind']
  patches?: { field: string; from?: SyncValue; to: SyncValue }[]
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
    deviceId: 'probe-phone',
  }
}

const patchesOf = (fields: Record<string, SyncValue>) =>
  Object.entries(fields).map(([field, to]) => ({ field, to }))

/** A file as a device makes it. */
function aFile(
  fields: Record<string, SyncValue>,
  recordId: string = newId<'attachment'>(),
): Operation {
  return operation({ entity: 'attachments', recordId, patches: patchesOf(fields) })
}

/** A version as a device makes it, of the scan unless it says otherwise. */
function aVersion(attachmentId: string, fields: Record<string, SyncValue> = {}): Operation {
  return operation({
    entity: 'attachment_versions',
    recordId: newId<'attachment-version'>(),
    patches: patchesOf({
      attachmentId,
      sha256: scan.sha256,
      sizeBytes: scan.sizeBytes,
      mediaType: 'application/pdf',
      fileName: 'Lieferschein.pdf',
      previewSha256: null,
      ...fields,
    }),
  })
}

function send(operations: readonly Operation[]) {
  return inTenant((tx) => sync.applyOperations(tx, north.id, operations, null))
}

const outcomes = (receipts: readonly OperationReceipt[]) =>
  receipts.map(({ outcome, reason, fields }) => ({ outcome, reason, fields }))

async function refused(operations: readonly Operation[]): Promise<OperationRefused> {
  const error = await send(operations).catch((thrown: unknown) => thrown)

  expect(error).toBeInstanceOf(OperationRefused)
  expect((error as OperationRefused).cause).toBeInstanceOf(UnknownFieldError)

  return error as OperationRefused
}

function keptFiles() {
  return inTenant((tx) => tx.select().from(probeAttachments))
}

function keptVersions() {
  return inTenant((tx) => tx.select().from(probeAttachmentVersions))
}

beforeAll(async () => {
  foundation = await probeFoundation(probeSyncMade)
  admin = await foundation.kit.connect()
  database = Database.connect(foundation.kit.applicationDatabaseUrl())
}, 60_000)

beforeEach(async () => {
  await foundation.empty(admin)
  await foundation.tenants(admin, [north, south])

  shelf = newId<'shelf'>()
  letter = newId<'letter'>()
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

  // The bytes travel ahead of a version: what is stored before anything is sent.
  for (const [tenant, file] of [
    [north.id, scan],
    [north.id, preview],
    [south.id, foreign],
  ] as const) {
    await admin.query(
      "insert into files (tenant_id, sha256, size_bytes, media_type) values ($1, $2, $3, 'application/pdf')",
      [tenant, file.sha256, file.sizeBytes],
    )
  }
})

afterAll(async () => {
  await database.close()
  await admin.end()
  foundation.remove()
})

describe('a file from a device', () => {
  it('lands at the records it names, one or several, with its version and who stored it', async () => {
    const atShelf = newId<'attachment'>()
    const atBoth = newId<'attachment'>()

    const receipts = await send([
      aFile({ shelfId: shelf, title: 'Regal' }, atShelf),
      aVersion(atShelf, { previewSha256: preview.sha256 }),
      aFile({ shelfId: shelf, letterId: letter, title: 'Lieferschein' }, atBoth),
      aVersion(atBoth),
    ])

    expect(outcomes(receipts)).toEqual([
      { outcome: 'applied', reason: null, fields: [] },
      { outcome: 'applied', reason: null, fields: [] },
      { outcome: 'applied', reason: null, fields: [] },
      { outcome: 'applied', reason: null, fields: [] },
    ])
    expect(
      (await keptFiles()).map(({ title, shelfId, letterId }) => ({ title, shelfId, letterId })),
    ).toEqual(
      expect.arrayContaining([
        { title: 'Regal', shelfId: shelf, letterId: null },
        { title: 'Lieferschein', shelfId: shelf, letterId: letter },
      ]),
    )

    const versions = await keptVersions()

    expect(versions).toHaveLength(2)
    expect(versions.map((row) => row.createdBy)).toEqual(['olga', 'olga'])
    expect(versions.find((row) => row.attachmentId === atShelf)).toMatchObject({
      sha256: scan.sha256,
      sizeBytes: scan.sizeBytes,
      previewSha256: preview.sha256,
      fileName: 'Lieferschein.pdf',
    })
  })

  it('on none of its records is a mistake of the device, refused with the sentence of the application', async () => {
    const fine = aFile({ shelfId: shelf, title: 'Regal' })

    for (const fields of [
      { title: 'Nirgends' },
      { shelfId: null, letterId: null, title: 'Nirgends' },
    ] as Record<string, SyncValue>[]) {
      const homeless = aFile(fields)
      const error = await refused([fine, homeless])

      expect(error.operationId).toBe(homeless.id)
      expect(error.message).toBe(
        'Eine Datei hängt an einem Regal oder an einem Brief, diese an keinem davon.',
      )
    }

    // One transaction: the file before it is not there either.
    expect(await keptFiles()).toEqual([])
  })

  it('that is renamed says nothing about where it hangs', async () => {
    const id = newId<'attachment'>()

    await send([aFile({ shelfId: shelf, title: 'Regal' }, id)])

    const receipts = await send([
      operation({
        entity: 'attachments',
        recordId: id,
        kind: 'update',
        patches: [{ field: 'title', from: 'Regal', to: 'Regal vorn' }],
      }),
    ])

    expect(outcomes(receipts)).toEqual([{ outcome: 'applied', reason: null, fields: [] }])
    expect((await keptFiles())[0]).toMatchObject({ title: 'Regal vorn', shelfId: shelf })
  })

  it('that is taken off its one record is refused like a file made on none', async () => {
    const id = newId<'attachment'>()

    await send([aFile({ shelfId: shelf, title: 'Regal' }, id)])

    const error = await refused([
      operation({
        entity: 'attachments',
        recordId: id,
        kind: 'update',
        patches: [
          { field: 'shelfId', from: shelf, to: null },
          { field: 'letterId', from: null, to: null },
        ],
      }),
    ])

    expect(error.message).toBe(probeAttachmentRules.homeProblem({}))
    expect((await keptFiles())[0]).toMatchObject({ shelfId: shelf })
  })

  it('that is removed is marked, and its versions stay', async () => {
    const id = newId<'attachment'>()

    await send([aFile({ shelfId: shelf, title: 'Regal' }, id), aVersion(id)])

    const receipts = await send([
      operation({ entity: 'attachments', recordId: id, kind: 'delete' }),
    ])

    expect(outcomes(receipts)).toEqual([{ outcome: 'applied', reason: null, fields: [] }])
    expect((await keptFiles())[0]?.deletedAt).toBeInstanceOf(Date)
    expect(await keptVersions()).toHaveLength(1)
  })
})

describe('a version from a device', () => {
  let attachmentId: string

  beforeEach(async () => {
    attachmentId = newId<'attachment'>()
    await send([aFile({ shelfId: shelf, title: 'Regal' }, attachmentId)])
  })

  it('whose bytes never arrived is a conflict about that one version, and the rest lands', async () => {
    const receipts = await send([
      aVersion(attachmentId, { sha256: missing }),
      aVersion(attachmentId),
    ])

    expect(outcomes(receipts)).toEqual([
      { outcome: 'conflict', reason: 'record_missing', fields: ['sha256'] },
      { outcome: 'applied', reason: null, fields: [] },
    ])
    expect((await keptVersions()).map((row) => row.sha256)).toEqual([scan.sha256])
  })

  it('whose preview never arrived is a conflict about the preview', async () => {
    const receipts = await send([aVersion(attachmentId, { previewSha256: missing })])

    expect(outcomes(receipts)).toEqual([
      { outcome: 'conflict', reason: 'record_missing', fields: ['previewSha256'] },
    ])
    expect(await keptVersions()).toEqual([])
  })

  it('finds no bytes another tenant stored, whoever knows their hash', async () => {
    const receipts = await send([
      aVersion(attachmentId, { sha256: foreign.sha256, sizeBytes: foreign.sizeBytes }),
      aVersion(attachmentId, { previewSha256: foreign.sha256 }),
    ])

    expect(outcomes(receipts)).toEqual([
      { outcome: 'conflict', reason: 'record_missing', fields: ['sha256'] },
      { outcome: 'conflict', reason: 'record_missing', fields: ['previewSha256'] },
    ])
    expect(await keptVersions()).toEqual([])
  })

  it('with a size that is not the size of its file is a mistake of the device, refused with the sentence', async () => {
    const wrong = aVersion(attachmentId, { sizeBytes: scan.sizeBytes + 1 })
    const error = await refused([aVersion(attachmentId), wrong])

    expect(error.operationId).toBe(wrong.id)
    expect(error.message).toBe(attachmentVersionSizeMismatch)
    expect(await keptVersions()).toEqual([])
  })

  it('that says of its bytes what only a broken client says is refused with the sentence of the rule', async () => {
    const said: [Record<string, SyncValue>, string][] = [
      [{ sha256: 'ABC' }, 'Die Prüfsumme der Datei ist kein SHA-256 in Kleinbuchstaben.'],
      [
        { sha256: scan.sha256.toUpperCase() },
        'Die Prüfsumme der Datei ist kein SHA-256 in Kleinbuchstaben.',
      ],
      [
        { previewSha256: 'kein-hash' },
        'Die Prüfsumme der Datei ist kein SHA-256 in Kleinbuchstaben.',
      ],
      [
        { mediaType: 'Application/PDF' },
        'Der Typ der Datei ist nicht so angegeben, wie die Ablage ihn festhält.',
      ],
      [
        { mediaType: 'text/html' },
        'Der Typ der Datei ist nicht so angegeben, wie die Ablage ihn festhält.',
      ],
      [{ sizeBytes: 0 }, 'Die Datei ist leer.'],
      [{ sizeBytes: -4 }, 'Die Größe der Datei ist keine Zahl von Bytes.'],
    ]

    for (const [fields, sentence] of said) {
      const error = await refused([aVersion(attachmentId, fields)])

      expect(error.message, JSON.stringify(fields)).toBe(sentence)
    }

    expect(await keptVersions()).toEqual([])
  })

  it('is asked about its bytes only when it is made, and by no other entity', async () => {
    // A file may carry a field called like a hash without being asked for bytes.
    const check = attachmentVersionFiles<null>()
    const asked = (entity: string, kind: Operation['kind']) =>
      inTenant(async (tx) =>
        check({
          tx,
          tenantId: north.id,
          operation: { ...aVersion(attachmentId), entity, kind },
          table: probeAttachmentVersions,
          values: { sha256: missing, sizeBytes: 1 },
          current: null,
          sender: null,
        }),
      )

    expect(await asked('attachment_versions', 'create')).toEqual({
      kind: 'conflict',
      reason: 'record_missing',
      fields: ['sha256'],
    })
    expect(await asked('attachment_versions', 'update')).toBeNull()
    expect(await asked('attachments', 'create')).toBeNull()
    expect(await asked('notes', 'create')).toBeNull()
  })

  it('is never changed afterwards: a change is a conflict, and the row stays as written', async () => {
    const made = aVersion(attachmentId)

    await send([made])

    const receipts = await send([
      operation({
        entity: 'attachment_versions',
        recordId: made.recordId,
        kind: 'update',
        patches: [{ field: 'fileName', from: 'Lieferschein.pdf', to: 'Anders.pdf' }],
      }),
    ])

    expect(receipts.map((receipt) => receipt.outcome)).toEqual(['conflict'])
    expect((await keptVersions())[0]).toMatchObject({ fileName: 'Lieferschein.pdf', version: 1 })
  })

  it('cannot say who stored it, which the server writes', async () => {
    const receipts = await send([aVersion(attachmentId, { createdBy: 'jemand anderes' })])

    expect(outcomes(receipts)).toEqual([
      { outcome: 'conflict', reason: 'set_by_server', fields: ['createdBy'] },
    ])
    expect(await keptVersions()).toEqual([])
  })
})
