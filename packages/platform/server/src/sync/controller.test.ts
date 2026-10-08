import 'reflect-metadata'

import { ConflictException, type INestApplication } from '@nestjs/common'
import { APP_FILTER, APP_GUARD } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import { syncRights, type SyncValue, type TenantId } from '@opengewerk/platform-domain'
import { eq, sql } from 'drizzle-orm'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { type Authorization, AUTHORIZATION, AuthorizationGuard } from '../api/authorization.js'
import { databaseErrors } from '../api/database-errors.js'
import { TRUSTED_ORIGINS } from '../api/handed-in.js'
import { type FoundIdentity, IDENTITY_SOURCE } from '../api/identity.js'
import { SameOriginGuard } from '../api/origin.js'
import { headerIdentities, testIdentityHeader } from '../api/test-identity.js'
import { accountsOf } from '../authentication/administration.js'
import {
  probeAuthorization,
  probeCatalogue,
  type ProbeFoundation,
  probeFoundation,
} from '../authentication/probe-application.js'
import { Database } from '../database/database.js'
import { newId } from '../database/identifier.js'
import { standingInLine } from '../database/test-database.js'
import { serverSync } from './apply.js'
import { syncParts, type SyncRoutes } from './controller.js'
import { fingerprintOf } from './narrowing.js'
import {
  letterLines,
  letters,
  letterSeals,
  notes,
  probePermissionFor,
  probeSyncAccess,
  type ProbeSyncIdentity,
  probeSyncMade,
  type ProbeSyncRight,
  probeSyncRoutes,
  probeSyncRules,
  shelves,
} from './probe-sync.js'
import { syncTables } from './tables.js'

/**
 * The routes a device syncs through, for an application that is nobody's
 * (ADR 0010): the probe application with its shelves, notes, letters and
 * their lines. What the routes do here they do without knowing an entity by
 * name. What the probe application hands them is what every application
 * hands them: the right each operation asks for, its words for a refusal of
 * the database, and what the device of somebody holds.
 */

const north = { id: newId<'tenant'>(), name: 'Mandant Nord' }
const south = { id: newId<'tenant'>(), name: 'Mandant Süd' }

/** Who sent a note, in the order the transmissions arrived. */
const senders: string[] = []

/** A database error that names a reference to nothing. */
function isMissingReference(error: unknown): boolean {
  return [error, (error as { cause?: unknown } | undefined)?.cause].some(
    (candidate) => (candidate as { code?: unknown } | undefined)?.code === '23503',
  )
}

/** What the probe application says to a refusal over a right, for its rights with those of the sync. */
const words: Authorization<ProbeSyncRight> = probeAuthorization

const sync = serverSync<FoundIdentity<ProbeSyncIdentity>>({
  rules: probeSyncRules,
  tables: syncTables({ shelves, notes, letters, letterLines }),
  checks: [
    // A mistake only the client can make: its form asks for a text first.
    ({ operation, values }) =>
      operation.entity === 'notes' && 'text' in values && String(values['text']).trim() === ''
        ? { kind: 'client', message: 'Eine Notiz braucht einen Text.' }
        : null,
    ({ operation, sender }) => {
      if (operation.entity === 'notes') {
        senders.push(sender.userId)
      }

      return null
    },
    // The server failing on its own, which is no reason to lose the entry.
    ({ operation, values }) => {
      if (operation.entity === 'notes' && values['text'] === 'Platte voll') {
        throw new Error('Kein Platz mehr auf dem Datenträger.')
      }

      return null
    },
  ],
})

/** The words of the probe application for a note on a shelf that does not exist. */
const answerFor: SyncRoutes['answerFor'] = (error) =>
  isMissingReference(error)
    ? new ConflictException('Dieses Regal gibt es nicht.')
    : databaseErrors().answerFor(error)

let foundation: ProbeFoundation
let admin: Pool
let database: Database
let app: INestApplication
let withoutScope: INestApplication

