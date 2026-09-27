import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto'

import { base32 } from '@better-auth/utils/base32'
import { createOTP } from '@better-auth/utils/otp'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import type { PasskeyEntry, TenantId } from '@opengewerk/domain'
import { toNodeHandler } from 'better-auth/node'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { ApiModule } from '../api/api.module.js'
import { Database } from '../database/database.js'
import { newId } from '../database/identifier.js'
import {
  allowApplicationLogin,
  applicationDatabaseUrl,
  applyMigrations,
  connect,
  resetSchema,
} from '../database/test-database.js'
import { passkeyNotices, type PasskeyOwner } from '../mail/passkey-notice.js'
import { aMailServer, testKey } from '../mail/test-mail-server.js'
import type { Authentication } from './authentication.js'
import { authenticationPath, createAuthentication } from './authentication.js'
import { SessionIdentitySource } from './session-identity.js'
import { addStaffMember } from './staff.js'

/**
 * Passkeys, end to end and through HTTP (#167, #248): added only after
 * confirming again, taken only when confirmed on the device, counted as the
 * second factor, listed, renamed and deleted by their own account and nobody
 * else's, and every change of them in the log of every business.
 *
 * The browser's half is an authenticator built here, from a P-256 key and a
 * few bytes of CBOR, so that what better-auth checks is a real signature over
 * a real challenge and not a stand-in that agrees with anything.
 */

const north = { id: newId<'tenant'>(), name: 'Elektro Nord GmbH' }
const south = { id: newId<'tenant'>(), name: 'Elektro Süd GmbH' }

const origin = 'https://opengewerk.example.de'
const relyingParty = 'opengewerk.example.de'
const password = 'ein-ordentlich-langes-passwort'

/** In both businesses, without the app: the one who adds most of the passkeys here. */
const worker = { email: 'monteur@example.de', name: 'Max Monteur' }
/** An owner without the app, for whom a passkey is the second factor. */
const chief = { email: 'chefin@example.de', name: 'Olga Ohne-App' }
/** With the app set up, so that confirming again asks for the code. */
const guarded = { email: 'buero@example.de', name: 'Beate Büro' }
/** Somebody else, in the other business, whose reach ends at their own passkeys. */
const stranger = { email: 'fremd@example.de', name: 'Fritz Fremd' }

let admin: Pool
let database: Database
let authentication: Authentication
let app: INestApplication
const notices: { owner: PasskeyOwner; passkey: { id: string; name: string } }[] = []
const userIds = new Map<string, string>()
let guardedTotpUri = ''

function http() {
  return request(app.getHttpServer())
}

function cookiesOf(answer: { headers: Record<string, unknown> }): string {
  const raw = answer.headers['set-cookie']
  const list = Array.isArray(raw) ? (raw as string[]) : typeof raw === 'string' ? [raw] : []

  return list.map((cookie) => cookie.split(';')[0]).join('; ')
}

function joined(...cookies: string[]): string {
  return cookies.filter((cookie) => cookie !== '').join('; ')
}

/** A code the way the app on somebody's phone would produce it. */
async function currentCode(totpUri: string): Promise<string> {
  const encoded = new URL(totpUri).searchParams.get('secret') ?? ''
  const secret = new TextDecoder().decode(base32.decode(encoded))

  return createOTP(secret, { digits: 6, period: 30 }).totp()
}

/** Signs in with the password and, where the account has one, the code. */
async function signIn(email: string): Promise<string> {
  const answer = await http()
    .post(`${authenticationPath}/sign-in/email`)
    .set('origin', origin)
    .send({ email, password })
    .expect(200)

  const cookies = cookiesOf(answer)

  if ((answer.body as { twoFactorRedirect?: boolean }).twoFactorRedirect !== true) {
    return cookies
  }

  const verified = await http()
    .post(`${authenticationPath}/two-factor/verify-totp`)
    .set('cookie', cookies)
    .set('origin', origin)
    .send({ code: await currentCode(guardedTotpUri) })
    .expect(200)

  return cookiesOf(verified) || cookies
}

function reconfirm(cookies: string, body: Record<string, unknown>) {
  return http()
    .post(`${authenticationPath}/reconfirm`)
    .set('cookie', cookies)
    .set('origin', origin)
    .send(body)
}

