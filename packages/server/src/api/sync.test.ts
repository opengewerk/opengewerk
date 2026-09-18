import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { type Identity, type RoleKey, syncEntities, type TenantId } from '@opengewerk/domain'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { Database } from '../database/database.js'
import { newId } from '../database/identifier.js'
import {
  allowApplicationLogin,
  applicationDatabaseUrl,
  applyMigrations,
  connect,
  resetSchema,
} from '../database/test-database.js'
import { ApiModule } from './api.module.js'
import type { IdentitySource } from './identity.js'

/**
 * Two devices in a basement, one connection between them and the server, and
 * the question ADR 0005 turned down CRDTs over: what happens when both of them
 * wrote the same thing.
 */

const north = { id: newId<'tenant'>(), name: 'Elektro Nord GmbH' }

let admin: Pool
let database: Database
let app: INestApplication
let customerId: string
let siteId: string

const identities: IdentitySource = {
  identify: async (incoming: unknown) => {
    const header = (incoming as { headers?: Record<string, string> }).headers?.['x-test-identity']

    return header ? (JSON.parse(header) as Identity) : null
  },
}

function as(tenantId: TenantId, ...roles: RoleKey[]): string {
  return JSON.stringify({ userId: 'test', tenantId, roles } satisfies Identity)
}

const office = () => as(north.id, 'office')
const technician = () => as(north.id, 'technician')

function http() {
  return request(app.getHttpServer())
}

interface Patch {
  field: string
  from: string | number | boolean | null
  to: string | number | boolean | null
}

function change(over: {
  id?: string
  entity?: string
  recordId: string
  kind?: 'create' | 'update' | 'delete'
  baseVersion?: number | null
  patches?: Patch[]
  recordedAt?: string
}) {
  return {
    id: over.id ?? newId<'operation'>(),
    entity: over.entity ?? 'installations',
    recordId: over.recordId,
    kind: over.kind ?? 'update',
    baseVersion: over.baseVersion ?? null,
    patches: over.patches ?? [],
    recordedAt: over.recordedAt ?? new Date().toISOString(),
  }
}

async function push(who: string, deviceId: string, operations: unknown[], expected = 201) {
  const answer = await http()
    .post('/sync')
    .set('x-test-identity', who)
    .send({ deviceId, operations })
    .expect(expected)

  return answer.body as { receipts: { operationId: string; outcome: string; reason: string }[] }
}

async function installation(designation: string) {
  const created = await http()
    .post('/installations')
    .set('x-test-identity', office())
    .send({ siteId, kind: 'meter_cabinet', designation })
    .expect(201)

  return created.body as { id: string; version: number; designation: string }
}

beforeAll(async () => {
  admin = await connect()
  await resetSchema(admin)
  await applyMigrations()
  await allowApplicationLogin(admin)
  await admin.query('insert into tenants (id, name) values ($1, $2)', [north.id, north.name])

  database = Database.connect(applicationDatabaseUrl())

  const built = await Test.createTestingModule({
    imports: [ApiModule.create(database, identities)],
  }).compile()

  app = built.createNestApplication()
  await app.init()

  const customer = await http()
    .post('/customers')
    .set('x-test-identity', office())
    .send({ kind: 'business', name: 'Bauherr Nord' })
    .expect(201)
  customerId = customer.body.id

  const site = await http()
    .post('/sites')
    .set('x-test-identity', office())
    .send({ customerId, designation: 'Mehrfamilienhaus' })
    .expect(201)
  siteId = site.body.id
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
})

describe('the tables', () => {
  it('carry the sync columns exactly where the rules say they should', async () => {
    // Asked of two places at once: the policies in `domain` say which entities
    // a device knows, the catalogue says which tables are built for it. A
    // table that is in one and not the other is the failure nobody notices,
    // because everything keeps working until two devices meet.
    const { rows } = await admin.query<{ table_name: string; columns: string }>(
      `select c.relname as table_name,
              (select count(*) from pg_attribute a
                where a.attrelid = c.oid and not a.attisdropped
                  and a.attname in ('version', 'updated_by', 'device_id',
                                    'deleted_at', 'change_sequence')) as columns
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'
        order by c.relname`,
    )

    const prepared = new Set(
      rows.filter((row) => Number(row.columns) === 5).map((row) => row.table_name),
    )
    const declared = new Set(syncEntities)

    expect(declared.size).toBeGreaterThanOrEqual(13)
    expect([...declared].filter((entity) => !prepared.has(entity))).toEqual([])
    expect([...prepared].filter((table) => !declared.has(table))).toEqual([])
  })

  it('that stay on the server say so, rather than simply lacking the columns', async () => {
    // The other direction, and the one that catches the next table. Anything
    // with a tenant is either something a device syncs or something that
    // deliberately never leaves, and there is no third case where somebody
    // just forgot.
    const { rows } = await admin.query<{ table_name: string }>(
      `select c.relname as table_name
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
         join pg_attribute a on a.attrelid = c.oid
          and a.attname = 'tenant_id' and not a.attisdropped
        where n.nspname = 'public' and c.relkind = 'r'
        order by c.relname`,
    )

    // Counters, the log, the sync layer's own bookkeeping and the settings a
    // business makes about itself. None of them is work a technician does in a
    // basement.
    const serverOnly = (name: string) =>
      name.startsWith('audit_') ||
      name.startsWith('sync_') ||
      name === 'number_ranges' ||
      name === 'tenant_parameters'

    const declared = new Set<string>(syncEntities)
    const unaccounted = rows
      .map((row) => row.table_name)
      .filter((name) => !declared.has(name) && !serverOnly(name))

    expect(unaccounted).toEqual([])
  })
})