/** The HTTP side of the probe application with the routes of the sync, as an application builds it. */
async function instanceWith<Sender = FoundIdentity<ProbeSyncIdentity>>(
  routes: SyncRoutes<ProbeSyncIdentity, ProbeSyncRight, Sender>,
): Promise<INestApplication> {
  const syncing = syncParts({ access: probeSyncAccess, routes })
  const built = await Test.createTestingModule({
    controllers: syncing.controllers,
    providers: [
      { provide: Database, useValue: database },
      ...syncing.providers,
      { provide: IDENTITY_SOURCE, useValue: headerIdentities<ProbeSyncIdentity>() },
      { provide: AUTHORIZATION, useValue: words },
      { provide: TRUSTED_ORIGINS, useValue: [] },
      { provide: APP_GUARD, useClass: SameOriginGuard },
      { provide: APP_GUARD, useClass: AuthorizationGuard },
      { provide: APP_FILTER, useClass: databaseErrors().DatabaseExceptionFilter },
    ],
  }).compile()
  const instance = built.createNestApplication()

  await instance.init()

  return instance
}

/** Somebody of a tenant, with the rights their roles add up to. */
function as(tenantId: TenantId, userId: string, ...rights: ProbeSyncRight[]): string {
  return JSON.stringify({ userId, tenantId, roles: [], rights })
}

/** Whoever works with notes on a device: syncs and writes notes, and nothing else. */
const olga = (tenantId: TenantId = north.id) =>
  as(tenantId, 'olga', syncRights.read, syncRights.write, 'notes.write')

/** Whoever keeps the shelves and writes the letters. */
const lena = (tenantId: TenantId = north.id) =>
  as(
    tenantId,
    'lena',
    syncRights.read,
    syncRights.write,
    'notes.write',
    'shelves.write',
    'letters.write',
  )

/** Whoever only looks: takes what has changed and sends nothing. */
const gustav = (tenantId: TenantId = north.id) => as(tenantId, 'gustav', syncRights.read)

interface Sent {
  readonly id: string
  readonly entity: string
  readonly recordId: string
  readonly kind: 'create' | 'update' | 'delete'
  readonly baseVersion: number | null
  readonly patches: { field: string; from: SyncValue; to: SyncValue }[]
  readonly recordedAt: string
}

function operation(over: {
  entity: string
  recordId?: string
  kind?: Sent['kind']
  patches?: { field: string; from?: SyncValue; to: SyncValue }[]
}): Sent {
  return {
    id: newId<'operation'>(),
    entity: over.entity,
    recordId: over.recordId ?? newId<'record'>(),
    kind: over.kind ?? 'create',
    baseVersion: null,
    patches: (over.patches ?? []).map((patch) => ({
      field: patch.field,
      from: patch.from ?? null,
      to: patch.to,
    })),
    recordedAt: new Date().toISOString(),
  }
}

function push(
  who: string,
  operations: readonly Sent[],
  deviceId = 'probe-phone',
  instance: INestApplication = app,
) {
  return request(instance.getHttpServer())
    .post('/sync')
    .set(testIdentityHeader, who)
    .send({ deviceId, operations })
}

function pull(who: string, query = 'since=0', instance: INestApplication = app) {
  return request(instance.getHttpServer()).get(`/sync?${query}`).set(testIdentityHeader, who)
}

interface PulledChange {
  readonly entity: string
  readonly rows: readonly Record<string, unknown>[]
}

/** The rows of one entity in an answer of a pull. */
function rowsOf(body: { changes: readonly PulledChange[] }, entity: string) {
  return body.changes.find((change) => change.entity === entity)?.rows ?? []
}

/** A shelf and a note on it, sent the way a device sends them. */
async function shelfWithNote(label: string, text: string, tenantId: TenantId = north.id) {
  const shelfId = newId<'shelf'>()
  const noteId = newId<'note'>()

  await push(lena(tenantId), [
    operation({
      entity: 'shelves',
      recordId: shelfId,
      patches: [{ field: 'label', to: label }],
    }),
    operation({
      entity: 'notes',
      recordId: noteId,
      patches: [
        { field: 'text', to: text },
        { field: 'shelfId', to: shelfId },
      ],
    }),
  ]).expect(201)

  return { shelfId, noteId }
}

/** Closes a shelf, the way a route of the office would: online, not through the sync. */
function close(shelfId: string, tenantId: TenantId = north.id) {
  return database.forTenant({ tenantId, userId: 'lena', reason: 'shelves.write' }, (tx) =>
    tx
      .update(shelves)
      .set({ closed: true })
      .where(eq(shelves.id, shelfId as never)),
  )
}

