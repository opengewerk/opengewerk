import 'reflect-metadata'

import { type DynamicModule, type INestApplication, Module } from '@nestjs/common'
import { APP_FILTER, APP_GUARD } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import type { MemberIdentity, TenantId } from '@opengewerk/platform-domain'
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
  probeAccess,
  probeAuthorization,
  type ProbeFoundation,
  probeFoundation,
  type ProbeRight,
} from '../authentication/probe-application.js'
import { Database } from '../database/database.js'
import { newId } from '../database/identifier.js'
import { probePush } from '../database/probe-schema.js'
import { PUSH, type PushContext } from './context.js'
import { pushStore } from './outbox.js'
import { type PushOverview, pushParts } from './push.controller.js'
import { aBrowser, recordingPost, testVapid } from './test-browser.js'

/**
 * The routes of push on one's own devices, on an application that is
 * nobody's: in the probe application a device works at the front desk or in
 * the back office, and a person switches off what they hear about parcels and
 * visits. What they hold: whoever has the right switches push on for
 * themselves and nobody else, a device is only taken with an address on the
 * internet and keys that are keys, and an instance without a key says so.
 */

const north = { id: newId<'tenant'>() as TenantId, name: 'Mandant Nord' }
const south = { id: newId<'tenant'>() as TenantId, name: 'Mandant Süd' }

const people = {
  lena: { tenant: north.id, roles: ['lead'], rights: ['notes.write'] },
  mia: { tenant: north.id, roles: ['member'], rights: ['notes.write'] },
  gero: { tenant: north.id, roles: ['guest'], rights: ['members.read'] },
  sven: { tenant: south.id, roles: ['lead'], rights: ['notes.write'] },
} as const

type Person = keyof typeof people

const vapid = testVapid()
const pushService = recordingPost()
const store = pushStore(probePush)

/** What the probe application says about push, in words of its own. */
const rules = {
  store,
  entries: ['front', 'back'] as ['front', 'back'],
  entryRefused: 'Ein Gerät steht am Empfang ("front") oder im Büro ("back").',
  occasions: {
    parcel_waiting: { label: 'Pakete', about: 'Wenn am Empfang ein Paket für dich wartet.' },
    visit_announced: { label: 'Besuch', about: 'Wenn sich Besuch für dich angemeldet hat.' },
  },
  test: {
    text: { title: 'Probe aus dem Probewerk', body: 'Push kommt an.' },
    urls: { front: '/empfang/konto', back: '/konto' },
  },
}

let foundation: ProbeFoundation
let admin: Pool
let database: Database
let app: INestApplication
/** The same routes on an instance without a key. */
let keyless: INestApplication

function as(person: Person): string {
  const { tenant, roles, rights } = people[person]
  const identity: MemberIdentity<ProbeRight> & { readonly sessionId: string } = {
    userId: person,
    tenantId: tenant,
    roles: [...roles],
    rights: [...rights],
    sessionId: `session-${person}`,
  }

  return JSON.stringify(identity)
}

function http(on: INestApplication = app) {
  return request(on.getHttpServer())
}

async function overview(person: Person): Promise<PushOverview> {
  const answer = await http().get('/push').set(testIdentityHeader, as(person)).expect(200)

  return answer.body as PushOverview
}

function subscription(endpoint = 'https://fcm.googleapis.com/fcm/send/abc:def') {
  const browser = aBrowser()

  return {
    browser,
    body: { endpoint, keys: browser.keys, entry: 'front', label: 'Chrome auf Windows' },
  }
}

async function subscribe(person: Person, body: object) {
  return http().put('/push/subscription').set(testIdentityHeader, as(person)).send(body)
}

/** The module of an application, as far as push goes. */
@Module({})
class ProbePushModule {
  static create(database: Database, push: PushContext | null): DynamicModule {
    const parts = pushParts({ access: probeAccess, rights: { write: 'notes.write' }, rules })

    return {
      module: ProbePushModule,
      controllers: parts.controllers,
      providers: [
        { provide: Database, useValue: database },
        { provide: PUSH, useValue: push },
        ...parts.providers,
        { provide: IDENTITY_SOURCE, useValue: headerIdentities<MemberIdentity<ProbeRight>>() },
        { provide: AUTHORIZATION, useValue: probeAuthorization },
        { provide: TRUSTED_ORIGINS, useValue: [] },
        { provide: APP_GUARD, useClass: SameOriginGuard },
        { provide: APP_GUARD, useClass: AuthorizationGuard },
        { provide: APP_FILTER, useClass: databaseErrors().DatabaseExceptionFilter },
      ],
    }
  }
}

