import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { Database } from '../database/database.js'
import {
  allowApplicationLogin,
  applicationDatabaseUrl,
  applyMigrations,
  connect,
  resetSchema,
} from '../database/test-database.js'
import { ApiModule } from './api.module.js'
import { ClosedIdentitySource } from './closed-identity.js'

/**
 * The health check and the identity source an instance runs with before the
 * authentication exists, tested together because that is the pair the
 * container runtime meets: one route that answers without credentials, and
 * nothing else that answers at all.
 */

let database: Database
let app: INestApplication

beforeAll(async () => {
  const admin = await connect()
  await resetSchema(admin)
  await applyMigrations()
  await allowApplicationLogin(admin)
  await admin.end()

  database = Database.connect(applicationDatabaseUrl())

  const built = await Test.createTestingModule({
    imports: [ApiModule.create(database, new ClosedIdentitySource())],
  }).compile()

  app = built.createNestApplication()
  await app.init()
})

afterAll(async () => {
  await app?.close()
  await database?.close()
})

describe('the health check', () => {
  it('answers without any credentials', async () => {
    const response = await request(app.getHttpServer()).get('/health').expect(200)

    expect(response.body).toEqual({ status: 'bereit', database: true, version: null })
  })

  it('names the version the installation runs, for the foot of the sign in (#259)', async () => {
    const built = await Test.createTestingModule({
      imports: [ApiModule.create(database, new ClosedIdentitySource(), { version: '0.2.0' })],
    }).compile()
    const released = built.createNestApplication()

    await released.init()

    try {
      const response = await request(released.getHttpServer()).get('/health').expect(200)

      expect(response.body).toEqual({ status: 'bereit', database: true, version: '0.2.0' })
    } finally {
      await released.close()
    }
  })

  it('reports the database as unreachable instead of claiming to be fine', async () => {
    const unreachable = Database.connect('postgres://nobody:nobody@127.0.0.1:1/opengewerk')

    try {
      const built = await Test.createTestingModule({
        imports: [ApiModule.create(unreachable, new ClosedIdentitySource())],
      }).compile()

      const broken = built.createNestApplication()
      await broken.init()

      // 503 and not 200, because a server whose database is gone accepts
      // connections and fails every request. Reporting that as healthy would
      // turn a loud outage into a quiet one.
      const response = await request(broken.getHttpServer()).get('/health').expect(503)

      expect(response.body).toEqual({ status: 'gestört', database: false, version: null })

      await broken.close()
    } finally {
      await unreachable.close()
    }
  })
})

describe('an instance without authentication', () => {
  it('refuses every route that touches data', async () => {
    await request(app.getHttpServer()).get('/customers').expect(401)
    await request(app.getHttpServer())
      .post('/customers')
      .send({ name: 'Wer auch immer' })
      .expect(401)
  })

  /**
   * The point of the closed source, stated as a test: it refuses everybody,
   * not just requests that bring nothing. A stand in that let a header decide
   * would pass the test above and fail this one.
   */
  it('refuses a request that brings an identity along', async () => {
    await request(app.getHttpServer())
      .get('/customers')
      .set('x-test-identity', JSON.stringify({ userId: 'wer', tenantId: 'egal', roles: ['owner'] }))
      .set('authorization', 'Bearer irgendwas')
      .expect(401)
  })
})
