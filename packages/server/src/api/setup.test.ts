import { base32 } from '@better-auth/utils/base32'
import { createOTP } from '@better-auth/utils/otp'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import type { TenantId } from '@opengewerk/domain'
import { toNodeHandler } from 'better-auth/node'
import { and, eq } from 'drizzle-orm'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Authentication } from '../authentication/authentication.js'
import { authenticationPath, createAuthentication } from '../authentication/authentication.js'
import { SessionIdentitySource } from '../authentication/session-identity.js'
import { instanceIsEmpty, setUpInstance } from '../authentication/setup.js'
import { Database } from '../database/database.js'
import { auditEntries, authUsers, memberships } from '../database/schema/index.js'
import {
  allowApplicationLogin,
  applicationDatabaseUrl,
  applyMigrations,
  connect,
  resetSchema,
} from '../database/test-database.js'
import { ApiModule } from './api.module.js'

/**
 * The first run of an instance, through HTTP, because that is the only way it
 * is ever used: somebody opens a freshly started installation in a browser and
 * has to get from nothing to a signed in owner.
 *
 * Everything here starts from a genuinely empty schema. That is not ceremony:
 * the whole feature is a question asked of an empty database, and a test that
 * seeded a business first would measure the refusal and never the way in.
 */

const origin = 'https://opengewerk.example.de'
const password = 'ein-ordentlich-langes-passwort'

/** The code of this instance, as `setup.sh` would have written it into the .env (#215). */
const setupCode = 'K7Q4-9PXM'

const firstRun = {
  company: 'Elektro Neubeginn GmbH',
  name: 'Olga Beispiel',
  email: 'chefin@neubeginn.example.de',
  password,
}

/** What the setup screen sends: the code first, then the business and the account. */
const firstRequest = { setupCode, ...firstRun }

let admin: Pool
let database: Database
let authentication: Authentication
let app: INestApplication

function http() {
  return request(app.getHttpServer())
}

/**
 * A first run from a given address, the way a proxy in front would report it.
 *
 * The limit on wrong codes lives in the controller and so for the whole file.
 * Every test that sends a wrong code does it from an address of its own, from
 * the ranges reserved for documentation, so that no test runs into the
 * attempts of another.
 */
function from(address: string) {
  return http().post('/setup').set('origin', origin).set('x-forwarded-for', address)
}

/** Back to the state a freshly started installation is in. */
async function emptyInstance(): Promise<void> {
  await resetSchema(admin)
  await applyMigrations()
  await allowApplicationLogin(admin)
}

/**
 * Counts what a first run left behind, as the superuser and on purpose.
 *
 * Through the application these numbers would be a different question: it sees
 * the companies of its own memberships and no others, which is the isolation
 * working and not a way of counting. The point here is what is in the database,
 * so the connection that sees everything is the right one to ask.
 */
async function counted(): Promise<{ businesses: number; accounts: number }> {
  const result = await admin.query<{ businesses: number; accounts: number }>(
    `select (select count(*) from tenants)::int as businesses,
            (select count(*) from auth_users)::int as accounts`,
  )

  return result.rows[0] as { businesses: number; accounts: number }
}

/**
 * The cookies an answer set, the way a browser would keep them.
 *
 * Read after every step that can hand out a new session, because one of them
 * does: better-auth mints a fresh session the first time a second factor is
 * confirmed, and a test that kept the old cookie would be measuring a session
 * that no longer exists.
 */
function cookiesOf(answer: { headers: Record<string, unknown> }): string {
  const raw = answer.headers['set-cookie']
  const list = Array.isArray(raw) ? (raw as string[]) : typeof raw === 'string' ? [raw] : []

  return list.map((cookie) => cookie.split(';')[0]).join('; ')
}

/**
 * A code the way the authenticator app on somebody's phone would produce it.
 *
 * The secret arrives base32 encoded inside the address the app is fed, which
 * is the same address the setup screen turns into a picture. Decoding it back
 * to the string better-auth started from and asking the same generator it
 * checks against is the only way to measure this flow without a phone in the
 * room.
 */
async function currentCode(totpUri: string): Promise<string> {
  const encoded = new URL(totpUri).searchParams.get('secret') ?? ''
  const secret = new TextDecoder().decode(base32.decode(encoded))

  return createOTP(secret, { digits: 6, period: 30 }).totp()
}

/** The one business, read the same way. */
async function theBusiness(): Promise<{ id: TenantId; name: string }> {
  const result = await admin.query<{ id: TenantId; name: string }>(
    'select id, name from tenants order by created_at limit 1',
  )

  return result.rows[0] as { id: TenantId; name: string }
}

