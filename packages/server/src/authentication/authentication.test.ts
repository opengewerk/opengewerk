import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { toNodeHandler } from 'better-auth/node'
import { eq } from 'drizzle-orm'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { ApiModule } from '../api/api.module.js'
import { ClosedIdentitySource } from '../api/closed-identity.js'
import { Database } from '../database/database.js'
import { newId } from '../database/identifier.js'
import { auditEntries, authRateLimits, authUsers, customers } from '../database/schema/index.js'
import {
  allowApplicationLogin,
  applicationDatabaseUrl,
  applyMigrations,
  connect,
  resetSchema,
} from '../database/test-database.js'
import type { Authentication } from './authentication.js'
import { authenticationPath, createAuthentication } from './authentication.js'
import { SessionIdentitySource } from './session-identity.js'
import { addStaffMember } from './staff.js'

/**
 * The authentication, end to end and through HTTP, because that is the only
 * way it is ever used. Nothing in here reaches past the request: a test that
 * called `identify` directly would prove the function works and say nothing
 * about whether the cookie ever arrives.
 */

const north = { id: newId<'tenant'>(), name: 'Elektro Nord GmbH' }
const south = { id: newId<'tenant'>(), name: 'Elektro Süd GmbH' }

const origin = 'https://opengewerk.example.de'
const password = 'ein-ordentlich-langes-passwort'

let admin: Pool
let database: Database
let authentication: Authentication
let app: INestApplication
let closedApp: INestApplication
let closedDatabase: Database

/** Somebody in one business, the ordinary case. */
const office = { email: 'buero@example.de', name: 'Beate Büro' }
/** Somebody in two, which is the case the whole tenant choice exists for. */
const both = { email: 'inhaber@example.de', name: 'Ingo Inhaber' }
/** An owner, so that the second factor requirement can be looked at. */
const owner = { email: 'chefin@example.de', name: 'Olga Ohne-Zweitfaktor' }

function http() {
  return request(app.getHttpServer())
}

/** Signs in and hands back the cookies, the way a browser would keep them. */
async function signIn(email: string): Promise<string[]> {
  const answer = await http()
    .post(`${authenticationPath}/sign-in/email`)
    .set('origin', origin)
    .send({ email, password })
    .expect(200)

  const cookies = answer.headers['set-cookie']

  return Array.isArray(cookies) ? cookies : [cookies as string]
}

function withCookies(cookies: string[]): string {
  return cookies.map((cookie) => cookie.split(';')[0]).join('; ')
}

beforeAll(async () => {
  admin = await connect()
  await resetSchema(admin)
  await applyMigrations()
  await allowApplicationLogin(admin)
  await admin.query('insert into tenants (id, name) values ($1, $2), ($3, $4)', [
    north.id,
    north.name,
    south.id,
    south.name,
  ])

  database = Database.connect(applicationDatabaseUrl())

  authentication = createAuthentication({
    database,
    secret: 'z'.repeat(64),
    trustedOrigins: [origin],
    // Off here and on in the test that is about them. They count per address,
    // and every request in this file comes from the same one, so leaving them
    // on would mean the sixth sign in measures the limit rather than the thing
    // it was written for.
    rateLimited: false,
  })

  await addStaffMember(authentication, database, {
    ...office,
    password,
    tenantId: north.id,
    roles: ['office'],
  })
  await addStaffMember(authentication, database, {
    ...both,
    password,
    tenantId: north.id,
    roles: ['office'],
  })
  await addStaffMember(authentication, database, {
    ...both,
    password,
    tenantId: south.id,
    roles: ['office'],
  })
  await addStaffMember(authentication, database, {
    ...owner,
    password,
    tenantId: north.id,
    roles: ['owner'],
  })

  // The same list better-auth has, as on an instance: every request below
  // names the address it comes from, the way a browser does.
  const built = await Test.createTestingModule({
    imports: [
      ApiModule.create(database, new SessionIdentitySource(authentication, database), {
        trustedOrigins: [origin],
      }),
    ],
  }).compile()

  app = built.createNestApplication()
  // In front of Nest's body parser, which is the order an instance uses and
  // the order that matters: a parser in front leaves better-auth with an empty
  // body and the failure reads like a wrong password.
  app.use(authenticationPath, toNodeHandler(authentication))
  await app.init()
})