async function chooseBusiness(cookies: string, tenantId: TenantId): Promise<void> {
  await http()
    .post('/auth/tenant')
    .set('cookie', cookies)
    .set('origin', origin)
    .send({ tenantId })
    .expect(201)
}

// ---------------------------------------------------------------------------
// The authenticator.

type Cbor = number | string | Uint8Array | ReadonlyMap<Cbor, Cbor>

/** The head of a CBOR item: major type and length, RFC 8949 section 3. */
function cborHead(major: number, length: number): Buffer {
  if (length < 24) {
    return Buffer.from([(major << 5) | length])
  }

  if (length < 256) {
    return Buffer.from([(major << 5) | 24, length])
  }

  const head = Buffer.alloc(3)
  head[0] = (major << 5) | 25
  head.writeUInt16BE(length, 1)

  return head
}

/** Just enough CBOR for an attestation object and a COSE key. */
function cbor(value: Cbor): Buffer {
  if (typeof value === 'number') {
    return value >= 0 ? cborHead(0, value) : cborHead(1, -1 - value)
  }

  if (typeof value === 'string') {
    const bytes = Buffer.from(value, 'utf8')

    return Buffer.concat([cborHead(3, bytes.length), bytes])
  }

  if (value instanceof Uint8Array) {
    return Buffer.concat([cborHead(2, value.length), Buffer.from(value)])
  }

  const parts = [cborHead(5, value.size)]

  for (const [key, entry] of value) {
    parts.push(cbor(key), cbor(entry))
  }

  return Buffer.concat(parts)
}

function sha256(data: string | Buffer): Buffer {
  return createHash('sha256').update(data).digest()
}

function counterBytes(counter: number): Buffer {
  const bytes = Buffer.alloc(4)
  bytes.writeUInt32BE(counter)

  return bytes
}

/** The flags of authenticator data: user present, user verified, attested data. */
const present = 0x01
const verifiedByUser = 0x04
const attested = 0x40

/**
 * A platform authenticator with one passkey, as Windows Hello or a phone
 * would be: it signs what it is given, and whether the person confirmed on
 * the device is a flag it sets or leaves out.
 */
class TestAuthenticator {
  private readonly keys = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  private readonly credentialId = randomBytes(16)
  private counter = 0

  get id(): string {
    return this.credentialId.toString('base64url')
  }

  register(challenge: string, { userVerified = true } = {}) {
    const jwk = this.keys.publicKey.export({ format: 'jwk' })
    const publicKey = cbor(
      new Map<Cbor, Cbor>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, Buffer.from(jwk.x ?? '', 'base64url')],
        [-3, Buffer.from(jwk.y ?? '', 'base64url')],
      ]),
    )
    const idLength = Buffer.alloc(2)
    idLength.writeUInt16BE(this.credentialId.length)

    const authenticatorData = Buffer.concat([
      sha256(relyingParty),
      Buffer.from([present | attested | (userVerified ? verifiedByUser : 0)]),
      counterBytes(0),
      Buffer.alloc(16),
      idLength,
      this.credentialId,
      publicKey,
    ])
    const clientData = Buffer.from(
      JSON.stringify({ type: 'webauthn.create', challenge, origin, crossOrigin: false }),
    )
    const attestation = cbor(
      new Map<Cbor, Cbor>([
        ['fmt', 'none'],
        ['attStmt', new Map<Cbor, Cbor>()],
        ['authData', authenticatorData],
      ]),
    )

    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key',
      response: {
        clientDataJSON: clientData.toString('base64url'),
        attestationObject: attestation.toString('base64url'),
        transports: ['internal'],
      },
      clientExtensionResults: {},
      authenticatorAttachment: 'platform',
    }
  }

  signIn(challenge: string, { userVerified = true } = {}) {
    this.counter += 1

    const authenticatorData = Buffer.concat([
      sha256(relyingParty),
      Buffer.from([present | (userVerified ? verifiedByUser : 0)]),
      counterBytes(this.counter),
    ])
    const clientData = Buffer.from(
      JSON.stringify({ type: 'webauthn.get', challenge, origin, crossOrigin: false }),
    )
    const signature = sign(
      'sha256',
      Buffer.concat([authenticatorData, sha256(clientData)]),
      this.keys.privateKey,
    )

    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key',
      response: {
        clientDataJSON: clientData.toString('base64url'),
        authenticatorData: authenticatorData.toString('base64url'),
        signature: signature.toString('base64url'),
      },
      clientExtensionResults: {},
      authenticatorAttachment: 'platform',
    }
  }
}

