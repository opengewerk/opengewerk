import { workingInHeader } from '@opengewerk/platform-domain'
import { and, eq } from 'drizzle-orm'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { newId } from '../database/identifier.js'
import { auditEntries, authRateLimits, authUsers, invitations } from '../schema.js'
import { authenticationPath } from './authentication.js'
import { mintToken } from './invitation.js'
import {
  type ProbeFoundation,
  probeFoundation,
  probeIdentities,
  type ProbeInstance,
  probeInstance,
  probeOrigin as origin,
  reached,
} from './probe-application.js'
import { addStaffMember } from './staff.js'

/**
 * The authentication, end to end and through HTTP, because that is the only
 * way it is ever used. Nothing in here reaches past the request: a test that
 * called `identify` directly would prove the function works and say nothing
 * about whether the cookie ever arrives.
 *
 * With an application that is nobody's (`probe-application.ts`), on a database
 * that carries the foundation and nothing else.
 */

const north = { id: newId<'tenant'>(), name: 'Mandant Nord' }
const south = { id: newId<'tenant'>(), name: 'Mandant Süd' }

const password = 'ein-ordentlich-langes-passwort'

let foundation: ProbeFoundation
let admin: Pool
let instance: ProbeInstance
const others: ProbeInstance[] = []

/** Somebody in one tenant, the ordinary case. */
const member = { email: 'mitglied@example.de', name: 'Mia Mitglied' }
/** Somebody in two, which is the case the whole tenant choice exists for. */
const both = { email: 'beide@example.de', name: 'Bodo Beide' }
/** Somebody who leads a tenant, so that the second factor requirement can be looked at. */
const lead = { email: 'leitung@example.de', name: 'Lea Ohne-Zweitfaktor' }

const userIds = new Map<string, string>()

function http() {
  return instance.http()
}

/** Signs in and hands back the raw cookies, attributes and all. */
async function signInRaw(email: string): Promise<string[]> {
  const answer = await http()
    .post(`${authenticationPath}/sign-in/email`)
    .set('origin', origin)
    .send({ email, password })
    .expect(200)

  const cookies = answer.headers['set-cookie']

  return Array.isArray(cookies) ? cookies : [cookies as string]
}

function withCookies(cookies: readonly string[]): string {
  return cookies.map((cookie) => cookie.split(';')[0]).join('; ')
}

/** Signs in and hands back the cookies, the way a browser would send them. */
async function signIn(email: string): Promise<string> {
  return withCookies(await signInRaw(email))
}

/** The people the tenant of this session has, by the key of their account. */
async function membersSeen(cookies: string): Promise<string[]> {
  const seen = await http().get('/probe/members').set('cookie', cookies).expect(200)

  return (seen.body as { userId: string }[]).map((row) => row.userId)
}

beforeAll(async () => {
  foundation = await probeFoundation()
  admin = await foundation.kit.connect()
  await foundation.empty(admin)
  await foundation.tenants(admin, [north, south])

  instance = await probeInstance(foundation.kit.applicationDatabaseUrl())

  for (const [person, tenantId, role] of [
    [member, north.id, 'member'],
    [both, north.id, 'member'],
    [both, south.id, 'member'],
    [lead, north.id, 'lead'],
  ] as const) {
    const { userId } = await addStaffMember(instance.authentication, instance.database, {
      ...person,
      password,
      tenantId,
      roles: [role],
    })

    userIds.set(person.email, userId)
  }
})

afterAll(async () => {
  await instance.close()

  for (const other of others) {
    await other.close()
  }

  await foundation.kit.resetSchema(admin)
  await admin.end()
  foundation.remove()
})

