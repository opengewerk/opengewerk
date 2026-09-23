import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { contactParentText, syncEntities } from '@opengewerk/domain'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { Database } from '../database/database.js'
import { newId } from '../database/identifier.js'
import { changesSince } from '../database/sync.js'
import {
  allowApplicationLogin,
  applicationDatabaseUrl,
  applyMigrations,
  connect,
  resetSchema,
} from '../database/test-database.js'
import { ApiModule } from './api.module.js'
import { permissionFor } from './sync.controller.js'
import { as, testIdentities as identities } from './test-identity.js'
import { invoiceable, issuableDraft, readyToInvoice } from './test-invoice.js'
import { created, push as transmit } from './test-structure.js'

/**
 * Two devices in a basement, one connection between them and the server, and
 * the question ADR 0005 turned down CRDTs over: what happens when both of them
 * wrote the same thing.
 */

const north = { id: newId<'tenant'>(), name: 'Elektro Nord GmbH' }
/** The business next door, for the records a device must not reach. */
const south = { id: newId<'tenant'>(), name: 'Elektro Süd GmbH' }

let admin: Pool
let database: Database
let app: INestApplication
let customerId: string
let siteId: string

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
  await admin.query('insert into tenants (id, name) values ($1, $2), ($3, $4)', [
    north.id,
    north.name,
    south.id,
    south.name,
  ])
  await readyToInvoice(admin, north.id)

  database = Database.connect(applicationDatabaseUrl())

  const built = await Test.createTestingModule({
    imports: [ApiModule.create(database, identities)],
  }).compile()

  app = built.createNestApplication()
  await app.init()

  const customer = await http()
    .post('/customers')
    .set('x-test-identity', office())
    .send({ kind: 'business', name: 'Bauherr Nord', ...invoiceable })
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

    // Counters, the log, the sync layer's own bookkeeping, the settings a
    // business makes about itself, and who may work in it. None of them is work
    // a technician does in a basement.
    //
    // The last three are worth a sentence, because they look syncable and are
    // not. A membership says what somebody may do, and a device that carried
    // its own copy would answer that question from a copy as old as its last
    // connection: rights taken away in the office would go on working on the
    // roof until it next came online. A tenant session records a sign in,
    // which happens on the server by definition. An invitation is a way into
    // the business, and a way in that a phone holds a copy of is a way in that
    // survives being called back. All three are read live or not at all.
    //
    // The four from #71 stay here for plainer reasons. The letterhead is a
    // setting like the parameters. A snapshot is written by the issuing and a
    // document file by the first print, both on the server by definition. And
    // `files` holds nothing a device writes yet; the photo taken on a roof
    // arrives with its own issue, and with it the question how a file travels.
    //
    // The text snippets from #72 are picked from at a desk, and inserting one
    // copies its text into the document, which does travel. A device that
    // needed the list would get it with the documents that come to the site.
    //
    // The mail outbox from #81 is the server's own work from end to end: a
    // message is written by a cause on the server and sent from there. What a
    // device does raises causes, a task written on site for instance, and
    // those travel; the message about it never needs to.
    //
    // The mail server of a business and the sealed password to it are the
    // clearest case of all. A device does not send mail, and a login to a
    // mailbox in the storage of a phone that was left on a roof is exactly
    // what sealing it on the server was for.
    //
    // The instructions from #109 are kept at a desk like the text snippets, and
    // what went with a document is copied into its snapshot. What the office
    // chose on a draft is chosen before issuing, which needs a connection, and a
    // device has no instructions to choose from.
    const serverOnly = (name: string) =>
      name.startsWith('audit_') ||
      name.startsWith('sync_') ||
      name === 'number_ranges' ||
      name === 'tenant_parameters' ||
      name === 'memberships' ||
      name === 'tenant_sessions' ||
      name === 'invitations' ||
      name === 'letterheads' ||
      name === 'document_snapshots' ||
      name === 'document_files' ||
      name === 'files' ||
      name === 'text_snippets' ||
      name === 'instructions' ||
      name === 'document_instruction_choices' ||
      name === 'mail_outbox' ||
      name === 'mail_settings' ||
      name === 'secrets'

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

  it('lets a technician create one, which is the case the whole thing is for', async () => {
    // Two questions that used to give opposite answers. The sync policy says
    // master data may be created without a network, the rights said a
    // technician may not create it at all, and the rights won. Since the
    // decision on #32 there is a right for exactly this, so the two agree:
    // the call out at an address nobody has entered yet goes through.
    const answer = await push(technician(), 'telefon-anna', [
      change({
        entity: 'customers',
        recordId: newId<'customer'>(),
        kind: 'create',
        patches: [
          { field: 'kind', from: null, to: 'private' },
          { field: 'name', from: null, to: 'Notdienst, noch nicht erfasst' },
        ],
      }),
    ])

    expect(answer.receipts[0]?.outcome).toBe('applied')
  })

  it('still needs the right for it, whatever the sync policy allows', async () => {
    // The other half of the same sentence, and the reason the right was split
    // rather than widened. Creating is granted, changing is not, and a queue
    // is still a different way in and not a different thing to do. The right
    // answers before the policy is asked at all: for the office the same
    // operation comes back as `online_only`, here it never reaches the merge.
    const refused = await http()
      .post('/sync')
      .set('x-test-identity', technician())
      .send({
        deviceId: 'telefon-anna',
        operations: [
          change({
            entity: 'customers',
            recordId: customerId,
            patches: [{ field: 'name', from: 'Bauherr Nord', to: 'Ohne Recht' }],
          }),
        ],
      })
      .expect(400)

    expect(refused.body.message).toMatch(/customer\.write/)
  })

  it('may not create a site either way, because only the customer is cut that finely', async () => {
    // The visible exception, written down where it can be seen. Splitting the
    // verbs for every subject was the other way out of #32 and was not taken,
    // so a building still needs `site.write` and the office enters it. The
    // technician can record who was called out and where they were only once
    // somebody with a connection has entered the address.
    const refused = await http()
      .post('/sync')
      .set('x-test-identity', technician())
      .send({
        deviceId: 'telefon-anna',
        operations: [
          change({
            entity: 'sites',
            recordId: newId<'site'>(),
            kind: 'create',
            patches: [{ field: 'designation', from: null, to: 'Haus ohne Recht' }],
          }),
        ],
      })
      .expect(400)

    expect(refused.body.message).toMatch(/site\.write/)
  })

  it('cannot touch a document once it has been issued', async () => {
    const draft = await issuableDraft(app, office(), customerId)

    await http().post(`/documents/${draft}/issue`).set('x-test-identity', office()).expect(201)

    const answer = await push(office(), 'telefon-anna', [
      change({
        entity: 'documents',
        recordId: draft,
        patches: [{ field: 'subject', from: null, to: 'Nachträglich' }],
      }),
    ])

    expect(answer.receipts[0]).toMatchObject({ outcome: 'conflict', reason: 'record_is_fixed' })
  })

  it('cannot be issued through the sync channel', async () => {
    // The whole point of the endpoint that does it: a number out of the
    // counter, a timestamp from the server clock, and a right the sender may
    // not even have. None of that is on this road.
    const draft = await http()
      .post('/documents')
      .set('x-test-identity', office())
      .send({ customerId, kind: 'final_invoice', documentDate: '2026-09-18' })
      .expect(201)

    const answer = await push(office(), 'telefon-anna', [
      change({
        entity: 'documents',
        recordId: draft.body.id,
        patches: [
          { field: 'status', from: 'draft', to: 'issued' },
          { field: 'number', from: null, to: 'RE-2026-0001' },
          { field: 'issuedAt', from: null, to: '2026-09-19T08:00:00.000Z' },
        ],
      }),
    ])

    expect(answer.receipts[0]).toMatchObject({
      outcome: 'conflict',
      reason: 'set_by_server',
    })

    const documents = await http().get('/documents').set('x-test-identity', office()).expect(200)
    const after = (documents.body as { id: string; status: string; number: string | null }[]).find(
      (document) => document.id === draft.body.id,
    )

    expect(after).toMatchObject({ status: 'draft', number: null })
  })

  it('cannot arrive from a device already issued', async () => {
    // The harder way in, and the one the gate on `status` cannot see: there is
    // no previous state to hold the patch against.
    const recordId = newId<'document'>()

    const answer = await push(office(), 'telefon-anna', [
      change({
        entity: 'documents',
        recordId,
        kind: 'create',
        patches: [
          { field: 'customerId', from: null, to: customerId },
          { field: 'kind', from: null, to: 'final_invoice' },
          { field: 'documentDate', from: null, to: '2026-09-18' },
          { field: 'status', from: null, to: 'issued' },
          { field: 'number', from: null, to: 'RE-2026-9999' },
        ],
      }),
    ])

    expect(answer.receipts[0]).toMatchObject({
      outcome: 'conflict',
      reason: 'set_by_server',
    })

    const documents = await http().get('/documents').set('x-test-identity', office()).expect(200)

    expect((documents.body as { id: string }[]).some((document) => document.id === recordId)).toBe(
      false,
    )
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

  it('cannot delete by writing the column that marks it', async () => {
    const board = await installation('Löschen an der Regel vorbei')

    const refused = await http()
      .post('/sync')
      .set('x-test-identity', technician())
      .send({
        deviceId: 'telefon-anna',
        operations: [
          change({
            recordId: board.id,
            baseVersion: board.version,
            patches: [{ field: 'deletedAt', from: null, to: '2026-09-19T08:00:00.000Z' }],
          }),
        ],
      })
      .expect(400)

    // Deleting has its own kind of operation and a rule of its own to pass.
    // As an ordinary field the column would walk around that rule, and set
    // back to null it would undelete something nobody restored.
    expect(refused.body.message).toMatch(/deletedAt/)
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

describe('a record that was deleted while the device was away', () => {
  it('takes no further change, it is as good as missing', async () => {
    const board = await installation('Aus dem Büro gelöscht')

    await http().delete(`/installations/${board.id}`).set('x-test-identity', office()).expect(200)

    const answer = await push(technician(), 'telefon-anna', [
      change({
        recordId: board.id,
        baseVersion: board.version,
        patches: [{ field: 'designation', from: 'Aus dem Büro gelöscht', to: 'Umbenannt' }],
      }),
    ])

    // Nothing is ever removed for real, so the row is still there to be found
    // and the change would land on it. Nobody would ever see the result: the
    // record is out of every list.
    expect(answer.receipts[0]?.outcome).toBe('conflict')
    expect(answer.receipts[0]?.reason).toBe('record_missing')

    const conflicts = await http()
      .get('/sync/conflicts')
      .set('x-test-identity', office())
      .expect(200)
    expect(
      (conflicts.body as { recordId: string }[]).some((entry) => entry.recordId === board.id),
    ).toBe(true)
  })

  it('is not deleted a second time when the queue arrives again', async () => {
    const board = await installation('Zweimal gelöscht')

    const first = await push(technician(), 'telefon-anna', [
      change({ recordId: board.id, kind: 'delete', baseVersion: board.version }),
    ])
    expect(first.receipts[0]?.outcome).toBe('applied')

    // A new operation id, so the recorded receipt does not catch it. What
    // catches it is the state: the row is already gone, and asking a person to
    // decide about that would be an entry on the list for nothing.
    const again = await push(technician(), 'telefon-anna', [
      change({ recordId: board.id, kind: 'delete', baseVersion: board.version }),
    ])
    expect(again.receipts[0]?.outcome).toBe('skipped')
    expect(again.receipts[0]?.reason).toBe('nothing_to_do')
  })

  it('collides with a delete when somebody changed it in the meantime', async () => {
    const board = await installation('Geändert und gelöscht')

    await http()
      .patch(`/installations/${board.id}`)
      .set('x-test-identity', office())
      .send({ designation: 'Im Büro umbenannt' })
      .expect(200)

    // The device still holds the version from before the office touched it. A
    // delete carries no fields to compare, so the version is the only thing
    // that can say the record moved on.
    const answer = await push(technician(), 'telefon-anna', [
      change({ recordId: board.id, kind: 'delete', baseVersion: board.version }),
    ])

    expect(answer.receipts[0]?.outcome).toBe('conflict')
    expect(answer.receipts[0]?.reason).toBe('changed_elsewhere')

    const listed = await http().get('/installations').set('x-test-identity', office()).expect(200)
    expect((listed.body as { id: string }[]).some((entry) => entry.id === board.id)).toBe(true)
  })

  it('takes nothing new to hang on it either', async () => {
    const building = await http()
      .post('/sites')
      .set('x-test-identity', office())
      .send({ customerId, designation: 'Altbau, abgerissen' })
      .expect(201)
    const standing = await http()
      .post('/installations')
      .set('x-test-identity', office())
      .send({ siteId: building.body.id, kind: 'meter', designation: 'Zähler im Altbau' })
      .expect(201)

    await http().delete(`/sites/${building.body.id}`).set('x-test-identity', office()).expect(200)

    // The device was in the cellar when the office took the building out, and
    // writes a new installation into it. The key would take that, the row is
    // still there, and nobody would find the installation again: no list
    // shows the site it hangs on.
    const answer = await transmit(app, technician(), [
      created('installations', newId<'installation'>(), {
        siteId: building.body.id,
        kind: 'meter',
        designation: 'Neuer Zähler',
      }),
      // A change that leaves the site alone is not held to it. The reading
      // was taken, and it belongs on the installation whatever happened to
      // the building since.
      change({
        recordId: standing.body.id,
        baseVersion: standing.body.version,
        patches: [{ field: 'designation', from: 'Zähler im Altbau', to: 'Zähler, abgelesen' }],
      }),
    ])

    expect(
      answer.receipts.map(({ outcome, reason, fields }) => ({ outcome, reason, fields })),
    ).toEqual([
      { outcome: 'conflict', reason: 'record_missing', fields: ['siteId'] },
      { outcome: 'applied', reason: null, fields: [] },
    ])
  })
})

/**
 * Every operation of a transmission runs in one transaction, and since 0031
 * the keys refuse a record of another business inside it. Left to them, one
 * operation with a wrong id would take every other one along, and the device
 * would send the same stack again the next time and the time after. Asked
 * first, it is a conflict about the one operation that names it, with the
 * field, and the rest of the queue goes through.
 */
describe('a reference to a record of another business', () => {
  const southOffice = () => as(south.id, 'office')

  async function southern(path: string, body: object): Promise<string> {
    const answer = await http()
      .post(path)
      .set('x-test-identity', southOffice())
      .send(body)
      .expect(201)

    return answer.body.id as string
  }

  it('is a conflict about that one operation, on every entity that points', async () => {
    const southCustomer = await southern('/customers', { kind: 'business', name: 'Bauherr Süd' })
    const southSite = await southern('/sites', { customerId: southCustomer, designation: 'Haus Süd' })
    const southInstallation = await southern('/installations', {
      siteId: southSite,
      kind: 'pv_system',
      designation: 'PV-Anlage Süd',
    })
    const southDocument = await southern('/documents', {
      customerId: southCustomer,
      kind: 'quote',
      documentDate: '2026-09-22',
    })
    const southInverter = newId<'inverter'>()
    const southString = newId<'pv-string'>()
    await transmit(app, southOffice(), [
      created('inverters', southInverter, {
        installationId: southInstallation,
        designation: 'WR Süd',
      }),
      created('pv_strings', southString, { inverterId: southInverter, designation: 'String Süd' }),
    ])

    // The ids of the other business are ones a device could know: somebody
    // who works for both, or a list copied from one to the other.
    const fine = newId<'site'>()
    const answer = await transmit(app, office(), [
      created('contacts', newId<'contact'>(), {
        customerId: southCustomer,
        familyName: 'Untergeschoben',
      }),
      created('sites', newId<'site'>(), {
        customerId: southCustomer,
        designation: 'Untergeschoben',
      }),
      created('installations', newId<'installation'>(), {
        siteId: southSite,
        kind: 'meter',
        designation: 'Untergeschoben',
      }),
      created('jobs', newId<'job'>(), {
        customerId,
        installationId: southInstallation,
        kind: 'service',
        designation: 'Untergeschoben',
      }),
      created('documents', newId<'document'>(), {
        customerId: southCustomer,
        kind: 'quote',
        documentDate: '2026-09-22',
        subject: 'Untergeschoben',
      }),
      created('document_lines', newId<'document-line'>(), {
        documentId: southDocument,
        position: 1,
        designation: 'Untergeschoben',
        quantityMilli: 1000,
        unit: 'piece',
        unitPriceCents: 100,
      }),
      created('inverters', newId<'inverter'>(), {
        installationId: southInstallation,
        designation: 'Untergeschoben',
      }),
      created('pv_strings', newId<'pv-string'>(), {
        inverterId: southInverter,
        designation: 'Untergeschoben',
      }),
      created('pv_modules', newId<'pv-module'>(), {
        pvStringId: southString,
        manufacturer: 'Untergeschoben',
      }),
      created('sites', fine, { customerId, designation: 'Richtig verwiesen' }),
    ])

    const missing = [
      'customerId',
      'customerId',
      'siteId',
      'installationId',
      'customerId',
      'documentId',
      'installationId',
      'inverterId',
      'pvStringId',
    ]
    expect(
      answer.receipts.map(({ outcome, reason, fields }) => ({ outcome, reason, fields })),
    ).toEqual([
      ...missing.map((field) => ({ outcome: 'conflict', reason: 'record_missing', fields: [field] })),
      { outcome: 'applied', reason: null, fields: [] },
    ])

    const { rows } = await admin.query<{ count: string }>(
      `select (select count(*) from contacts where family_name = 'Untergeschoben')
            + (select count(*) from sites where designation = 'Untergeschoben')
            + (select count(*) from installations where designation = 'Untergeschoben')
            + (select count(*) from jobs where designation = 'Untergeschoben')
            + (select count(*) from documents where subject = 'Untergeschoben')
            + (select count(*) from document_lines where designation = 'Untergeschoben')
            + (select count(*) from inverters where designation = 'Untergeschoben')
            + (select count(*) from pv_strings where designation = 'Untergeschoben')
            + (select count(*) from pv_modules where manufacturer = 'Untergeschoben') as count`,
    )
    expect(Number(rows[0]?.count)).toBe(0)

    const { rows: landed } = await admin.query<{ tenant_id: string }>(
      'select tenant_id from sites where id = $1',
      [fine],
    )
    expect(landed).toEqual([{ tenant_id: north.id }])
  })

  it('is asked on a change as well, for the reference it moves', async () => {
    const southCustomer = await southern('/customers', { kind: 'private', name: 'Familie Süd' })
    const job = await http()
      .post('/jobs')
      .set('x-test-identity', office())
      .send({ customerId, kind: 'service', designation: 'Wartung Wallbox' })
      .expect(201)

    const answer = await transmit(app, office(), [
      change({
        entity: 'jobs',
        recordId: job.body.id,
        baseVersion: job.body.version,
        patches: [{ field: 'customerId', from: customerId, to: southCustomer }],
      }),
    ])

    expect(
      answer.receipts.map(({ outcome, reason, fields }) => ({ outcome, reason, fields })),
    ).toEqual([{ outcome: 'conflict', reason: 'record_missing', fields: ['customerId'] }])

    const { rows } = await admin.query<{ customer_id: string }>(
      'select customer_id from jobs where id = $1',
      [job.body.id],
    )
    expect(rows).toEqual([{ customer_id: customerId }])
  })
})

/**
 * A contact hangs on one customer or on one site, and the check in the
 * database says so for the whole transmission: it refused a contact on
 * neither with "Die Angaben passen nicht zum Datenmodell.", and everything
 * the device had sent with it, so the next exchange sent the same stack
 * again. The sync asks first now (#116).
 */
describe('a contact from a device', () => {
  const answered = (answer: Awaited<ReturnType<typeof transmit>>) =>
    answer.receipts.map(({ outcome, reason, fields }) => ({ outcome, reason, fields }))

  it('lands on a customer, and on a site', async () => {
    const answer = await transmit(app, office(), [
      created('contacts', newId<'contact'>(), {
        customerId,
        familyName: 'Weber',
        role: 'Bauleitung',
      }),
      created('contacts', newId<'contact'>(), {
        siteId,
        familyName: 'Krause',
        role: 'Hausmeister',
      }),
    ])

    expect(answered(answer)).toEqual([
      { outcome: 'applied', reason: null, fields: [] },
      { outcome: 'applied', reason: null, fields: [] },
    ])
  })

  it('on neither is a conflict about that one operation, and the rest of the transmission lands', async () => {
    const stray = newId<'contact'>()
    const fine = newId<'site'>()

    const answer = await transmit(app, office(), [
      created('contacts', stray, { familyName: 'Ohne Zuordnung' }),
      created('sites', fine, { customerId, designation: 'Landet trotzdem' }),
    ])

    expect(answered(answer)).toEqual([
      { outcome: 'conflict', reason: 'record_missing', fields: ['customerId', 'siteId'] },
      { outcome: 'applied', reason: null, fields: [] },
    ])

    const { rows: contacts } = await admin.query('select id from contacts where id = $1', [stray])
    expect(contacts).toEqual([])
    const { rows: sites } = await admin.query('select designation from sites where id = $1', [fine])
    expect(sites).toEqual([{ designation: 'Landet trotzdem' }])

    // And it waits on the list for a person, like every other conflict.
    const conflicts = await http()
      .get('/sync/conflicts')
      .set('x-test-identity', office())
      .expect(200)
    expect(
      (conflicts.body as { recordId: string }[]).some((entry) => entry.recordId === stray),
    ).toBe(true)
  })

  it('on both is refused as a mistake of the client, in the words of the rule', async () => {
    const doubled = newId<'contact'>()

    const refused = await transmit(
      app,
      office(),
      [created('contacts', doubled, { customerId, siteId, familyName: 'Doppelt' })],
      400,
    )

    // No form can make one: a contact is made on the screen of what it
    // belongs to. So this is a client that needs fixing, and the sentence
    // says what to fix, where the database only said that something is wrong.
    expect(refused.message).toBe(contactParentText.both)

    const { rows } = await admin.query('select id from contacts where id = $1', [doubled])
    expect(rows).toEqual([])
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
    const changes = next.body as {
      changes: { entity: string }[]
      cursor: number
      hasMore: boolean
    }

    expect(changes.changes.map((entry) => entry.entity)).toContain('installations')
    expect(changes.cursor).toBeGreaterThan(cursor)
    // Nothing ran into the limit, so the cursor is the highest there is and
    // the device has everything.
    expect(changes.hasMore).toBe(false)
  })

  it('leaves nothing behind when one entity has more waiting than fits', async () => {
    const start = await http().get('/sync').set('x-test-identity', technician()).expect(200)
    const from = (start.body as { cursor: number }).cursor

    const boards = [
      await installation('Verteilung eins'),
      await installation('Verteilung zwei'),
      await installation('Verteilung drei'),
    ]

    // One change on another entity, made last, so it carries the highest
    // sequence number of the lot. That is the whole setup: the limit bites on
    // `installations`, and the number that looked like a safe cursor comes
    // from somewhere else entirely.
    await http()
      .post('/customers')
      .set('x-test-identity', office())
      .send({ kind: 'business', name: 'Zuletzt angelegt' })
      .expect(201)

    const pull = (since: number) =>
      database.forTenant({ userId: 'test', tenantId: north.id }, (tx) => changesSince(tx, since, 2))

    const first = await pull(from)
    const second = await pull(first.cursor)

    const seen = new Set(
      [...first.changes, ...second.changes]
        .filter((entry) => entry.entity === 'installations')
        .flatMap((entry) => entry.rows.map((row) => String(row['id']))),
    )

    // The third one is what used to fall out of the window, and it would never
    // come back: no error, no hint, and it hits exactly the device that was
    // away for a long time. This is the assertion that matters, so it comes
    // before the flag.
    for (const board of boards) {
      expect(seen.has(board.id)).toBe(true)
    }

    // Two of the three fit, so the cursor stops at the second one rather than
    // at the customer, and the answer says to come back.
    expect(first.hasMore).toBe(true)
    expect(second.hasMore).toBe(false)
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

/**
 * The positions of a document, over the queue. The rule that matters is not on
 * the line at all: whether it may be touched follows from the status of the
 * document it hangs on, which is the case `gateFrom` exists for.
 */
describe('a document line from a device', () => {
  async function draftDocument() {
    const created = await http()
      .post('/documents')
      .set('x-test-identity', office())
      .send({ customerId, kind: 'final_invoice', documentDate: '2026-09-20' })
      .expect(201)

    return created.body as { id: string }
  }

  function linePatches(over: Record<string, string | number> = {}) {
    const values: Record<string, string | number> = {
      position: 1,
      designation: 'Montage vor Ort',
      quantityMilli: 2000,
      unit: 'hour',
      unitPriceCents: 5000,
      ...over,
    }

    return Object.entries(values).map(([field, to]) => ({ field, from: null, to }))
  }

  it('lands while the document is a draft', async () => {
    const document = await draftDocument()
    const lineId = newId<'document-line'>()

    const answer = await push(technician(), 'tablet-1', [
      change({
        entity: 'document_lines',
        recordId: lineId,
        kind: 'create',
        patches: [...linePatches(), { field: 'documentId', from: null, to: document.id }],
      }),
    ])

    expect(answer.receipts[0]?.outcome).toBe('applied')

    // Und der Server hat die Summe selbst gerechnet: 2 Stunden zu 50,00 Euro.
    const lines = await http()
      .get(`/documents/${document.id}/lines`)
      .set('x-test-identity', office())
      .expect(200)
    expect((lines.body as { netCents: number }[])[0]?.netCents).toBe(10000)
  })

  it('is refused once the document is issued, with the reason the document gets', async () => {
    // One line already on it, because an invoice without one is not issued.
    const document = { id: await issuableDraft(app, office(), customerId) }
    await http()
      .post(`/documents/${document.id}/issue`)
      .set('x-test-identity', office())
      .expect(201)

    const answer = await push(technician(), 'tablet-1', [
      change({
        entity: 'document_lines',
        recordId: newId<'document-line'>(),
        kind: 'create',
        patches: [...linePatches(), { field: 'documentId', from: null, to: document.id }],
      }),
    ])

    expect(answer.receipts[0]).toMatchObject({
      outcome: 'conflict',
      reason: 'record_is_fixed',
    })
  })

  /**
   * The other half of the same rule. `netCents` is the server's, because a
   * client that rounded differently would put an amount in the books that does
   * not follow from the two numbers printed beside it.
   */
  it('cannot set the line total itself', async () => {
    const document = await draftDocument()

    const answer = await push(technician(), 'tablet-1', [
      change({
        entity: 'document_lines',
        recordId: newId<'document-line'>(),
        kind: 'create',
        patches: [
          ...linePatches(),
          { field: 'documentId', from: null, to: document.id },
          { field: 'netCents', from: null, to: 1 },
        ],
      }),
    ])

    expect(answer.receipts[0]).toMatchObject({
      outcome: 'conflict',
      reason: 'set_by_server',
    })
  })

  it('is refused when the document it names is not there', async () => {
    const answer = await push(technician(), 'tablet-1', [
      change({
        entity: 'document_lines',
        recordId: newId<'document-line'>(),
        kind: 'create',
        patches: [...linePatches(), { field: 'documentId', from: null, to: newId<'document'>() }],
      }),
    ])

    expect(answer.receipts[0]).toMatchObject({
      outcome: 'conflict',
      reason: 'record_missing',
    })
  })
})

describe('the rights the queue asks for', () => {
  /**
   * Asked of the policy list rather than kept beside it. `document_lines` was
   * added to the policies and forgotten here, and the failure was a 400 on
   * every transmission carrying a position: well formed, allowed, and refused
   * as an unknown kind of record. A list that has to be remembered twice is a
   * list that is wrong once.
   */
  it('cover every entity a device may send', () => {
    const without = syncEntities.filter((entity) => permissionFor(entity, 'create') === null)

    expect(without).toEqual([])
  })

  it('ask for writing, not for reading', () => {
    for (const entity of syncEntities) {
      expect(permissionFor(entity, 'update')).toMatch(/\.(write|create)$/)
    }
  })
})
