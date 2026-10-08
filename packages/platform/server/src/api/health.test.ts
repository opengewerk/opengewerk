import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { probeFoundation, ProbeModule } from '../authentication/probe-application.js'
import { Database } from '../database/database.js'
import { ClosedIdentitySource } from './closed-identity.js'

/**
 * The health check of the foundation, in the module of an application that
 * belongs to nobody, and with the identity source an instance runs with while
 * it is closed: the one route that answers without credentials, and nothing
 * else that answers at all.
 */

let database: Database
let app: INestApplication

async function started(base: Database, version?: string | null): Promise<INestApplication> {
  const built = await Test.createTestingModule({
    imports: [ProbeModule.create(base, new ClosedIdentitySource(), { version })],
  }).compile()
  const running = built.createNestApplication()

  await running.init()

  return running
}

beforeAll(async () => {
  const foundation = await probeFoundation()
  const admin = await foundation.kit.connect()

  await foundation.empty()
  await admin.end()

  database = Database.connect(foundation.kit.applicationDatabaseUrl())
  app = await started(database)
})

afterAll(async () => {
  await app?.close()
  await database?.close()
})

describe('the health check', () => {
  it('answers without any credentials, on a closed instance too', async () => {
    const response = await request(app.getHttpServer()).get('/health').expect(200)

    expect(response.body).toEqual({ status: 'bereit', database: true, version: null })
  })

  it('names the version the installation runs, for the foot of the sign in', async () => {
    const released = await started(database, '0.2.0')

    try {
      const response = await request(released.getHttpServer()).get('/health').expect(200)

      expect(response.body).toEqual({ status: 'bereit', database: true, version: '0.2.0' })
    } finally {
      await released.close()
    }
  })

  it('reports the database as unreachable instead of claiming to be fine', async () => {
    const unreachable = Database.connect('postgres://nobody:nobody@127.0.0.1:1/probe')
    const broken = await started(unreachable)

    try {
      const response = await request(broken.getHttpServer()).get('/health').expect(503)

      expect(response.body).toEqual({ status: 'gestört', database: false, version: null })
    } finally {
      await broken.close()
      await unreachable.close()
    }
  })

  it('is the one route a closed instance answers', async () => {
    // Everything else needs an identity, and the closed source gives none.
    expect((await request(app.getHttpServer()).get('/probe/members')).status).toBe(401)
  })
})
