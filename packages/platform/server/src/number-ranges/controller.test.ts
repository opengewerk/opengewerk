import 'reflect-metadata'

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
import { numberRangeStore } from '../database/number-ranges.js'
import { probeNumberRanges } from '../database/probe-schema.js'
import { numberRangeParts } from './controller.js'

/**
 * `GET` and `PUT /settings/number-ranges` (opengewerk-haustechnik#127), for
 * an application that is nobody's: the probe application numbers the parcels
 * it takes in and the visits it receives. Its people read the sequences with
 * the right to read its members and change them with the right to write
 * notes. How a number is drawn and what a pattern may be is tested beside the
 * store; this is the route: who may ask, which key exists, and that what the
 * store refuses comes back as a sentence and changes nothing.
 */

const tenant = { id: newId<'tenant'>() as TenantId, name: 'Mandant mit Paketen' }

const store = numberRangeStore(probeNumberRanges, {
  keys: ['parcel', 'visit'],
  defaultPatterns: { parcel: 'PK-{number:5}', visit: 'B{number}' },
  yearOf: () => 2037,
})

let foundation: ProbeFoundation
let admin: Pool
let database: Database
let app: INestApplication

function as(rights: readonly ProbeRight[]): string {
  const identity: MemberIdentity<ProbeRight> = {
    userId: 'lea',
    tenantId: tenant.id,
    roles: [],
    rights: [...rights],
  }

  return JSON.stringify(identity)
}

function listed(rights: readonly ProbeRight[]) {
  return request(app.getHttpServer())
    .get('/settings/number-ranges')
    .set(testIdentityHeader, as(rights))
}

function changed(key: string, body: unknown, rights: readonly ProbeRight[] = ['notes.write']) {
  return request(app.getHttpServer())
    .put(`/settings/number-ranges/${key}`)
    .set(testIdentityHeader, as(rights))
    .send(body as object)
}

beforeAll(async () => {
  foundation = await probeFoundation()
  admin = await foundation.kit.connect()
  await foundation.empty()
  await foundation.tenants(admin, [tenant])
  database = Database.connect(foundation.kit.applicationDatabaseUrl())

  const parts = numberRangeParts({
    access: probeAccess,
    read: 'members.read',
    write: 'notes.write',
    keys: ['parcel', 'visit'],
    store,
  })
  const built = await Test.createTestingModule({
    controllers: parts.controllers,
    providers: [
      { provide: Database, useValue: database },
      { provide: IDENTITY_SOURCE, useValue: headerIdentities<MemberIdentity<ProbeRight>>() },
      { provide: AUTHORIZATION, useValue: probeAuthorization },
      { provide: TRUSTED_ORIGINS, useValue: [] },
      { provide: APP_GUARD, useClass: SameOriginGuard },
      { provide: APP_GUARD, useClass: AuthorizationGuard },
      { provide: APP_FILTER, useClass: databaseErrors().DatabaseExceptionFilter },
    ],
  }).compile()

  app = built.createNestApplication()
  await app.init()
}, 60_000)

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
  foundation.remove()
})

describe('the routes of the number ranges', () => {
  it('are refused to an application whose catalogue lacks a right they name', () => {
    expect(() =>
      numberRangeParts({
        access: probeAccess,
        read: 'members.read',
        write: 'letters.write' as ProbeRight,
        keys: ['parcel', 'visit'],
        store,
      }),
    ).toThrow('The catalogue lacks a right of the number ranges: letters.write')
  })

  it('show the sequences to whoever reads them, and to nobody else', async () => {
    expect((await listed(['members.read']).expect(200)).body).toEqual([
      { key: 'parcel', pattern: 'PK-{number:5}', nextValue: 1, next: 'PK-00001' },
      { key: 'visit', pattern: 'B{number}', nextValue: 1, next: 'B1' },
    ])
    await listed(['notes.write']).expect(403)
  })

  it('change a pattern and raise a counter for whoever writes them, and for nobody who only reads', async () => {
    await changed('parcel', { pattern: 'PK-X' }, ['members.read']).expect(403)

    expect(
      (await changed('parcel', { pattern: ' P-{number:3} ', nextValue: 40 }).expect(200)).body,
    ).toEqual({ key: 'parcel', pattern: 'P-{number:3}', nextValue: 40, next: 'P-040' })
  })

  it('know no other sequence, and say why a change is refused without making it', async () => {
    await changed('letter', { pattern: 'L{number}' }).expect(404)

    expect((await changed('parcel', {}).expect(400)).body.message).toBe('Das Muster fehlt.')
    expect(
      (await changed('parcel', { pattern: 'P{number}', nextValue: '41' }).expect(400)).body.message,
    ).toBe('Die nächste Nummer ist eine Zahl.')
    // The counter only goes up: a number below it may be on something already.
    expect(
      (await changed('parcel', { pattern: 'P-{number:3}', nextValue: 7 }).expect(400)).body.message,
    ).toEqual(expect.any(String))
    expect((await listed(['members.read']).expect(200)).body[0]).toEqual({
      key: 'parcel',
      pattern: 'P-{number:3}',
      nextValue: 40,
      next: 'P-040',
    })
  })
})
