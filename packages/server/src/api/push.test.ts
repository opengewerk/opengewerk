import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import type { RoleKey, TenantId } from '@opengewerk/domain'
import { Database, newId, type PushOverview } from '@opengewerk/platform-server'
import { aBrowser, recordingPost, testVapid } from '@opengewerk/platform-server/testing'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import {
  allowApplicationLogin,
  applicationDatabaseUrl,
  applyMigrations,
  connect,
  resetSchema,
} from '../database/test-database.js'
import { ApiModule } from './api.module.js'
import { testIdentities as identities } from './test-identity.js'

/**
 * The routes of push on one's own devices, #284. What they hold: every role
 * switches push on for itself and for nobody else, a device is only taken
 * with an address on the internet and keys that are keys, and an instance
 * without a key says so instead of taking devices it cannot reach.
 */

const north = newId<'tenant'>() as TenantId
const south = newId<'tenant'>() as TenantId

const people = {
  britta: { name: 'Britta Büro', tenant: north, roles: ['office'] },
  max: { name: 'Max Monteur', tenant: north, roles: ['technician'] },
  susi: { name: 'Susi Süd', tenant: south, roles: ['owner'] },
} as const

type Person = keyof typeof people

const vapid = testVapid()
const pushService = recordingPost()

let admin: Pool
let database: Database
let app: INestApplication
/** The same routes on an instance without a key. */
let keyless: INestApplication

function as(person: Person): string {
  const { tenant, roles } = people[person]

  return JSON.stringify({
    userId: person,
    tenantId: tenant,
    roles: [...roles] as RoleKey[],
    sessionId: `session-${person}`,
  })
}

function http(on: INestApplication = app) {
  return request(on.getHttpServer())
}

async function overview(person: Person): Promise<PushOverview> {
  const answer = await http().get('/push').set('x-test-identity', as(person)).expect(200)

  return answer.body as PushOverview
}

function subscription(endpoint = 'https://fcm.googleapis.com/fcm/send/abc:def') {
  const browser = aBrowser()

  return {
    browser,
    body: { endpoint, keys: browser.keys, entry: 'office', label: 'Chrome auf Windows' },
  }
}

async function subscribe(person: Person, body: object) {
  return http().put('/push/subscription').set('x-test-identity', as(person)).send(body)
}

beforeAll(async () => {
  admin = await connect()
  await resetSchema(admin)
  await applyMigrations()
  await allowApplicationLogin(admin)
  await admin.query('insert into tenants (id, name) values ($1, $2), ($3, $4)', [
    north,
    'Elektro Nord GmbH',
    south,
    'Elektro Süd GmbH',
  ])

  for (const [userId, person] of Object.entries(people)) {
    await admin.query('insert into auth_users (id, name, email) values ($1, $2, $3)', [
      userId,
      person.name,
      `${userId}@example.de`,
    ])
    await admin.query('insert into memberships (tenant_id, user_id, roles) values ($1, $2, $3)', [
      person.tenant,
      userId,
      [...person.roles],
    ])
  }

  database = Database.connect(applicationDatabaseUrl())

  const resolve = (host: string) =>
    Promise.resolve(host.endsWith('.intern') ? ['10.0.0.1'] : ['142.250.185.74'])

  app = (
    await Test.createTestingModule({
      imports: [
        ApiModule.create(database, identities, {
          push: { vapid, post: pushService.post, resolve },
        }),
      ],
    }).compile()
  ).createNestApplication()
  await app.init()

  keyless = (
    await Test.createTestingModule({ imports: [ApiModule.create(database, identities)] }).compile()
  ).createNestApplication()
  await keyless.init()
})

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
})

describe('"Konto"', () => {
  it('says whether the instance sends push, with its key, the occasions and the devices', async () => {
    expect(await overview('britta')).toEqual({
      available: true,
      publicKey: vapid.publicKey,
      occasions: [
        {
          key: 'task_due',
          label: 'Fällige Aufgaben',
          about: 'Am Morgen des Tages, an dem eine Aufgabe für dich fällig ist.',
          on: true,
        },
        {
          key: 'deadline_due',
          label: 'Fristen',
          about: 'Wenn eine Frist, für die du verantwortlich bist, erinnert.',
          on: true,
        },
      ],
      devices: [],
    })
  })

  it('without a key says so and takes no device', async () => {
    const answer = await http(keyless).get('/push').set('x-test-identity', as('britta')).expect(200)

    expect(answer.body).toMatchObject({ available: false, publicKey: null })

    await http(keyless)
      .put('/push/subscription')
      .set('x-test-identity', as('britta'))
      .send(subscription().body)
      .expect(409)
  })
})