beforeAll(async () => {
  admin = await connect()
  await emptyInstance()

  database = Database.connect(applicationDatabaseUrl())
  authentication = createAuthentication({
    database,
    secret: 'z'.repeat(64),
    trustedOrigins: [origin],
    // Off, because nothing here is about the limits and every request comes
    // from the same address.
    rateLimited: false,
  })

  const built = await Test.createTestingModule({
    imports: [
      ApiModule.create(database, new SessionIdentitySource(authentication, database), {
        authentication,
        setupCode,
        trustedOrigins: [origin],
      }),
    ],
  }).compile()

  app = built.createNestApplication()
  app.use(authenticationPath, toNodeHandler(authentication))
  await app.init()
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
})

describe('an instance nobody has used yet', () => {
  it('says so, and stops saying so once it has been set up', async () => {
    await emptyInstance()

    const before = await http().get('/setup').expect(200)
    expect(before.body).toEqual({ needed: true })

    await http().post('/setup').set('origin', origin).send(firstRequest).expect(201)

    const after = await http().get('/setup').expect(200)
    expect(after.body).toEqual({ needed: false })
  })

  /**
   * The point of the whole issue, in one test: from nothing to a session, with
   * no psql and no command line anywhere in it.
   */
  it('takes somebody from nothing to a signed in owner', async () => {
    await emptyInstance()

    const created = await http().post('/setup').set('origin', origin).send(firstRequest).expect(201)
    const tenantId = created.body.tenantId as string

    expect(tenantId).toMatch(/^[0-9a-f-]{36}$/)

    const answer = await http()
      .post(`${authenticationPath}/sign-in/email`)
      .set('origin', origin)
      .send({ email: firstRun.email, password })
      .expect(200)

    const raw = answer.headers['set-cookie']
    const cookies = (Array.isArray(raw) ? raw : [raw as string])
      .map((cookie) => cookie.split(';')[0])
      .join('; ')

    const choices = await http().get('/auth/tenants').set('cookie', cookies).expect(200)

    expect(choices.body).toEqual([{ id: tenantId, name: firstRun.company, roles: ['owner'] }])
  })

  it('leaves a business, an account and a membership that belong together', async () => {
    await emptyInstance()

    await http().post('/setup').set('origin', origin).send(firstRequest).expect(201)

    const business = await theBusiness()
    expect(business.name).toBe(firstRun.company)

    const [account] = await database.forInstance((tx) =>
      tx.select().from(authUsers).where(eq(authUsers.email, firstRun.email)),
    )

    expect(account?.name).toBe(firstRun.name)
    // Nobody has a second factor a moment after their account exists, owner or
    // not. The screen that fixes that is the next step of the flow and not
    // part of this route.
    expect(account?.twoFactorEnabled).toBe(false)

    const held = await database.forTenant({ tenantId: business.id }, (tx) =>
      tx
        .select()
        .from(memberships)
        .where(
          and(
            eq(memberships.tenantId, business.id),
            eq(memberships.userId, account?.id ?? 'nobody'),
          ),
        ),
    )

    expect(held[0]?.roles).toEqual(['owner'])
  })

  /**
   * What the new business can see of its own beginning.
   *
   * The account itself is not in here and cannot be: the log is per business
   * and an account belongs to the instance, which is why the `auth_` tables
   * carry no audit trigger (ADR 0006). What a business sees of an account is
   * the membership, and that is what this looks for.
   */
  it('writes its own beginning into the audit log of the new business', async () => {
    await emptyInstance()

    const created = await http().post('/setup').set('origin', origin).send(firstRequest).expect(201)
    const tenantId = created.body.tenantId as TenantId

    const entries = await database.forTenant({ tenantId }, (tx) =>
      tx.select().from(auditEntries).where(eq(auditEntries.tenantId, tenantId)),
    )

    expect(new Set(entries.map((entry) => entry.tableName))).toEqual(
      new Set(['tenants', 'memberships']),
    )

    for (const entry of entries) {
      expect(entry.reason).toBe('instance.setup')
    }

    const membership = entries.find((entry) => entry.tableName === 'memberships')
    expect(membership?.userId).toBeTruthy()
  })
})

