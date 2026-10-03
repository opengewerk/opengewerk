import 'reflect-metadata'

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { INestApplication } from '@nestjs/common'
import { APP_FILTER, APP_GUARD } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import type { MemberIdentity, TenantId } from '@opengewerk/platform-domain'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { AUTHORIZATION, AuthorizationGuard } from '../api/authorization.js'
import { databaseErrors } from '../api/database-errors.js'
import { TRUSTED_ORIGINS } from '../api/handed-in.js'
import { IDENTITY_SOURCE } from '../api/identity.js'
import { SameOriginGuard } from '../api/origin.js'
import { headerIdentities, testIdentityHeader } from '../api/test-identity.js'
import {
  probeAccess,
  probeAuthorization,
  type ProbeFoundation,
  probeFoundation,
  type ProbeRight,
} from '../authentication/probe-application.js'
import { Database } from '../database/database.js'
import { newId } from '../database/identifier.js'
import { backupStatusParts } from './controller.js'

/**
 * `GET /settings/backup` (#130, #23), for an application that is nobody's:
 * the probe application, whose people see the last backup with the right to
 * read its members. What the answer says is tested beside `backupStatus`;
 * this is the route: who may ask, that the day the tenant was set up is read
 * from inside the tenant, and that the hour is the one of the instance.
 */

const old = { id: newId<'tenant'>() as TenantId, name: 'Mandant seit einer Woche' }
const fresh = { id: newId<'tenant'>() as TenantId, name: 'Mandant seit heute' }

let foundation: ProbeFoundation
let admin: Pool
let database: Database
let records: string
let app: INestApplication

function asked(tenantId: TenantId, rights: readonly ProbeRight[]) {
  const identity: MemberIdentity<ProbeRight> = {
    userId: 'lea',
    tenantId,
    roles: [],
    rights: [...rights],
  }

  return request(app.getHttpServer())
    .get('/settings/backup')
    .set(testIdentityHeader, JSON.stringify(identity))
}

async function moduleWith(directory: string | null): Promise<INestApplication> {
  const parts = backupStatusParts({ access: probeAccess, read: 'members.read', directory })
  const built = await Test.createTestingModule({
    controllers: parts.controllers,
    providers: [
      { provide: Database, useValue: database },
      ...parts.providers,
      { provide: IDENTITY_SOURCE, useValue: headerIdentities<MemberIdentity<ProbeRight>>() },
      { provide: AUTHORIZATION, useValue: probeAuthorization },
      { provide: TRUSTED_ORIGINS, useValue: [] },
      { provide: APP_GUARD, useClass: SameOriginGuard },
      { provide: APP_GUARD, useClass: AuthorizationGuard },
      { provide: APP_FILTER, useClass: databaseErrors().DatabaseExceptionFilter },
    ],
  }).compile()
  const application = built.createNestApplication()

  await application.init()

  return application
}

beforeAll(async () => {
  foundation = await probeFoundation()
  admin = await foundation.kit.connect()
  await foundation.empty(admin)
  await foundation.tenants(admin, [old, fresh])
  // A tenant of a week, so that a missing backup counts for it.
  await admin.query("update tenants set created_at = now() - interval '7 days' where id = $1", [
    old.id,
  ])
  database = Database.connect(foundation.kit.applicationDatabaseUrl())
  records = mkdtempSync(join(tmpdir(), 'backup-route-'))
  app = await moduleWith(records)
}, 60_000)

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
  foundation.remove()
  rmSync(records, { recursive: true, force: true })
})

describe('the route of the last backup', () => {
  it('is refused to an application whose catalogue lacks the right it names', () => {
    expect(() =>
      backupStatusParts({
        access: probeAccess,
        read: 'letters.read' as ProbeRight,
        directory: null,
      }),
    ).toThrow('The catalogue lacks the right to see the last backup: letters.read')
  })

  it('is refused to whoever lacks that right', async () => {
    await asked(old.id, ['notes.write']).expect(403)
  })
})

describe('the last backup', () => {
  it('warns a tenant of a week that has none, and not a tenant of today', async () => {
    expect((await asked(old.id, ['members.read']).expect(200)).body).toEqual({
      state: 'none',
      overdue: true,
      time: '02:30',
    })
    expect((await asked(fresh.id, ['members.read']).expect(200)).body).toEqual({
      state: 'none',
      overdue: false,
      time: '02:30',
    })
  })

  it('names the last one once a backup has recorded it, at the hour of the instance', async () => {
    const finished = new Date(Date.now() - 3 * 60 * 60 * 1000)

    writeFileSync(
      join(records, 'last.json'),
      JSON.stringify({
        finished: finished.toISOString(),
        archive: 'probe-2026-09-23T003112Z.tar.gz',
        bytes: 2048,
        encrypted: true,
      }),
    )
    await admin.query("update instance_settings set backup_time = '03:15'")

    try {
      expect((await asked(old.id, ['members.read']).expect(200)).body).toEqual({
        state: 'recorded',
        finishedAt: finished.toISOString(),
        archive: 'probe-2026-09-23T003112Z.tar.gz',
        bytes: 2048,
        encrypted: true,
        overdue: false,
        time: '03:15',
      })
    } finally {
      await admin.query("update instance_settings set backup_time = '02:30'")
      rmSync(join(records, 'last.json'))
    }
  })

  it('is unknown where the instance knows no record of its backups', async () => {
    const without = await moduleWith(null)

    try {
      expect(
        (
          await request(without.getHttpServer())
            .get('/settings/backup')
            .set(
              testIdentityHeader,
              JSON.stringify({
                userId: 'lea',
                tenantId: old.id,
                roles: [],
                rights: ['members.read'],
              } satisfies MemberIdentity<ProbeRight>),
            )
            .expect(200)
        ).body,
      ).toEqual({ state: 'unknown' })
    } finally {
      await without.close()
    }
  })
})