describe('a device', () => {
  it('is taken from any role, and the same browser again updates its row', async () => {
    const { body } = subscription()
    const first = await subscribe('max', { ...body, entry: 'site' })

    expect(first.status).toBe(200)
    expect((await overview('max')).devices).toEqual([
      expect.objectContaining({
        id: (first.body as { id: string }).id,
        label: 'Chrome auf Windows',
        entry: 'site',
        thisSession: true,
      }),
    ])

    // The tablet is handed to Britta: the same endpoint becomes hers.
    const again = await subscribe('britta', body)

    expect((again.body as { id: string }).id).toBe((first.body as { id: string }).id)
    expect((await overview('max')).devices).toEqual([])
    expect((await overview('britta')).devices).toHaveLength(1)
  })

  it('is refused inside a network, without HTTPS, and with keys that are no keys', async () => {
    const { body } = subscription()

    expect(
      (await subscribe('britta', { ...body, endpoint: 'https://push.firma.intern/x' })).status,
    ).toBe(422)
    expect(
      (await subscribe('britta', { ...body, endpoint: 'http://push.example.com/x' })).status,
    ).toBe(422)
    expect(
      (await subscribe('britta', { ...body, keys: { p256dh: 'AAAA', auth: 'AAAA' } })).status,
    ).toBe(422)
    expect((await subscribe('britta', { ...body, entry: 'garage' })).status).toBe(400)
    expect((await subscribe('britta', { endpoint: body.endpoint })).status).toBe(400)
    expect((await overview('britta')).devices).toEqual([])
  })

  it('is taken off only by the person it belongs to', async () => {
    const answer = await subscribe('britta', subscription().body)
    const id = (answer.body as { id: string }).id

    for (const person of ['max', 'susi'] as const) {
      await http()
        .delete(`/push/subscriptions/${id}`)
        .set('x-test-identity', as(person))
        .expect(404)
    }

    await http()
      .delete(`/push/subscriptions/${id}`)
      .set('x-test-identity', as('britta'))
      .expect(200)
    expect((await overview('britta')).devices).toEqual([])
  })

  it('is not listed once its session has ended', async () => {
    await subscribe('britta', subscription().body)
    await admin.query("delete from auth_sessions where id = 'session-britta'")

    expect((await overview('britta')).devices).toEqual([])
  })
})

describe('an occasion', () => {
  it('is switched off and on for the person asking and nobody else', async () => {
    const off = await http()
      .put('/push/occasions/task_due')
      .set('x-test-identity', as('britta'))
      .send({ on: false })
      .expect(200)

    expect(off.body).toEqual([
      expect.objectContaining({ key: 'task_due', on: false }),
      expect.objectContaining({ key: 'deadline_due', on: true }),
    ])
    expect((await overview('max')).occasions.every((occasion) => occasion.on)).toBe(true)

    await http()
      .put('/push/occasions/task_due')
      .set('x-test-identity', as('britta'))
      .send({ on: true })
      .expect(200)

    expect((await overview('britta')).occasions.every((occasion) => occasion.on)).toBe(true)
  })

  it('that does not exist, or a body without a yes or no, is refused', async () => {
    await http()
      .put('/push/occasions/geburtstage')
      .set('x-test-identity', as('britta'))
      .send({ on: false })
      .expect(404)
    await http()
      .put('/push/occasions/task_due')
      .set('x-test-identity', as('britta'))
      .send({ on: 'nein' })
      .expect(400)
  })
})

describe('the test message', () => {
  it('goes at once to every device of the person that is signed in', async () => {
    const { browser, body } = subscription()
    await subscribe('britta', body)

    const answer = await http().post('/push/test').set('x-test-identity', as('britta')).expect(201)

    expect(answer.body).toEqual({ sent: 1, failed: 0 })
    expect(pushService.posted).toHaveLength(1)
    expect(browser.read(pushService.posted[0]?.body ?? Buffer.alloc(0))).toMatchObject({
      title: 'Probenachricht',
      url: '/konto',
    })
  })

  it('is refused while push is on nowhere', async () => {
    await http().post('/push/test').set('x-test-identity', as('britta')).expect(409)
  })
})
