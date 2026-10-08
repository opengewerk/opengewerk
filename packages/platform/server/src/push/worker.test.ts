import type { TenantId } from '@opengewerk/platform-domain'
import type { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { type ProbeFoundation, probeFoundation } from '../authentication/probe-application.js'
import { Database } from '../database/database.js'
import { newId } from '../database/identifier.js'
import { probePush } from '../database/probe-schema.js'
import { pushStore } from './outbox.js'
import { aBrowser, recordingPost, testVapid } from './test-browser.js'
import { type PushJob, runPushCycle, sendDuePush } from './worker.js'

/**
 * The job that sends push, on an application that is nobody's: the probe
 * application tells the people at its front desk that a parcel waits, an
 * occasion no real application has (#23). What the job holds is the same for
 * every application: a device signed in gets the message of its person, a
 * device signed out or dropped by its browser is taken off, and a message
 * that cannot go out in time is given up on.
 */

const north = { id: newId<'tenant'>() as TenantId, name: 'Mandant Nord' }
const south = { id: newId<'tenant'>() as TenantId, name: 'Mandant Süd' }

const people = {
  lena: { tenant: north.id, roles: ['lead'] },
  sven: { tenant: south.id, roles: ['lead'] },
} as const

type Person = keyof typeof people

const store = pushStore(probePush)
const { pushOutbox, pushSubscriptions } = probePush
const vapid = testVapid()

const sentences = {
  tenantFailed: (tenantId: TenantId) => `Push für den Mandanten ${tenantId} ist gescheitert.`,
}

let foundation: ProbeFoundation
let admin: Pool
let database: Database

/** The parcels waiting at the desk of each person, which the probe application raises as causes. */
let waiting: Map<Person, string[]>
/** The tenants the job asked to raise what is due. */
let raisedFor: TenantId[]

const minutes = (count: number) => count * 60_000

/** The cause of the probe application: one message per parcel, for every device of its person. */
async function raise(tenantId: TenantId, now: Date): Promise<number> {
  raisedFor.push(tenantId)

  let written = 0

  for (const [person, parcels] of waiting) {
    if (people[person].tenant !== tenantId) {
      continue
    }

    for (const parcel of parcels) {
      const ids = await store.write(
        database,
        tenantId,
        {
          kind: 'parcel_waiting',
          cause: `parcel:${parcel}`,
          userId: person,
          text: { title: 'Ein Paket wartet', body: 'Am Empfang wartet ein Paket.' },
          urls: { front: '/empfang', back: '/buero' },
          expiresAt: new Date(now.getTime() + minutes(60)),
        },
        now,
      )

      written += ids.length
    }
  }

  return written
}

/** The job of the probe application, with its entries and occasions. */
type ProbeJob = PushJob<'front' | 'back', 'parcel_waiting' | 'visit_announced'>

function job(post: ReturnType<typeof recordingPost>, over: Partial<ProbeJob> = {}): ProbeJob {
  return { database, vapid, post: post.post, store, raise, sentences, ...over }
}

/** A device of this person that switched push on, signed in with a session of its own. */
async function aDevice(person: Person) {
  const browser = aBrowser()
  const session = `session-${person}-${newId()}`
  const tenantId = people[person].tenant

  await admin.query(
    `insert into auth_sessions (id, token, user_id, expires_at, active_tenant_id, created_at, updated_at)
       values ($1, $1, $2, '2038-01-01', $3, now(), now())`,
    [session, person, tenantId],
  )
  await database.forTenant({ tenantId }, (tx) =>
    tx.insert(pushSubscriptions).values({
      tenantId,
      userId: person,
      sessionId: session,
      entry: 'front',
      label: 'Chrome auf Windows',
      endpoint: `https://push.example.com/${person}/${newId()}`,
      ...browser.keys,
    }),
  )

  return { browser, session }
}

async function messages(tenantId: TenantId = north.id) {
  return database.forTenant({ tenantId }, (tx) => tx.select().from(pushOutbox))
}

async function devices(tenantId: TenantId = north.id) {
  return database.forTenant({ tenantId }, (tx) => tx.select().from(pushSubscriptions))
}

beforeAll(async () => {
  foundation = await probeFoundation()
  admin = await foundation.kit.connect()
  await foundation.empty()
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
}, 60_000)

beforeEach(async () => {
  waiting = new Map()
  raisedFor = []
  await admin.query('delete from push_outbox')
  await admin.query('delete from push_subscriptions')
  await admin.query('delete from auth_sessions')
})

afterEach(() => {
  vi.restoreAllMocks()
})

afterAll(async () => {
  await database.close()
  await admin.end()
  foundation.remove()
})

describe('a cause of the application', () => {
  it('reaches every signed in device of its person in the same pass, readable only there', async () => {
    const { browser } = await aDevice('lena')
    const service = recordingPost()
    waiting.set('lena', ['P-0042'])

    const report = await runPushCycle(job(service))

    expect(report).toMatchObject({ written: 1, sent: 1, failed: 0, forgotten: 0 })
    expect(service.posted).toHaveLength(1)
    expect(browser.read(service.posted[0]?.body ?? Buffer.alloc(0))).toEqual({
      title: 'Ein Paket wartet',
      body: 'Am Empfang wartet ein Paket.',
      url: '/empfang',
      tag: 'parcel:P-0042',
    })
    expect((await messages())[0]?.status).toBe('sent')
  })

  it('is raised only where somebody takes push', async () => {
    await aDevice('lena')

    await runPushCycle(job(recordingPost()))

    expect(raisedFor).toEqual([north.id])
  })
})

describe('a device', () => {
  it('signed out is taken off before anything goes to it', async () => {
    const { session } = await aDevice('lena')
    const service = recordingPost()
    waiting.set('lena', ['P-0042'])
    await admin.query('delete from auth_sessions where id = $1', [session])

    const report = await runPushCycle(job(service))

    expect(report).toMatchObject({ forgotten: 1, written: 0, sent: 0 })
    expect(service.posted).toEqual([])
    expect(await devices()).toEqual([])
  })

  it('whose browser dropped the subscription is taken off, with its message', async () => {
    await aDevice('lena')
    const service = recordingPost()
    service.answer({ status: 410, retryAfter: null })
    waiting.set('lena', ['P-0042'])

    const report = await runPushCycle(job(service))

    expect(report).toMatchObject({ forgotten: 1, sent: 0 })
    expect(await devices()).toEqual([])
    expect(await messages()).toEqual([])
  })

  it('whose push service is down is tried again, until the message would come too late', async () => {
    await aDevice('lena')
    const service = recordingPost()
    service.answer({ status: 503, retryAfter: null })
    waiting.set('lena', ['P-0042'])
    const now = new Date(Date.now() + 1_000)

    expect(await runPushCycle(job(service, { now: () => now }))).toMatchObject({ retried: 1 })
    expect((await messages())[0]?.status).toBe('pending')

    waiting.clear()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const late = await runPushCycle(
      job(service, { now: () => new Date(now.getTime() + minutes(61)) }),
    )

    expect(late).toMatchObject({ failed: 1, sent: 0 })
    expect((await messages())[0]).toMatchObject({
      status: 'failed',
      lastError: 'Nicht rechtzeitig zugestellt, die Nachricht wäre zu spät gekommen.',
    })
  })

  it('whose push service refuses the message gets it never again', async () => {
    await aDevice('lena')
    const service = recordingPost()
    service.answer({ status: 400, retryAfter: null })
    waiting.set('lena', ['P-0042'])
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    expect(await runPushCycle(job(service))).toMatchObject({ failed: 1, retried: 0 })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('400'))
  })
})