describe('the five columns the server keeps', () => {
  it('move on their own, without a controller asking them to', async () => {
    const board = await http()
      .post('/installations')
      .set('x-test-identity', office())
      .send({ siteId, kind: 'meter_cabinet', designation: 'Gestempelt' })
      .expect(201)

    const changed = await http()
      .patch(`/installations/${board.body.id}`)
      .set('x-test-identity', office())
      .send({ designation: 'Gestempelt und geändert' })
      .expect(200)

    // The request said nothing about any of these. The trigger owns them, and
    // that is the point: a line the application has to remember is a line it
    // forgets at the sixteenth place, and a stale version only hurts the next
    // time two devices meet, days later and somewhere else.
    expect(new Date(changed.body.updatedAt).getTime()).toBeGreaterThan(
      new Date(board.body.updatedAt).getTime(),
    )
    expect(changed.body.version).toBe(board.body.version + 1)
    expect(changed.body.changeSequence).toBeGreaterThan(board.body.changeSequence)
    expect(changed.body.updatedBy).toBe('test')
  })
})

describe('two devices that wrote the same field', () => {
  it('leave an entry to decide, not a quiet takeover', async () => {
    const board = await installation('UV Keller')

    // Both were offline and both saw the same designation.
    const seen = board.designation

    await push(technician(), 'telefon-anna', [
      change({
        recordId: board.id,
        baseVersion: board.version,
        patches: [{ field: 'designation', from: seen, to: 'UV Keller links' }],
      }),
    ])

    const answer = await push(technician(), 'telefon-bernd', [
      change({
        recordId: board.id,
        baseVersion: board.version,
        patches: [{ field: 'designation', from: seen, to: 'UV Keller rechts' }],
      }),
    ])

    expect(answer.receipts[0]?.outcome).toBe('conflict')
    expect(answer.receipts[0]?.reason).toBe('changed_elsewhere')

    // The first one stands. The second is not lost and not silently applied
    // over the first: it is a question with both answers next to it.
    const after = await http().get('/installations').set('x-test-identity', office()).expect(200)
    const stored = (after.body as { id: string; designation: string }[]).find(
      (entry) => entry.id === board.id,
    )
    expect(stored?.designation).toBe('UV Keller links')

    const conflicts = await http()
      .get('/sync/conflicts')
      .set('x-test-identity', office())
      .expect(200)
    const open = (conflicts.body as Record<string, unknown>[]).filter(
      (entry) => entry['recordId'] === board.id,
    )

    expect(open).toHaveLength(1)
    expect(open[0]).toMatchObject({
      reason: 'changed_elsewhere',
      fields: ['designation'],
      deviceId: 'telefon-bernd',
      wanted: { designation: 'UV Keller rechts' },
      seen: { designation: 'UV Keller' },
      found: { designation: 'UV Keller links' },
    })
  })

  it('both go through when they wrote different fields', async () => {
    const board = await installation('UV Dachboden')

    await push(technician(), 'telefon-anna', [
      change({
        recordId: board.id,
        baseVersion: board.version,
        patches: [{ field: 'designation', from: board.designation, to: 'UV Dachboden links' }],
      }),
    ])

    const second = await push(technician(), 'telefon-bernd', [
      change({
        recordId: board.id,
        baseVersion: board.version,
        patches: [{ field: 'manufacturer', from: null, to: 'Hager' }],
      }),
    ])

    // Nothing to decide here. That is the merge on field level: the two never
    // reached for the same thing.
    expect(second.receipts[0]?.outcome).toBe('applied')
  })
})