/** Asks for options and answers them with the authenticator, as the browser would. */
async function register(
  cookies: string,
  authenticator: TestAuthenticator,
  { name = 'Laptop Büro', userVerified = true, extra = {} as Record<string, unknown> } = {},
) {
  const options = await http()
    .get(`${authenticationPath}/passkey/generate-register-options`)
    .set('cookie', cookies)
    .expect(200)
  const challenge = (options.body as { challenge: string }).challenge

  return http()
    .post(`${authenticationPath}/passkey/verify-registration`)
    .set('cookie', joined(cookies, cookiesOf(options)))
    .set('origin', origin)
    .send({ response: authenticator.register(challenge, { userVerified }), name, ...extra })
}

/** Confirms again with the password and adds a passkey, for tests that are about what follows. */
async function addPasskey(email: string, name: string): Promise<TestAuthenticator> {
  const cookies = await signIn(email)
  const authenticator = new TestAuthenticator()

  await reconfirm(cookies, { password }).expect(200)
  expect((await register(cookies, authenticator, { name })).status).toBe(200)

  return authenticator
}

/** Signs in with a passkey, without a session to start from, and hands back the new one. */
async function passkeySignIn(authenticator: TestAuthenticator, { userVerified = true } = {}) {
  const options = await http()
    .get(`${authenticationPath}/passkey/generate-authenticate-options`)
    .expect(200)
  const challenge = (options.body as { challenge: string }).challenge

  return http()
    .post(`${authenticationPath}/passkey/verify-authentication`)
    .set('cookie', cookiesOf(options))
    .set('origin', origin)
    .send({ response: authenticator.signIn(challenge, { userVerified }) })
}

async function passkeyRows(userId: string): Promise<{ id: string; name: string | null }[]> {
  const { rows } = await admin.query<{ id: string; name: string | null }>(
    'select id, name from auth_passkeys where user_id = $1 order by created_at',
    [userId],
  )

  return rows
}

/** What the log of a business says about the passkeys, field by field. */
async function logged(
  tenantId: TenantId,
  field: string,
): Promise<{ new_value: string | null; reason: string | null }[]> {
  const { rows } = await admin.query<{ new_value: string | null; reason: string | null }>(
    `select new_value, reason
       from audit_entries
      where tenant_id = $1 and table_name = 'member_passkeys' and field = $2
      order by sequence`,
    [tenantId, field],
  )

  return rows
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
    passkeyNotice: (owner, passkey) => {
      notices.push({ owner, passkey })

      return Promise.resolve()
    },
  })

  for (const [person, tenantId, roles] of [
    [worker, north.id, ['technician']],
    [worker, south.id, ['technician']],
    [chief, north.id, ['owner']],
    [guarded, north.id, ['office']],
    [stranger, south.id, ['office']],
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

  // The app for the one account that confirms with a code.
  const signedIn = await signIn(guarded.email)
  const started = await http()
    .post(`${authenticationPath}/two-factor/enable`)
    .set('cookie', signedIn)
    .set('origin', origin)
    .send({ password, method: 'totp' })
    .expect(200)

  guardedTotpUri = (started.body as { totpURI: string }).totpURI

  await http()
    .post(`${authenticationPath}/two-factor/verify-totp`)
    .set('cookie', signedIn)
    .set('origin', origin)
    .send({ code: await currentCode(guardedTotpUri) })
    .expect(200)
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
})