beforeAll(async () => {
  foundation = await probeFoundation(probeSyncMade)
  admin = await foundation.kit.connect()
  database = Database.connect(foundation.kit.applicationDatabaseUrl())
  const routes = probeSyncRoutes(sync, answerFor)

  app = await instanceWith(routes)
  // The same application, as one whose every device holds everything.
  withoutScope = await instanceWith({
    sync: routes.sync,
    permissionFor: routes.permissionFor,
    answerFor: routes.answerFor,
  })
}, 60_000)

beforeEach(async () => {
  await foundation.empty()
  await foundation.tenants(admin, [north, south])
  senders.length = 0
})

afterAll(async () => {
  await app.close()
  await withoutScope.close()
  await database.close()
  await admin.end()
  foundation.remove()
})

describe('sending an outbox', () => {
  it('applies what a device queued up, with the person of the session as the sender', async () => {
    const noteId = newId<'note'>()
    const answer = await push(olga(), [
      operation({
        entity: 'notes',
        recordId: noteId,
        patches: [{ field: 'text', to: 'Zähler ablesen' }],
      }),
    ]).expect(201)

    expect(
      (answer.body as { receipts: { outcome: string; reason: string | null }[] }).receipts,
    ).toMatchObject([{ outcome: 'applied', reason: null }])
    expect(senders).toEqual(['olga'])

    const [note] = await database.forTenant(
      { tenantId: north.id, userId: 'olga', reason: 'probe' },
      (tx) => tx.select().from(notes),
    )

    expect(note).toMatchObject({ id: noteId, text: 'Zähler ablesen', deviceId: 'probe-phone' })
  })

  it('takes the device from the transmission, not from an operation in it', async () => {
    const queued = {
      ...operation({ entity: 'notes', patches: [{ field: 'text', to: 'Sicherung prüfen' }] }),
      deviceId: 'somebody-else',
    }

    await push(olga(), [queued], 'olgas-phone').expect(201)

    const [note] = await database.forTenant(
      { tenantId: north.id, userId: 'olga', reason: 'probe' },
      (tx) => tx.select().from(notes),
    )

    expect(note?.deviceId).toBe('olgas-phone')
  })

  it('refuses an entity the application does not sync, names the operation and writes nothing', async () => {
    const crate = operation({ entity: 'crates', patches: [{ field: 'label', to: 'Kiste' }] })
    const answer = await push(olga(), [
      operation({ entity: 'notes', patches: [{ field: 'text', to: 'Davor' }] }),
      crate,
    ]).expect(400)

    expect(answer.body).toMatchObject({
      message: 'Diese Art von Datensatz wird nicht abgeglichen: crates',
      operationId: crate.id,
    })
    expect(
      await database.forTenant({ tenantId: north.id, userId: 'olga', reason: 'probe' }, (tx) =>
        tx.select().from(notes),
      ),
    ).toEqual([])
  })

  it('refuses an operation whose right the person lacks, in the words of the application', async () => {
    const letter = operation({ entity: 'letters', patches: [{ field: 'subject', to: 'Angebot' }] })
    const answer = await push(olga(), [letter]).expect(400)

    expect(answer.body).toMatchObject({
      message: words.missingPermission('letters.write'),
      operationId: letter.id,
    })
  })

  it('asks for the right to what an operation does, not only to what it touches', async () => {
    const { shelfId, noteId } = await shelfWithNote('Keller', 'Zähler ablesen')
    const other = newId<'shelf'>()

    await push(lena(), [
      operation({ entity: 'shelves', recordId: other, patches: [{ field: 'label', to: 'Boden' }] }),
    ]).expect(201)

    const moving = operation({
      entity: 'notes',
      recordId: noteId,
      kind: 'update',
      patches: [{ field: 'shelfId', from: shelfId, to: other }],
    })

    // Writing the text of the note is olga's; moving it to another shelf is not.
    const refused = await push(olga(), [moving]).expect(400)

    expect(refused.body).toMatchObject({
      message: words.missingPermission('shelves.write'),
      operationId: moving.id,
    })

    const moved = await push(lena(), [{ ...moving, id: newId<'operation'>() }]).expect(201)

    expect((moved.body as { receipts: { outcome: string }[] }).receipts[0]?.outcome).toBe('applied')
  })

  it('is refused to whoever may not send at all, before anything is read', async () => {
    await push(gustav(), [
      operation({ entity: 'notes', patches: [{ field: 'text', to: 'Heimlich' }] }),
    ]).expect(403)
    await request(app.getHttpServer())
      .post('/sync')
      .send({ deviceId: 'probe-phone', operations: [] })
      .expect(401)
  })

  it('refuses what is not an outbox, with what is wrong with it', async () => {
    expect((await push(olga(), [], '').expect(400)).body).toMatchObject({
      message: 'Es fehlt die Geräte-Kennung.',
    })

    const noList = await request(app.getHttpServer())
      .post('/sync')
      .set(testIdentityHeader, olga())
      .send({ deviceId: 'probe-phone' })
      .expect(400)

    expect(noList.body).toMatchObject({ message: 'Es fehlt die Liste der Vorgänge.' })

    const merge = { ...operation({ entity: 'notes' }), kind: 'merge' }
    const unknownKind = await request(app.getHttpServer())
      .post('/sync')
      .set(testIdentityHeader, olga())
      .send({ deviceId: 'probe-phone', operations: [merge] })
      .expect(400)

    expect(unknownKind.body).toMatchObject({ message: 'Vorgang 1: unbekannte Art merge.' })
  })

  /**
   * A device that lost the answer sends its queue again, and the first
   * transmission may still be at work when the second arrives. The receipt
   * that makes a second transmission harmless is written at the end of the
   * first, so the second found none, applied the operation again and then
   * failed on that receipt: the device was told its transmission was refused
   * over an operation the server had taken.
   *
   * The note is held until one transmission waits to write it and the other
   * waits for the first. Sent off together and left to chance, one is through
   * before the other asks, and nothing is ever at stake.
   */
  it('takes an operation once when its transmission arrives twice at the same moment', async () => {
    const { noteId } = await shelfWithNote('Keller', 'Zähler ablesen')
    const reworded = operation({
      entity: 'notes',
      recordId: noteId,
      kind: 'update',
      patches: [{ field: 'text', from: 'Zähler ablesen', to: 'Zähler abgelesen' }],
    })
    const holder = await admin.connect()

    try {
      await holder.query('begin')
      await holder.query('select id from notes where id = $1 for update', [noteId])

      const both = Promise.all([push(olga(), [reworded]), push(olga(), [reworded])])

      await standingInLine(admin, 2)
      await holder.query('commit')

      const answers = await both

      expect(answers.map((answer) => answer.status)).toEqual([201, 201])
      expect(
        answers
          .flatMap((answer) => (answer.body as { receipts: { reason: string | null }[] }).receipts)
          .map((receipt) => receipt.reason)
          .sort(),
      ).toEqual(['already_seen', null].sort())
    } finally {
      await holder.query('rollback')
      holder.release()
    }

    const [note] = await database.forTenant(
      { tenantId: north.id, userId: 'olga', reason: 'probe' },
      (tx) =>
        tx
          .select()
          .from(notes)
          .where(eq(notes.id, noteId as never)),
    )

    // Written once: the text is the new one, and the version moved by one.
    expect(note).toMatchObject({ text: 'Zähler abgelesen', version: 2 })
  })

  it('answers a mistake only the client can make with its sentence, naming the operation', async () => {
    const empty = operation({ entity: 'notes', patches: [{ field: 'text', to: '   ' }] })
    const answer = await push(olga(), [empty]).expect(400)

    expect(answer.body).toMatchObject({
      message: 'Eine Notiz braucht einen Text.',
      operationId: empty.id,
    })
  })

  it('answers a refusal of the database in the words of the application, naming the operation', async () => {
    const nowhere = operation({
      entity: 'notes',
      patches: [
        { field: 'text', to: 'Auf welchem Regal?' },
        { field: 'shelfId', to: newId<'shelf'>() },
      ],
    })
    const answer = await push(olga(), [nowhere]).expect(409)

    expect(answer.body).toMatchObject({
      message: 'Dieses Regal gibt es nicht.',
      operationId: nowhere.id,
    })
  })

  it('names no operation over a failure of its own', async () => {
    const answer = await push(olga(), [
      operation({ entity: 'notes', patches: [{ field: 'text', to: 'Platte voll' }] }),
    ]).expect(500)

    expect(answer.body).not.toHaveProperty('operationId')
  })
})