describe('signing in', () => {
  it('gets somebody as far as the choice of tenant and no further', async () => {
    const cookies = await signIn(member.email)

    // Signed in, so the routes around the choice answer.
    const choices = await http().get('/auth/tenants').set('cookie', cookies).expect(200)
    expect(choices.body).toEqual([{ id: north.id, name: north.name, roles: ['member'] }])

    // And the data still does not, because no tenant has been chosen. A 401
    // with its own sentence, in the words of the application: the way out is
    // not to sign in again.
    const refused = await http().get('/probe/members').set('cookie', cookies).expect(401)
    expect(refused.body.message).toBe(
      'Es ist noch kein Mandant gewählt. Bitte zuerst einen Mandanten auswählen.',
    )
  })

  it('opens the data once a tenant is chosen', async () => {
    const cookies = await signIn(member.email)

    await instance.chooseTenant(cookies, north.id)

    expect(await membersSeen(cookies)).toContain(userIds.get(member.email))
  })

  it('is refused with the wrong password, and says nothing more than that', async () => {
    const refused = await http()
      .post(`${authenticationPath}/sign-in/email`)
      .set('origin', origin)
      .send({ email: member.email, password: 'falsch-aber-lang-genug' })

    expect(refused.status).toBeGreaterThanOrEqual(400)
    expect(JSON.stringify(refused.body)).not.toContain(member.name)
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

    const created = await instance.database.forInstance((tx) =>
      tx.select().from(authUsers).where(eq(authUsers.email, 'fremd@example.de')),
    )
    expect(created).toEqual([])
  })
})

describe('putting somebody into a tenant', () => {
  /**
   * Whether the account came into being here or was already on the instance.
   *
   * The command line needs the answer, and not for a nicer sentence: an
   * account that was already there keeps the password it had, so a command
   * that printed the one it brought along would be naming a password that does
   * not work. Somebody in two tenants is the ordinary case for the second
   * half, not an edge one.
   */
  it('says whether the account was new, because a second tenant reuses it', async () => {
    const fresh = await addStaffMember(instance.authentication, instance.database, {
      email: 'neu@example.de',
      name: 'Nina Neu',
      password,
      tenantId: north.id,
      roles: ['member'],
    })

    expect(fresh.created).toBe(true)

    const again = await addStaffMember(instance.authentication, instance.database, {
      email: 'neu@example.de',
      name: 'Nina Neu',
      password: 'ein-ganz-anderes-passwort',
      tenantId: south.id,
      roles: ['member'],
    })

    expect(again.created).toBe(false)
    expect(again.userId).toBe(fresh.userId)

    // And the password really is the first one, which is what the flag is
    // there to let a caller say out loud.
    expect(await instance.signIn('neu@example.de', 'ein-ganz-anderes-passwort')).toBe('')
    expect(await instance.signIn('neu@example.de', password)).not.toBe('')
  })
})