describe('a tenant whose pass fails', () => {
  it('does not stop the others, and is said in the words of the application', async () => {
    await aDevice('lena')
    await aDevice('sven')
    waiting.set('sven', ['P-0100'])
    const service = recordingPost()
    const complain = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const failing = new Error('Die Probe ist durcheinander.')

    const report = await runPushCycle(
      job(service, {
        raise: (tenantId, now) =>
          tenantId === north.id ? Promise.reject(failing) : raise(tenantId, now),
      }),
    )

    expect(report).toMatchObject({ written: 1, sent: 1 })
    expect(complain).toHaveBeenCalledWith(sentences.tenantFailed(north.id), failing)
  })
})

describe('sending at once', () => {
  it('sends only the messages named, and leaves the rest for the job', async () => {
    await aDevice('lena')
    const now = new Date()
    const [named] = await store.write(
      database,
      north.id,
      {
        kind: 'test',
        cause: `test:${newId()}`,
        userId: 'lena',
        text: { title: 'Probe', body: 'Push kommt an.' },
        urls: { front: '/konto', back: '/konto' },
        expiresAt: new Date(now.getTime() + minutes(10)),
      },
      now,
    )
    waiting.set('lena', ['P-0042'])
    await raise(north.id, new Date(now.getTime() + minutes(1)))
    const service = recordingPost()

    const report = await sendDuePush(
      { database, vapid, post: service.post, store },
      north.id,
      now,
      named ? [named] : [],
    )

    expect(report.sent).toBe(1)
    expect((await messages()).filter((message) => message.status === 'pending')).toHaveLength(1)
  })
})