describe('adding a passkey', () => {
  it('is refused without confirming again, however young the session', async () => {
    const cookies = await signIn(worker.email)

    const refused = await http()
      .get(`${authenticationPath}/passkey/generate-register-options`)
      .set('cookie', cookies)
      .expect(403)

    expect((refused.body as { message: string }).message).toContain('mit dem Passwort bestätigen')

    // Nor can the second step be sent on its own.
    await http()
      .post(`${authenticationPath}/passkey/verify-registration`)
      .set('cookie', cookies)
      .set('origin', origin)
      .send({ response: new TestAuthenticator().register('egal'), name: 'Ohne Bestätigung' })
      .expect(403)
  })

  it('takes the password again, and a wrong one confirms nothing', async () => {
    const cookies = await signIn(worker.email)

    const refused = await reconfirm(cookies, { password: 'falsch-aber-lang-genug' }).expect(401)

    expect((refused.body as { message: string }).message).toBe('Das Passwort stimmt nicht.')

    await http()
      .get(`${authenticationPath}/passkey/generate-register-options`)
      .set('cookie', cookies)
      .expect(403)
  })

  it('works after confirming, and goes into the log of every business of the account', async () => {
    const cookies = await signIn(worker.email)
    const userId = userIds.get(worker.email) ?? ''
    const before = notices.length

    await reconfirm(cookies, { password }).expect(200)
    const added = await register(cookies, new TestAuthenticator(), { name: '  Laptop Büro  ' })

    expect(added.status).toBe(200)
    expect((await passkeyRows(userId)).map((row) => row.name)).toContain('Laptop Büro')

    // In both businesses, as an insert with the reason of the route.
    for (const tenantId of [north.id, south.id]) {
      const names = await logged(tenantId, 'name')

      expect(names).toContainEqual({ new_value: 'Laptop Büro', reason: 'passkey.add' })
    }

    // Told to the account, once.
    expect(notices.slice(before)).toEqual([
      {
        owner: { id: userId, email: worker.email, name: worker.name },
        passkey: { id: (added.body as { id: string }).id, name: 'Laptop Büro' },
      },
    ])

    // And the confirmation is spent: the next passkey needs the password again.
    await http()
      .get(`${authenticationPath}/passkey/generate-register-options`)
      .set('cookie', cookies)
      .expect(403)
  })

  it('refuses a passkey that was not confirmed on the device', async () => {
    const cookies = await signIn(worker.email)
    const userId = userIds.get(worker.email) ?? ''
    const count = (await passkeyRows(userId)).length

    await reconfirm(cookies, { password }).expect(200)
    const refused = await register(cookies, new TestAuthenticator(), {
      name: 'Schlüssel ohne PIN',
      userVerified: false,
    })

    expect(refused.status).toBe(400)
    expect((refused.body as { message: string }).message).toContain('Bestätigung am Gerät')
    expect(await passkeyRows(userId)).toHaveLength(count)
    expect(
      (await logged(north.id, 'name')).some((entry) => entry.new_value === 'Schlüssel ohne PIN'),
    ).toBe(false)
  })

  it('needs a name, and makes no session of its own', async () => {
    const cookies = await signIn(worker.email)

    await reconfirm(cookies, { password }).expect(200)

    const nameless = await register(cookies, new TestAuthenticator(), { name: '   ' })

    expect(nameless.status).toBe(400)
    expect((nameless.body as { message: string }).message).toContain('braucht einen Namen')

    const withSession = await register(cookies, new TestAuthenticator(), {
      name: 'Mit Sitzung',
      extra: { createSession: true },
    })

    expect(withSession.status).toBe(400)
  })

  it('asks for the code as well where the account has the app', async () => {
    const cookies = await signIn(guarded.email)

    const withoutCode = await reconfirm(cookies, { password }).expect(401)
    expect((withoutCode.body as { message: string }).message).toContain('Code aus der App')

    await reconfirm(cookies, { password, code: '000000' }).expect(401)
    await reconfirm(cookies, { password, code: await currentCode(guardedTotpUri) }).expect(200)

    expect((await register(cookies, new TestAuthenticator(), { name: 'Telefon' })).status).toBe(200)
  })

  it('holds the account after ten wrong codes in a row, as a sign in does', async () => {
    const cookies = await signIn(guarded.email)
    const userId = userIds.get(guarded.email) ?? ''

    await admin.query(
      'update auth_two_factors set failed_verification_count = 9 where user_id = $1',
      [userId],
    )

    await reconfirm(cookies, { password, code: '000000' }).expect(401)

    const held = await reconfirm(cookies, { password, code: await currentCode(guardedTotpUri) })

    expect(held.status).toBe(429)

    await admin.query(
      'update auth_two_factors set failed_verification_count = 0, locked_until = null where user_id = $1',
      [userId],
    )
  })

  it('holds for ten minutes and not longer', async () => {
    const cookies = await signIn(worker.email)

    await reconfirm(cookies, { password }).expect(200)
    await admin.query(
      `update auth_sessions set reconfirmed_at = now() - interval '11 minutes'
        where reconfirmed_at is not null`,
    )

    await http()
      .get(`${authenticationPath}/passkey/generate-register-options`)
      .set('cookie', cookies)
      .expect(403)
  })

  /**
   * A passkey nobody can see come is what the log is for, so one that cannot
   * be put there does not stay.
   */
  it('is taken back when it cannot be written into the log', async () => {
    const cookies = await signIn(worker.email)
    const userId = userIds.get(worker.email) ?? ''
    const count = (await passkeyRows(userId)).length

    await reconfirm(cookies, { password }).expect(200)
    await admin.query('revoke insert on member_passkeys from opengewerk_app')

    try {
      const failed = await register(cookies, new TestAuthenticator(), { name: 'Ohne Protokoll' })

      expect(failed.status).toBe(500)
      expect((failed.body as { message: string }).message).toContain('nicht angelegt')
    } finally {
      await admin.query('grant insert on member_passkeys to opengewerk_app')
    }

    expect(await passkeyRows(userId)).toHaveLength(count)
  })
})