describe('the choice of tenant', () => {
  it('offers somebody in two tenants both of them', async () => {
    const cookies = await signIn(both.email)

    const choices = await http().get('/auth/tenants').set('cookie', cookies).expect(200)

    expect((choices.body as { id: string }[]).map((row) => row.id).sort()).toEqual(
      [north.id, south.id].sort(),
    )
  })

  /**
   * The oldest promise in the server, from the other side. `authorization.test`
   * says a tenant in a request body is ignored; this says the one place a
   * tenant can be named is checked against a membership before it is believed.
   */
  it('refuses a tenant somebody is not part of', async () => {
    const cookies = await signIn(member.email)

    const refused = await http()
      .post('/auth/tenant')
      .set('cookie', cookies)
      .set('origin', origin)
      .send({ tenantId: south.id })
      .expect(403)

    expect(refused.body.message).toBe('Kein Zugang zu diesem Mandanten.')

    // And it really did not take, rather than answering 403 and going through.
    await http().get('/probe/members').set('cookie', cookies).expect(401)
  })

  it('refuses a tenant that does not exist, with the same answer', async () => {
    const cookies = await signIn(member.email)

    const refused = await http()
      .post('/auth/tenant')
      .set('cookie', cookies)
      .set('origin', origin)
      .send({ tenantId: newId<'tenant'>() })
      .expect(403)

    // The same sentence as above. Telling the two apart would turn this route
    // into a way of finding out which tenants are on an instance.
    expect(refused.body.message).toBe('Kein Zugang zu diesem Mandanten.')
  })

  it('keeps the two tenants of one person apart', async () => {
    const inNorth = await signIn(both.email)
    await instance.chooseTenant(inNorth, north.id)

    const inSouth = await signIn(both.email)
    await instance.chooseTenant(inSouth, south.id)

    // The same person, and each session sees the people of its own tenant:
    // the one who works only in the north is not in the south.
    expect(await membersSeen(inNorth)).toContain(userIds.get(member.email))
    expect(await membersSeen(inSouth)).not.toContain(userIds.get(member.email))
    expect(await membersSeen(inSouth)).toContain(userIds.get(both.email))
  })

  /**
   * The switch between two tenants without signing in again (#242). The
   * session goes over, and the stretch of work in the first tenant ends
   * there, in its own log, instead of staying open because the sign out
   * later closes only what is open in the tenant chosen last.
   */
  it('moves one session from one tenant to the other, and ends the work in the first', async () => {
    const cookies = await signIn(both.email)

    await instance.chooseTenant(cookies, north.id)
    expect(await membersSeen(cookies)).toContain(userIds.get(member.email))

    await instance.chooseTenant(cookies, south.id)
    expect(await membersSeen(cookies)).not.toContain(userIds.get(member.email))

    const { rows } = await admin.query<{ tenant_id: string; ended: boolean }>(
      `select s.tenant_id, s.ended_at is not null as ended
         from tenant_sessions s
         join auth_users u on u.id = s.user_id
        where u.email = $1 and s.session_id = (
          select id from auth_sessions where user_id = u.id order by created_at desc limit 1)`,
      [both.email],
    )

    expect(rows.find((row) => row.tenant_id === north.id)?.ended).toBe(true)
    expect(rows.find((row) => row.tenant_id === south.id)?.ended).toBe(false)

    const ended = await instance.database.forTenant({ tenantId: north.id }, (tx) =>
      tx
        .select({ reason: auditEntries.reason })
        .from(auditEntries)
        .where(
          and(eq(auditEntries.tableName, 'tenant_sessions'), eq(auditEntries.field, 'ended_at')),
        ),
    )

    expect(ended.some((entry) => entry.reason === 'session.switch')).toBe(true)
  })

  /**
   * The other tab (#242): a page that still works in the first tenant sends
   * its tenant along, and the server refuses it instead of taking what it
   * sends into the second. Without the header, as before, nothing changes.
   */
  it('refuses a page that still works in the tenant the session left', async () => {
    const cookies = await signIn(both.email)

    await instance.chooseTenant(cookies, north.id)
    await instance.chooseTenant(cookies, south.id)

    const left = await http()
      .get('/probe/members')
      .set('cookie', cookies)
      .set(workingInHeader, north.id)
      .expect(401)

    expect((left.body as { message: string }).message).toBe(
      'Diese Seite arbeitet noch bei einem anderen Mandanten.',
    )

    const before = reached.written

    await http()
      .post('/probe/notes')
      .set('cookie', cookies)
      .set('origin', origin)
      .set(workingInHeader, north.id)
      .send({ text: 'Aus dem alten Tab' })
      .expect(401)

    // Refused before the handler, so nothing of the old tab was written.
    expect(reached.written).toBe(before)

    await http()
      .get('/probe/members')
      .set('cookie', cookies)
      .set(workingInHeader, south.id)
      .expect(200)
    await http()
      .post('/probe/notes')
      .set('cookie', cookies)
      .set('origin', origin)
      .set(workingInHeader, south.id)
      .send({ text: 'Aus dem neuen Tab' })
      .expect(201, { tenantId: south.id })
    await http().get('/probe/members').set('cookie', cookies).expect(200)
  })
})