describe('an instance that has been set up', () => {
  it('refuses a second first run', async () => {
    await emptyInstance()

    await http().post('/setup').set('origin', origin).send(firstRequest).expect(201)

    const refused = await http()
      .post('/setup')
      .set('origin', origin)
      .send({ ...firstRequest, email: 'zweite@neubeginn.example.de' })
      .expect(409)

    expect(refused.body.message).toContain('bereits eingerichtet')
    expect(await counted()).toEqual({ businesses: 1, accounts: 1 })
  })

  /**
   * The acceptance criterion only the database can keep: two people opening
   * the screen at the same moment.
   *
   * Straight at `setUpInstance` and not through HTTP, on purpose. The route
   * holds first runs to one at a time so that an unauthenticated flood cannot
   * spend the instance's memory on Argon2id, and that gate would answer here
   * before the lock in the database ever did. The gate is convenience; the
   * lock is the guarantee, and the guarantee is what this measures.
   */
  it('ends up with one business when two first runs start at the same moment', async () => {
    await emptyInstance()

    const results = await Promise.allSettled([
      setUpInstance(authentication, database, firstRun),
      setUpInstance(authentication, database, {
        ...firstRun,
        company: 'Elektro Zweitversuch GmbH',
        email: 'zweite@neubeginn.example.de',
      }),
    ])

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)

    // The account of the run that lost is gone with it. That is the
    // transaction doing its job: half a first run is worse than none.
    expect(await counted()).toEqual({ businesses: 1, accounts: 1 })
    expect(await instanceIsEmpty(database)).toBe(false)
  })
})

describe('the first run', () => {
  it('turns down a password short enough to be guessed', async () => {
    await emptyInstance()

    const refused = await http()
      .post('/setup')
      .set('origin', origin)
      .send({ ...firstRequest, password: 'kurz' })
      .expect(400)

    expect(refused.body.message).toContain('zu kurz')
    expect(await instanceIsEmpty(database)).toBe(true)
  })

  it('turns down an address that is not one', async () => {
    await emptyInstance()

    await http()
      .post('/setup')
      .set('origin', origin)
      .send({ ...firstRequest, email: 'chefin' })
      .expect(400)

    expect(await instanceIsEmpty(database)).toBe(true)
  })

  it('names the fields it is missing', async () => {
    await emptyInstance()

    const refused = await http().post('/setup').set('origin', origin).send({}).expect(400)

    expect(refused.body.message).toContain('setupCode')
    expect(refused.body.message).toContain('company')
    expect(refused.body.message).toContain('password')
  })

  /**
   * The one writing route nobody has to be signed in for, and therefore the
   * one that has to refuse a form on a stranger's page by itself. The window
   * is narrow, between the first start and the first run, and it is the window
   * in which an instance is worth taking over whole.
   */
  it('refuses a request that comes from an address it does not know', async () => {
    await emptyInstance()

    const refused = await http()
      .post('/setup')
      .set('origin', 'https://fremde-seite.example.com')
      .send(firstRequest)
      .expect(403)

    expect(refused.body.message).toContain('fremden Adresse')
    expect(await instanceIsEmpty(database)).toBe(true)
  })

  /**
   * The half an origin check leaves open: a request with no `Origin` at all,
   * which is the ordinary case for `curl` on the machine itself. A form can
   * only send the two encodings HTML knows, and neither of them is JSON, so
   * asking for JSON is what closes it. A browser that wants to send JSON
   * across origins is asked for permission first, and nothing here gives it.
   */
  it('refuses a form encoded body, which is all a foreign page could send', async () => {
    await emptyInstance()

    const refused = await http()
      .post('/setup')
      .type('form')
      .send({ ...firstRequest })
      .expect(415)

    expect(refused.body.message).toContain('JSON')
    expect(await instanceIsEmpty(database)).toBe(true)
  })

  it('lets a request without an origin through, which is how a shell sends one', async () => {
    await emptyInstance()

    await http().post('/setup').send(firstRequest).expect(201)
    expect(await instanceIsEmpty(database)).toBe(false)
  })
})

/**
 * The code from the .env that the first run asks for (#215).
 *
 * Before it, an empty instance took its first run from whoever reached the
 * address first, and between the first start and the first run an instance
 * usually stands open on the internet. The code is what only somebody who can
 * read the .env on the server knows.
 */