describe('signing in with a passkey', () => {
  it('needs no password, and counts as the second factor an owner must have', async () => {
    const authenticator = await addPasskey(chief.email, 'Telefon der Chefin')

    // With the password alone, the owner is stopped, and told both ways out.
    const withPassword = await signIn(chief.email)
    await chooseBusiness(withPassword, north.id)

    const stopped = await http().get('/customers').set('cookie', withPassword).expect(403)
    const message = (stopped.body as { message: string }).message

    expect(message).toContain('Authenticator-App')
    expect(message).toContain('Passkey')

    // With the passkey, the owner works.
    const signedIn = await passkeySignIn(authenticator)

    expect(signedIn.status).toBe(200)

    const cookies = cookiesOf(signedIn)
    const session = await http().get(`${authenticationPath}/get-session`).set('cookie', cookies)

    expect((session.body as { session: { signInMethod: string } }).session.signInMethod).toBe(
      'passkey',
    )

    await chooseBusiness(cookies, north.id)
    await http().get('/customers').set('cookie', cookies).expect(200)

    // And the business sees it in its log.
    const { rows } = await admin.query<{ new_value: string; reason: string }>(
      `select new_value, reason from audit_entries
        where tenant_id = $1 and table_name = 'tenant_sessions' and field = 'sign_in_method'
          and new_value = 'passkey'`,
      [north.id],
    )

    expect(rows).toEqual([{ new_value: 'passkey', reason: 'session.start' }])

    // The list says when it was last used.
    const listed = await http().get('/auth/passkeys').set('cookie', cookies).expect(200)
    const entry = (listed.body as PasskeyEntry[]).find(
      (passkey) => passkey.name === 'Telefon der Chefin',
    )

    expect(entry?.lastUsedAt).not.toBeNull()
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
      const cookies = cookiesOf(await passkeySignIn(authenticator))

      expect(
        (await http().get('/instance/access').set('cookie', cookies).expect(200)).body,
      ).toEqual({ operator: true, secondFactor: true })
      await http().get('/instance/settings').set('cookie', cookies).expect(200)
    } finally {
      await admin.query('delete from instance_operators where user_id = $1', [userId])
    }
  })

  it('is refused for a passkey not confirmed on the device', async () => {
    const authenticator = await addPasskey(worker.email, 'Sicherheitsschlüssel')

    const refused = await passkeySignIn(authenticator, { userVerified: false })

    expect(refused.status).toBe(401)
    expect((refused.body as { message: string }).message).toContain('Bestätigung am Gerät')
    expect(cookiesOf(refused)).not.toContain('session_token')
  })

  it('cannot be claimed by a session that began with the password', async () => {
    const cookies = await signIn(chief.email)

    await http()
      .post(`${authenticationPath}/update-session`)
      .set('cookie', cookies)
      .set('origin', origin)
      .send({ signInMethod: 'passkey' })

    await chooseBusiness(cookies, north.id)
    await http().get('/customers').set('cookie', cookies).expect(403)
  })
})

