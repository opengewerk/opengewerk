import 'reflect-metadata'

import {
  type DynamicModule,
  type INestApplication,
  Module,
  UnprocessableEntityException,
} from '@nestjs/common'
import { APP_FILTER, APP_GUARD } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import {
  contactFamilyNameMissing,
  contactRules,
  type MemberIdentity,
  rightsCatalogue,
  type TenantId,
} from '@opengewerk/platform-domain'
import { probeContactRules } from '@opengewerk/platform-domain/testing'
import { and, eq, isNull } from 'drizzle-orm'
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
import { Database } from '../database/database.js'
import { newId } from '../database/identifier.js'
import {
  checkViolation,
  foreignKeyViolation,
  refusedBy,
  standingInLine,
} from '../database/test-database.js'
import {
  letters,
  type ProbeContactColumns,
  probeContacts,
  probeSyncAccess,
  probeSyncCatalogue,
  probeSyncMade,
  type ProbeSyncRight,
  shelves,
} from '../sync/probe-sync.js'
import { type ContactPlacing, contactParts, type ContactRoutes } from './controller.js'

/**
 * The routes of the contacts, on an application that is nobody's
 * (opengewerk-haustechnik#85): somebody to ask about a shelf, or the person a
 * letter goes to. What they hold: a contact hangs on exactly one record of
 * the application; its texts are kept as a form hands them over; the rights
 * are the application's, with one beyond the route's own for the people of a
 * letter; and the application looks at a contact before it is written.
 */

const north = { id: newId<'tenant'>() as TenantId, name: 'Mandant Nord' }
const south = { id: newId<'tenant'>() as TenantId, name: 'Mandant Süd' }

const every: ProbeSyncRight[] = ['members.read', 'notes.write', 'shelves.write', 'letters.write']

const people = {
  // Keeps shelves and writes letters: every route, every parent.
  lena: { tenant: north.id, roles: ['lead'], rights: every },
  // Keeps shelves and writes no letters.
  kai: {
    tenant: north.id,
    roles: ['member'],
    rights: every.filter((right) => right !== 'letters.write'),
  },
  // Adds a contact and corrects none.
  mia: { tenant: north.id, roles: ['member'], rights: ['members.read', 'notes.write'] },
  // Reads.
  gero: { tenant: north.id, roles: ['guest'], rights: ['members.read'] },
  sven: { tenant: south.id, roles: ['lead'], rights: every },
} as const satisfies Record<string, { tenant: TenantId; roles: string[]; rights: ProbeSyncRight[] }>

type Person = keyof typeof people

const shelfClosed = 'Dieses Regal ist geschlossen und nimmt keinen Ansprechpartner mehr.'
const shelfGone = 'Dieses Regal gibt es nicht oder nicht mehr.'
const letterGone = 'Diesen Brief gibt es nicht oder nicht mehr.'
const missing = 'Diesen Ansprechpartner gibt es nicht oder nicht mehr.'

/** What the application was shown before each write, in order. */
let placed: { parents: Record<string, unknown>; creating: boolean }[]

/**
 * What the probe application looks at before a contact is written: the shelf
 * or the letter has to be there for whoever asks, a closed shelf takes nobody
 * further, and the label of the shelf is kept with the contact.
 */
async function place({ tx, parents, creating }: ContactPlacing<'shelfId' | 'letterId'>) {
  placed.push({ parents: { ...parents }, creating })

  const shelfId = parents.shelfId
  const letterId = parents.letterId

  if (typeof letterId === 'string') {
    const [letter] = await tx
      .select({ id: letters.id })
      .from(letters)
      .where(and(eq(letters.id, letterId as never), isNull(letters.deletedAt)))

    if (!letter) {
      throw new UnprocessableEntityException(letterGone)
    }
  }

  if (typeof shelfId === 'string') {
    const [shelf] = await tx
      .select()
      .from(shelves)
      .where(and(eq(shelves.id, shelfId as never), isNull(shelves.deletedAt)))

    if (!shelf) {
      throw new UnprocessableEntityException(shelfGone)
    }

    if (shelf.closed) {
      throw new UnprocessableEntityException(shelfClosed)
    }

    return { filedUnder: shelf.label }
  }

  // Taken off its shelf, or never on one: filed under nothing.
  return 'shelfId' in parents ? { filedUnder: null } : undefined
}

