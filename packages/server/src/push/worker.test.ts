import {
  coreDeadlineKinds,
  type DeadlineKind,
  deadlineRegistry,
  type TaskId,
  type TenantId,
} from '@opengewerk/domain'
import { Database, newId } from '@opengewerk/platform-server'
import type { Pool } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { pushOutbox, pushSubscriptions, tasks } from '../database/schema/index.js'
import {
  allowApplicationLogin,
  applicationDatabaseUrl,
  applyMigrations,
  connect,
  resetSchema,
} from '../database/test-database.js'
import { aBrowser, recordingPost, testVapid } from './test-browser.js'
import { type PushJob, runPushCycle } from './worker.js'

/**
 * The job that turns what has become due into push messages and sends them
 * (#284). What it has to hold, from the issue: a device that switched push on
 * gets the message of an occasion, a device signed out gets none, and no
 * message names a person or an address.
 */

const north = newId<'tenant'>() as TenantId
const south = newId<'tenant'>() as TenantId

const people = {
  britta: { name: 'Britta Büro', tenant: north, roles: ['office'] },
  max: { name: 'Max Monteur', tenant: north, roles: ['technician'] },
  susi: { name: 'Susi Süd', tenant: south, roles: ['owner'] },
} as const

type Person = keyof typeof people

/** Thursday the 24th, as in the mail tests: half past five and half past six in Berlin. */
const before6 = new Date('2037-09-24T03:30:00Z')
const morning = new Date('2037-09-24T04:30:00Z')
const today = '2037-09-24'

const vapid = testVapid()

/** A kind that reminds and makes no task, for the deadlines. */
const reminding: DeadlineKind = {
  key: 'quote.look_again',
  trade: null,
  title: 'Angebot ansehen',
  about: 'Ein Angebot, das noch einmal angesehen werden soll.',
  source: 'quote',
  intervalDays: 7,
  leadDays: 0,
  responsible: 'source',
  actions: ['reminder'],
  taskTitle: 'Angebot {quelle} ansehen',
}
const registry = deadlineRegistry([...coreDeadlineKinds, reminding])

let admin: Pool
let database: Database

function job(post: ReturnType<typeof recordingPost>): PushJob {
  return { database, vapid, post: post.post, deadlineKinds: registry }
}

function at(now: Date, post: ReturnType<typeof recordingPost>): PushJob {
  return { ...job(post), now: () => now }
}

/** A session that is signed in until next year. */
async function aSession(person: Person): Promise<string> {
  const id = `session-${person}-${String(Math.random()).slice(2)}`

  await admin.query(
    `insert into auth_sessions (id, token, user_id, expires_at, active_tenant_id, created_at, updated_at)
       values ($1, $1, $2, '2038-01-01', $3, now(), now())`,
    [id, person, people[person].tenant],
  )

  return id
}

/** A device of this person that switched push on, signed in with a session of its own. */
async function aDevice(person: Person, entry: 'office' | 'site' = 'office') {
  const browser = aBrowser()
  const session = await aSession(person)
  const endpoint = `https://push.example.com/${person}/${String(Math.random()).slice(2)}`
  const tenantId = people[person].tenant

  await database.forTenant({ tenantId }, (tx) =>
    tx.insert(pushSubscriptions).values({
      tenantId,
      userId: person,
      sessionId: session,
      entry,
      label: 'Chrome auf Windows',
      endpoint,
      ...browser.keys,
    }),
  )

  return { browser, session, endpoint }
}

async function aTask(person: Person, title = 'Herrn Müller in der Rheinstraße 12 anrufen') {
  const id = newId<'task'>() as TaskId
  const tenantId = people[person].tenant

  await database.forTenant({ tenantId, userId: 'britta' }, (tx) =>
    tx.insert(tasks).values({ id, tenantId, title, dueOn: today, assigneeUserId: person }),
  )

  return id
}

async function devices(tenantId: TenantId = north) {
  return database.forTenant({ tenantId }, (tx) => tx.select().from(pushSubscriptions))
}

async function messages(tenantId: TenantId = north) {
  return database.forTenant({ tenantId }, (tx) => tx.select().from(pushOutbox))
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
})

beforeEach(async () => {
  await admin.query('delete from push_outbox')
  await admin.query('delete from push_subscriptions')
  await admin.query('delete from push_opt_outs')
  await admin.query('delete from auth_sessions')
  await admin.query('delete from deadlines')
  await admin.query('delete from tasks')
  await admin.query('update memberships set blocked_at = null')
})

afterAll(async () => {
  await database.close()
  await admin.end()
})

