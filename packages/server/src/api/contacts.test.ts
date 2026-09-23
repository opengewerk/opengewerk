import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { contactParentText } from '@opengewerk/domain'
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
import { as, testIdentities as identities } from './test-identity.js'

/**
 * The people to talk to at a customer or a site (#121). Created on the
 * screens through the outbox, corrected and removed here, with a connection,
 * the way master data is. The rights are the customer's.
 */

const north = { id: newId<'tenant'>(), name: 'Elektro Nord GmbH' }
const south = { id: newId<'tenant'>(), name: 'Elektro Süd GmbH' }

let admin: Pool
let database: Database
let app: INestApplication

const office = () => as(north.id, 'office')
const technician = () => as(north.id, 'technician')
const neighbour = () => as(south.id, 'office')

let customerId: string
let siteId: string
let foreignCustomerId: string

interface ContactRow {
  readonly id: string
  readonly customerId: string | null
  readonly siteId: string | null
  readonly givenName: string | null
  readonly familyName: string
  readonly role: string | null
}

function http() {
  return request(app.getHttpServer())
}

async function made(path: string, body: Record<string, unknown>, identity = office()) {
  const answer = await http().post(path).set('x-test-identity', identity).send(body).expect(201)

  return (answer.body as { id: string }).id
}

async function contact(body: Record<string, unknown>, identity = office()) {
  const answer = await http()
    .post('/contacts')
    .set('x-test-identity', identity)
    .send(body)
    .expect(201)

  return answer.body as ContactRow
}

async function list(identity = office()) {
  const answer = await http().get('/contacts').set('x-test-identity', identity).expect(200)

  return answer.body as ContactRow[]
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

  database = Database.connect(applicationDatabaseUrl())

  const built = await Test.createTestingModule({
    imports: [ApiModule.create(database, identities)],
  }).compile()

  app = built.createNestApplication()
  await app.init()

  customerId = await made('/customers', { kind: 'property_management', name: 'Nordblick' })
  siteId = await made('/sites', { customerId, designation: 'Elbchaussee 140' })
  foreignCustomerId = await made('/customers', { kind: 'private', name: 'Süd' }, neighbour())
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
})

describe('contacts', () => {
  it('hang on a customer or on a site, and only the own business sees them', async () => {
    const manager = await contact({ customerId, familyName: 'Brandt', role: 'Bauleitung' })
    const caretaker = await contact({ siteId, givenName: 'Ole', familyName: 'Jensen' })
    await contact({ customerId: foreignCustomerId, familyName: 'Nachbar' }, neighbour())

    expect(manager).toMatchObject({ customerId, siteId: null, role: 'Bauleitung' })
    expect(caretaker).toMatchObject({ customerId: null, siteId, givenName: 'Ole' })

    const names = (await list()).map((row) => row.familyName)

    expect(names).toEqual(expect.arrayContaining(['Brandt', 'Jensen']))
    expect(names).not.toContain('Nachbar')
  })

  it('are refused on both a customer and a site, or on neither, with the sentence of the rule', async () => {
    const both = await http()
      .post('/contacts')
      .set('x-test-identity', office())
      .send({ customerId, siteId, familyName: 'Doppelt' })
      .expect(400)
    const neither = await http()
      .post('/contacts')
      .set('x-test-identity', office())
      .send({ familyName: 'Niemand' })
      .expect(400)

    expect((both.body as { message: string }).message).toBe(contactParentText.both)
    expect((neither.body as { message: string }).message).toBe(contactParentText.none)
  })

  it('are refused with a customer of another business, naming the field', async () => {
    const answer = await http()
      .post('/contacts')
      .set('x-test-identity', office())
      .send({ customerId: foreignCustomerId, familyName: 'Fremd' })
      .expect(422)

    expect((answer.body as { message: string }).message).toContain('customerId')
  })

  it('need a family name, on the way in and when changed', async () => {
    await http()
      .post('/contacts')
      .set('x-test-identity', office())
      .send({ customerId, givenName: 'Nur Vorname' })
      .expect(400)

    const row = await contact({ customerId, familyName: 'Albers' })

    await http()
      .patch(`/contacts/${row.id}`)
      .set('x-test-identity', office())
      .send({ familyName: '  ' })
      .expect(400)
    await http()
      .patch(`/contacts/${row.id}`)
      .set('x-test-identity', office())
      .send({ familyName: null })
      .expect(400)
  })

  it('are changed, with the parent judged as it would stand afterwards', async () => {
    const row = await contact({ customerId, familyName: 'Clausen' })

    const changed = await http()
      .patch(`/contacts/${row.id}`)
      .set('x-test-identity', office())
      .send({ role: 'Buchhaltung', phone: '040 123 45' })
      .expect(200)

    expect(changed.body).toMatchObject({ role: 'Buchhaltung', phone: '040 123 45' })

    // A site on top of the customer would be both.
    const both = await http()
      .patch(`/contacts/${row.id}`)
      .set('x-test-identity', office())
      .send({ siteId })
      .expect(400)

    expect((both.body as { message: string }).message).toBe(contactParentText.both)

    // Moving over takes both fields at once, and that is one parent again.
    const moved = await http()
      .patch(`/contacts/${row.id}`)
      .set('x-test-identity', office())
      .send({ customerId: null, siteId })
      .expect(200)

    expect(moved.body).toMatchObject({ customerId: null, siteId })

    // Emptying the one parent there is leaves it on neither.
    const orphaned = await http()
      .patch(`/contacts/${row.id}`)
      .set('x-test-identity', office())
      .send({ siteId: null })
      .expect(400)

    expect((orphaned.body as { message: string }).message).toBe(contactParentText.none)
  })

  it('of another business are not found, the same as ones that do not exist', async () => {
    const row = await contact({ customerId, familyName: 'Dahl' })

    await http()
      .patch(`/contacts/${row.id}`)
      .set('x-test-identity', neighbour())
      .send({ role: 'Übernommen' })
      .expect(404)
    await http().delete(`/contacts/${row.id}`).set('x-test-identity', neighbour()).expect(404)
    await http()
      .patch(`/contacts/${newId<'contact'>()}`)
      .set('x-test-identity', office())
      .send({ role: 'Niemand' })
      .expect(404)
  })

  it('are removed by marking them deleted, which a device then hears about', async () => {
    const row = await contact({ customerId, familyName: 'Ehlers' })

    await http().delete(`/contacts/${row.id}`).set('x-test-identity', office()).expect(200)
    await http().delete(`/contacts/${row.id}`).set('x-test-identity', office()).expect(404)

    expect((await list()).map((entry) => entry.id)).not.toContain(row.id)

    const kept = await admin.query<{ deleted_at: Date | null }>(
      'select deleted_at from contacts where id = $1',
      [row.id],
    )

    expect(kept.rows[0]?.deleted_at).toBeInstanceOf(Date)
  })

  it('are created by a technician on site, and corrected only by whoever may correct the customer', async () => {
    const row = await contact({ siteId, familyName: 'Friese', role: 'Mieter' }, technician())

    await http()
      .patch(`/contacts/${row.id}`)
      .set('x-test-identity', technician())
      .send({ role: 'Hausmeister' })
      .expect(403)
    await http().delete(`/contacts/${row.id}`).set('x-test-identity', technician()).expect(403)
  })
})