const routes: ContactRoutes<ProbeSyncRight, 'shelfId' | 'letterId', ProbeContactColumns> = {
  table: probeContacts,
  rules: probeContactRules,
  // The people of a letter are for whoever writes letters.
  parentRight: (field) => (field === 'letterId' ? 'letters.write' : null),
  place,
}

const rights = { read: 'members.read', create: 'notes.write', write: 'shelves.write' } as const

let foundation: ProbeFoundation
let admin: Pool
let database: Database
let app: INestApplication

let shelf: string
let closedShelf: string
let letter: string
let southShelf: string

function as(person: Person): string {
  const { tenant, roles, rights: held } = people[person]
  const identity: MemberIdentity<ProbeSyncRight> = {
    userId: person,
    tenantId: tenant,
    roles: [...roles],
    rights: [...held],
  }

  return JSON.stringify(identity)
}

function http() {
  return request(app.getHttpServer())
}

/** The module of an application, as far as its contacts go. */
@Module({})
class ProbeContactModule {
  static create(on: Database): DynamicModule {
    const parts = contactParts({ access: probeSyncAccess, rights, routes })

    return {
      module: ProbeContactModule,
      controllers: parts.controllers,
      providers: [
        { provide: Database, useValue: on },
        ...parts.providers,
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

interface ContactAnswer {
  readonly id: string
  readonly shelfId: string | null
  readonly letterId: string | null
  readonly filedUnder: string | null
  readonly givenName: string | null
  readonly familyName: string
  readonly role: string | null
  readonly phone: string | null
  readonly email: string | null
  readonly version: number
  readonly changeSequence: number
  readonly deletedAt: string | null
}

async function made(
  body: Record<string, unknown>,
  person: Person = 'lena',
): Promise<ContactAnswer> {
  const answer = await http()
    .post('/contacts')
    .set(testIdentityHeader, as(person))
    .send(body)
    .expect(201)

  return answer.body as ContactAnswer
}

async function list(person: Person = 'lena'): Promise<ContactAnswer[]> {
  const answer = await http().get('/contacts').set(testIdentityHeader, as(person)).expect(200)

  return answer.body as ContactAnswer[]
}

async function refusal(
  method: 'post' | 'patch' | 'delete',
  path: string,
  body: Record<string, unknown> | undefined,
  status: number,
  person: Person = 'lena',
): Promise<string> {
  const sent = http()[method](path).set(testIdentityHeader, as(person))
  const answer = await (body === undefined ? sent : sent.send(body)).expect(status)

  return (answer.body as { message: string }).message
}

async function aShelf(tenant: TenantId, label: string, closed = false): Promise<string> {
  const id = newId<'shelf'>()

  await admin.query('insert into shelves (id, tenant_id, label, closed) values ($1, $2, $3, $4)', [
    id,
    tenant,
    label,
    closed,
  ])

  return id
}

beforeAll(async () => {
  foundation = await probeFoundation(probeSyncMade)
  admin = await foundation.kit.connect()
  database = Database.connect(foundation.kit.applicationDatabaseUrl())
  app = (
    await Test.createTestingModule({ imports: [ProbeContactModule.create(database)] }).compile()
  ).createNestApplication()
  await app.init()
}, 60_000)

beforeEach(async () => {
  await foundation.empty(admin)
  await foundation.tenants(admin, [north, south])

  shelf = await aShelf(north.id, 'Wareneingang')
  closedShelf = await aShelf(north.id, 'Archiv', true)
  southShelf = await aShelf(south.id, 'Lager Süd')
  letter = newId<'letter'>()
  await admin.query('insert into letters (id, tenant_id, subject) values ($1, $2, $3)', [
    letter,
    north.id,
    'Lieferschein',
  ])

  placed = []
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
  foundation.remove()
})

describe('the contacts of an application', () => {
  it('hang on one of its records, and only the own tenant sees them', async () => {
    const keeper = await made({ shelfId: shelf, familyName: 'Brandt', role: 'Lagerleitung' })
    const receiver = await made({ letterId: letter, givenName: 'Ole', familyName: 'Jensen' })

    await made({ shelfId: southShelf, familyName: 'Nachbar' }, 'sven')

    expect(keeper).toMatchObject({ shelfId: shelf, letterId: null, role: 'Lagerleitung' })
    expect(receiver).toMatchObject({ shelfId: null, letterId: letter, givenName: 'Ole' })

    expect((await list()).map((row) => row.familyName).sort()).toEqual(['Brandt', 'Jensen'])
    expect((await list('sven')).map((row) => row.familyName)).toEqual(['Nachbar'])
  })

  it('keep their texts as a form hands them over: trimmed, and one left empty is none', async () => {
    const row = await made({
      shelfId: shelf,
      givenName: '  Ole ',
      familyName: ' Jensen  ',
      role: '',
      phone: ' 040 123 45 ',
      email: '   ',
    })

    expect(row).toMatchObject({
      givenName: 'Ole',
      familyName: 'Jensen',
      role: null,
      phone: '040 123 45',
      email: null,
    })

    const changed = await http()
      .patch(`/contacts/${row.id}`)
      .set(testIdentityHeader, as('lena'))
      .send({ givenName: ' ', role: ' Empfang ', phone: null })
      .expect(200)

    expect(changed.body).toMatchObject({
      givenName: null,
      familyName: 'Jensen',
      role: 'Empfang',
      phone: null,
    })
  })

  it('need a family name, on the way in and when changed', async () => {
    for (const body of [
      { shelfId: shelf, givenName: 'Nur Vorname' },
      { shelfId: shelf, familyName: '   ' },
      { shelfId: shelf, familyName: null },
    ]) {
      expect(await refusal('post', '/contacts', body, 400)).toBe(contactFamilyNameMissing)
    }

    const row = await made({ shelfId: shelf, familyName: 'Albers' })

    for (const familyName of ['  ', '', null]) {
      expect(await refusal('patch', `/contacts/${row.id}`, { familyName }, 400)).toBe(
        contactFamilyNameMissing,
      )
    }

    // A change to another field says nothing about the name.
    await http()
      .patch(`/contacts/${row.id}`)
      .set(testIdentityHeader, as('lena'))
      .send({ role: 'Empfang' })
      .expect(200)
    expect((await list()).map((entry) => entry.familyName)).toEqual(['Albers'])
  })

  it('are refused when one of their texts is no text', async () => {
    const sentence = 'Die Angaben zu einem Ansprechpartner sind Text.'

    expect(await refusal('post', '/contacts', { shelfId: shelf, familyName: 7 }, 400)).toBe(
      sentence,
    )
    expect(
      await refusal('post', '/contacts', { shelfId: shelf, familyName: 'Albers', phone: 40 }, 400),
    ).toBe(sentence)
    expect(await list()).toEqual([])
  })

  it('take what the application finds wrong with a text beside the family name', async () => {
    const long = 'Stellvertretende Leitung des Wareneingangs am Standort Nord'
    const sentence = 'Die Funktion hat höchstens 40 Zeichen.'

    expect(
      await refusal('post', '/contacts', { shelfId: shelf, familyName: 'Albers', role: long }, 400),
    ).toBe(sentence)

    const row = await made({ shelfId: shelf, familyName: 'Albers' })

    expect(await refusal('patch', `/contacts/${row.id}`, { role: long }, 400)).toBe(sentence)
    // The family name comes first where both are wrong.
    expect(
      await refusal('post', '/contacts', { shelfId: shelf, familyName: ' ', role: long }, 400),
    ).toBe(contactFamilyNameMissing)
  })

  it('are refused on several records or on none, with the sentence of the application', async () => {
    expect(
      await refusal(
        'post',
        '/contacts',
        { shelfId: shelf, letterId: letter, familyName: 'Doppelt' },
        400,
      ),
    ).toBe(probeContactRules.parentText.several)
    expect(await refusal('post', '/contacts', { familyName: 'Niemand' }, 400)).toBe(
      probeContactRules.parentText.none,
    )
    expect(
      await refusal(
        'post',
        '/contacts',
        { shelfId: null, letterId: '', familyName: 'Niemand' },
        400,
      ),
    ).toBe(probeContactRules.parentText.none)
    expect(await list()).toEqual([])
    // Refused before the application was asked anything.
    expect(placed).toEqual([])
  })

  it('are changed, with the parent judged as it would stand afterwards', async () => {
    const row = await made({ shelfId: shelf, familyName: 'Clausen' })

    // A letter on top of the shelf would be both.
    expect(await refusal('patch', `/contacts/${row.id}`, { letterId: letter }, 400)).toBe(
      probeContactRules.parentText.several,
    )

    // Moving over takes both fields at once, and that is one parent again.
    const moved = await http()
      .patch(`/contacts/${row.id}`)
      .set(testIdentityHeader, as('lena'))
      .send({ shelfId: null, letterId: letter })
      .expect(200)

    expect(moved.body).toMatchObject({ shelfId: null, letterId: letter })

    // Emptying the one parent there is leaves it on neither.
    expect(await refusal('patch', `/contacts/${row.id}`, { letterId: null }, 400)).toBe(
      probeContactRules.parentText.none,
    )
    expect((await list())[0]).toMatchObject({ shelfId: null, letterId: letter })
  })

  it('refuse a change that changes nothing', async () => {
    const row = await made({ shelfId: shelf, familyName: 'Dahl' })

    expect(await refusal('patch', `/contacts/${row.id}`, {}, 400)).toBe(
      'Die Anfrage enthält keine Änderung.',
    )
    expect(await refusal('patch', `/contacts/${row.id}`, { tenantId: south.id }, 400)).toBe(
      'Die Anfrage enthält keine Änderung.',
    )
  })

  it('ask for the right of what a contact hangs on, beyond the right of the route', async () => {
    const lacks = probeAuthorization.missingPermission('letters.write' as never)
    const ofLetter = await made({ letterId: letter, familyName: 'Ehlers' })
    const ofShelf = await made({ shelfId: shelf, familyName: 'Friese' })

    // Kai keeps shelves and writes no letters.
    expect(
      await refusal('post', '/contacts', { letterId: letter, familyName: 'Gerdes' }, 403, 'kai'),
    ).toBe(lacks)
    expect(
      await refusal('patch', `/contacts/${ofLetter.id}`, { role: 'Empfang' }, 403, 'kai'),
    ).toBe(lacks)
    expect(await refusal('delete', `/contacts/${ofLetter.id}`, undefined, 403, 'kai')).toBe(lacks)
    // Handing a contact of a shelf over to a letter is keeping the people of a letter as well.
    expect(
      await refusal(
        'patch',
        `/contacts/${ofShelf.id}`,
        { shelfId: null, letterId: letter },
        403,
        'kai',
      ),
    ).toBe(lacks)

    // The people of a shelf are his.
    await http()
      .patch(`/contacts/${ofShelf.id}`)
      .set(testIdentityHeader, as('kai'))
      .send({ role: 'Empfang' })
      .expect(200)
    await made({ shelfId: shelf, familyName: 'Gerdes' }, 'kai')

    // Nothing of the letter's contact was touched.
    const kept = (await list()).find((row) => row.id === ofLetter.id)

    expect(kept).toMatchObject({ role: null, letterId: letter, deletedAt: null })
  })

  it('are for whoever holds the right of each route', async () => {
    const row = await made({ shelfId: shelf, familyName: 'Hansen' })

    // Gero reads.
    expect((await list('gero')).map((entry) => entry.familyName)).toEqual(['Hansen'])
    await refusal('post', '/contacts', { shelfId: shelf, familyName: 'Iversen' }, 403, 'gero')

    // Mia adds and corrects nothing.
    await made({ shelfId: shelf, familyName: 'Iversen' }, 'mia')
    await refusal('patch', `/contacts/${row.id}`, { role: 'Empfang' }, 403, 'mia')
    await refusal('delete', `/contacts/${row.id}`, undefined, 403, 'mia')

    // Nobody without a session reads anything.
    await http().get('/contacts').expect(401)
  })

  it('are shown to the application before they are written, which may refuse and may add what it works out', async () => {
    expect(
      await refusal('post', '/contacts', { shelfId: closedShelf, familyName: 'Jacobs' }, 422),
    ).toBe(shelfClosed)
    expect(
      await refusal('post', '/contacts', { shelfId: southShelf, familyName: 'Jacobs' }, 422),
    ).toBe(shelfGone)
    expect(await list()).toEqual([])

    // What the application works out from the shelf is written with the row.
    const row = await made({ shelfId: shelf, familyName: 'Jacobs' })

    expect(row.filedUnder).toBe('Wareneingang')

    // A change that leaves the parent alone names none, and what was worked out stays.
    placed = []

    const corrected = await http()
      .patch(`/contacts/${row.id}`)
      .set(testIdentityHeader, as('lena'))
      .send({ role: 'Empfang' })
      .expect(200)

    expect(placed).toEqual([{ parents: {}, creating: false }])
    expect(corrected.body).toMatchObject({ filedUnder: 'Wareneingang', role: 'Empfang' })

    // Moved to a closed shelf: refused, and the row stays as it was.
    expect(await refusal('patch', `/contacts/${row.id}`, { shelfId: closedShelf }, 422)).toBe(
      shelfClosed,
    )

    // Moved to a letter: the application takes the label away again.
    const moved = await http()
      .patch(`/contacts/${row.id}`)
      .set(testIdentityHeader, as('lena'))
      .send({ shelfId: null, letterId: letter })
      .expect(200)

    expect(moved.body).toMatchObject({ shelfId: null, letterId: letter, filedUnder: null })
  })

  it('take no column the application works out from a request', async () => {
    const row = await made({ shelfId: shelf, familyName: 'Karstens', filedUnder: 'Tresor' })
    // At a letter the application works out nothing, and the request still sets nothing.
    const ofLetter = await made({ letterId: letter, familyName: 'Lund', filedUnder: 'Tresor' })

    expect(row.filedUnder).toBe('Wareneingang')
    expect(ofLetter.filedUnder).toBeNull()

    // Alone it is a change that changes nothing, beside another field it is left out.
    await refusal('patch', `/contacts/${row.id}`, { filedUnder: 'Tresor' }, 400)

    const changed = await http()
      .patch(`/contacts/${ofLetter.id}`)
      .set(testIdentityHeader, as('lena'))
      .send({ role: 'Empfang', filedUnder: 'Tresor', tenantId: south.id, version: 40 })
      .expect(200)

    expect(changed.body).toMatchObject({ role: 'Empfang', filedUnder: null, version: 2 })
    expect((await list()).map((entry) => entry.filedUnder).sort()).toEqual(['Wareneingang', null])
    expect(await list('sven')).toEqual([])
  })

  it('are judged as they stand once an earlier change is through, not as they stood when the request came', async () => {
    const row = await made({ shelfId: shelf, familyName: 'Mommsen' })
    const other = await aShelf(north.id, 'Versand')

    // Somebody holds the row, the way a change that is still under way does.
    const holder = await admin.connect()

    await holder.query('begin')
    await holder.query('select 1 from contacts where id = $1 for update', [row.id])

    // Two changes that each fit the contact as it stands now and do not fit
    // together: handed over to the letter, and moved to another shelf. One
    // after the other, so that they come to the row in this order.
    const toLetter = http()
      .patch(`/contacts/${row.id}`)
      .set(testIdentityHeader, as('lena'))
      .send({ shelfId: null, letterId: letter })
      .then((answer) => answer)

    await standingInLine(admin, 1)

    const toShelf = http()
      .patch(`/contacts/${row.id}`)
      .set(testIdentityHeader, as('lena'))
      .send({ shelfId: other })
      .then((answer) => answer)

    await standingInLine(admin, 2)
    await holder.query('commit')
    holder.release()

    const [first, second] = await Promise.all([toLetter, toShelf])

    // The second is judged by what the first left: on the letter, and a shelf
    // on top of that would be both. Not held, both would be judged by the
    // contact on its shelf, and the check in the database would answer the
    // second with a sentence about nothing.
    expect(first.status).toBe(200)
    expect(second.status).toBe(400)
    expect((second.body as { message: string }).message).toBe(probeContactRules.parentText.several)
    expect((await list())[0]).toMatchObject({ shelfId: null, letterId: letter })
  })

  it('of another tenant are not found, the same as ones that do not exist or whose id is none', async () => {
    const row = await made({ shelfId: shelf, familyName: 'Lorenzen' })

    expect(await refusal('patch', `/contacts/${row.id}`, { role: 'Übernommen' }, 404, 'sven')).toBe(
      missing,
    )
    expect(await refusal('delete', `/contacts/${row.id}`, undefined, 404, 'sven')).toBe(missing)
    expect(
      await refusal('patch', `/contacts/${newId<'contact'>()}`, { role: 'Niemand' }, 404),
    ).toBe(missing)
    expect(await refusal('patch', '/contacts/keine-kennung', { role: 'Niemand' }, 404)).toBe(
      missing,
    )
    expect(await refusal('delete', '/contacts/keine-kennung', undefined, 404)).toBe(missing)
    expect((await list())[0]).toMatchObject({ role: null, deletedAt: null })
  })

  it('are taken away by marking them deleted, which a device then hears about', async () => {
    const row = await made({ shelfId: shelf, familyName: 'Matthiesen' })

    const removed = await http()
      .delete(`/contacts/${row.id}`)
      .set(testIdentityHeader, as('lena'))
      .expect(200)

    expect((removed.body as ContactAnswer).deletedAt).not.toBeNull()
    expect(await refusal('delete', `/contacts/${row.id}`, undefined, 404)).toBe(missing)
    expect(await refusal('patch', `/contacts/${row.id}`, { role: 'Empfang' }, 404)).toBe(missing)
    expect(await list()).toEqual([])

    const kept = await admin.query<{ deleted_at: Date | null; version: number; later: boolean }>(
      'select deleted_at, version, change_sequence > $2 as later from contacts where id = $1',
      [row.id, row.changeSequence],
    )

    // The row stays, with a later place in the stream of changes.
    expect(kept.rows[0]?.deleted_at).toBeInstanceOf(Date)
    expect(kept.rows[0]).toMatchObject({ version: 2, later: true })
  })

  it('are written into the change log and stamped for the sync, like every record that travels', async () => {
    const row = await made({ shelfId: shelf, familyName: 'Nissen' })

    expect(row.version).toBe(1)
    expect(row.changeSequence).toBeGreaterThan(0)

    const logged = await admin.query<{ field: string }>(
      `select field from audit_entries where table_name = 'contacts' and record_id = $1`,
      [row.id],
    )

    expect(logged.rows.map((entry) => entry.field)).toEqual(
      expect.arrayContaining(['family_name', 'shelf_id', 'filed_under']),
    )
  })

  it('cannot be removed for good by the application, only marked', async () => {
    const row = await made({ shelfId: shelf, familyName: 'Otten' })

    await expect(
      database.forTenant({ tenantId: north.id, reason: 'tidy' }, (tx) =>
        tx.delete(probeContacts).where(eq(probeContacts.id, row.id as never)),
      ),
    ).rejects.toMatchObject({ cause: { code: '42501' } })
    expect(await list()).toHaveLength(1)
  })

  it('are held to one record by the check of the application as well, for every other way in', async () => {
    const written = (shelfId: string | null, letterId: string | null) =>
      admin.query(
        `insert into contacts (id, tenant_id, family_name, shelf_id, letter_id)
         values ($1, $2, 'Petersen', $3, $4)`,
        [newId<'contact'>(), north.id, shelfId, letterId],
      )

    // What the routes refuse with a sentence, the database refuses for whoever
    // comes another way: the keys and the check an application gives its
    // contacts are part of the table it gets.
    expect(await refusedBy(written(shelf, letter))).toEqual({
      code: checkViolation,
      constraint: 'contacts_on_one_record',
    })
    expect(await refusedBy(written(null, null))).toEqual({
      code: checkViolation,
      constraint: 'contacts_on_one_record',
    })
    // The key runs over the tenant, so the shelf of another tenant is no shelf.
    expect(await refusedBy(written(southShelf, null))).toEqual({
      code: foreignKeyViolation,
      constraint: 'contacts_shelf',
    })

    await written(shelf, null)
    expect((await list()).map((row) => row.familyName)).toEqual(['Petersen'])
  })
})

describe('the parts of the routes of the contacts', () => {
  it('refuse a catalogue that lacks one of their rights, the right of a parent included', () => {
    const without = (right: ProbeSyncRight) => ({
      catalogue: rightsCatalogue(probeSyncCatalogue.rights.filter((held) => held !== right)),
    })

    for (const right of [
      'members.read',
      'notes.write',
      'shelves.write',
      'letters.write',
    ] as const) {
      expect(() => contactParts({ access: without(right) as never, rights, routes })).toThrow(
        `The catalogue lacks a right of the contacts: ${right}`,
      )
    }

    expect(() => contactParts({ access: probeSyncAccess, rights, routes })).not.toThrow()
  })

  it('refuse rules that name a parent the table has no column for', () => {
    const rules = contactRules({
      parents: ['shelfId', 'drawerId'],
      parentText: probeContactRules.parentText,
    })

    expect(() =>
      contactParts({
        access: probeSyncAccess,
        rights,
        routes: { table: probeContacts, rules },
      }),
    ).toThrow('The contacts have no column for what a contact hangs on: drawerId')
  })
})