describe('a task due today', () => {
  it('goes to every signed in device of its person, from six in the morning, once', async () => {
    const office = await aDevice('britta', 'office')
    const site = await aDevice('britta', 'site')
    const task = await aTask('britta')
    const post = recordingPost()

    expect(await runPushCycle(at(before6, post))).toMatchObject({ written: 0, sent: 0 })
    expect(await runPushCycle(at(morning, post))).toMatchObject({ written: 2, sent: 2 })
    expect(await runPushCycle(at(new Date(morning.getTime() + 60_000), post))).toMatchObject({
      written: 0,
      sent: 0,
    })

    const toOffice = post.posted.find((request) => request.endpoint === office.endpoint)
    const toSite = post.posted.find((request) => request.endpoint === site.endpoint)

    expect(post.posted).toHaveLength(2)
    expect(office.browser.read(toOffice?.body ?? Buffer.alloc(0))).toEqual({
      title: 'Heute fällig',
      body: 'Eine Aufgabe ist heute für dich fällig.',
      url: '/aufgaben',
      tag: `task_due:${task}:${today}`,
    })
    expect(site.browser.read(toSite?.body ?? Buffer.alloc(0))).toMatchObject({ url: '/m/' })
    expect(toOffice?.headers).toMatchObject({
      'Content-Encoding': 'aes128gcm',
      Urgency: 'normal',
    })
    expect(toOffice?.headers['Authorization']).toMatch(/^vapid t=.+, k=.+$/)
    // Until the end of the day in Berlin, which is 17.5 hours after half past six.
    expect(Number(toOffice?.headers['TTL'])).toBe(17.5 * 3600)
    expect((await messages()).map((message) => message.status)).toEqual(['sent', 'sent'])
  })

  it('names nobody and no address, whatever the task says', async () => {
    const device = await aDevice('britta')
    await aTask('britta', 'Herrn Müller in der Rheinstraße 12 anrufen')
    const post = recordingPost()

    await runPushCycle(at(morning, post))

    const shown = JSON.stringify(device.browser.read(post.posted[0]?.body ?? Buffer.alloc(0)))

    expect(shown).not.toMatch(/Müller|Rheinstraße/)
  })

  it('goes to nobody who switched the occasion off, and to nobody blocked', async () => {
    await aDevice('britta')
    await aDevice('max')
    await aTask('britta')
    await aTask('max')
    await admin.query(
      "insert into push_opt_outs (tenant_id, user_id, occasion) values ($1, 'britta', 'task_due')",
      [north],
    )
    await admin.query("update memberships set blocked_at = now() where user_id = 'max'")
    const post = recordingPost()

    expect(await runPushCycle(at(morning, post))).toMatchObject({ written: 0, sent: 0 })
    expect(post.posted).toHaveLength(0)
  })

  it('keeps every business to its own devices', async () => {
    await aDevice('susi')
    await aTask('britta')
    const post = recordingPost()

    await runPushCycle(at(morning, post))

    expect(post.posted).toHaveLength(0)
    expect(await messages(south)).toHaveLength(0)
  })
})

describe('a device', () => {
  it('signed out gets nothing more and is taken off', async () => {
    const device = await aDevice('britta')
    await aTask('britta')
    await admin.query('delete from auth_sessions where id = $1', [device.session])
    const post = recordingPost()

    expect(await runPushCycle(at(morning, post))).toMatchObject({ sent: 0, forgotten: 1 })
    expect(post.posted).toHaveLength(0)
    expect(await devices()).toHaveLength(0)
  })

  it('whose browser dropped the subscription is taken off, with its message', async () => {
    await aDevice('britta')
    await aTask('britta')
    const post = recordingPost()
    post.answer({ status: 410, retryAfter: null })

    expect(await runPushCycle(at(morning, post))).toMatchObject({ sent: 0, forgotten: 1 })
    expect(await devices()).toHaveLength(0)
    expect(await messages()).toHaveLength(0)
  })

  it('whose push service is down is tried again, until the message would come too late', async () => {
    await aDevice('britta')
    await aTask('britta')
    const post = recordingPost()
    post.answer({ status: 503, retryAfter: null })

    expect(await runPushCycle(at(morning, post))).toMatchObject({ written: 1, retried: 1 })

    const [waiting] = await messages()

    expect(waiting).toMatchObject({ status: 'pending', attempts: 1 })
    expect(waiting?.lastError).toMatch(/503/)

    post.answer({ status: 201, retryAfter: null })

    // Tomorrow the task's message is no use any more.
    expect(
      await runPushCycle(at(new Date(morning.getTime() + 24 * 3_600_000), post)),
    ).toMatchObject({ sent: 0, failed: 1 })
    expect((await messages())[0]).toMatchObject({ status: 'failed' })
  })
})

describe('a deadline of a kind that reminds', () => {
  it('goes to the person who answers for it, by the name of its kind and its day', async () => {
    const device = await aDevice('britta')
    await admin.query(
      `insert into deadlines (tenant_id, kind, source_id, source_label, anchor_on, due_on,
                              reminded_for, reminded_at, responsible_user_id)
         values ($1, 'quote.look_again', $2, 'A-2037-0001', '2037-09-17', $3, $3, $4, 'britta')`,
      [north, newId(), today, morning],
    )
    const post = recordingPost()

    expect(await runPushCycle(at(morning, post))).toMatchObject({ written: 1, sent: 1 })
    expect(device.browser.read(post.posted[0]?.body ?? Buffer.alloc(0))).toMatchObject({
      title: 'Frist am 24.09.2037',
      body: 'Angebot ansehen',
      url: '/fristen',
    })
  })
})
