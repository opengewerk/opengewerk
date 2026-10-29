import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { Database, newId, WriteLimits } from '@opengewerk/platform-server'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { applicationDatabaseUrl, connect, resetToMigrated } from '../database/test-database.js'
import { ApiModule } from './api.module.js'
import { as, testIdentities as identities } from './test-identity.js'

/**
 * The budget of writing at the routes of the application (B5 of the security
 * audit): every request that changes something with a JSON body counts for
 * its account, whichever route it goes to. With a budget of three requests an
 * hour, so that the test does not have to send a hundred megabytes.
 */

const north = { id: newId<'tenant'>(), name: 'Elektro Nord GmbH' }

let admin: Pool
let database: Database
let app: INestApplication

beforeAll(async () => {
  admin = await connect()
  await resetToMigrated()
  await admin.query('insert into tenants (id, name) values ($1, $2)', [north.id, north.name])

  database = Database.connect(applicationDatabaseUrl())

  const built = await Test.createTestingModule({
    imports: [
      ApiModule.create(database, identities, {
        writeLimits: new WriteLimits({ accountBytesPerHour: 3000, leastCountedBytes: 1000 }),
      }),
    ],
  }).compile()

  app = built.createNestApplication()
  await app.init()
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
})

describe('the budget of writing', () => {
  it('counts what an account changes at any route, refuses what is over, and lets it read', async () => {
    const office = as(north.id, 'office')
    const customer = (name: string) =>
      request(app.getHttpServer())
        .post('/customers')
        .set('x-test-identity', office)
        .send({ kind: 'private', name })

    await customer('Familie Berg').expect(201)
    await customer('Familie Tal').expect(201)
    await request(app.getHttpServer())
      .post('/customers/tags')
      .set('x-test-identity', office)
      .send({ name: 'Wartung' })
      .expect(201)

    const refused = await customer('Familie Weg').expect(429)

    expect(String((refused.body as { message: string }).message)).toMatch(
      /in spätestens einer Stunde speichern/,
    )

    await request(app.getHttpServer()).get('/customers').set('x-test-identity', office).expect(200)

    const { rows } = await admin.query<{ name: string }>('select name from customers order by name')

    expect(rows.map((row) => row.name)).toEqual(['Familie Berg', 'Familie Tal'])
  })
})