afterAll(async () => {
  await app.close()
  await database.close()

  if (closedApp) {
    await closedApp.close()
  }
  if (closedDatabase) {
    await closedDatabase.close()
  }

  await admin.end()
})

describe('signing in', () => {
  it('gets somebody as far as the choice of business and no further', async () => {
    const cookies = await signIn(office.email)

    // Signed in, so the routes around the choice answer.
    const choices = await http()
      .get('/auth/tenants')
      .set('cookie', withCookies(cookies))
      .expect(200)
    expect(choices.body).toEqual([{ id: north.id, name: north.name, roles: ['office'] }])

    // And the data still does not, because no business has been chosen. A 401
    // with its own sentence: the way out is not to sign in again.
    const refused = await http().get('/customers').set('cookie', withCookies(cookies)).expect(401)
    expect(refused.body.message).toContain('Betrieb')
  })

  it('opens the data once a business is chosen', async () => {
    const cookies = await signIn(office.email)

    await http()
      .post('/auth/tenant')
      .set('cookie', withCookies(cookies))
      .set('origin', origin)
      .send({ tenantId: north.id })
      .expect(201)

    await http().get('/customers').set('cookie', withCookies(cookies)).expect(200)
  })

  it('is refused with the wrong password, and says nothing more than that', async () => {
    const refused = await http()
      .post(`${authenticationPath}/sign-in/email`)
      .set('origin', origin)
      .send({ email: office.email, password: 'falsch-aber-lang-genug' })

    expect(refused.status).toBeGreaterThanOrEqual(400)
    expect(JSON.stringify(refused.body)).not.toContain(office.name)
  })

  it('is refused for somebody who does not exist, the same way', async () => {
    const refused = await http()
      .post(`${authenticationPath}/sign-in/email`)
      .set('origin', origin)
      .send({ email: 'niemand@example.de', password })

    expect(refused.status).toBeGreaterThanOrEqual(400)
  })

  /**
   * Nobody signs themselves up. An instance where a stranger can make an
   * account has given away a foothold before anybody has done anything wrong,
   * and `addStaffMember` is the only way in.
   */
  it('cannot be reached by signing oneself up', async () => {
    const refused = await http()
      .post(`${authenticationPath}/sign-up/email`)
      .set('origin', origin)
      .send({ email: 'fremd@example.de', password, name: 'Fremder' })

    expect(refused.status).toBeGreaterThanOrEqual(400)

    const created = await database.forInstance((tx) =>
      tx.select().from(authUsers).where(eq(authUsers.email, 'fremd@example.de')),
    )
    expect(created).toEqual([])
  })
})

describe('putting somebody into a business', () => {
  /**
   * Whether the account came into being here or was already on the instance.
   *
   * The command line needs the answer, and not for a nicer sentence: an
   * account that was already there keeps the password it had, so a command
   * that printed the one it brought along would be naming a password that does
   * not work. Somebody in two companies is the ordinary case for the second
   * half, not an edge one.
   */
  it('says whether the account was new, because a second business reuses it', async () => {
    const fresh = await addStaffMember(authentication, database, {
      email: 'neu@example.de',
      name: 'Nina Neu',
      password,
      tenantId: north.id,
      roles: ['office'],
    })

    expect(fresh.created).toBe(true)

    const again = await addStaffMember(authentication, database, {
      email: 'neu@example.de',
      name: 'Nina Neu',
      password: 'ein-ganz-anderes-passwort',
      tenantId: south.id,
      roles: ['office'],
    })

    expect(again.created).toBe(false)
    expect(again.userId).toBe(fresh.userId)

    // And the password really is the first one, which is what the flag is
    // there to let a caller say out loud.
    await http()
      .post(`${authenticationPath}/sign-in/email`)
      .set('origin', origin)
      .send({ email: 'neu@example.de', password: 'ein-ganz-anderes-passwort' })
      .expect(401)

    await signIn('neu@example.de')
  })
})

