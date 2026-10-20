import type { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { Database } from '../database/database.js'
import { newId } from '../database/identifier.js'
import { appointOperator } from '../instance/operators.js'
import type { PasskeyOwner } from './notices.js'
import { recordPasswordReset } from './password-resets.js'
import { InstanceSettingsCache } from '../instance/settings.js'
import { authenticationPath } from './authentication.js'
import {
  cookiesOf,
  probeAccess,
  type ProbeFoundation,
  probeFoundation,
  type ProbeInstance,
  probeInstance,
  probeOrigin as origin,
} from './probe-application.js'
import { addStaffMember } from './staff.js'
import { currentCode } from './test-authenticator.js'

/**
 * The second factor belongs to the session, not to the account (found in the
 * security review, opengewerk-haustechnik#360).
 *
 * Two places ask for it on every request: a role that leads a tenant, and the
 * area of the instance. Both used to read it off the account, so a session
 * that began with the password alone counted as one with a second factor from
 * the moment the account got the app, wherever that happened. Now a session
 * has it when it began with one, with the code, a recovery code or a passkey,
 * when the app was set up in it, or when it took the place of a session that
 * had it; and setting the app up ends the sessions of the account that have
 * none.
 *
 * Everybody here leads the tenant and runs the instance, so that each session
 * is asked both questions. A passkey session is asked them in
 * `passkeys.test.ts`, where the authenticator is.
 */

const north = { id: newId<'tenant'>(), name: 'Mandant Nord' }
const password = 'ein-ordentlich-langes-passwort'

let foundation: ProbeFoundation
let admin: Pool
let database: Database
let instance: ProbeInstance
/** Who was told of new recovery codes, in order. */
const told: PasskeyOwner[] = []

function post(path: string, cookies?: string) {
  const sending = instance.http().post(`${authenticationPath}${path}`).set('origin', origin)

  return cookies ? sending.set('cookie', cookies) : sending
}

/** Somebody who leads the tenant and runs the instance; both ask for a second factor. */
async function leader(email: string): Promise<string> {
  const { userId } = await addStaffMember(instance.authentication, instance.database, {
    email,
    name: 'Lena Leitung',
    password,
    tenantId: north.id,
    roles: ['lead'],
  })

  await appointOperator(database, probeAccess.sentences.instance, userId, email)

  return userId
}

/** Signs in with the password alone, on an account without the app a whole session. */
async function withPassword(email: string): Promise<string> {
  const answer = await post('/sign-in/email').send({ email, password }).expect(200)

  expect((answer.body as { twoFactorRedirect?: boolean }).twoFactorRedirect).toBeUndefined()

  return cookiesOf(answer)
}

/** The step a sign in stops at on an account with the app, before the code. */
async function codeAsked(email: string): Promise<string> {
  const answer = await post('/sign-in/email').send({ email, password }).expect(200)

  expect((answer.body as { twoFactorRedirect?: boolean }).twoFactorRedirect).toBe(true)

  return cookiesOf(answer)
}

/** Signs in with the password and the code from the app. */
async function withCode(email: string, totpUri: string): Promise<string> {
  const verified = await post('/two-factor/verify-totp', await codeAsked(email))
    .send({ code: await currentCode(totpUri) })
    .expect(200)

  return cookiesOf(verified)
}

/**
 * Sets the app up as "Konto" and the gate do: in a session that began with the
 * password, which the confirmation with the first code replaces. Hands back
 * what the app was fed, the recovery codes and the cookies of the new session.
 */
async function setUpApp(
  email: string,
): Promise<{ totpUri: string; backupCodes: string[]; cookies: string }> {
  const signedIn = await withPassword(email)
  const started = await post('/two-factor/enable', signedIn).send({ password }).expect(200)
  const { totpURI, backupCodes } = started.body as { totpURI: string; backupCodes: string[] }
  const confirmed = await post('/two-factor/verify-totp', signedIn)
    .send({ code: await currentCode(totpURI) })
    .expect(200)

  return { totpUri: totpURI, backupCodes, cookies: cookiesOf(confirmed) }
}

/**
 * What a session gets: choosing the tenant, which asks for no second factor,
 * then the area of the instance and a page of the tenant, which both do.
 * Status and sentence, so that "the same answer" means the same answer.
 */
async function reach(cookies: string) {
  const chosen = await instance
    .http()
    .post('/auth/tenant')
    .set('cookie', cookies)
    .set('origin', origin)
    .send({ tenantId: north.id })
  const area = await instance.http().get('/instance/operators').set('cookie', cookies)
  const tenant = await instance.http().get('/probe/members').set('cookie', cookies)
  const said = (answer: { status: number; body: unknown }) =>
    answer.status === 200 ? null : (answer.body as { message?: string }).message

  return {
    chosen: chosen.status,
    area: [area.status, said(area)],
    tenant: [tenant.status, said(tenant)],
  }
}

const allowed = { chosen: 201, area: [200, null], tenant: [200, null] }
const signedOut = {
  chosen: 401,
  area: [401, expect.any(String)],
  tenant: [401, expect.any(String)],
}

beforeAll(async () => {
  foundation = await probeFoundation()
  admin = await foundation.kit.connect()
  await foundation.empty()
  await foundation.tenants(admin, [north])

  const url = foundation.kit.applicationDatabaseUrl()

  database = Database.connect(url)
  instance = await probeInstance(url, {
    instanceSettings: await InstanceSettingsCache.load(database),
    recoveryCodesNotice: (owner) => {
      told.push(owner)

      return Promise.resolve()
    },
  })
})

afterAll(async () => {
  await instance.close()
  await database.close()
  await foundation.kit.resetSchema(admin)
  await admin.end()
  foundation.remove()
})

describe('the second factor of a session', () => {
  it('is not given to a session of the password alone when its account gets the app', async () => {
    const userId = await leader('ohne-app@nord.example.de')
    const session = await withPassword('ohne-app@nord.example.de')
    const before = await reach(session)

    expect(before).toEqual({
      chosen: 201,
      area: [403, expect.stringContaining('zweiter Faktor Pflicht')],
      tenant: [403, expect.stringContaining('zweiter Faktor Pflicht')],
    })

    // The account has the app now, and the session from before still stands,
    // as one did on an instance when the account was given the app before
    // this fix.
    await admin.query('update auth_users set two_factor_enabled = true where id = $1', [userId])

    expect(await reach(session)).toEqual(before)
  })

  it('ends the sessions of the account without one when the app is set up, and the session it was set up in has it', async () => {
    await leader('einrichten@nord.example.de')
    const before = await withPassword('einrichten@nord.example.de')
    const elsewhere = await withPassword('einrichten@nord.example.de')

    const { cookies } = await setUpApp('einrichten@nord.example.de')

    expect(await reach(before)).toEqual(signedOut)
    expect(await reach(elsewhere)).toEqual(signedOut)
    expect(await reach(cookies)).toEqual(allowed)
  })

  it('is given at the sign in by the code from the app, and by a recovery code', async () => {
    await leader('code@nord.example.de')
    const { totpUri, backupCodes } = await setUpApp('code@nord.example.de')

    expect(await reach(await withCode('code@nord.example.de', totpUri))).toEqual(allowed)

    const recovered = await post(
      '/two-factor/verify-backup-code',
      await codeAsked('code@nord.example.de'),
    )
      .send({ code: backupCodes[0] })
      .expect(200)

    expect(await reach(cookiesOf(recovered))).toEqual(allowed)
  })

  it('stays with a session whose password changes, while the other sessions end as before', async () => {
    await leader('wechsel@nord.example.de')
    const { totpUri } = await setUpApp('wechsel@nord.example.de')
    const here = await withCode('wechsel@nord.example.de', totpUri)
    const elsewhere = await withCode('wechsel@nord.example.de', totpUri)

    const changed = await post('/change-password', here)
      .send({
        currentPassword: password,
        newPassword: 'ein-anderes-langes-passwort',
        revokeOtherSessions: true,
      })
      .expect(200)

    expect(await reach(cookiesOf(changed))).toEqual(allowed)
    expect(await reach(elsewhere)).toEqual(signedOut)
  })
})

/**
 * The one limit of the sign in that counts per account and not per address
 * (opengewerk-haustechnik#360): ten wrong codes in a row hold the account for
 * a quarter of an hour, wherever they come from. It holds where the limits per
 * address cannot, behind a proxy that names nobody or for somebody with many
 * addresses. The instance here counts nothing per address at all.
 */
describe('the code from the app at a sign in', () => {
  it('is refused after ten wrong ones in a row, the right one included, from any address', async () => {
    const userId = await leader('gesperrt@nord.example.de')
    const { totpUri } = await setUpApp('gesperrt@nord.example.de')

    for (let attempt = 1; attempt <= 10; attempt += 1) {
      await post('/two-factor/verify-totp', await codeAsked('gesperrt@nord.example.de'))
        .set('x-forwarded-for', `203.0.113.${String(100 + attempt)}`)
        .send({ code: '000000' })
        .expect(401)
    }

    const held = await post('/two-factor/verify-totp', await codeAsked('gesperrt@nord.example.de'))
      .set('x-forwarded-for', '198.51.100.200')
      .send({ code: await currentCode(totpUri) })

    expect(held.status).toBe(429)

    await admin.query(
      'update auth_two_factors set failed_verification_count = 0, locked_until = null where user_id = $1',
      [userId],
    )
  })
})

/**
 * The second factor itself, past the sign in (opengewerk-haustechnik#360):
 * whoever has a session and knows the password, but not the phone, gets no
 * copy of the app, cannot switch it off and makes no recovery codes of their
 * own. The codes are new only after the password and the code from the app,
 * as a sign in asks for both, and the account is told.
 */
describe('the second factor of an account', () => {
  it('is not read, switched off or renewed with a session and the password alone', async () => {
    const email = 'nur-passwort@nord.example.de'

    await leader(email)
    const { totpUri, backupCodes } = await setUpApp(email)
    const cookies = await withCode(email, totpUri)
    const before = told.length

    await post('/two-factor/get-totp-uri', cookies).send({ password }).expect(404)
    await post('/two-factor/disable', cookies).send({ password }).expect(404)

    const refused = await post('/two-factor/generate-backup-codes', cookies)
      .send({ password })
      .expect(403)

    expect((refused.body as { code?: string }).code).toBe('RECONFIRMATION_REQUIRED')
    expect(told).toHaveLength(before)

    // The app still asks at the sign in, and the codes of before still open.
    await codeAsked(email)
    await post('/two-factor/verify-backup-code', await codeAsked(email))
      .send({ code: backupCodes[0] })
      .expect(200)
  })

  it('makes new recovery codes after the password and the code, once, and tells the account', async () => {
    const email = 'neue-codes@nord.example.de'
    const userId = await leader(email)
    const { totpUri, backupCodes } = await setUpApp(email)
    const cookies = await withCode(email, totpUri)
    const before = told.length

    await post('/reconfirm', cookies)
      .send({ password, code: await currentCode(totpUri) })
      .expect(200)

    const renewed = await post('/two-factor/generate-backup-codes', cookies)
      .send({ password })
      .expect(200)
    const fresh = (renewed.body as { backupCodes: string[] }).backupCodes

    expect(fresh).toHaveLength(backupCodes.length)
    await waitForTold(before + 1)
    expect(told.slice(before)).toEqual([{ id: userId, email, name: 'Lena Leitung' }])

    // The confirmation is spent with the first set.
    await post('/two-factor/generate-backup-codes', cookies).send({ password }).expect(403)

    // The old codes are gone, the new ones open.
    await post('/two-factor/verify-backup-code', await codeAsked(email))
      .send({ code: backupCodes[1] })
      .expect(401)
    await post('/two-factor/verify-backup-code', await codeAsked(email))
      .send({ code: fresh[0] })
      .expect(200)
  })

  it('makes no new recovery codes for a day after a reset of the password', async () => {
    const email = 'zurueckgesetzt@nord.example.de'
    const userId = await leader(email)
    const { totpUri } = await setUpApp(email)
    const cookies = await withCode(email, totpUri)

    await recordPasswordReset(database, userId)
    await post('/reconfirm', cookies)
      .send({ password, code: await currentCode(totpUri) })
      .expect(200)

    const refused = await post('/two-factor/generate-backup-codes', cookies)
      .send({ password })
      .expect(403)

    expect((refused.body as { code?: string }).code).toBe('PASSWORD_RECENTLY_RESET')
  })
})

/** The notice is not awaited by the route; it has arrived once the list is this long. */
async function waitForTold(length: number): Promise<void> {
  for (let tries = 0; tries < 50 && told.length < length; tries += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}