describe('the second factor', () => {
  /**
   * ADR 0006 hangs this on the role and not on a setting, so it is checked on
   * every request rather than once at sign in: somebody given such a role an
   * hour ago is stopped at their next request without anybody having to
   * remember to look at them again. Which roles those are, the application
   * says.
   */
  it('is required of a role the application names, which gets no further than the choice without one', async () => {
    const cookies = await signIn(lead.email)

    // The choice still works, otherwise there would be no way to get to the
    // screen that sets a second factor up.
    await http().get('/auth/tenants').set('cookie', cookies).expect(200)
    await instance.chooseTenant(cookies, north.id)

    const refused = await http().get('/probe/members').set('cookie', cookies).expect(403)
    expect(refused.body.message).toContain('zweiter Faktor')
    // Both ways out (#167): the app, or signing in with a passkey.
    expect(refused.body.message).toContain('Authenticator-App')
    expect(refused.body.message).toContain('Passkey')
  })

  /**
   * Passkeys were off from 23.09.2026 (GHSA-jghx-6wmh-mpcj): a session could
   * register one without confirming anything, and signing in with it skipped
   * the second factor. They came back with #167, and the first half of that
   * advisory is what this holds: a session alone registers nothing, however
   * young it is. The rest is in `passkeys.test.ts`, which also signs in with
   * one and shows that only one confirmed on the device counts.
   */
  it('cannot be gone round by registering a passkey with a session alone', async () => {
    const cookies = await signIn(lead.email)

    const refused = await http()
      .get(`${authenticationPath}/passkey/generate-register-options`)
      .set('cookie', cookies)
      .expect(403)

    expect(refused.body.message).toContain('mit dem Passwort bestätigen')

    await http()
      .post(`${authenticationPath}/passkey/verify-registration`)
      .set('cookie', cookies)
      .set('origin', origin)
      .send({ response: {}, name: 'Ohne Bestätigung' })
      .expect(403)
  })

  it('is not required of a role the application does not name, which works as usual', async () => {
    const cookies = await signIn(member.email)

    await instance.chooseTenant(cookies, north.id)
    await http().get('/probe/members').set('cookie', cookies).expect(200)
  })
})

describe('devices', () => {
  it('are listed for their own account only, with the current one marked', async () => {
    const first = await signIn(member.email)
    const second = await signIn(member.email)

    const seen = await http().get('/auth/devices').set('cookie', second).expect(200)
    const rows = seen.body as { sessionId: string; current: boolean }[]

    expect(rows.length).toBeGreaterThanOrEqual(2)
    expect(rows.filter((row) => row.current)).toHaveLength(1)

    // Somebody else's list is not in it.
    const otherCookies = await signIn(both.email)
    const other = await http().get('/auth/devices').set('cookie', otherCookies).expect(200)
    const mine = new Set(rows.map((row) => row.sessionId))
    for (const row of other.body as { sessionId: string }[]) {
      expect(mine.has(row.sessionId)).toBe(false)
    }

    expect(first.length).toBeGreaterThan(0)
  })

  it('can be cut off from another one, and the cut off session stops working', async () => {
    const toRevoke = await signIn(member.email)
    const keeping = await signIn(member.email)

    await instance.chooseTenant(toRevoke, north.id)
    await http().get('/probe/members').set('cookie', toRevoke).expect(200)

    // Asked of the session that is about to be cut off, not of the one doing
    // the cutting. Earlier tests in this file left this account several open
    // sessions, so "the first one that is not the current one" would pick a
    // stranger and the test would prove nothing.
    const own = await http().get('/auth/devices').set('cookie', toRevoke).expect(200)
    const victim = (own.body as { sessionId: string; current: boolean }[]).find(
      (row) => row.current,
    )

    await http()
      .delete(`/auth/devices/${victim?.sessionId}`)
      .set('cookie', keeping)
      .set('origin', origin)
      .expect(200)

    // The revoked one is out, the one that did the revoking is not.
    await http().get('/probe/members').set('cookie', toRevoke).expect(401)
    await http().get('/auth/devices').set('cookie', keeping).expect(200)
  })

  it('cannot be cut off by somebody else', async () => {
    const mine = await signIn(member.email)
    const stranger = await signIn(both.email)

    const list = await http().get('/auth/devices').set('cookie', mine).expect(200)
    const target = (list.body as { sessionId: string; current: boolean }[]).find(
      (row) => row.current,
    )

    await http()
      .delete(`/auth/devices/${target?.sessionId}`)
      .set('cookie', stranger)
      .set('origin', origin)
      .expect(403)

    // Still working, so the 403 was not a 403 with the deletion happening anyway.
    await http().get('/auth/devices').set('cookie', mine).expect(200)
  })
})