describe('the same transmission twice', () => {
  it('creates no second record', async () => {
    const recordId = newId<'installation'>()
    const operation = change({
      recordId,
      kind: 'create',
      patches: [
        { field: 'siteId', from: null, to: siteId },
        { field: 'kind', from: null, to: 'meter_cabinet' },
        { field: 'designation', from: null, to: 'Zweimal geschickt' },
      ],
    })

    const first = await push(technician(), 'telefon-anna', [operation])
    expect(first.receipts[0]?.outcome).toBe('applied')

    // The connection dropped after the server committed. The device knows
    // nothing of that and sends its queue again, which is the ordinary case.
    const again = await push(technician(), 'telefon-anna', [operation])
    expect(again.receipts[0]?.reason).toBe('already_seen')

    const all = await http().get('/installations').set('x-test-identity', office()).expect(200)
    const matching = (all.body as { designation: string }[]).filter(
      (entry) => entry.designation === 'Zweimal geschickt',
    )

    expect(matching).toHaveLength(1)
  })

  it('does not change anything a second time either', async () => {
    const board = await installation('Einmal ändern')
    const operation = change({
      recordId: board.id,
      baseVersion: board.version,
      patches: [{ field: 'designation', from: board.designation, to: 'Geändert' }],
    })

    await push(technician(), 'telefon-anna', [operation])
    const again = await push(technician(), 'telefon-anna', [operation])

    expect(again.receipts[0]?.reason).toBe('already_seen')

    const conflicts = await http()
      .get('/sync/conflicts')
      .set('x-test-identity', office())
      .expect(200)
    const open = (conflicts.body as Record<string, unknown>[]).filter(
      (entry) => entry['recordId'] === board.id,
    )

    // And not a conflict either. The receipt answers it before the merge is
    // ever asked, which is the difference between a repeat and a real second
    // opinion about the same field.
    expect(open).toEqual([])
  })
})

describe('what a device may not do without a connection', () => {
  it('cannot change master data', async () => {
    const answer = await push(office(), 'telefon-anna', [
      change({
        entity: 'customers',
        recordId: customerId,
        patches: [{ field: 'name', from: 'Bauherr Nord', to: 'Umbenannt' }],
      }),
    ])

    // Not for want of a right: the office has every one of them. An address
    // corrected on two devices at once is a question for somebody with a
    // connection, and that is what the policy says.
    expect(answer.receipts[0]).toMatchObject({ outcome: 'conflict', reason: 'online_only' })
  })

  it('can still create master data, because that happens on site', async () => {
    const answer = await push(office(), 'telefon-anna', [
      change({
        entity: 'customers',
        recordId: newId<'customer'>(),
        kind: 'create',
        patches: [
          { field: 'kind', from: null, to: 'private' },
          { field: 'name', from: null, to: 'Vor Ort entdeckt' },
        ],
      }),
    ])

    expect(answer.receipts[0]?.outcome).toBe('applied')
  })

  it('still needs the right for it, whatever the sync policy allows', async () => {
    // Two questions, two answers, and this is where they meet. The sync policy
    // says master data may be created without a network; the rights say who
    // may create it at all, and a technician may not. ADR 0005 pictures a
    // technician adding a customer on site, ADR 0006 gives them only
    // `customer.read`. The rights win, because sending a queue is a different
    // way in and not a different thing to do.
    const refused = await http()
      .post('/sync')
      .set('x-test-identity', technician())
      .send({
        deviceId: 'telefon-anna',
        operations: [
          change({
            entity: 'customers',
            recordId: newId<'customer'>(),
            kind: 'create',
            patches: [{ field: 'name', from: null, to: 'Ohne Recht' }],
          }),
        ],
      })
      .expect(400)

    expect(refused.body.message).toMatch(/customer\.write/)
  })

  it('cannot touch a document once it has been issued', async () => {
    const draft = await http()
      .post('/documents')
      .set('x-test-identity', office())
      .send({ customerId, kind: 'final_invoice', documentDate: '2026-09-18' })
      .expect(201)

    await http()
      .post(`/documents/${draft.body.id}/issue`)
      .set('x-test-identity', office())
      .expect(201)

    const answer = await push(office(), 'telefon-anna', [
      change({
        entity: 'documents',
        recordId: draft.body.id,
        patches: [{ field: 'subject', from: null, to: 'Nachträglich' }],
      }),
    ])

    expect(answer.receipts[0]).toMatchObject({ outcome: 'conflict', reason: 'record_is_fixed' })
  })

  it('cannot write the columns the server keeps', async () => {
    const board = await installation('Fremde Spalte')

    const refused = await http()
      .post('/sync')
      .set('x-test-identity', technician())
      .send({
        deviceId: 'telefon-anna',
        operations: [
          change({
            recordId: board.id,
            baseVersion: board.version,
            patches: [{ field: 'version', from: 1, to: 99 }],
          }),
        ],
      })
      .expect(400)

    // A device that could write its own version could make any change look
    // like the newest one there is. Not a conflict, a mistake in the client.
    expect(refused.body.message).toMatch(/version/)
  })

  it('cannot sync an entity nobody offered', async () => {
    await http()
      .post('/sync')
      .set('x-test-identity', technician())
      .send({
        deviceId: 'telefon-anna',
        operations: [change({ entity: 'number_ranges', recordId: newId<'number-range'>() })],
      })
      .expect(400)
  })
})

