import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { permissions, roles, workingInHeader } from '@opengewerk/domain'
import {
  type Authentication,
  authenticationPath,
  ClosedIdentitySource,
  Database,
  newId,
} from '@opengewerk/platform-server'
import { toNodeHandler } from 'better-auth/node'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { ApiModule } from '../api/api.module.js'
import { authUsers, customers } from '../database/schema/index.js'
import {
  applicationDatabaseUrl,
  connect,
  resetToMigrated,
  shipRoles,
} from '../database/test-database.js'
import { addStaffMember, createAuthentication, SessionIdentitySource } from './access.js'

/**
 * The authentication as this application has it: with its roles, its words
 * and its data behind the guard, end to end and through HTTP.
 *
 * The mechanism is the foundation's (ADR 0010) and is tested there, with an
 * application that is nobody's: signing in, the choice of tenant, sessions and
 * devices, the rate limits, the log. What is held here is what this
 * application adds to it, and that the two are bound: an owner is the role
 * that needs a second factor, a tenant is a business and is called one, and
 * the customers of one business stay out of the next.
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
  await resetToMigrated()
  await admin.query('insert into tenants (id, name) values ($1, $2), ($3, $4)', [
    north.id,
    north.name,
    south.id,
    south.name,
  ])
  await shipRoles(admin, north.id, south.id)

  database = Database.connect(applicationDatabaseUrl())

  authentication = createAuthentication({
    database,
    secret: 'z'.repeat(64),
    trustedOrigins: [origin],
    // Off, because nothing here is about the limits. They count per address,
    // and every request in this file comes from the same one.
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

    // Signed in, so the routes around the choice answer, with the roles of
    // this application.
    const choices = await http()
      .get('/auth/tenants')
      .set('cookie', withCookies(cookies))
      .expect(200)
    expect(choices.body).toEqual([
      {
        id: north.id,
        name: north.name,
        roles: ['office'],
        // What the business calls the role and what it adds up to there, for
        // the screens to decide by (ADR 0010): in the order of the catalogue.
        roleLabels: ['Büro'],
        rights: permissions.filter((permission) => roles.office.permissions.includes(permission)),
        secondFactor: false,
      },
    ])

    // And the data still does not, because no business has been chosen. A 401
    // with its own sentence, which calls a tenant what this application calls
    // it: the way out is not to sign in again.
    const refused = await http().get('/customers').set('cookie', withCookies(cookies)).expect(401)
    expect(refused.body.message).toBe(
      'Es ist noch kein Betrieb gewählt. Bitte zuerst einen Betrieb auswählen.',
    )
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
})

describe('the choice of business', () => {
  it('refuses a business somebody is not part of, in the words of this application', async () => {
    const cookies = await signIn(office.email)

    const refused = await http()
      .post('/auth/tenant')
      .set('cookie', withCookies(cookies))
      .set('origin', origin)
      .send({ tenantId: south.id })
      .expect(403)

    expect(refused.body.message).toBe('Kein Zugang zu diesem Betrieb.')

    // And it really did not take, rather than answering 403 and going through.
    const seen = await http().get('/customers').set('cookie', withCookies(cookies)).expect(401)
    expect(seen.body.message).toContain('Betrieb')
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

  /**
   * The other tab (#242): a page that still works in the first business sends
   * its business along, and the server refuses it instead of taking its
   * outbox into the second. Without the header, as before, nothing changes.
   */
  it('refuses a page that still works in the business the session left', async () => {
    const cookies = await signIn(both.email)
    const choose = (tenantId: string) =>
      http()
        .post('/auth/tenant')
        .set('cookie', withCookies(cookies))
        .set('origin', origin)
        .send({ tenantId })
        .expect(201)

    await choose(north.id)
    await choose(south.id)

    const left = await http()
      .get('/sync?since=0')
      .set('cookie', withCookies(cookies))
      .set(workingInHeader, north.id)
      .expect(401)

    expect((left.body as { message: string }).message).toContain('anderen Betrieb')

    await http()
      .post('/customers')
      .set('cookie', withCookies(cookies))
      .set(workingInHeader, north.id)
      .send({ kind: 'business', name: 'Aus dem alten Tab' })
      .expect(401)
    await http()
      .get('/sync?since=0')
      .set('cookie', withCookies(cookies))
      .set(workingInHeader, south.id)
      .expect(200)
    await http().get('/customers').set('cookie', withCookies(cookies)).expect(200)

    const { rows } = await admin.query("select 1 from customers where name = 'Aus dem alten Tab'")

    expect(rows).toEqual([])
  })
})

describe('the second factor', () => {
  /**
   * ADR 0006 hangs this on the role and not on a setting, and the role is the
   * owner: that is what this application tells the authentication, and what
   * this holds. That it is asked on every request is the foundation's test.
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
    // Both ways out (#167): the app, or signing in with a passkey.
    expect(refused.body.message).toContain('Authenticator-App')
    expect(refused.body.message).toContain('Passkey')
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

describe('the two halves of the schema', () => {
  /**
   * The property `forInstance` rests on, measured rather than asserted in a
   * comment, with the data of this application. Inside a business the accounts
   * are out of reach; outside one the business data is. Neither is a rule
   * somebody has to keep: both are the policies, and a query that crossed the
   * line comes back empty instead of leaking.
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