describe('the setup code', () => {
  it('lets the first run in with the code of the instance', async () => {
    await emptyInstance()

    await from('192.0.2.10').send(firstRequest).expect(201)
    expect(await instanceIsEmpty(database)).toBe(false)
  })

  it('takes the code however it was typed, in small letters, with spaces or without the dash', async () => {
    for (const typed of ['k7q4-9pxm', ' K7Q4 9PXM ', 'k7q49pxm', 'K 7 Q 4 - 9 P X M']) {
      await emptyInstance()

      await from('192.0.2.11')
        .send({ ...firstRequest, setupCode: typed })
        .expect(201)
    }
  })

  /**
   * The refusal says that the code is wrong and nothing else: not how close it
   * came, not how long the right one is, and never the right one.
   */
  it('turns down a wrong code, and leaves the instance empty', async () => {
    await emptyInstance()

    for (const wrong of ['K7Q4-9PXN', 'K7Q4', 'K7Q4-9PXM-9PXM']) {
      const refused = await from('192.0.2.12')
        .send({ ...firstRequest, setupCode: wrong })
        .expect(403)

      expect(refused.body.message).toBe('Der Einrichtungscode stimmt nicht.')
    }

    expect(await counted()).toEqual({ businesses: 0, accounts: 0 })
    expect(await instanceIsEmpty(database)).toBe(true)
  })

  /**
   * Five wrong codes from one address, and the sixth attempt is refused
   * before its code is looked at, the right one included. Another address
   * still gets in: the person at the server should not be locked out by
   * whoever is guessing.
   */
  it('stops listening to an address after five wrong codes, and only to that one', async () => {
    await emptyInstance()

    for (let attempt = 1; attempt <= 5; attempt++) {
      await from('198.51.100.7')
        .send({ ...firstRequest, setupCode: 'AAAA-AAAA' })
        .expect(403)
    }

    const limited = await from('198.51.100.7').send(firstRequest).expect(429)

    expect(limited.body.message).toBe(
      'Zu viele Versuche. Bitte in einer Viertelstunde erneut versuchen.',
    )
    expect(await instanceIsEmpty(database)).toBe(true)

    await from('198.51.100.8').send(firstRequest).expect(201)
  })

  /**
   * An .env from before #215, or one filled in by hand without the line. The
   * instance runs, and the first run is refused with the sentence that says
   * how to get a code, rather than taken from anybody.
   */
  it('refuses every first run on an instance without a code, and says how to get one', async () => {
    await emptyInstance()

    const built = await Test.createTestingModule({
      imports: [
        ApiModule.create(database, new SessionIdentitySource(authentication, database), {
          authentication,
          trustedOrigins: [origin],
        }),
      ],
    }).compile()
    const withoutCode = built.createNestApplication()
    await withoutCode.init()

    try {
      const refused = await request(withoutCode.getHttpServer())
        .post('/setup')
        .set('origin', origin)
        .send(firstRequest)
        .expect(503)

      expect(refused.body.message).toContain('keinen Einrichtungscode')
      expect(refused.body.message).toContain('sh docker/start.sh')
      expect(refused.body.message).toContain('SETUP_CODE')
      expect(await instanceIsEmpty(database)).toBe(true)
    } finally {
      await withoutCode.close()
    }
  })
})