describe('what a device gets back', () => {
  it('sees a record that was deleted, which is why it is only marked', async () => {
    const board = await installation('Wird gelöscht')

    const before = await http().get('/sync').set('x-test-identity', technician()).expect(200)
    const cursor = (before.body as { cursor: number }).cursor

    await http().delete(`/installations/${board.id}`).set('x-test-identity', office()).expect(200)

    const after = await http()
      .get(`/sync?since=${cursor}`)
      .set('x-test-identity', technician())
      .expect(200)

    const installations = (
      after.body as { changes: { entity: string; rows: Record<string, unknown>[] }[] }
    ).changes.find((entry) => entry.entity === 'installations')
    const deleted = installations?.rows.find((row) => row['id'] === board.id)

    // Without this the record would simply stop appearing, and a device that
    // was offline would keep it on its screen forever.
    expect(deleted).toBeDefined()
    expect(deleted?.['deletedAt']).not.toBeNull()

    // And it is out of the ordinary list at the same time.
    const listed = await http().get('/installations').set('x-test-identity', office()).expect(200)
    expect((listed.body as { id: string }[]).some((entry) => entry.id === board.id)).toBe(false)
  })

  it('sees one a device deleted through its outbox, for the same reason', async () => {
    const board = await installation('Vom Gerät gelöscht')

    const before = await http().get('/sync').set('x-test-identity', technician()).expect(200)
    const cursor = (before.body as { cursor: number }).cursor

    const answer = await push(technician(), 'telefon-anna', [
      change({ recordId: board.id, kind: 'delete', baseVersion: board.version }),
    ])
    expect(answer.receipts[0]?.outcome).toBe('applied')

    const after = await http()
      .get(`/sync?since=${cursor}`)
      .set('x-test-identity', technician())
      .expect(200)

    const rows = (
      after.body as { changes: { entity: string; rows: Record<string, unknown>[] }[] }
    ).changes.find((entry) => entry.entity === 'installations')?.rows
    const gone = rows?.find((row) => row['id'] === board.id)

    // The path that matters most: a technician deletes something on a phone.
    // Removing the row here would be the one place where the deletion never
    // reaches the other device, because there would be nothing left to send.
    expect(gone).toBeDefined()
    expect(gone?.['deletedAt']).not.toBeNull()
  })

  it('moves its cursor forward and does not hand the same change out twice', async () => {
    const first = await http().get('/sync').set('x-test-identity', technician()).expect(200)
    const cursor = (first.body as { cursor: number }).cursor

    const quiet = await http()
      .get(`/sync?since=${cursor}`)
      .set('x-test-identity', technician())
      .expect(200)
    expect((quiet.body as { changes: unknown[] }).changes).toEqual([])

    await installation('Nach dem Stand')

    const next = await http()
      .get(`/sync?since=${cursor}`)
      .set('x-test-identity', technician())
      .expect(200)
    const changes = next.body as { changes: { entity: string }[]; cursor: number }

    expect(changes.changes.map((entry) => entry.entity)).toContain('installations')
    expect(changes.cursor).toBeGreaterThan(cursor)
  })
})

describe('a conflict', () => {
  it('stays on the list until somebody says it is decided', async () => {
    const board = await installation('Zu entscheiden')

    await push(technician(), 'telefon-anna', [
      change({
        recordId: board.id,
        baseVersion: board.version,
        patches: [{ field: 'designation', from: board.designation, to: 'Anna' }],
      }),
    ])
    await push(technician(), 'telefon-bernd', [
      change({
        recordId: board.id,
        baseVersion: board.version,
        patches: [{ field: 'designation', from: board.designation, to: 'Bernd' }],
      }),
    ])

    const listed = await http().get('/sync/conflicts').set('x-test-identity', office()).expect(200)
    const mine = (listed.body as { id: string; recordId: string }[]).find(
      (entry) => entry.recordId === board.id,
    )
    if (!mine) {
      throw new Error('Kein Konflikt zum Entscheiden')
    }

    await http()
      .post(`/sync/conflicts/${mine.id}/resolve`)
      .set('x-test-identity', office())
      .expect(201)

    const left = await http().get('/sync/conflicts').set('x-test-identity', office()).expect(200)
    expect((left.body as { id: string }[]).some((entry) => entry.id === mine.id)).toBe(false)

    // And not twice. A conflict that could be closed again and again would let
    // a list quietly disagree with itself about how much is still open.
    await http()
      .post(`/sync/conflicts/${mine.id}/resolve`)
      .set('x-test-identity', office())
      .expect(404)
  })
})
