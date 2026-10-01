import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import type { TenantId } from '@opengewerk/domain'
import {
  type Authentication,
  authenticationPath,
  Database,
  newId,
} from '@opengewerk/platform-server'
import { TestAuthenticator } from '@opengewerk/platform-server/testing'
import { toNodeHandler } from 'better-auth/node'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { ApiModule } from '../api/api.module.js'
import {
  allowApplicationLogin,
  applicationDatabaseUrl,
  applyMigrations,
  connect,
  resetSchema,
} from '../database/test-database.js'
import { passkeyNotices } from '../mail/passkey-notice.js'
import { aMailServer, testKey } from '../mail/test-mail-server.js'
import { addStaffMember, createAuthentication, SessionIdentitySource } from './access.js'

/**
 * Passkeys where this application adds to them (#167, #248): the area of the
 * instance, which a passkey opens to an operator as the app would, and the
 * mail that tells an account of a new one.
 *
 * Adding one, signing in with one, the list under "Konto" and the log of
 * every business are the foundation's (ADR 0010) and tested there, with an
 * authenticator built for the test. The same one signs here.
 */

const north = { id: newId<'tenant'>(), name: 'Elektro Nord GmbH' }
const south = { id: newId<'tenant'>(), name: 'Elektro Süd GmbH' }

const origin = 'https://opengewerk.example.de'
const site = { relyingParty: 'opengewerk.example.de', origin }
const password = 'ein-ordentlich-langes-passwort'

/** In both businesses, without the app. */
const worker = { email: 'monteur@example.de', name: 'Max Monteur' }
/** An owner without the app, for whom a passkey is the second factor. */
const chief = { email: 'chefin@example.de', name: 'Olga Ohne-App' }

let admin: Pool
let database: Database
let authentication: Authentication
let app: INestApplication
const userIds = new Map<string, string>()

/** A request against the instance of this file, or against another one of a test. */
function http(target: INestApplication = app) {
  return request(target.getHttpServer())
}

function cookiesOf(answer: { headers: Record<string, unknown> }): string {
  const raw = answer.headers['set-cookie']
  const list = Array.isArray(raw) ? (raw as string[]) : typeof raw === 'string' ? [raw] : []

  return list.map((cookie) => cookie.split(';')[0]).join('; ')
}

async function signIn(email: string, target: INestApplication = app): Promise<string> {
  const answer = await http(target)
    .post(`${authenticationPath}/sign-in/email`)
    .set('origin', origin)
    .send({ email, password })
    .expect(200)

  return cookiesOf(answer)
}

/** Confirms again with the password and adds a passkey, as the browser would. */
async function addPasskey(
  email: string,
  name: string,
  target: INestApplication = app,
): Promise<TestAuthenticator> {
  const cookies = await signIn(email, target)
  const authenticator = new TestAuthenticator(site)

  await http(target)
    .post(`${authenticationPath}/reconfirm`)
    .set('cookie', cookies)
    .set('origin', origin)
    .send({ password })
    .expect(200)

  const options = await http(target)
    .get(`${authenticationPath}/passkey/generate-register-options`)
    .set('cookie', cookies)
    .expect(200)
  const challenge = (options.body as { challenge: string }).challenge

  await http(target)
    .post(`${authenticationPath}/passkey/verify-registration`)
    .set('cookie', [cookies, cookiesOf(options)].filter((part) => part !== '').join('; '))
    .set('origin', origin)
    .send({ response: authenticator.register(challenge), name })
    .expect(200)

  return authenticator
}