describe('the choice of business', () => {
  it('offers somebody in two companies both of them', async () => {
    const cookies = await signIn(both.email)

    const choices = await http()
      .get('/auth/tenants')
      .set('cookie', withCookies(cookies))
      .expect(200)

    expect((choices.body as { id: string }[]).map((row) => row.id).sort()).toEqual(
      [north.id, south.id].sort(),
    )
  })

  /**
   * The oldest promise in the server, from the other side. `authorization.test`
   * says a tenant in a request body is ignored; this says the one place a
   * tenant can be named is checked against a membership before it is believed.
   */
  it('refuses a business somebody is not part of', async () => {
    const cookies = await signIn(office.email)

    const refused = await http()
      .post('/auth/tenant')
      .set('cookie', withCookies(cookies))
      .set('origin', origin)
      .send({ tenantId: south.id })
      .expect(403)

    expect(refused.body.message).toContain('Kein Zugang')

    // And it really did not take, rather than answering 403 and going through.
    const seen = await http().get('/customers').set('cookie', withCookies(cookies)).expect(401)
    expect(seen.body.message).toContain('Betrieb')
  })

  it('refuses a business that does not exist, with the same answer', async () => {
    const cookies = await signIn(office.email)

    const refused = await http()
      .post('/auth/tenant')
      .set('cookie', withCookies(cookies))
      .set('origin', origin)
      .send({ tenantId: newId<'tenant'>() })
      .expect(403)

    // The same sentence as above. Telling the two apart would turn this route
    // into a way of finding out which companies are on an instance.
    expect(refused.body.message).toContain('Kein Zugang')
  })

  it('keeps the two companies of one person apart', async () => {
    const north_ = await signIn(both.email)
    await http()
      .post('/auth/tenant')
      .set('cookie', withCookies(north_))
      .set('origin', origin)
      .send({ tenantId: north.id })
      .expect(201)

    await http()
      .post('/customers')
      .set('cookie', withCookies(north_))
      .send({ kind: 'business', name: 'Nur im Norden' })
      .expect(201)

    const south_ = await signIn(both.email)
    await http()
      .post('/auth/tenant')
      .set('cookie', withCookies(south_))
      .set('origin', origin)
      .send({ tenantId: south.id })
      .expect(201)

    const seen = await http().get('/customers').set('cookie', withCookies(south_)).expect(200)

    expect((seen.body as { name: string }[]).map((row) => row.name)).not.toContain('Nur im Norden')
  })
})

describe('the second factor', () => {
  /**
   * ADR 0006 hangs this on the role and not on a setting, so it is checked on
   * every request rather than once at sign in: somebody made an owner an hour
   * ago is stopped at their next request without anybody having to remember to
   * look at them again.
   */
  it('is required of an owner, who gets no further than the choice without one', async () => {
    const cookies = await signIn(owner.email)

    // The choice still works, otherwise there would be no way to get to the
    // screen that sets a second factor up.
    await http().get('/auth/tenants').set('cookie', withCookies(cookies)).expect(200)

    await http()
      .post('/auth/tenant')
      .set('cookie', withCookies(cookies))
      .set('origin', origin)
      .send({ tenantId: north.id })
      .expect(201)

    const refused = await http().get('/customers').set('cookie', withCookies(cookies)).expect(403)
    expect(refused.body.message).toContain('zweiter Faktor')
  })

  it('is not required of the office, who works as usual', async () => {
    const cookies = await signIn(office.email)
    await http()
      .post('/auth/tenant')
      .set('cookie', withCookies(cookies))
      .set('origin', origin)
      .send({ tenantId: north.id })
      .expect(201)

    await http().get('/customers').set('cookie', withCookies(cookies)).expect(200)
  })
})