describe('whoever sent a transmission, read before its transaction', () => {
  /** The sender as this sync is told it: with the name of the account, which lives on the instance. */
  type Named = FoundIdentity<ProbeSyncIdentity> & { readonly name: string }

  /**
   * Who was read for which operations, in the order the transmissions
   * arrived, and how many transactions of the application stood open
   * meanwhile.
   */
  const read: { userId: string; entities: string[]; openTransactions: number }[] = []

  /** A sync whose seals carry the name of the account that sent them, and seal their letter. */
  const sealing = serverSync<Named>({
    rules: probeSyncRules,
    tables: syncTables({ shelves, notes, letters, letterLines, letterSeals }),
    complete: ({ operation, values, sender }) =>
      operation.entity === 'letter_seals' ? { ...values, sealedBy: sender.name } : values,
    afterWrite: async ({ tx, operation, values }) => {
      if (operation.entity === 'letter_seals') {
        await tx
          .update(letters)
          .set({ status: 'sealed' })
          .where(eq(letters.id, values['letterId'] as never))
      }
    },
  })

  let named: INestApplication

  beforeAll(async () => {
    named = await instanceWith<Named>({
      sync: sealing,
      permissionFor: probePermissionFor,
      answerFor,
      async senderOf(identity, operations) {
        // A transaction of the transmission already open would wait here, on
        // a connection of its own, for this one.
        const open = await database.forInstance((tx) =>
          tx.execute(sql`
            select count(*)::int as open from pg_stat_activity
             where usename = current_user
               and state like 'idle in transaction%'
               and pid <> pg_backend_pid()`),
        )

        read.push({
          userId: identity.userId,
          entities: operations.map((operation) => operation.entity),
          openTransactions: Number((open.rows[0] as { open: number } | undefined)?.open),
        })

        // On the instance, the way accounts are read, and never inside a tenant.
        const account = (await accountsOf(database, [identity.userId], identity.userId)).get(
          identity.userId,
        )

        if (!account) {
          throw new ConflictException('Dieses Konto gibt es nicht mehr.')
        }

        return { ...identity, name: account.name }
      },
    })
  })

  beforeEach(async () => {
    read.length = 0
    await admin.query('insert into auth_users (id, name, email) values ($1, $2, $3)', [
      'lena',
      'Lena Leitung',
      'lena@example.de',
    ])
  })

  afterAll(async () => {
    await named.close()
  })

  /** A letter and a seal on it, as a device sends them in one transmission. */
  function letterWithSeal() {
    const letterId = newId<'letter'>()

    return {
      letterId,
      operations: [
        operation({
          entity: 'letters',
          recordId: letterId,
          patches: [{ field: 'subject', to: 'Angebot' }],
        }),
        operation({ entity: 'letter_seals', patches: [{ field: 'letterId', to: letterId }] }),
      ],
    }
  }

  it('is read once per transmission with its operations, before its transaction, and the sync is told it', async () => {
    const { letterId, operations } = letterWithSeal()

    await push(lena(), operations, 'probe-phone', named).expect(201)

    expect(read).toEqual([
      { userId: 'lena', entities: ['letters', 'letter_seals'], openTransactions: 0 },
    ])

    const seals = await database.forTenant(
      { tenantId: north.id, userId: 'lena', reason: 'probe' },
      (tx) => tx.select().from(letterSeals),
    )
    const [letter] = await database.forTenant(
      { tenantId: north.id, userId: 'lena', reason: 'probe' },
      (tx) => tx.select().from(letters).where(eq(letters.id, letterId)),
    )

    expect(seals.map((seal) => seal.sealedBy)).toEqual(['Lena Leitung'])
    expect(letter?.status).toBe('sealed')
  })

  it('is not read for a transmission refused over a right', async () => {
    // Olga writes notes and no letters.
    await push(olga(), letterWithSeal().operations, 'probe-phone', named).expect(400)

    expect(read).toEqual([])
  })

  it('refuses the transmission with what it throws, before anything is written', async () => {
    await admin.query("delete from auth_users where id = 'lena'")

    const answer = await push(lena(), letterWithSeal().operations, 'probe-phone', named).expect(409)

    expect(answer.body).toMatchObject({ message: 'Dieses Konto gibt es nicht mehr.' })
    // Not about an operation, so it names none.
    expect(answer.body).not.toHaveProperty('operationId')
    expect(
      await database.forTenant({ tenantId: north.id, userId: 'lena', reason: 'probe' }, (tx) =>
        tx.select().from(letters),
      ),
    ).toEqual([])
  })
})

