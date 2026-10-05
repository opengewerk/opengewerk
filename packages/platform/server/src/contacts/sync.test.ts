import {
  contactFamilyNameMissing,
  type Operation,
  type OperationReceipt,
  syncRules,
  type SyncValue,
  type TenantId,
} from '@opengewerk/platform-domain'
import { probeContactRules, probePolicies } from '@opengewerk/platform-domain/testing'
import type { Pool } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { type ProbeFoundation, probeFoundation } from '../authentication/probe-application.js'
import { Database, type TenantTransaction } from '../database/database.js'
import { newId } from '../database/identifier.js'
import { OperationRefused, serverSync, UnknownFieldError } from '../sync/apply.js'
import { letters, probeContacts, probeSyncMade, shelves } from '../sync/probe-sync.js'
import { recordRulesCheck } from '../sync/record-rules.js'
import { syncTables } from '../sync/tables.js'
import { contactRecordRules, contactWithoutParent } from './sync.js'

/**
 * What the sync asks of a contact before the database does, on an application
 * that is nobody's (opengewerk-haustechnik#85): its devices add the people to
 * ask about a shelf and the people a letter goes to, and correct them. A
 * contact without a family name or on both is a mistake of the device, refused
 * with the sentence; one on neither is a conflict about that one contact.
 */

const north = { id: newId<'tenant'>(), name: 'Mandant Nord' }

const sync = serverSync<null>({
  // An application whose devices make contacts and correct them field by field.
  rules: syncRules({ ...probePolicies, contacts: { create: true, change: 'merge' } }),
  tables: syncTables({ shelves, letters, contacts: probeContacts }),
  checks: [
    recordRulesCheck({ contacts: contactRecordRules(probeContactRules) }),
    contactWithoutParent(probeContactRules),
  ],
})

let foundation: ProbeFoundation
let admin: Pool
let database: Database

let shelf: string
let letter: string

function inTenant<Result>(work: (tx: TenantTransaction) => Promise<Result>): Promise<Result> {
  return database.forTenant(
    { tenantId: north.id, userId: 'olga', reason: 'sync', deviceId: 'probe-phone' },
    work,
  )
}