describe('how long a session lasts', () => {
  const hour = 60 * 60 * 1000
  const day = 24 * hour

  /** The session cookie among what a response set, attributes and all. */
  function sessionCookie(cookies: readonly string[]): string {
    const found = cookies.find((cookie) => cookie.includes('session_token='))

    if (!found) {
      throw new Error('no session cookie in the answer')
    }

    return found
  }

  /** The row behind a cookie: its value is the token, a dot and a signature. */
  function tokenOf(cookies: readonly string[]): string {
    const value = sessionCookie(cookies).split(';')[0]?.split('=')[1] ?? ''

    return decodeURIComponent(value).split('.')[0] ?? ''
  }

  async function rowOf(cookies: readonly string[]) {
    const { rows } = await admin.query<{ expires_at: Date; long_lived: boolean }>(
      'select expires_at, long_lived from auth_sessions where token = $1',
      [tokenOf(cookies)],
    )
    const [row] = rows

    if (!row) {
      throw new Error('no session row for the cookie')
    }

    return { ...row, left: row.expires_at.getTime() - Date.now() }
  }

  async function expiresIn(cookies: readonly string[], left: number): Promise<void> {
    await admin.query('update auth_sessions set expires_at = $2 where token = $1', [
      tokenOf(cookies),
      new Date(Date.now() + left),
    ])
  }

  async function inTenant(email: string, deviceId?: string): Promise<string[]> {
    const cookies = await signInRaw(email)

    await instance.chooseTenant(withCookies(cookies), north.id, deviceId)

    return cookies
  }

  /**
   * The cookie is the long lifetime whatever the session is, and the row is
   * what decides (#124). With the short lifetime in the cookie, as before,
   * every registered device was signed out after twelve hours although its
   * row said thirty days.
   */
  it('keeps the cookie a month, and a new session short until a device is registered', async () => {
    const cookies = await signInRaw(member.email)

    expect(sessionCookie(cookies)).toContain('Max-Age=2592000')

    const fresh = await rowOf(cookies)

    expect(fresh.left).toBeGreaterThan(12 * hour - 5 * 60_000)
    expect(fresh.left).toBeLessThanOrEqual(12 * hour)
  })

  it('gives a registered device thirty days, and every other session twelve hours', async () => {
    const device = await rowOf(await inTenant(member.email, newId<'device'>()))
    const desk = await rowOf(await inTenant(member.email))

    expect(device.long_lived).toBe(true)
    expect(device.left).toBeGreaterThan(30 * day - hour)
    expect(desk.long_lived).toBe(false)
    expect(desk.left).toBeLessThanOrEqual(12 * hour)
  })

  it('names the device of the session in the identity, not what a request says', async () => {
    // What is handed to a device is measured by this (#286); a session at a
    // desk registered none.
    const deviceId = newId<'device'>()
    const source = probeIdentities(instance.authentication, instance.database)
    const device = await inTenant(member.email, deviceId)
    const desk = await inTenant(member.email)

    expect((await source.identify({ headers: { cookie: withCookies(device) } }))?.deviceId).toBe(
      deviceId,
    )
    expect(
      (await source.identify({ headers: { cookie: withCookies(desk) } }))?.deviceId,
    ).toBeUndefined()
  })

  it('renews a session in use to a full lifetime from now, by its kind', async () => {
    const desk = await inTenant(member.email)
    const device = await inTenant(member.email, newId<'device'>())

    // Last renewed two hours and two days ago.
    await expiresIn(desk, 10 * hour)
    await expiresIn(device, 28 * day)

    await http().get('/probe/members').set('cookie', withCookies(desk)).expect(200)
    await http().get('/probe/members').set('cookie', withCookies(device)).expect(200)

    expect((await rowOf(desk)).left).toBeGreaterThan(12 * hour - 5 * 60_000)
    expect((await rowOf(device)).left).toBeGreaterThan(30 * day - hour)
    expect((await rowOf(device)).long_lived).toBe(true)
  })

  it('leaves a session alone that was renewed a moment ago', async () => {
    const desk = await inTenant(member.email)

    await expiresIn(desk, 11 * hour + 50 * 60_000)
    await http().get('/probe/members').set('cookie', withCookies(desk)).expect(200)

    expect((await rowOf(desk)).left).toBeLessThan(11 * hour + 51 * 60_000)
  })

  /**
   * The interface asks after the session at every start and whenever it
   * comes back into view. That answer carries the cookie again, a month from
   * now, so a device in use never reaches the end of it.
   */
  it('hands the cookie out again for a month when the interface asks after the session', async () => {
    const device = await inTenant(member.email, newId<'device'>())
    const answer = await http()
      .get(`${authenticationPath}/get-session`)
      .set('cookie', withCookies(device))
      .expect(200)
    const renewed = answer.headers['set-cookie']

    expect(sessionCookie(Array.isArray(renewed) ? renewed : [String(renewed)])).toContain(
      'Max-Age=2592000',
    )
  })

  it('refuses a session whose row has run out, however long the cookie would last', async () => {
    const desk = await inTenant(member.email)

    await expiresIn(desk, -60_000)
    await http().get('/probe/members').set('cookie', withCookies(desk)).expect(401)
  })
})

