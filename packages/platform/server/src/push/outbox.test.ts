import type { TenantId } from '@opengewerk/platform-domain'
import type { Pool } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { type ProbeFoundation, probeFoundation } from '../authentication/probe-application.js'
import { Database } from '../database/database.js'
import { newId } from '../database/identifier.js'
import { probePush } from '../database/probe-schema.js'
import { type PushDraft, pushMaximumAttempts, type PushRow, pushStore } from './outbox.js'
import { aBrowser } from './test-browser.js'

/**
 * The devices and the outbox of push as the foundation keeps them, on the
 * push of an application that is nobody's: the probe application has a front
 * desk and a back office, and tells about parcels and visits. Whom a message
 * reaches, once per cause and device, and when it is tried again or given up
 * on is the same for every application.
 */

const north = { id: newId<'tenant'>() as TenantId, name: 'Mandant Nord' }
const south = { id: newId<'tenant'>() as TenantId, name: 'Mandant Süd' }

const people = {
  lena: { tenant: north.id, roles: ['lead'] },
  mia: { tenant: north.id, roles: ['member'] },
  sven: { tenant: south.id, roles: ['lead'] },
} as const

type Person = keyof typeof people

const store = pushStore(probePush)
const { pushOptOuts, pushOutbox, pushSubscriptions } = probePush

let foundation: ProbeFoundation
let admin: Pool
let database: Database

const minutes = (count: number) => count * 60_000

/** A session that is signed in until next year, or one that has run out. */
async function aSession(person: Person, over: { readonly ended?: boolean } = {}): Promise<string> {
  const id = `session-${person}-${newId()}`

  await admin.query(
    `insert into auth_sessions (id, token, user_id, expires_at, active_tenant_id, created_at, updated_at)
       values ($1, $1, $2, $3, $4, now(), now())`,
    [id, person, over.ended ? '2001-01-01' : '2038-01-01', people[person].tenant],
  )

  return id
}

/** A device of this person that switched push on. */
async function aDevice(
  person: Person,
  over: { readonly entry?: 'front' | 'back'; readonly session?: string | null } = {},
) {
  const tenantId = people[person].tenant
  const sessionId = over.session === undefined ? await aSession(person) : over.session
  const [device] = await database.forTenant({ tenantId }, (tx) =>
    tx
      .insert(pushSubscriptions)
      .values({
        tenantId,
        userId: person,
        sessionId,
        entry: over.entry ?? 'front',
        label: 'Chrome auf Windows',
        endpoint: `https://push.example.com/${person}/${newId()}`,
        ...aBrowser().keys,
      })
      .returning(),
  )

  if (!device) {
    throw new Error('No device was written.')
  }

  return device
}

/** A message about a parcel for Lena, useful for an hour. */
function aDraft(
  over: Partial<PushDraft<'front' | 'back', 'parcel_waiting' | 'visit_announced'>> = {},
): PushDraft<'front' | 'back', 'parcel_waiting' | 'visit_announced'> {
  return {
    kind: 'parcel_waiting',
    cause: `parcel:${newId()}`,
    userId: 'lena',
    text: { title: 'Ein Paket wartet', body: 'Am Empfang wartet ein Paket.' },
    urls: { front: '/empfang', back: '/buero' },
    expiresAt: new Date(Date.now() + minutes(60)),
    ...over,
  }
}

async function messages(tenantId: TenantId = north.id) {
  return database.forTenant({ tenantId }, (tx) => tx.select().from(pushOutbox))
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
}, 60_000)

beforeEach(async () => {
  await admin.query('delete from push_outbox')
  await admin.query('delete from push_subscriptions')
  await admin.query('delete from push_opt_outs')
  await admin.query('delete from auth_sessions')
})

afterAll(async () => {
  await database.close()
  await admin.end()
  foundation.remove()
})

describe('writing a message', () => {
  it('writes one per signed in device of the person, with the link of its entry', async () => {
    const desk = await aDevice('lena', { entry: 'front' })
    const office = await aDevice('lena', { entry: 'back' })
    await aDevice('mia')

    const written = await store.write(database, north.id, aDraft(), new Date())
    const rows = await messages()

    expect(written).toHaveLength(2)
    expect(rows.map((row) => [row.subscriptionId, row.url])).toEqual(
      expect.arrayContaining([
        [desk.id, '/empfang'],
        [office.id, '/buero'],
      ]),
    )
    expect(rows).toHaveLength(2)
  })

  it('writes nothing for a person who switched the occasion off, but the test all the same', async () => {
    await aDevice('lena')
    await database.forTenant({ tenantId: north.id }, (tx) =>
      tx
        .insert(pushOptOuts)
        .values({ tenantId: north.id, userId: 'lena', occasion: 'parcel_waiting' }),
    )

    expect(await store.write(database, north.id, aDraft(), new Date())).toEqual([])
    expect(
      await store.write(database, north.id, aDraft({ kind: 'visit_announced' }), new Date()),
    ).toHaveLength(1)
    expect(
      await store.write(database, north.id, aDraft({ kind: 'test' }), new Date()),
    ).toHaveLength(1)
  })

  it('writes the test message even where a row says it was switched off', async () => {
    // No route takes the test as an occasion; a row that names it anyway, from
    // a hand in the database or an older version, does not keep a person from
    // seeing that push works.
    await aDevice('lena')
    await database.forTenant({ tenantId: north.id }, (tx) =>
      tx.insert(pushOptOuts).values({ tenantId: north.id, userId: 'lena', occasion: 'test' }),
    )

    expect(
      await store.write(database, north.id, aDraft({ kind: 'test' }), new Date()),
    ).toHaveLength(1)
  })

  it('writes nothing for a device whose session has ended, and to one without a session', async () => {
    await aDevice('lena', { session: await aSession('lena', { ended: true }) })

    expect(await store.write(database, north.id, aDraft(), new Date())).toEqual([])

    await aDevice('lena', { session: null })

    expect(await store.write(database, north.id, aDraft(), new Date())).toHaveLength(1)
  })

  it('writes once per cause and device, however often it is asked', async () => {
    await aDevice('lena')
    const draft = aDraft()

    expect(await store.write(database, north.id, draft, new Date())).toHaveLength(1)
    expect(await store.write(database, north.id, draft, new Date())).toEqual([])
  })
})