function operation(over: {
  recordId: string
  kind?: Operation['kind']
  patches?: { field: string; from?: SyncValue; to: SyncValue }[]
}): Operation {
  return {
    id: newId<'operation'>(),
    entity: 'contacts',
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

/** A contact as a device makes it, at the shelf unless it says otherwise. */
function aContact(
  fields: Record<string, SyncValue>,
  recordId: string = newId<'contact'>(),
): Operation {
  return operation({
    recordId,
    patches: Object.entries(fields).map(([field, to]) => ({ field, to })),
  })
}

function send(operations: readonly Operation[]) {
  return inTenant((tx) => sync.applyOperations(tx, north.id as TenantId, operations, null))
}

const outcomes = (receipts: readonly OperationReceipt[]) =>
  receipts.map(({ outcome, reason, fields }) => ({ outcome, reason, fields }))

async function refused(operations: readonly Operation[]): Promise<OperationRefused> {
  const error = await send(operations).catch((thrown: unknown) => thrown)

  expect(error).toBeInstanceOf(OperationRefused)
  expect((error as OperationRefused).cause).toBeInstanceOf(UnknownFieldError)

  return error as OperationRefused
}

function kept() {
  return inTenant((tx) => tx.select().from(probeContacts))
}

beforeAll(async () => {
  foundation = await probeFoundation(probeSyncMade)
  admin = await foundation.kit.connect()
  database = Database.connect(foundation.kit.applicationDatabaseUrl())
}, 60_000)

beforeEach(async () => {
  await foundation.empty(admin)
  await foundation.tenants(admin, [north])

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
})

afterAll(async () => {
  await database.close()
  await admin.end()
  foundation.remove()
})

describe('a contact from a device', () => {
  it('lands at the one record it names', async () => {
    const receipts = await send([
      aContact({ shelfId: shelf, familyName: 'Brandt', role: 'Lagerleitung' }),
      aContact({ letterId: letter, givenName: 'Ole', familyName: 'Jensen' }),
    ])

    expect(outcomes(receipts)).toEqual([
      { outcome: 'applied', reason: null, fields: [] },
      { outcome: 'applied', reason: null, fields: [] },
    ])
    expect((await kept()).map((row) => row.familyName).sort()).toEqual(['Brandt', 'Jensen'])
  })

  it('without a family name is a mistake of the device, refused with the sentence of the rule', async () => {
    const fine = aContact({ shelfId: shelf, familyName: 'Brandt' })

    for (const fields of [
      { shelfId: shelf, givenName: 'Nur Vorname' },
      { shelfId: shelf, familyName: '   ' },
      { shelfId: shelf, familyName: null },
    ] as Record<string, SyncValue>[]) {
      const nameless = aContact(fields)
      const error = await refused([fine, nameless])

      expect(error.operationId).toBe(nameless.id)
      expect(error.message).toBe(contactFamilyNameMissing)
    }

    // One transaction: the contact before it is not there either.
    expect(await kept()).toEqual([])
  })

  it('with a text the application finds wrong is refused with the sentence of the application', async () => {
    const error = await refused([
      aContact({
        shelfId: shelf,
        familyName: 'Brandt',
        role: 'Stellvertretende Leitung des Wareneingangs am Standort Nord',
      }),
    ])

    expect(error.message).toBe('Die Funktion hat höchstens 40 Zeichen.')
  })

  it('on several records is a mistake of the device, refused with the sentence of the application', async () => {
    const error = await refused([
      aContact({ shelfId: shelf, letterId: letter, familyName: 'Doppelt' }),
    ])

    expect(error.message).toBe(probeContactRules.parentText.several)
    expect(await kept()).toEqual([])
  })

  it('on none of them is a conflict about that one contact, with every field a parent could stand in, and the rest lands', async () => {
    const receipts = await send([
      aContact({ familyName: 'Niemand' }),
      aContact({ shelfId: shelf, familyName: 'Brandt' }),
    ])

    expect(outcomes(receipts)).toEqual([
      { outcome: 'conflict', reason: 'record_missing', fields: ['shelfId', 'letterId'] },
      { outcome: 'applied', reason: null, fields: [] },
    ])
    expect((await kept()).map((row) => row.familyName)).toEqual(['Brandt'])
  })
})

describe('a change to a contact from a device', () => {
  let contactId: string

  beforeEach(async () => {
    contactId = newId<'contact'>()
    await send([aContact({ shelfId: shelf, familyName: 'Clausen', role: 'Empfang' }, contactId)])
  })

  function change(patches: { field: string; from?: SyncValue; to: SyncValue }[]): Operation {
    return operation({ recordId: contactId, kind: 'update', patches })
  }

  it('that leaves the family name alone says nothing about it', async () => {
    const receipts = await send([change([{ field: 'role', from: 'Empfang', to: 'Lagerleitung' }])])

    expect(outcomes(receipts)).toEqual([{ outcome: 'applied', reason: null, fields: [] }])
    expect((await kept())[0]).toMatchObject({ familyName: 'Clausen', role: 'Lagerleitung' })
  })

  it('that empties the family name is refused like a contact made without one', async () => {
    const error = await refused([change([{ field: 'familyName', from: 'Clausen', to: '' }])])

    expect(error.message).toBe(contactFamilyNameMissing)
    expect((await kept())[0]).toMatchObject({ familyName: 'Clausen' })
  })

  it('that moves it takes both fields, and is judged as the contact would stand afterwards', async () => {
    const receipts = await send([
      change([
        { field: 'shelfId', from: shelf, to: null },
        { field: 'letterId', from: null, to: letter },
      ]),
    ])

    expect(outcomes(receipts)).toEqual([{ outcome: 'applied', reason: null, fields: [] }])
    expect((await kept())[0]).toMatchObject({ shelfId: null, letterId: letter })
  })

  it('that names a second record beside the one it has is two changes that do not fit together', async () => {
    // The device set one parent and never saw the other: somebody else wrote
    // that half, so a person looks at both fields.
    const receipts = await send([change([{ field: 'letterId', from: null, to: letter }])])

    expect(outcomes(receipts)).toEqual([
      { outcome: 'conflict', reason: 'changed_elsewhere', fields: ['shelfId', 'letterId'] },
    ])
    expect((await kept())[0]).toMatchObject({ shelfId: shelf, letterId: null })
  })

  it('that takes its one record away is a conflict about that change', async () => {
    const receipts = await send([change([{ field: 'shelfId', from: shelf, to: null }])])

    expect(outcomes(receipts)).toEqual([
      { outcome: 'conflict', reason: 'record_missing', fields: ['shelfId', 'letterId'] },
    ])
    expect((await kept())[0]).toMatchObject({ shelfId: shelf })
  })

  it('that removes it asks nothing of its fields, whatever the operation carries beside', async () => {
    // A delete marks the row and writes none of its patches, so there is
    // nothing to judge: not the family name it would empty, and not the one
    // record it would take the contact from.
    const receipts = await send([
      operation({
        recordId: contactId,
        kind: 'delete',
        patches: [
          { field: 'shelfId', from: shelf, to: null },
          { field: 'familyName', from: 'Clausen', to: '' },
        ],
      }),
    ])

    expect(outcomes(receipts)).toEqual([{ outcome: 'applied', reason: null, fields: [] }])

    const [row] = await kept()

    expect(row).toMatchObject({ shelfId: shelf, familyName: 'Clausen' })
    expect(row?.deletedAt).toBeInstanceOf(Date)
  })
})
