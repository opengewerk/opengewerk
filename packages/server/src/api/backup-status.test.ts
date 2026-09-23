import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
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
 * `GET /settings/backup`, for the screen "Sicherung" and the warning at the
 * top of the office (#130). What the answer says is tested next to
 * `backupStatus`; this is the route: who may ask, and that the day the
 * business was set up is read from inside it.
 */

const north = { id: newId<'tenant'>(), name: 'Elektro Nord GmbH' }

let admin: Pool
let database: Database
let app: INestApplication
let records: string

function http() {
  return request(app.getHttpServer())
}

beforeAll(async () => {
  admin = await connect()
  await resetSchema(admin)
  await applyMigrations()
  await allowApplicationLogin(admin)
  // A business of a week, so that a missing backup counts.
  await admin.query(
    "insert into tenants (id, name, created_at) values ($1, $2, now() - interval '7 days')",
    [north.id, north.name],
  )

  records = mkdtempSync(join(tmpdir(), 'opengewerk-backup-route-'))
  database = Database.connect(applicationDatabaseUrl())

  const built = await Test.createTestingModule({
    imports: [ApiModule.create(database, identities, { backupStatus: records })],
  }).compile()

  app = built.createNestApplication()
  await app.init()
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
  rmSync(records, { recursive: true, force: true })
})

describe('the last backup', () => {
  it('warns the office when a business of a week has none', async () => {
    const answer = await http()
      .get('/settings/backup')
      .set('x-test-identity', as(north.id, 'office'))
      .expect(200)

    expect(answer.body).toEqual({ state: 'none', overdue: true })
  })

  it('names the last one to the owner once a backup has recorded it', async () => {
    const finished = new Date(Date.now() - 3 * 60 * 60 * 1000)

    writeFileSync(
      join(records, 'last.json'),
      JSON.stringify({
        finished: finished.toISOString(),
        finishedEpoch: Math.floor(finished.getTime() / 1000),
        archive: 'opengewerk-2026-09-23T003112Z.tar.gz',
        bytes: 2048,
        encrypted: false,
        storageFiles: 3,
        auditChains: 1,
      }),
    )

    const answer = await http()
      .get('/settings/backup')
      .set('x-test-identity', as(north.id, 'owner'))
      .expect(200)

    expect(answer.body).toEqual({
      state: 'recorded',
      finishedAt: finished.toISOString(),
      archive: 'opengewerk-2026-09-23T003112Z.tar.gz',
      bytes: 2048,
      encrypted: false,
      overdue: false,
    })
  })

  it('is not for a technician, who reads no settings', async () => {
    await http()
      .get('/settings/backup')
      .set('x-test-identity', as(north.id, 'technician'))
      .expect(403)
  })
})