describe('the second factor an owner cannot work without', () => {
  /**
   * The dead end from #62, and the way through it, end to end.
   *
   * ADR 0006 makes a second factor compulsory for the owner and checks it on
   * every request. The only account a new instance can have is an owner, so
   * until there was a screen for it the instance was unusable by the one
   * person who had an account on it. This is that screen's flow: set the
   * factor up before choosing a business, then choose one and work.
   */
  it('is set up before the business is chosen, and the owner then gets in', async () => {
    await emptyInstance()

    const created = await http().post('/setup').set('origin', origin).send(firstRequest).expect(201)
    const tenantId = created.body.tenantId as string

    const signedIn = await http()
      .post(`${authenticationPath}/sign-in/email`)
      .set('origin', origin)
      .send({ email: firstRun.email, password })
      .expect(200)

    const cookies = cookiesOf(signedIn)

    const started = await http()
      .post(`${authenticationPath}/two-factor/enable`)
      .set('cookie', cookies)
      .set('origin', origin)
      .send({ password, method: 'totp' })
      .expect(200)

    expect(started.body.totpURI).toContain('otpauth://totp/')
    // Shown once and never again, which is why the screen puts them in front
    // of somebody rather than behind a link.
    expect(started.body.backupCodes.length).toBeGreaterThan(0)

    const verified = await http()
      .post(`${authenticationPath}/two-factor/verify-totp`)
      .set('cookie', cookies)
      .set('origin', origin)
      .send({ code: await currentCode(started.body.totpURI as string) })
      .expect(200)

    // better-auth replaces the session the first time a factor is confirmed,
    // so from here on the new cookie is the one that counts.
    const now = cookiesOf(verified) || cookies

    await http()
      .post('/auth/tenant')
      .set('cookie', now)
      .set('origin', origin)
      .send({ tenantId })
      .expect(201)

    // The request that was refused before the factor existed.
    await http().get('/customers').set('cookie', now).expect(200)
  })

  /**
   * The phone is gone (#125). The recovery codes shown when the factor was set
   * up are the way in, each of them once, and the account learns how many are
   * left and can make new ones. Before, the sign in only knew the code from
   * the app, and an owner without a phone was locked out of the business.
   */
  it('lets the owner in with a recovery code, each once, and makes new ones', async () => {
    await emptyInstance()

    const created = await http().post('/setup').set('origin', origin).send(firstRequest).expect(201)
    const tenantId = created.body.tenantId as string
    const first = cookiesOf(
      await http()
        .post(`${authenticationPath}/sign-in/email`)
        .set('origin', origin)
        .send({ email: firstRun.email, password })
        .expect(200),
    )
    const started = await http()
      .post(`${authenticationPath}/two-factor/enable`)
      .set('cookie', first)
      .set('origin', origin)
      .send({ password, method: 'totp' })
      .expect(200)
    const codes = started.body.backupCodes as string[]

    await http()
      .post(`${authenticationPath}/two-factor/verify-totp`)
      .set('cookie', first)
      .set('origin', origin)
      .send({ code: await currentCode(started.body.totpURI as string) })
      .expect(200)

    /** A sign in that stops at the second factor, and its cookie for that step. */
    async function passwordOnly(): Promise<string> {
      const answer = await http()
        .post(`${authenticationPath}/sign-in/email`)
        .set('origin', origin)
        .send({ email: firstRun.email, password })
        .expect(200)

      expect(answer.body.twoFactorRedirect).toBe(true)

      return cookiesOf(answer)
    }

    const redeemed = await http()
      .post(`${authenticationPath}/two-factor/verify-backup-code`)
      .set('cookie', await passwordOnly())
      .set('origin', origin)
      .send({ code: codes[0] })
      .expect(200)
    const signedIn = cookiesOf(redeemed)

    await http()
      .post('/auth/tenant')
      .set('cookie', signedIn)
      .set('origin', origin)
      .send({ tenantId })
      .expect(201)
    await http().get('/customers').set('cookie', signedIn).expect(200)

    const left = await http().get('/auth/recovery-codes').set('cookie', signedIn).expect(200)

    expect(left.body).toEqual({ left: codes.length - 1 })

    // The same code a second time is no way in.
    const again = await http()
      .post(`${authenticationPath}/two-factor/verify-backup-code`)
      .set('cookie', await passwordOnly())
      .set('origin', origin)
      .send({ code: codes[0] })

    expect(again.status).toBeGreaterThanOrEqual(400)

    const renewed = await http()
      .post(`${authenticationPath}/two-factor/generate-backup-codes`)
      .set('cookie', signedIn)
      .set('origin', origin)
      .send({ password })
      .expect(200)

    expect((renewed.body.backupCodes as string[]).length).toBe(codes.length)

    const now = await http().get('/auth/recovery-codes').set('cookie', signedIn).expect(200)

    expect(now.body).toEqual({ left: codes.length })
  })

  /**
   * The same thing from inside the application, which is where somebody whose
   * account already exists sets it up.
   *
   * Worth its own test because of what better-auth does in the middle: it
   * mints a new session and deletes the old one. The business chosen for the
   * session has to survive that, or an owner would be dropped back at the
   * chooser every time they secure their account.
   */
  it('can also be set up from inside a business, and the choice survives it', async () => {
    await emptyInstance()

    const created = await http().post('/setup').set('origin', origin).send(firstRequest).expect(201)
    const tenantId = created.body.tenantId as string

    const signedIn = await http()
      .post(`${authenticationPath}/sign-in/email`)
      .set('origin', origin)
      .send({ email: firstRun.email, password })
      .expect(200)

    const cookies = cookiesOf(signedIn)

    await http()
      .post('/auth/tenant')
      .set('cookie', cookies)
      .set('origin', origin)
      .send({ tenantId })
      .expect(201)

    const started = await http()
      .post(`${authenticationPath}/two-factor/enable`)
      .set('cookie', cookies)
      .set('origin', origin)
      .send({ password, method: 'totp' })
      .expect(200)

    const verified = await http()
      .post(`${authenticationPath}/two-factor/verify-totp`)
      .set('cookie', cookies)
      .set('origin', origin)
      .send({ code: await currentCode(started.body.totpURI as string) })
      .expect(200)

    const now = cookiesOf(verified) || cookies
    const session = await http()
      .get(`${authenticationPath}/get-session`)
      .set('cookie', now)
      .expect(200)

    expect(session.body.session.activeTenantId).toBe(tenantId)
    await http().get('/customers').set('cookie', now).expect(200)
  })
})