describe('the passkeys of an account', () => {
  it('are listed for their own account, and nobody else sees them', async () => {
    await addPasskey(worker.email, 'Werkstatt-PC')

    const mine = await http()
      .get('/auth/passkeys')
      .set('cookie', await signIn(worker.email))
      .expect(200)

    expect((mine.body as PasskeyEntry[]).map((passkey) => passkey.name)).toContain('Werkstatt-PC')

    const theirs = await http()
      .get('/auth/passkeys')
      .set('cookie', await signIn(stranger.email))
      .expect(200)

    expect(theirs.body).toEqual([])
  })

  it('are renamed by their own account and by no other', async () => {
    await addPasskey(worker.email, 'Alter Name')
    const [passkey] = (await passkeyRows(userIds.get(worker.email) ?? '')).filter(
      (row) => row.name === 'Alter Name',
    )
    const id = passkey?.id ?? ''

    await http()
      .patch(`/auth/passkeys/${id}`)
      .set('cookie', await signIn(stranger.email))
      .set('origin', origin)
      .send({ name: 'Übernommen' })
      .expect(404)

    const cookies = await signIn(worker.email)

    await http()
      .patch(`/auth/passkeys/${id}`)
      .set('cookie', cookies)
      .set('origin', origin)
      .send({ name: '' })
      .expect(400)

    await http()
      .patch(`/auth/passkeys/${id}`)
      .set('cookie', cookies)
      .set('origin', origin)
      .send({ name: 'Neuer Name' })
      .expect(200)

    const names = (await passkeyRows(userIds.get(worker.email) ?? '')).map((row) => row.name)

    expect(names).toContain('Neuer Name')
    expect(names).not.toContain('Übernommen')

    for (const tenantId of [north.id, south.id]) {
      expect(await logged(tenantId, 'name')).toContainEqual({
        new_value: 'Neuer Name',
        reason: 'passkey.rename',
      })
    }
  })

  it('are deleted by their own account, and a deleted one signs nobody in', async () => {
    const authenticator = await addPasskey(worker.email, 'Zum Löschen')
    const [passkey] = (await passkeyRows(userIds.get(worker.email) ?? '')).filter(
      (row) => row.name === 'Zum Löschen',
    )
    const id = passkey?.id ?? ''

    // It signs in before.
    expect((await passkeySignIn(authenticator)).status).toBe(200)

    await http()
      .delete(`/auth/passkeys/${id}`)
      .set('cookie', await signIn(stranger.email))
      .set('origin', origin)
      .expect(404)

    await http()
      .delete(`/auth/passkeys/${id}`)
      .set('cookie', await signIn(worker.email))
      .set('origin', origin)
      .expect(200)

    expect((await passkeySignIn(authenticator)).status).toBe(401)

    for (const tenantId of [north.id, south.id]) {
      const removed = await logged(tenantId, 'removed_at')

      expect(removed.some((entry) => entry.reason === 'passkey.remove')).toBe(true)
    }
  })

  it('leave the password to sign in with when the last one is gone', async () => {
    const cookies = await signIn(worker.email)
    const listed = await http().get('/auth/passkeys').set('cookie', cookies).expect(200)

    for (const passkey of listed.body as PasskeyEntry[]) {
      await http()
        .delete(`/auth/passkeys/${passkey.id}`)
        .set('cookie', cookies)
        .set('origin', origin)
        .expect(200)
    }

    expect(await passkeyRows(userIds.get(worker.email) ?? '')).toEqual([])

    await signIn(worker.email)
  })

  it('cannot be reached through the routes of the plugin, which are off', async () => {
    const cookies = await signIn(worker.email)

    await http()
      .get(`${authenticationPath}/passkey/list-user-passkeys`)
      .set('cookie', cookies)
      .expect(404)

    for (const path of ['/passkey/update-passkey', '/passkey/delete-passkey']) {
      await http()
        .post(`${authenticationPath}${path}`)
        .set('cookie', cookies)
        .set('origin', origin)
        .send({ id: 'egal', name: 'egal' })
        .expect(404)
    }

    // The list of sessions with their tokens is off as well.
    await http().get(`${authenticationPath}/list-sessions`).set('cookie', cookies).expect(404)
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
})