describe('taking what has changed', () => {
  it('hands a device every change since its cursor, with where to go on from', async () => {
    const { shelfId, noteId } = await shelfWithNote('Keller', 'Zähler ablesen')
    const answer = await pull(lena()).expect(200)
    const body = answer.body as {
      changes: PulledChange[]
      cursor: number
      hasMore: boolean
      narrowed: Record<string, string>
    }

    expect(rowsOf(body, 'shelves').map((row) => row['id'])).toEqual([shelfId])
    expect(rowsOf(body, 'notes').map((row) => row['id'])).toEqual([noteId])
    expect(body.hasMore).toBe(false)
    expect(body.cursor).toBeGreaterThan(0)
    expect(body.narrowed).toEqual({ letters: 'all', letter_lines: 'all', notes: 'all' })

    const later = (await pull(lena(), `since=${String(body.cursor)}`).expect(200)).body as {
      changes: PulledChange[]
      cursor: number
    }

    expect(later.changes.flatMap((change) => change.rows)).toEqual([])
    expect(later.cursor).toBe(body.cursor)
  })

  it('refuses a cursor that is not a whole number from zero', async () => {
    for (const since of ['-1', 'abc', '1.5']) {
      const answer = await pull(lena(), `since=${since}`).expect(400)

      expect(answer.body).toMatchObject({ message: 'Der Stand muss eine Zahl ab null sein.' })
    }
  })

  it('is refused to whoever may not take what has changed', async () => {
    await pull(as(north.id, 'niemand', syncRights.write)).expect(403)
  })

  it('narrows by who asks, and names what it narrowed to', async () => {
    const letterId = newId<'letter'>()

    await push(lena(), [
      operation({
        entity: 'letters',
        recordId: letterId,
        patches: [{ field: 'subject', to: 'Angebot' }],
      }),
    ]).expect(201)

    const writer = (await pull(lena()).expect(200)).body as {
      changes: PulledChange[]
      narrowed: Record<string, string>
    }
    const reader = (await pull(gustav()).expect(200)).body as {
      changes: PulledChange[]
      narrowed: Record<string, string>
    }

    expect(rowsOf(writer, 'letters').map((row) => row['id'])).toEqual([letterId])
    expect(writer.narrowed['letters']).toBe('all')
    expect(rowsOf(reader, 'letters')).toEqual([])
    expect(reader.narrowed['letters']).toBe('none')
  })

  it('narrows by what the device asks for, with a fingerprint that follows the set', async () => {
    const cellar = await shelfWithNote('Keller', 'Zähler ablesen')
    const attic = await shelfWithNote('Boden', 'Dachfenster schließen')

    await close(attic.shelfId)

    const open = (await pull(olga(), 'since=0&shelves=open').expect(200)).body as {
      changes: PulledChange[]
      narrowed: Record<string, string>
    }

    expect(rowsOf(open, 'notes').map((row) => row['id'])).toEqual([cellar.noteId])
    expect(open.narrowed['notes']).toBe(`shelves:${fingerprintOf([cellar.shelfId])}`)

    // The last open shelf closes, and the set the device holds is another one.
    await close(cellar.shelfId)

    const none = (await pull(olga(), 'since=0&shelves=open').expect(200)).body as {
      changes: PulledChange[]
      narrowed: Record<string, string>
    }

    expect(rowsOf(none, 'notes')).toEqual([])
    expect(none.narrowed['notes']).toBe(`shelves:${fingerprintOf([])}`)
    expect(none.narrowed['notes']).not.toBe(open.narrowed['notes'])

    // A device that asks for everything gets everything.
    const all = (await pull(olga()).expect(200)).body as { changes: PulledChange[] }

    expect(rowsOf(all, 'notes')).toHaveLength(2)
  })

  it('hands every row as the application answers it, in the transaction of the pull', async () => {
    await shelfWithNote('Keller', 'Zähler ablesen')

    const body = (await pull(olga()).expect(200)).body as { changes: PulledChange[] }

    expect(rowsOf(body, 'notes')[0]).toMatchObject({ text: 'Zähler ablesen', shelfLabel: 'Keller' })
    expect(rowsOf(body, 'shelves')[0]).not.toHaveProperty('shelfLabel')
  })

  it('hands a tenant nothing of the tenant next door', async () => {
    await shelfWithNote('Keller', 'Zähler ablesen', north.id)

    const body = (await pull(lena(south.id)).expect(200)).body as { changes: PulledChange[] }

    expect(body.changes.flatMap((change) => change.rows)).toEqual([])
  })

  it('hands every device everything and names nothing for an application without a scope', async () => {
    const letterId = newId<'letter'>()

    await push(
      lena(),
      [
        operation({
          entity: 'letters',
          recordId: letterId,
          patches: [{ field: 'subject', to: 'Angebot' }],
        }),
      ],
      'probe-phone',
      withoutScope,
    ).expect(201)

    const body = (await pull(gustav(), 'since=0', withoutScope).expect(200)).body as {
      changes: PulledChange[]
      narrowed: Record<string, string>
    }

    expect(rowsOf(body, 'letters').map((row) => row['id'])).toEqual([letterId])
    expect(body.narrowed).toEqual({})
  })
})

