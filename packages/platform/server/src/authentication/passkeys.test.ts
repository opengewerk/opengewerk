import type { PasskeyEntry, TenantId } from '@opengewerk/platform-domain'
import type { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { newId } from '../database/identifier.js'
import { applicationRole } from '../database/test-database.js'
import { authenticationPath } from './authentication.js'
import type { PasskeyOwner } from './notices.js'
import {
  cookiesOf,
  joined,
  probeAuthenticator,
  type ProbeFoundation,
  probeFoundation,
  type ProbeInstance,
  probeInstance,
  probeOrigin as origin,
} from './probe-application.js'
import { addStaffMember } from './staff.js'
import { currentCode, type TestAuthenticator } from './test-authenticator.js'

/**
 * Passkeys, end to end and through HTTP (#167, #248): added only after
 * confirming again, taken only when confirmed on the device, counted as the
 * second factor, listed, renamed and deleted by their own account and nobody
 * else's, and every change of them in the log of every tenant.
 *
 * The browser's half is an authenticator built for the test, from a P-256 key
 * and a few bytes of CBOR, so that what better-auth checks is a real
 * signature over a real challenge and not a stand-in that agrees with
 * anything.
 */

const north = { id: newId<'tenant'>(), name: 'Mandant Nord' }
const south = { id: newId<'tenant'>(), name: 'Mandant Süd' }

const password = 'ein-ordentlich-langes-passwort'

/** In both tenants, without the app: the one who adds most of the passkeys here. */
const worker = { email: 'mitglied@example.de', name: 'Mia Mitglied' }
/** Somebody who leads a tenant, without the app, for whom a passkey is the second factor. */
const leader = { email: 'leitung@example.de', name: 'Lea Ohne-App' }
/** With the app set up, so that confirming again asks for the code. */
const guarded = { email: 'gesichert@example.de', name: 'Gerd Gesichert' }
/** Somebody else, in the other tenant, whose reach ends at their own passkeys. */
const stranger = { email: 'fremd@example.de', name: 'Fritz Fremd' }

let foundation: ProbeFoundation
let admin: Pool
let instance: ProbeInstance
const notices: { owner: PasskeyOwner; passkey: { id: string; name: string } }[] = []
/** Set by the test in which the notice cannot be written. */
let noticeFails = false
const userIds = new Map<string, string>()
let guardedTotpUri = ''

function http() {
  return instance.http()
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

/** Asks for options and answers them with the authenticator, as the browser would. */
async function register(
  cookies: string,
  authenticator: TestAuthenticator,
  { name = 'Laptop am Empfang', userVerified = true, extra = {} as Record<string, unknown> } = {},
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
  const authenticator = probeAuthenticator()

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

/** What the log of a tenant says about the passkeys, field by field. */
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
  foundation = await probeFoundation()
  admin = await foundation.kit.connect()
  await foundation.empty()
  await foundation.tenants(admin, [north, south])

  instance = await probeInstance(foundation.kit.applicationDatabaseUrl(), {
    passkeyNotice: (owner, passkey) => {
      if (noticeFails) {
        return Promise.reject(new Error('The outbox is not there.'))
      }

      notices.push({ owner, passkey })

      return Promise.resolve()
    },
  })

  for (const [person, tenantId, role] of [
    [worker, north.id, 'member'],
    [worker, south.id, 'member'],
    [leader, north.id, 'lead'],
    [guarded, north.id, 'member'],
    [stranger, south.id, 'member'],
  ] as const) {
    const { userId } = await addStaffMember(instance.authentication, instance.database, {
      ...person,
      password,
      tenantId,
      roles: [role],
    })

    userIds.set(person.email, userId)
  }

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
  await instance.close()
  await foundation.kit.resetSchema(admin)
  await admin.end()
  foundation.remove()
})

describe('the app that shows a code', () => {
  it('lists the account under the name of the application', () => {
    // What somebody reads on their phone, next to the code: the product, as
    // the application names it, and not a name the foundation would have.
    expect(decodeURIComponent(guardedTotpUri)).toContain('Probewerk')
  })
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
      .send({ response: probeAuthenticator().register('egal'), name: 'Ohne Bestätigung' })
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

  it('works after confirming, and goes into the log of every tenant of the account', async () => {
    const cookies = await signIn(worker.email)
    const userId = userIds.get(worker.email) ?? ''
    const before = notices.length

    await reconfirm(cookies, { password }).expect(200)
    const added = await register(cookies, probeAuthenticator(), { name: '  Laptop am Empfang  ' })

    expect(added.status).toBe(200)
    expect((await passkeyRows(userId)).map((row) => row.name)).toContain('Laptop am Empfang')

    // In both tenants, as an insert with the reason of the route.
    for (const tenantId of [north.id, south.id]) {
      const names = await logged(tenantId, 'name')

      expect(names).toContainEqual({ new_value: 'Laptop am Empfang', reason: 'passkey.add' })
    }

    // Told to the account, once.
    expect(notices.slice(before)).toEqual([
      {
        owner: { id: userId, email: worker.email, name: worker.name },
        passkey: { id: (added.body as { id: string }).id, name: 'Laptop am Empfang' },
      },
    ])

    // And the confirmation is spent: the next passkey needs the password again.
    await http()
      .get(`${authenticationPath}/passkey/generate-register-options`)
      .set('cookie', cookies)
      .expect(403)
  })

  it('refuses a passkey that was not confirmed on the device, naming the application', async () => {
    const cookies = await signIn(worker.email)
    const userId = userIds.get(worker.email) ?? ''
    const count = (await passkeyRows(userId)).length

    await reconfirm(cookies, { password }).expect(200)
    const refused = await register(cookies, probeAuthenticator(), {
      name: 'Schlüssel ohne PIN',
      userVerified: false,
    })

    expect(refused.status).toBe(400)
    expect((refused.body as { message: string }).message).toBe(
      'Ohne Bestätigung am Gerät, mit Fingerabdruck, Gesicht oder PIN, legt Probewerk keinen ' +
        'Passkey an.',
    )
    expect(await passkeyRows(userId)).toHaveLength(count)
    expect(
      (await logged(north.id, 'name')).some((entry) => entry.new_value === 'Schlüssel ohne PIN'),
    ).toBe(false)
  })

  it('needs a name, and makes no session of its own', async () => {
    const cookies = await signIn(worker.email)

    await reconfirm(cookies, { password }).expect(200)

    const nameless = await register(cookies, probeAuthenticator(), { name: '   ' })

    expect(nameless.status).toBe(400)
    expect((nameless.body as { message: string }).message).toContain('braucht einen Namen')

    const withSession = await register(cookies, probeAuthenticator(), {
      name: 'Mit Sitzung',
      extra: { createSession: true },
    })

    expect(withSession.status).toBe(400)
  })

  it('asks for the code as well where the account has the app', async () => {
    const cookies = await signIn(guarded.email)

    const withoutCode = await reconfirm(cookies, { password }).expect(400)
    expect((withoutCode.body as { message: string }).message).toContain('Code aus der App')

    await reconfirm(cookies, { password, code: '000000' }).expect(401)
    await reconfirm(cookies, { password, code: await currentCode(guardedTotpUri) }).expect(200)

    expect((await register(cookies, probeAuthenticator(), { name: 'Telefon' })).status).toBe(200)
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

  /**
   * Two registrations sent at once on one session, each with a challenge of
   * its own: one confirmation adds one key, and the second is sent back to
   * the password.
   */
  it('adds one passkey for one confirmation, even when two arrive at once', async () => {
    const cookies = await signIn(worker.email)
    const userId = userIds.get(worker.email) ?? ''
    const count = (await passkeyRows(userId)).length

    await reconfirm(cookies, { password }).expect(200)

    const challenges = await Promise.all(
      [1, 2].map(() =>
        http()
          .get(`${authenticationPath}/passkey/generate-register-options`)
          .set('cookie', cookies)
          .expect(200),
      ),
    )
    const answers = await Promise.all(
      challenges.map((options, index) =>
        http()
          .post(`${authenticationPath}/passkey/verify-registration`)
          .set('cookie', joined(cookies, cookiesOf(options)))
          .set('origin', origin)
          .send({
            response: probeAuthenticator().register(
              (options.body as { challenge: string }).challenge,
            ),
            name: `Gleichzeitig ${String(index + 1)}`,
          }),
      ),
    )

    expect(answers.map((answer) => answer.status).sort()).toEqual([200, 403])
    expect(await passkeyRows(userId)).toHaveLength(count + 1)
  })

  it('does not count a missing code as a wrong one, and says the code belongs to it', async () => {
    const cookies = await signIn(guarded.email)
    const userId = userIds.get(guarded.email) ?? ''

    const asked = await reconfirm(cookies, { password, code: '' }).expect(400)

    expect((asked.body as { code: string }).code).toBe('CODE_REQUIRED')

    const { rows } = await admin.query<{ failures: number }>(
      'select coalesce(failed_verification_count, 0) as failures from auth_two_factors where user_id = $1',
      [userId],
    )

    expect(rows).toEqual([{ failures: 0 }])
  })

  /**
   * Wrong codes sent at once count one by one: of five arriving together at
   * the ninth attempt, two get as far as the code and the rest are held.
   */
  it('counts guesses sent at once one by one, and holds the account at ten', async () => {
    const cookies = await signIn(guarded.email)
    const userId = userIds.get(guarded.email) ?? ''

    await admin.query(
      'update auth_two_factors set failed_verification_count = 8 where user_id = $1',
      [userId],
    )

    const answers = await Promise.all(
      [1, 2, 3, 4, 5].map(() => reconfirm(cookies, { password, code: '000000' })),
    )

    expect(answers.map((answer) => answer.status).sort()).toEqual([401, 401, 429, 429, 429])

    const held = await reconfirm(cookies, { password, code: await currentCode(guardedTotpUri) })

    expect(held.status).toBe(429)

    await admin.query(
      'update auth_two_factors set failed_verification_count = 0, locked_until = null where user_id = $1',
      [userId],
    )
  })

  /**
   * The state a race leaves: ten attempts counted and the hold not yet set,
   * because the guess that counted tenth is still checking its code. An
   * attempt behind it is refused, the right code included, or two guesses at
   * the same moment would each get a turn beyond the tenth.
   */
  it('refuses an attempt beyond the tenth, even with the right code', async () => {
    const cookies = await signIn(guarded.email)
    const userId = userIds.get(guarded.email) ?? ''

    await admin.query(
      'update auth_two_factors set failed_verification_count = 10, locked_until = null where user_id = $1',
      [userId],
    )

    const refused = await reconfirm(cookies, { password, code: await currentCode(guardedTotpUri) })

    expect(refused.status).toBe(429)

    await admin.query(
      'update auth_two_factors set failed_verification_count = 0, locked_until = null where user_id = $1',
      [userId],
    )
  })

  /**
   * The same race from the other side: the right code is still being checked
   * when a guess beside it sets the hold. It confirms nothing, and the hold
   * stays. The guess is played by a trigger that sets the hold in the moment
   * the attempt is counted.
   */
  it('confirms nothing when the account is held while the right code is checked', async () => {
    const cookies = await signIn(guarded.email)
    const userId = userIds.get(guarded.email) ?? ''

    await admin.query(`
      create function test_hold_while_checking() returns trigger language plpgsql as $$
      begin
        new.locked_until := now() + interval '15 minutes';
        return new;
      end $$`)
    await admin.query(`
      create trigger test_hold_while_checking
        before update of failed_verification_count on auth_two_factors
        for each row
        when (old.locked_until is null
          and new.failed_verification_count > coalesce(old.failed_verification_count, 0))
        execute function test_hold_while_checking()`)

    try {
      const refused = await reconfirm(cookies, {
        password,
        code: await currentCode(guardedTotpUri),
      })

      expect(refused.status).toBe(429)
    } finally {
      await admin.query('drop trigger test_hold_while_checking on auth_two_factors')
      await admin.query('drop function test_hold_while_checking()')
    }

    await http()
      .get(`${authenticationPath}/passkey/generate-register-options`)
      .set('cookie', cookies)
      .expect(403)

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
   * be put there does not stay. The sentence that says so names the tenants,
   * and is the application's.
   */
  it('is taken back when it cannot be written into the log', async () => {
    const cookies = await signIn(worker.email)
    const userId = userIds.get(worker.email) ?? ''
    const count = (await passkeyRows(userId)).length

    await reconfirm(cookies, { password }).expect(200)
    await admin.query(`revoke insert on member_passkeys from "${applicationRole}"`)

    try {
      const failed = await register(cookies, probeAuthenticator(), { name: 'Ohne Protokoll' })

      expect(failed.status).toBe(500)
      expect((failed.body as { message: string }).message).toBe(
        'Der Passkey ließ sich nicht im Protokoll der Mandanten festhalten und ist deshalb ' +
          'nicht angelegt.',
      )
    } finally {
      await admin.query(`grant insert on member_passkeys to "${applicationRole}"`)
    }

    expect(await passkeyRows(userId)).toHaveLength(count)
  })

  /**
   * The notice about a new key is written before the registration answers,
   * and a key nobody could be told of goes again, with what the tenants
   * already wrote down closed as removed.
   */
  it('is taken back when the notice about it cannot be written', async () => {
    const cookies = await signIn(worker.email)
    const userId = userIds.get(worker.email) ?? ''
    const count = (await passkeyRows(userId)).length

    await reconfirm(cookies, { password }).expect(200)
    noticeFails = true

    try {
      const failed = await register(cookies, probeAuthenticator(), { name: 'Ohne Mail' })

      expect(failed.status).toBe(500)
    } finally {
      noticeFails = false
    }

    expect(await passkeyRows(userId)).toHaveLength(count)

    const { rows } = await admin.query<{ tenant_id: string; removed: boolean }>(
      `select tenant_id, removed_at is not null as removed from member_passkeys
        where user_id = $1 and name = 'Ohne Mail' order by tenant_id`,
      [userId],
    )

    expect(rows).toHaveLength(2)
    expect(rows.every((row) => row.removed)).toBe(true)
  })
})

describe('signing in with a passkey', () => {
  it('needs no password, and counts as the second factor a leading role must have', async () => {
    const authenticator = await addPasskey(leader.email, 'Telefon der Leitung')

    // With the password alone, whoever leads is stopped, and told both ways out.
    const withPassword = await signIn(leader.email)
    await instance.chooseTenant(withPassword, north.id)

    const stopped = await http().get('/probe/members').set('cookie', withPassword).expect(403)
    const message = (stopped.body as { message: string }).message

    expect(message).toContain('Authenticator-App')
    expect(message).toContain('Passkey')

    // With the passkey, they work.
    const signedIn = await passkeySignIn(authenticator)

    expect(signedIn.status).toBe(200)

    const cookies = cookiesOf(signedIn)
    const session = await http().get(`${authenticationPath}/get-session`).set('cookie', cookies)

    expect((session.body as { session: { signInMethod: string } }).session.signInMethod).toBe(
      'passkey',
    )

    await instance.chooseTenant(cookies, north.id)
    await http().get('/probe/members').set('cookie', cookies).expect(200)

    // And the tenant sees it in its log.
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
      (passkey) => passkey.name === 'Telefon der Leitung',
    )

    expect(entry?.lastUsedAt).not.toBeNull()
  })

  it('is refused for a passkey not confirmed on the device', async () => {
    const authenticator = await addPasskey(worker.email, 'Sicherheitsschlüssel')

    const refused = await passkeySignIn(authenticator, { userVerified: false })

    expect(refused.status).toBe(401)
    expect((refused.body as { message: string }).message).toContain('Bestätigung am Gerät')
    expect(cookiesOf(refused)).not.toContain('session_token')
  })

  it('cannot be claimed by a session that began with the password', async () => {
    const cookies = await signIn(leader.email)

    await http()
      .post(`${authenticationPath}/update-session`)
      .set('cookie', cookies)
      .set('origin', origin)
      .send({ signInMethod: 'passkey' })

    await instance.chooseTenant(cookies, north.id)
    await http().get('/probe/members').set('cookie', cookies).expect(403)
  })
})

describe('the passkeys of an account', () => {
  it('are listed for their own account, and nobody else sees them', async () => {
    await addPasskey(worker.email, 'Rechner im Lager')

    const mine = await http()
      .get('/auth/passkeys')
      .set('cookie', await signIn(worker.email))
      .expect(200)

    expect((mine.body as PasskeyEntry[]).map((passkey) => passkey.name)).toContain(
      'Rechner im Lager',
    )

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

  /**
   * A removal whose record broke off after the key was gone is finished by
   * the same request again, and only then is the answer "not there".
   */
  it('finish a removal that broke off halfway when asked again', async () => {
    await addPasskey(worker.email, 'Halb gelöscht')
    const userId = userIds.get(worker.email) ?? ''
    const [passkey] = (await passkeyRows(userId)).filter((row) => row.name === 'Halb gelöscht')
    const id = passkey?.id ?? ''

    // The key went, the tenants did not learn of it.
    await admin.query('delete from auth_passkeys where id = $1', [id])

    const cookies = await signIn(worker.email)

    await http()
      .delete(`/auth/passkeys/${id}`)
      .set('cookie', cookies)
      .set('origin', origin)
      .expect(200)

    const { rows } = await admin.query<{ removed: boolean }>(
      'select removed_at is not null as removed from member_passkeys where passkey_id = $1',
      [id],
    )

    expect(rows).toHaveLength(2)
    expect(rows.every((row) => row.removed)).toBe(true)

    await http()
      .delete(`/auth/passkeys/${id}`)
      .set('cookie', cookies)
      .set('origin', origin)
      .expect(404)
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