describe('signing out', () => {
  it('ends the session, and the cookie stops working', async () => {
    const cookies = await signIn(member.email)

    await instance.chooseTenant(cookies, north.id)
    await http().post('/auth/sign-out').set('cookie', cookies).set('origin', origin).expect(201)

    await http().get('/probe/members').set('cookie', cookies).expect(401)
  })
})

describe('the audit log', () => {
  /**
   * What ADR 0006 asks for, and the reason `tenant_sessions` exists at all: an
   * entry needs a tenant, so a sign in can only be logged once a tenant is
   * chosen. Both ends of the stretch of work are in there, because the row is
   * written on the choice and changed on signing out, and the audit trigger
   * watches it like any other table.
   */
  it('holds both ends of a stretch of work in the tenant it happened in', async () => {
    const cookies = await signIn(member.email)

    await instance.chooseTenant(cookies, north.id)
    await http().post('/auth/sign-out').set('cookie', cookies).set('origin', origin).expect(201)

    const entries = await instance.database.forTenant({ tenantId: north.id }, (tx) =>
      tx
        .select({ reason: auditEntries.reason, field: auditEntries.field })
        .from(auditEntries)
        .where(eq(auditEntries.tableName, 'tenant_sessions')),
    )

    const reasons = new Set(entries.map((entry) => entry.reason))
    expect(reasons.has('session.start')).toBe(true)
    expect(reasons.has('session.end')).toBe(true)
    // The end is an update to `ended_at`, not a row that disappeared: the
    // tenant's record that somebody worked in it has to survive the sign out.
    expect(entries.some((entry) => entry.field === 'ended_at')).toBe(true)
  })

  it('records a change of rights, because a membership is an ordinary table', async () => {
    const entries = await instance.database.forTenant({ tenantId: north.id }, (tx) =>
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
   * comment. Inside a tenant the accounts are out of reach; outside one the
   * data of a tenant is. Neither is a rule somebody has to keep: both are the
   * policies, and a query that crossed the line comes back empty instead of
   * leaking.
   */
  it('cannot see each other, whichever side the question is asked from', async () => {
    const database = instance.database

    // Something that belongs to one tenant: an invitation into it.
    await database.forTenant({ tenantId: north.id }, (tx) =>
      tx.insert(invitations).values({
        tenantId: north.id,
        email: 'gegenprobe@example.de',
        name: 'Für die Gegenprobe',
        roles: ['member'],
        tokenHash: mintToken().hash,
        invitedBy: userIds.get(lead.email) ?? '',
        expiresAt: new Date(Date.now() + 60_000),
      }),
    )

    // There are users, and there is an invitation. Proved from the side each
    // of them is visible from, so that an empty result below cannot be an
    // empty table.
    const users = await database.forInstance((tx) => tx.select().from(authUsers))
    expect(users.length).toBeGreaterThan(0)

    const invitationsFromInside = await database.forTenant({ tenantId: north.id }, (tx) =>
      tx.select().from(invitations),
    )
    expect(invitationsFromInside.length).toBeGreaterThan(0)

    // From inside the tenant: no accounts.
    const usersFromInside = await database.forTenant({ tenantId: north.id }, (tx) =>
      tx.select().from(authUsers),
    )
    expect(usersFromInside).toEqual([])

    // From outside any tenant: nothing that belongs to one.
    const invitationsFromOutside = await database.forInstance((tx) => tx.select().from(invitations))
    expect(invitationsFromOutside).toEqual([])

    // And from the tenant next door: nothing either.
    const invitationsFromNextDoor = await database.forTenant({ tenantId: south.id }, (tx) =>
      tx.select().from(invitations),
    )
    expect(invitationsFromNextDoor).toEqual([])
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
    const limited = await probeInstance(foundation.kit.applicationDatabaseUrl(), {
      secret: 'y'.repeat(64),
      rateLimited: true,
    })

    others.push(limited)

    const statuses: number[] = []

    for (let attempt = 0; attempt < 6; attempt += 1) {
      const answer = await limited
        .http()
        .post(`${authenticationPath}/sign-in/email`)
        .set('origin', origin)
        .send({ email: member.email, password: 'immer-wieder-falsch-geraten' })

      statuses.push(answer.status)
    }

    // Not "some request failed": the last one has to be the limit and not
    // another wrong password, otherwise this test would pass with no limit
    // at all.
    expect(statuses.at(-1)).toBe(429)
    expect(statuses.filter((status) => status === 429).length).toBeGreaterThan(0)
  })

  /**
   * A recovery code is a second factor as much as the code from the app, and
   * an account has ten of them (#125). better-auth's plugin limits its routes
   * to three in ten seconds, which is eighteen guesses a minute; the rule of
   * ours is five a minute, like the code from the app. So five guesses, then
   * the window of the plugin is moved past, and the sixth still has to be
   * refused: only the minute of our rule refuses it there.
   */
  it('stop somebody working through recovery codes, five a minute and not eighteen', async () => {
    const limited = await probeInstance(foundation.kit.applicationDatabaseUrl(), {
      secret: 'x'.repeat(64),
      rateLimited: true,
    })

    others.push(limited)

    const guess = () =>
      limited
        .http()
        .post(`${authenticationPath}/two-factor/verify-backup-code`)
        .set('origin', origin)
        .send({ code: 'abcde-fghij' })

    await admin.query("delete from auth_rate_limits where key like '%verify-backup-code%'")

    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await guess()).status).not.toBe(429)
    }

    await admin.query(
      "update auth_rate_limits set last_request = last_request - 11000 where key like '%verify-backup-code%'",
    )

    expect((await guess()).status).toBe(429)
  })

  /**
   * The counter is in the database and not in memory, which is what makes the
   * limit survive a restart. Without it, anybody who can make the container
   * fall over gets a fresh allowance for free, and during an update that
   * happens on purpose.
   */
  it('are counted in the database, so a restart does not hand out a fresh allowance', async () => {
    const counters = await instance.database.forInstance((tx) => tx.select().from(authRateLimits))

    expect(counters.length).toBeGreaterThan(0)
  })
})

describe('an instance that has been closed', () => {
  /**
   * What an operator switches on during a restore. It is the state a server
   * is in before there is an authentication, and it stays available: closing
   * swaps the identity source and leaves better-auth unmounted, so there is
   * not even a sign in to get half way through, and the ways in for somebody
   * without an account are not on the routing table at all.
   */
  it('answers what is public and refuses everything else, the sign in included', async () => {
    const closed = await probeInstance(foundation.kit.applicationDatabaseUrl(), { closed: true })

    others.push(closed)

    const ask = () => request(closed.app.getHttpServer())

    await ask().get('/probe/health').expect(200)
    await ask().get('/probe/members').expect(401)
    await ask().get('/auth/tenants').expect(401)
    // Not mounted at all, so there is nothing to post a password to.
    await ask()
      .post(`${authenticationPath}/sign-in/email`)
      .send({ email: member.email, password })
      .expect(404)
    // Neither is the first run or the far end of a link.
    await ask().get('/setup').expect(404)
    await ask().get(`/invitation/${mintToken().token}`).expect(404)
  })
})