describe('devices', () => {
  it('are listed for their own account only, with the current one marked', async () => {
    const first = await signIn(office.email)
    const second = await signIn(office.email)

    const seen = await http().get('/auth/devices').set('cookie', withCookies(second)).expect(200)
    const rows = seen.body as { sessionId: string; current: boolean }[]

    expect(rows.length).toBeGreaterThanOrEqual(2)
    expect(rows.filter((row) => row.current)).toHaveLength(1)

    // Somebody else's list is not in it.
    const otherCookies = await signIn(both.email)
    const other = await http()
      .get('/auth/devices')
      .set('cookie', withCookies(otherCookies))
      .expect(200)
    const mine = new Set(rows.map((row) => row.sessionId))
    for (const row of other.body as { sessionId: string }[]) {
      expect(mine.has(row.sessionId)).toBe(false)
    }

    expect(first.length).toBeGreaterThan(0)
  })

  it('can be cut off from another one, and the cut off session stops working', async () => {
    const toRevoke = await signIn(office.email)
    const keeping = await signIn(office.email)

    await http()
      .post('/auth/tenant')
      .set('cookie', withCookies(toRevoke))
      .set('origin', origin)
      .send({ tenantId: north.id })
      .expect(201)
    await http().get('/customers').set('cookie', withCookies(toRevoke)).expect(200)

    // Asked of the session that is about to be cut off, not of the one doing
    // the cutting. Earlier tests in this file left this account several open
    // sessions, so "the first one that is not the current one" would pick a
    // stranger and the test would prove nothing.
    const own = await http().get('/auth/devices').set('cookie', withCookies(toRevoke)).expect(200)
    const victim = (own.body as { sessionId: string; current: boolean }[]).find(
      (row) => row.current,
    )

    await http()
      .delete(`/auth/devices/${victim?.sessionId}`)
      .set('cookie', withCookies(keeping))
      .set('origin', origin)
      .expect(200)

    // The revoked one is out, the one that did the revoking is not.
    await http().get('/customers').set('cookie', withCookies(toRevoke)).expect(401)
    await http().get('/auth/devices').set('cookie', withCookies(keeping)).expect(200)
  })

  it('cannot be cut off by somebody else', async () => {
    const mine = await signIn(office.email)
    const stranger = await signIn(both.email)

    const list = await http().get('/auth/devices').set('cookie', withCookies(mine)).expect(200)
    const target = (list.body as { sessionId: string; current: boolean }[]).find(
      (row) => row.current,
    )

    await http()
      .delete(`/auth/devices/${target?.sessionId}`)
      .set('cookie', withCookies(stranger))
      .set('origin', origin)
      .expect(403)

    // Still working, so the 403 was not a 403 with the deletion happening anyway.
    await http().get('/auth/devices').set('cookie', withCookies(mine)).expect(200)
  })
})

describe('signing out', () => {
  it('ends the session, and the cookie stops working', async () => {
    const cookies = await signIn(office.email)
    await http()
      .post('/auth/tenant')
      .set('cookie', withCookies(cookies))
      .set('origin', origin)
      .send({ tenantId: north.id })
      .expect(201)

    await http()
      .post('/auth/sign-out')
      .set('cookie', withCookies(cookies))
      .set('origin', origin)
      .expect(201)

    await http().get('/customers').set('cookie', withCookies(cookies)).expect(401)
  })
})

describe('the audit log', () => {
  /**
   * What ADR 0006 asks for, and the reason `tenant_sessions` exists at all: an
   * entry needs a tenant, so a sign in can only be logged once a business is
   * chosen. Both ends of the stretch of work are in there, because the row is
   * written on the choice and changed on signing out, and the trigger from
   * 0003 watches it like any other table.
   */
  it('holds both ends of a stretch of work in the business it happened in', async () => {
    const cookies = await signIn(office.email)
    await http()
      .post('/auth/tenant')
      .set('cookie', withCookies(cookies))
      .set('origin', origin)
      .send({ tenantId: north.id })
      .expect(201)
    await http()
      .post('/auth/sign-out')
      .set('cookie', withCookies(cookies))
      .set('origin', origin)
      .expect(201)

    const entries = await database.forTenant({ tenantId: north.id }, (tx) =>
      tx
        .select({ reason: auditEntries.reason, field: auditEntries.field })
        .from(auditEntries)
        .where(eq(auditEntries.tableName, 'tenant_sessions')),
    )

    const reasons = new Set(entries.map((entry) => entry.reason))
    expect(reasons.has('session.start')).toBe(true)
    expect(reasons.has('session.end')).toBe(true)
    // The end is an update to `ended_at`, not a row that disappeared: the
    // company's record that somebody worked in it has to survive the sign out.
    expect(entries.some((entry) => entry.field === 'ended_at')).toBe(true)
  })

  it('records a change of rights, because a membership is an ordinary table', async () => {
    const entries = await database.forTenant({ tenantId: north.id }, (tx) =>
      tx
        .select({ reason: auditEntries.reason })
        .from(auditEntries)
        .where(eq(auditEntries.tableName, 'memberships')),
    )

    expect(entries.length).toBeGreaterThan(0)
    expect(entries.some((entry) => entry.reason === 'membership.create')).toBe(true)
  })
})