/** Signs in with a passkey, without a session to start from, and hands back the new one. */
async function passkeySignIn(authenticator: TestAuthenticator): Promise<string> {
  const options = await http()
    .get(`${authenticationPath}/passkey/generate-authenticate-options`)
    .expect(200)
  const challenge = (options.body as { challenge: string }).challenge

  const signedIn = await http()
    .post(`${authenticationPath}/passkey/verify-authentication`)
    .set('cookie', cookiesOf(options))
    .set('origin', origin)
    .send({ response: authenticator.signIn(challenge) })
    .expect(200)

  return cookiesOf(signedIn)
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
    rateLimited: false,
  })

  for (const [person, tenantId, roles] of [
    [worker, north.id, ['technician']],
    [worker, south.id, ['technician']],
    [chief, north.id, ['owner']],
  ] as const) {
    const { userId } = await addStaffMember(authentication, database, {
      ...person,
      password,
      tenantId,
      roles: [...roles],
    })

    userIds.set(person.email, userId)
  }

  const built = await Test.createTestingModule({
    imports: [
      ApiModule.create(database, new SessionIdentitySource(authentication, database), {
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

describe('signing in with a passkey', () => {
  it('counts as the second factor an owner must have, in front of the data of a business', async () => {
    const authenticator = await addPasskey(chief.email, 'Telefon der Chefin')

    // With the password alone, the owner is stopped.
    const withPassword = await signIn(chief.email)

    await http()
      .post('/auth/tenant')
      .set('cookie', withPassword)
      .set('origin', origin)
      .send({ tenantId: north.id })
      .expect(201)
    await http().get('/customers').set('cookie', withPassword).expect(403)

    // With the passkey, the owner works.
    const cookies = await passkeySignIn(authenticator)

    await http()
      .post('/auth/tenant')
      .set('cookie', cookies)
      .set('origin', origin)
      .send({ tenantId: north.id })
      .expect(201)
    await http().get('/customers').set('cookie', cookies).expect(200)
  })

  it('opens the area of the instance to an operator as the app would', async () => {
    const userId = userIds.get(chief.email) ?? ''

    await admin.query('insert into instance_operators (user_id) values ($1)', [userId])

    try {
      const withPassword = await signIn(chief.email)
      const stopped = await http().get('/instance/settings').set('cookie', withPassword).expect(403)

      expect((stopped.body as { message: string }).message).toContain('Passkey')
      expect(
        (await http().get('/instance/access').set('cookie', withPassword).expect(200)).body,
      ).toEqual({ operator: true, secondFactor: false })

      const authenticator = await addPasskey(chief.email, 'Zweites Telefon')
      const cookies = await passkeySignIn(authenticator)

      expect(
        (await http().get('/instance/access').set('cookie', cookies).expect(200)).body,
      ).toEqual({ operator: true, secondFactor: true })
      await http().get('/instance/settings').set('cookie', cookies).expect(200)
    } finally {
      await admin.query('delete from instance_operators where user_id = $1', [userId])
    }
  })
})

describe('the mail about a new passkey', () => {
  function notice() {
    return passkeyNotices(database, {
      origin,
      key: testKey,
      connect: () => ({
        send: () => Promise.resolve(),
        verify: () => Promise.resolve(),
        close: () => undefined,
      }),
    })
  }

  async function outbox(tenantId: TenantId) {
    const { rows } = await admin.query<{
      kind: string
      recipient_address: string
      subject: string
      body: string
    }>(
      `select kind, recipient_address, subject, body from mail_outbox
        where tenant_id = $1 and kind = 'passkey_added'`,
      [tenantId],
    )

    return rows
  }

  it('goes into the outbox of a business of the account that sends mail, once', async () => {
    await aMailServer(admin, south.id, { from: 'buero@sued.example.de' })
    const owner = {
      id: userIds.get(worker.email) ?? '',
      email: worker.email,
      name: worker.name,
    }

    await notice()(owner, { id: 'passkey-mail', name: 'Laptop Büro' })
    await notice()(owner, { id: 'passkey-mail', name: 'Laptop Büro' })

    // North sends no mail, so it went through south.
    expect(await outbox(north.id)).toEqual([])

    const written = await outbox(south.id)

    expect(written).toHaveLength(1)
    expect(written[0]?.recipient_address).toBe(worker.email)
    expect(written[0]?.subject).toBe('Ein neuer Passkey für OpenGewerk')
    expect(written[0]?.body).toContain('„Laptop Büro“')
    expect(written[0]?.body).toContain(`${origin}/konto`)
  })

  it('goes nowhere when no business of the account sends mail', async () => {
    const owner = {
      id: userIds.get(chief.email) ?? '',
      email: chief.email,
      name: chief.name,
    }

    await notice()(owner, { id: 'passkey-quiet', name: 'Telefon' })

    expect((await outbox(north.id)).filter((row) => row.recipient_address === chief.email)).toEqual(
      [],
    )
  })

  /**
   * The two are bound: a passkey added through the routes of the foundation
   * writes the notice of this application, into the outbox of a business that
   * sends mail. South does since the first test of this block.
   */
  it('is written when a passkey is added, through the notice handed to the authentication', async () => {
    const mailing = Database.connect(applicationDatabaseUrl())
    const withMail = createAuthentication({
      database: mailing,
      secret: 'z'.repeat(64),
      trustedOrigins: [origin],
      rateLimited: false,
      passkeyNotice: notice(),
    })
    const built = await Test.createTestingModule({
      imports: [
        ApiModule.create(mailing, new SessionIdentitySource(withMail, mailing), {
          trustedOrigins: [origin],
        }),
      ],
    }).compile()
    const mailingApp = built.createNestApplication()

    mailingApp.use(authenticationPath, toNodeHandler(withMail))
    await mailingApp.init()

    try {
      await addPasskey(worker.email, 'Werkstatt-PC', mailingApp)
    } finally {
      await mailingApp.close()
      await mailing.close()
    }

    const written = (await outbox(south.id)).filter((row) => row.body.includes('„Werkstatt-PC“'))

    expect(written).toHaveLength(1)
    expect(written[0]?.recipient_address).toBe(worker.email)
  })
})