beforeAll(async () => {
  foundation = await probeFoundation()
  admin = await foundation.kit.connect()
  await foundation.empty(admin)
  await foundation.tenants(admin, [north, south])

  for (const [userId, person] of Object.entries(people)) {
    await admin.query('insert into auth_users (id, name, email) values ($1, $1, $2)', [
      userId,
      `${userId}@example.de`,
    ])
    await admin.query('insert into memberships (tenant_id, user_id, roles) values ($1, $2, $3)', [
      person.tenant,
      userId,
      [...person.roles],
    ])
  }

  database = Database.connect(foundation.kit.applicationDatabaseUrl())

  const resolve = (host: string) =>
    Promise.resolve(host.endsWith('.intern') ? ['10.0.0.1'] : ['142.250.185.74'])

  app = (
    await Test.createTestingModule({
      imports: [ProbePushModule.create(database, { vapid, post: pushService.post, resolve })],
    }).compile()
  ).createNestApplication()
  await app.init()

  keyless = (
    await Test.createTestingModule({
      imports: [ProbePushModule.create(database, null)],
    }).compile()
  ).createNestApplication()
  await keyless.init()
}, 60_000)

beforeEach(async () => {
  await admin.query('delete from push_outbox')
  await admin.query('delete from push_subscriptions')
  await admin.query('delete from push_opt_outs')
  await admin.query('delete from auth_sessions')

  for (const [userId, person] of Object.entries(people)) {
    await admin.query(
      `insert into auth_sessions (id, token, user_id, expires_at, active_tenant_id, created_at, updated_at)
         values ($1, $1, $2, now() + interval '1 day', $3, now(), now())`,
      [`session-${userId}`, userId, person.tenant],
    )
  }

  pushService.posted.length = 0
  pushService.answer({ status: 201, retryAfter: null })
})

afterAll(async () => {
  await app.close()
  await keyless.close()
  await database.close()
  await admin.end()
  foundation.remove()
})

describe('the account', () => {
  it('says whether the instance sends push, with its key, the occasions in their words and the devices', async () => {
    expect(await overview('lena')).toEqual({
      available: true,
      publicKey: vapid.publicKey,
      occasions: [
        {
          key: 'parcel_waiting',
          label: 'Pakete',
          about: 'Wenn am Empfang ein Paket für dich wartet.',
          on: true,
        },
        {
          key: 'visit_announced',
          label: 'Besuch',
          about: 'Wenn sich Besuch für dich angemeldet hat.',
          on: true,
        },
      ],
      devices: [],
    })
  })

  it('without a key says so and takes no device', async () => {
    const answer = await http(keyless).get('/push').set(testIdentityHeader, as('lena')).expect(200)

    expect(answer.body).toMatchObject({ available: false, publicKey: null })

    await http(keyless)
      .put('/push/subscription')
      .set(testIdentityHeader, as('lena'))
      .send(subscription().body)
      .expect(409)
  })

  it('is closed to whoever lacks the right the application names', async () => {
    await http().get('/push').set(testIdentityHeader, as('gero')).expect(403)
  })
})