describe('the two halves of the schema', () => {
  /**
   * The property `forInstance` rests on, measured rather than asserted in a
   * comment. Inside a business the accounts are out of reach; outside one the
   * business data is. Neither is a rule somebody has to keep: both are the
   * policies, and a query that crossed the line comes back empty instead of
   * leaking.
   */
  it('cannot see each other, whichever side the question is asked from', async () => {
    const cookies = await signIn(office.email)
    await http()
      .post('/auth/tenant')
      .set('cookie', withCookies(cookies))
      .set('origin', origin)
      .send({ tenantId: north.id })
      .expect(201)
    await http()
      .post('/customers')
      .set('cookie', withCookies(cookies))
      .send({ kind: 'business', name: 'Für die Gegenprobe' })
      .expect(201)

    // There are users, and there are customers. Proved through the owner, so
    // that an empty result below cannot be an empty table.
    const users = await database.forInstance((tx) => tx.select().from(authUsers))
    expect(users.length).toBeGreaterThan(0)

    // From inside the business: no accounts.
    const usersFromInside = await database.forTenant({ tenantId: north.id }, (tx) =>
      tx.select().from(authUsers),
    )
    expect(usersFromInside).toEqual([])

    // From outside any business: no customers.
    const customersFromOutside = await database.forInstance((tx) => tx.select().from(customers))
    expect(customersFromOutside).toEqual([])
  })
})

describe('the rate limits', () => {
  /**
   * The part of the security baseline in ADR 0006 that is easiest to write
   * down and never check. Guessing a password is the attack this stops, so the
   * test guesses: six wrong passwords in a row, and the sixth is refused
   * before it is even compared.
   *
   * Its own instance, because the counter is keyed by address and path and
   * everything else in this file comes from the same address.
   */
  it('stop somebody working through passwords', async () => {
    const limitedDatabase = Database.connect(applicationDatabaseUrl())
    const limited = createAuthentication({
      database: limitedDatabase,
      secret: 'y'.repeat(64),
      trustedOrigins: [origin],
      rateLimited: true,
    })

    const built = await Test.createTestingModule({
      imports: [
        ApiModule.create(limitedDatabase, new SessionIdentitySource(limited, limitedDatabase)),
      ],
    }).compile()

    const limitedApp = built.createNestApplication()
    limitedApp.use(authenticationPath, toNodeHandler(limited))
    await limitedApp.init()

    try {
      const statuses: number[] = []

      for (let attempt = 0; attempt < 6; attempt += 1) {
        const answer = await request(limitedApp.getHttpServer())
          .post(`${authenticationPath}/sign-in/email`)
          .set('origin', origin)
          .send({ email: office.email, password: 'immer-wieder-falsch-geraten' })

        statuses.push(answer.status)
      }

      // Not "some request failed": the last one has to be the limit and not
      // another wrong password, otherwise this test would pass with no limit
      // at all.
      expect(statuses.at(-1)).toBe(429)
      expect(statuses.filter((status) => status === 429).length).toBeGreaterThan(0)
    } finally {
      await limitedApp.close()
      await limitedDatabase.close()
    }
  })

  /**
   * The counter is in the database and not in memory, which is what makes the
   * limit survive a restart. Without it, anybody who can make the container
   * fall over gets a fresh allowance for free, and during an update that
   * happens on purpose.
   */
  it('are counted in the database, so a restart does not hand out a fresh allowance', async () => {
    const counters = await database.forInstance((tx) => tx.select().from(authRateLimits))

    expect(counters.length).toBeGreaterThan(0)
  })
})

describe('an instance that has been closed', () => {
  /**
   * What an operator switches on during a restore. It is the state this server
   * shipped in before there was an authentication, and it stays available:
   * `CLOSED` swaps the identity source back and leaves better-auth unmounted,
   * so there is not even a sign in to get half way through.
   */
  it('answers its health check and refuses everything else, the sign in included', async () => {
    closedDatabase = Database.connect(applicationDatabaseUrl())

    const built = await Test.createTestingModule({
      imports: [ApiModule.create(closedDatabase, new ClosedIdentitySource())],
    }).compile()

    closedApp = built.createNestApplication()
    await closedApp.init()

    await request(closedApp.getHttpServer()).get('/health').expect(200)
    await request(closedApp.getHttpServer()).get('/customers').expect(401)
    await request(closedApp.getHttpServer()).get('/auth/tenants').expect(401)
    // Not mounted at all, so there is nothing to post a password to.
    await request(closedApp.getHttpServer())
      .post(`${authenticationPath}/sign-in/email`)
      .send({ email: office.email, password })
      .expect(404)
  })
})