describe('a message waiting', () => {
  it('is claimed with its device when it is due, and not once it would come too late', async () => {
    const device = await aDevice('lena')
    const now = new Date(Date.now() + 1_000)
    const [due] = await store.write(database, north.id, aDraft(), now)
    await store.write(database, north.id, aDraft({ expiresAt: new Date(now.getTime() - 1) }), now)

    const claimed = await database.forTenant({ tenantId: north.id }, (tx) =>
      store.claimDue(tx, now),
    )

    expect(claimed.map((entry) => [entry.message.id, entry.subscription.id])).toEqual([
      [due, device.id],
    ])
    expect(claimed[0]?.message.attempts).toBe(1)
  })

  it('is claimed at once when it is named, whatever the clock says', async () => {
    await aDevice('lena')
    const [first] = await store.write(database, north.id, aDraft(), new Date())
    await store.write(database, north.id, aDraft(), new Date())
    const long = new Date(Date.now() - minutes(60))

    const claimed = await database.forTenant({ tenantId: north.id }, (tx) =>
      store.claimDue(tx, long, first ? [first] : []),
    )

    expect(claimed.map((entry) => entry.message.id)).toEqual([first])
  })

  it('is given up on once it would come too late, and stays with why', async () => {
    await aDevice('lena')
    const now = new Date()
    await store.write(database, north.id, aDraft({ expiresAt: new Date(now.getTime() + 1) }), now)

    const given = await database.forTenant({ tenantId: north.id }, (tx) =>
      store.giveUpLate(tx, new Date(now.getTime() + minutes(1))),
    )

    expect(given).toBe(1)
    expect((await messages())[0]).toMatchObject({
      status: 'failed',
      lastError: 'Nicht rechtzeitig zugestellt, die Nachricht wäre zu spät gekommen.',
    })
  })

  it('is sent once marked so', async () => {
    await aDevice('lena')
    const [id] = await store.write(database, north.id, aDraft(), new Date())
    const now = new Date()

    await database.forTenant({ tenantId: north.id }, (tx) =>
      store.markSent(tx, id as PushRow['id'], now),
    )

    expect((await messages())[0]).toMatchObject({ status: 'sent', sentAt: now, lastError: null })
  })
})

describe('a message that did not go out', () => {
  async function aMessage(expiresInMinutes = 600) {
    await aDevice('lena')
    const [id] = await store.write(
      database,
      north.id,
      aDraft({ expiresAt: new Date(Date.now() + minutes(expiresInMinutes)) }),
      new Date(),
    )
    const row = (await messages()).find((message) => message.id === id)

    if (!row) {
      throw new Error('No message was written.')
    }

    return row
  }

  function failed(
    row: Awaited<ReturnType<typeof aMessage>>,
    attempts: number,
    failure: {
      readonly reason: string
      readonly permanent: boolean
      readonly afterSeconds?: number | null
    },
    now: Date,
  ) {
    return database.forTenant({ tenantId: north.id }, (tx) =>
      store.markFailed(tx, { ...row, attempts }, failure, now),
    )
  }

  it('waits longer after every attempt, or as long as the push service asked', async () => {
    const row = await aMessage()
    const now = new Date()

    const next = async () =>
      (await messages()).find((message) => message.id === row.id)?.nextAttemptAt

    expect(await failed(row, 3, { reason: 'Dienst weg', permanent: false }, now)).toBe('retry')
    expect(await next()).toEqual(new Date(now.getTime() + minutes(15)))

    expect(
      await failed(row, 1, { reason: 'Zu viel', permanent: false, afterSeconds: 1_200 }, now),
    ).toBe('retry')
    expect(await next()).toEqual(new Date(now.getTime() + minutes(20)))
  })

  it('is given up on for an answer that will not change, after the last attempt, or when it would come too late', async () => {
    const row = await aMessage()
    const now = new Date()

    expect(await failed(row, 1, { reason: 'Abgelehnt', permanent: true }, now)).toBe('failed')
    expect(
      await failed(row, pushMaximumAttempts, { reason: 'Dienst weg', permanent: false }, now),
    ).toBe('failed')

    const soon = await aMessage(2)

    expect(await failed(soon, 2, { reason: 'Dienst weg', permanent: false }, now)).toBe('failed')
  })
})

describe('a device', () => {
  it('signed out is taken off, with its messages, and one without a session stays', async () => {
    const session = await aSession('lena')
    await aDevice('lena', { session })
    await aDevice('lena', { session: null })
    await store.write(database, north.id, aDraft(), new Date())
    await admin.query('delete from auth_sessions where id = $1', [session])

    expect(await store.forgetSignedOut(database, north.id, new Date())).toBe(1)
    expect(
      await database.forTenant({ tenantId: north.id }, (tx) => tx.select().from(pushSubscriptions)),
    ).toHaveLength(1)
    expect(await messages()).toHaveLength(1)
  })

  it('is what tells whether anybody in a tenant takes push', async () => {
    const anybody = () => database.forTenant({ tenantId: south.id }, (tx) => store.anyDevice(tx))

    expect(await anybody()).toBe(false)

    await aDevice('sven')

    expect(await anybody()).toBe(true)
  })
})