describe('a device', () => {
  it('is taken, and the same browser again updates its row', async () => {
    const { body } = subscription()
    const first = await subscribe('mia', { ...body, entry: 'back' })

    expect(first.status).toBe(200)
    expect((await overview('mia')).devices).toEqual([
      expect.objectContaining({
        id: (first.body as { id: string }).id,
        label: 'Chrome auf Windows',
        entry: 'back',
        thisSession: true,
      }),
    ])

    // The tablet is handed to Lena: the same endpoint becomes hers.
    const again = await subscribe('lena', body)

    expect((again.body as { id: string }).id).toBe((first.body as { id: string }).id)
    expect((await overview('mia')).devices).toEqual([])
    expect((await overview('lena')).devices).toHaveLength(1)
  })

  it('is refused inside a network, without HTTPS, with keys that are no keys and in no entry', async () => {
    const { body } = subscription()

    expect(
      (await subscribe('lena', { ...body, endpoint: 'https://push.firma.intern/x' })).status,
    ).toBe(422)
    expect(
      (await subscribe('lena', { ...body, endpoint: 'http://push.example.com/x' })).status,
    ).toBe(422)
    expect(
      (await subscribe('lena', { ...body, keys: { p256dh: 'AAAA', auth: 'AAAA' } })).status,
    ).toBe(422)

    const garage = await subscribe('lena', { ...body, entry: 'garage' })

    expect(garage.status).toBe(400)
    expect((garage.body as { message: string }).message).toBe(rules.entryRefused)
    expect((await subscribe('lena', { endpoint: body.endpoint })).status).toBe(400)
    expect((await overview('lena')).devices).toEqual([])
  })

  it('is taken off only by the person it belongs to', async () => {
    const answer = await subscribe('lena', subscription().body)
    const id = (answer.body as { id: string }).id

    for (const person of ['mia', 'sven'] as const) {
      await http()
        .delete(`/push/subscriptions/${id}`)
        .set(testIdentityHeader, as(person))
        .expect(404)
    }

    await http().delete(`/push/subscriptions/${id}`).set(testIdentityHeader, as('lena')).expect(200)
    expect((await overview('lena')).devices).toEqual([])
  })

  it('is not listed once its session has ended', async () => {
    await subscribe('lena', subscription().body)
    await admin.query("delete from auth_sessions where id = 'session-lena'")

    expect((await overview('lena')).devices).toEqual([])
  })
})

describe('an occasion', () => {
  it('is switched off and on for the person asking and nobody else', async () => {
    const off = await http()
      .put('/push/occasions/parcel_waiting')
      .set(testIdentityHeader, as('lena'))
      .send({ on: false })
      .expect(200)

    expect(off.body).toEqual([
      expect.objectContaining({ key: 'parcel_waiting', on: false }),
      expect.objectContaining({ key: 'visit_announced', on: true }),
    ])
    expect((await overview('mia')).occasions.every((occasion) => occasion.on)).toBe(true)

    await http()
      .put('/push/occasions/parcel_waiting')
      .set(testIdentityHeader, as('lena'))
      .send({ on: true })
      .expect(200)

    expect((await overview('lena')).occasions.every((occasion) => occasion.on)).toBe(true)
  })

  it('that the application does not know, or a body without a yes or no, is refused', async () => {
    for (const unknown of ['task_due', 'test', 'toString']) {
      await http()
        .put(`/push/occasions/${unknown}`)
        .set(testIdentityHeader, as('lena'))
        .send({ on: false })
        .expect(404)
    }

    await http()
      .put('/push/occasions/parcel_waiting')
      .set(testIdentityHeader, as('lena'))
      .send({ on: 'nein' })
      .expect(400)
  })
})

describe('the test message', () => {
  it('goes at once to every signed in device of the person, in the words of the application', async () => {
    const { browser, body } = subscription()
    await subscribe('lena', body)

    const answer = await http().post('/push/test').set(testIdentityHeader, as('lena')).expect(201)

    expect(answer.body).toEqual({ sent: 1, failed: 0 })
    expect(pushService.posted).toHaveLength(1)
    expect(browser.read(pushService.posted[0]?.body ?? Buffer.alloc(0))).toMatchObject({
      title: 'Probe aus dem Probewerk',
      body: 'Push kommt an.',
      url: '/empfang/konto',
    })
  })

  it('reaches a device whatever its person switched off', async () => {
    await subscribe('lena', subscription().body)

    for (const occasion of Object.keys(rules.occasions)) {
      await http()
        .put(`/push/occasions/${occasion}`)
        .set(testIdentityHeader, as('lena'))
        .send({ on: false })
        .expect(200)
    }

    await http().post('/push/test').set(testIdentityHeader, as('lena')).expect(201)
  })

  it('is refused while push is on nowhere', async () => {
    await http().post('/push/test').set(testIdentityHeader, as('lena')).expect(409)
  })
})

describe('the routes', () => {
  it('ask the catalogue of the application for the right they are given', () => {
    expect(() =>
      pushParts({
        access: probeAccess,
        rights: { write: 'push.write' as ProbeRight },
        rules,
      }),
    ).toThrow('The catalogue lacks the right of push: push.write')
  })
})