/** The same somebody, in a session opened on one device. */
function on(who: string, deviceId: string): string {
  return JSON.stringify({ ...(JSON.parse(who) as Record<string, unknown>), deviceId })
}

function conflictsOf(who: string) {
  return request(app.getHttpServer()).get('/sync/conflicts').set(testIdentityHeader, who)
}

function resolveAs(who: string, id: string) {
  return request(app.getHttpServer())
    .post(`/sync/conflicts/${id}/resolve`)
    .set(testIdentityHeader, who)
}

describe('the conflicts', () => {
  /**
   * A conflict is the device's whose change it was, and the person on it
   * decides (ADR 0005). Listed for everybody who may sync, it handed out the
   * values of records a device is no longer given since it holds only its
   * part of the tenant, and anybody could mark it decided
   * (GHSA-4jfj-cxqw-qgpj, opengewerk-haustechnik#31).
   */
  it('lists what a device has to decide and closes it once, for that device alone', async () => {
    const { shelfId } = await shelfWithNote('Keller', 'Zähler ablesen')

    // A shelf is corrected with a connection, not from a device.
    const sent = await push(
      on(lena(), 'lenas-phone'),
      [
        operation({
          entity: 'shelves',
          recordId: shelfId,
          kind: 'update',
          patches: [{ field: 'label', from: 'Keller', to: 'Dachboden' }],
        }),
      ],
      'lenas-phone',
    ).expect(201)

    expect(
      (sent.body as { receipts: { outcome: string; reason: string }[] }).receipts,
    ).toMatchObject([{ outcome: 'conflict', reason: 'online_only' }])

    const listed = (await conflictsOf(on(lena(), 'lenas-phone')).expect(200)).body as {
      id: string
      entity: string
      recordId: string
      reason: string
    }[]

    expect(listed).toMatchObject([{ entity: 'shelves', recordId: shelfId, reason: 'online_only' }])

    const id = listed[0]?.id ?? ''

    // Another device of the tenant neither sees it nor closes it, whoever is
    // on it: somebody else, the same person on a second device, or a session
    // that was never opened as a device.
    for (const elsewhere of [on(olga(), 'olgas-phone'), on(lena(), 'lenas-tablet'), olga()]) {
      expect((await conflictsOf(elsewhere).expect(200)).body).toEqual([])
      await resolveAs(elsewhere, id).expect(404)
    }

    // Not from the tenant next door either, which does not even learn it
    // exists, and not without the right to write.
    await resolveAs(on(olga(south.id), 'lenas-phone'), id).expect(404)
    await resolveAs(on(gustav(), 'lenas-phone'), id).expect(403)

    const resolved = await resolveAs(on(lena(), 'lenas-phone'), id).expect(201)

    expect(resolved.body).toEqual({ resolved: id })

    await resolveAs(on(lena(), 'lenas-phone'), id).expect(404)
    expect((await conflictsOf(on(lena(), 'lenas-phone')).expect(200)).body).toEqual([])
  })
})

describe('the routes of the sync, put together', () => {
  it('are refused for a catalogue without the rights of the sync', () => {
    expect(() =>
      syncParts({ access: { catalogue: probeCatalogue }, routes: probeSyncRoutes(sync) }),
    ).toThrow('The catalogue lacks the rights of the sync: sync.read, sync.write')
  })
})
