import { base32 } from '@better-auth/utils/base32'
import { createOTP } from '@better-auth/utils/otp'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import type { TenantId } from '@opengewerk/domain'
import { toNodeHandler } from 'better-auth/node'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Authentication } from '../authentication/authentication.js'
import { authenticationPath, createAuthentication } from '../authentication/authentication.js'
import { SessionIdentitySource } from '../authentication/session-identity.js'
import { addStaffMember } from '../authentication/staff.js'
import { Database } from '../database/database.js'
import { newId } from '../database/identifier.js'
import {
  allowApplicationLogin,
  applicationDatabaseUrl,
  applyMigrations,
  connect,
  resetSchema,
} from '../database/test-database.js'
import { ApiModule } from './api.module.js'

/**
 * The user administration, end to end and through HTTP.
 *
 * Every check in here is one of the things the issue asked for by name, and
 * each is a way of getting this wrong that leaves something still looking like
 * a working screen: a list that quietly includes the company next door, a
 * block that takes effect at the next sign in rather than now, a business that
 * talks its last owner out of the owner role and locks itself out.
 *
 * It runs against a real PostgreSQL, because most of what is being checked is
 * a policy and not a line of TypeScript.
 */

const north = { id: newId<'tenant'>(), name: 'Elektro Nord GmbH' }
const south = { id: newId<'tenant'>(), name: 'Elektro Süd GmbH' }

const origin = 'https://opengewerk.example.de'
const password = 'ein-ordentlich-langes-passwort'

const chefin = { email: 'chefin@nord.example.de', name: 'Christa Chefin' }
const beate = { email: 'buero@nord.example.de', name: 'Beate Büro' }
const max = { email: 'monteur@nord.example.de', name: 'Max Monteur' }
const sued = { email: 'chef@sued.example.de', name: 'Sven Süd' }

let admin: Pool
let database: Database
let authentication: Authentication
let app: INestApplication

/** The address an authenticator app was fed, per account that has one. */
const secondFactors = new Map<string, string>()
/** The identifiers `addStaffMember` handed back, per address. */
const userIds = new Map<string, string>()

function http() {
  return request(app.getHttpServer())
}

function cookiesOf(answer: { headers: Record<string, unknown> }): string {
  const raw = answer.headers['set-cookie']
  const list = Array.isArray(raw) ? (raw as string[]) : typeof raw === 'string' ? [raw] : []

  return list.map((cookie) => cookie.split(';')[0]).join('; ')
}

/** A code the way the authenticator app on somebody's phone would produce it. */
async function currentCode(totpUri: string): Promise<string> {
  const encoded = new URL(totpUri).searchParams.get('secret') ?? ''
  const secret = new TextDecoder().decode(base32.decode(encoded))

  return createOTP(secret, { digits: 6, period: 30 }).totp()
}

/**
 * Signs in and answers the second factor if one is asked for, stopping short
 * of the choice of business.
 *
 * Anybody who has been an owner here has a factor, because ADR 0006 gives them
 * no choice, and it stays on the account afterwards. Written once rather than
 * in each test, because none of these tests is about that flow; there is one
 * that is, in `setup.test.ts`.
 */
async function signIn(email: string, secret = password): Promise<string> {
  const answer = await http()
    .post(`${authenticationPath}/sign-in/email`)
    .set('origin', origin)
    .send({ email, password: secret })
    .expect(200)

  const cookies = cookiesOf(answer)
  const totpUri = secondFactors.get(email)

  if (answer.body.twoFactorRedirect !== true || !totpUri) {
    return cookies
  }

  const verified = await http()
    .post(`${authenticationPath}/two-factor/verify-totp`)
    .set('cookie', cookies)
    .set('origin', origin)
    .send({ code: await currentCode(totpUri) })
    .expect(200)

  return cookiesOf(verified) || cookies
}

/** Signs in and picks a business, which is where work actually starts. */
async function workIn(email: string, tenantId: TenantId, secret = password): Promise<string> {
  const cookies = await signIn(email, secret)

  await http()
    .post('/auth/tenant')
    .set('cookie', cookies)
    .set('origin', origin)
    .send({ tenantId })
    .expect(201)

  return cookies
}

/** Gives an account the second factor its role makes compulsory. */
async function setUpSecondFactor(email: string): Promise<void> {
  const answer = await http()
    .post(`${authenticationPath}/sign-in/email`)
    .set('origin', origin)
    .send({ email, password })
    .expect(200)

  const cookies = cookiesOf(answer)

  const started = await http()
    .post(`${authenticationPath}/two-factor/enable`)
    .set('cookie', cookies)
    .set('origin', origin)
    .send({ password, method: 'totp' })
    .expect(200)

  const totpUri = started.body.totpURI as string

  await http()
    .post(`${authenticationPath}/two-factor/verify-totp`)
    .set('cookie', cookies)
    .set('origin', origin)
    .send({ code: await currentCode(totpUri) })
    .expect(200)

  secondFactors.set(email, totpUri)
}

/** What the audit log of one business says about one table and one field. */
async function logged(
  tenantId: TenantId,
  table: string,
  field: string,
): Promise<{ old_value: string | null; new_value: string | null; reason: string | null }[]> {
  const { rows } = await admin.query<{
    old_value: string | null
    new_value: string | null
    reason: string | null
  }>(
    `select old_value, new_value, reason
       from audit_entries
      where tenant_id = $1 and table_name = $2 and field = $3
      order by sequence`,
    [tenantId, table, field],
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
    secret: 'y'.repeat(64),
    trustedOrigins: [origin],
    // Off, because several tests sign in more than once from the same address
    // and the limit would be what the sixth one measured.
    rateLimited: false,
  })

  const built = await Test.createTestingModule({
    imports: [
      ApiModule.create(database, new SessionIdentitySource(authentication, database), {
        authentication,
        trustedOrigins: [origin],
      }),
    ],
  }).compile()

  app = built.createNestApplication()
  app.use(authenticationPath, toNodeHandler(authentication))
  await app.init()

  for (const [person, tenantId, roles] of [
    [chefin, north.id, ['owner']],
    [beate, north.id, ['office']],
    [max, north.id, ['technician']],
    [sued, south.id, ['owner']],
  ] as const) {
    const { userId } = await addStaffMember(authentication, database, {
      ...person,
      password,
      tenantId,
      roles: [...roles],
    })

    userIds.set(person.email, userId)
  }

  await setUpSecondFactor(chefin.email)
  await setUpSecondFactor(sued.email)
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
})

describe('the list of people in a business', () => {
  it('names everybody here, with what they may do and when they were last seen', async () => {
    const cookies = await workIn(chefin.email, north.id)
    const answer = await http().get('/staff').set('cookie', cookies).expect(200)

    const byEmail = new Map(
      (answer.body as { email: string; name: string; roles: string[] }[]).map((entry) => [
        entry.email,
        entry,
      ]),
    )

    expect([...byEmail.keys()].sort()).toEqual([chefin.email, beate.email, max.email].sort())
    expect(byEmail.get(max.email)?.roles).toEqual(['technician'])
    expect(byEmail.get(max.email)?.name).toBe(max.name)

    // The person asking has just signed in, so the business has seen them.
    const self = answer.body.find((entry: { email: string }) => entry.email === chefin.email) as {
      lastSignInAt: string | null
    }
    expect(self.lastSignInAt).not.toBeNull()
  })

  /**
   * The half of the isolation that a `where` clause alone would not give.
   *
   * The accounts live outside any business and are readable from there, so the
   * only thing keeping one company's office out of another's staff is that the
   * identifiers it asks about came from its own memberships. This is that
   * claim, measured: the owner of the south sees the south and nothing else,
   * and cannot reach into the north by naming somebody in it.
   */
  it('does not reach into another business, by reading or by writing', async () => {
    const cookies = await workIn(sued.email, south.id)

    const list = await http().get('/staff').set('cookie', cookies).expect(200)
    expect(list.body).toHaveLength(1)
    expect(list.body[0].email).toBe(sued.email)

    const stranger = userIds.get(max.email) as string

    // Not a 403 but a 404, and the same answer as for somebody who does not
    // exist at all. Telling the two apart would make this a way of asking who
    // has an account on the instance.
    await http()
      .patch(`/staff/${stranger}`)
      .set('cookie', cookies)
      .set('origin', origin)
      .send({ roles: ['owner'] })
      .expect(404)

    await http()
      .put(`/staff/${stranger}/block`)
      .set('cookie', cookies)
      .set('origin', origin)
      .expect(404)

    await http().get(`/staff/${stranger}/devices`).set('cookie', cookies).expect(404)
  })

  /**
   * The office role is not the office application.
   *
   * Somebody who can hand out roles can hand themselves the owner role, so
   * `membership.read` and `membership.write` belong to the owner alone. The
   * screen lives in the office application because that is where a desk is,
   * not because the office role reaches it.
   */
  it('is not open to the office role, although the screen lives in the office', async () => {
    const cookies = await workIn(beate.email, north.id)

    const refused = await http().get('/staff').set('cookie', cookies).expect(403)
    expect(refused.body.message).toContain('Zugänge ansehen')

    await http()
      .post('/staff')
      .set('cookie', cookies)
      .set('origin', origin)
      .send({ email: 'neu@nord.example.de', name: 'Neu', roles: ['technician'] })
      .expect(403)
  })
})

describe('a new colleague', () => {
  /**
   * The whole point of the link, and the sentence from the issue that decided
   * it: a password a colleague knows and that then stays for three years is
   * worse than one nobody knows.
   *
   * So what is measured here is not only that the new person gets in. It is
   * that what gets them in is something the office never saw. The office is
   * handed a token; the password is typed by the person the token was made
   * for, and the token stops working the moment it is used.
   */
  it('gets in with a password the office never saw, and the link then stops working', async () => {
    const cookies = await workIn(chefin.email, north.id)

    const invited = await http()
      .post('/staff')
      .set('cookie', cookies)
      .set('origin', origin)
      .send({ email: 'neue@nord.example.de', name: 'Nele Neu', roles: ['technician'] })
      .expect(201)

    const token = invited.body.token as string
    expect(token).toHaveLength(43)

    // What the database keeps is the hash, so the token is in the answer and
    // nowhere else. A copy of the table opens nothing.
    const stored = await admin.query<{ token_hash: string }>(
      'select token_hash from invitations where email = $1',
      ['neue@nord.example.de'],
    )
    expect(stored.rows[0]?.token_hash).toHaveLength(64)
    expect(stored.rows[0]?.token_hash).not.toContain(token)

    const offer = await http().get(`/invitation/${token}`).expect(200)
    expect(offer.body).toMatchObject({
      state: 'open',
      company: north.name,
      name: 'Nele Neu',
      email: 'neue@nord.example.de',
      knownAccount: false,
    })

    const chosen = 'was-nur-nele-kennt'

    await http()
      .post(`/invitation/${token}`)
      .set('origin', origin)
      .send({ password: chosen })
      .expect(201)

    // And in, with the roles the office picked, in the business the token
    // named and no other.
    const asNele = await workIn('neue@nord.example.de', north.id, chosen)
    await http().get('/customers').set('cookie', asNele).expect(200)

    // Once, and once only.
    const again = await http()
      .post(`/invitation/${token}`)
      .set('origin', origin)
      .send({ password: chosen })
      .expect(410)
    expect(again.body.message).toContain('schon benutzt')
  })

  it('cannot be invited twice into the same business', async () => {
    const cookies = await workIn(chefin.email, north.id)

    const refused = await http()
      .post('/staff')
      .set('cookie', cookies)
      .set('origin', origin)
      .send({ email: max.email, name: max.name, roles: ['office'] })
      .expect(409)

    expect(refused.body.message).toContain('arbeitet schon')
  })

  it('cannot use a link the office called back', async () => {
    const cookies = await workIn(chefin.email, north.id)

    const invited = await http()
      .post('/staff')
      .set('cookie', cookies)
      .set('origin', origin)
      .send({ email: 'irrtum@nord.example.de', name: 'Falsche Adresse', roles: ['technician'] })
      .expect(201)

    const open = await http().get('/staff/invitations').set('cookie', cookies).expect(200)
    const entry = (open.body as { id: string; email: string }[]).find(
      (row) => row.email === 'irrtum@nord.example.de',
    )

    await http()
      .delete(`/staff/invitations/${entry?.id ?? ''}`)
      .set('cookie', cookies)
      .set('origin', origin)
      .expect(200)

    const refused = await http()
      .post(`/invitation/${invited.body.token as string}`)
      .set('origin', origin)
      .send({ password: 'egal-wie-lang-das-ist' })
      .expect(410)

    expect(refused.body.message).toContain('zurückgezogen')
  })

  /**
   * The same defence the first run setup carries, on the other route that
   * writes without anybody signed in.
   *
   * Without it a form on a stranger's page could redeem a link that was lying
   * in somebody's messages, and the account it created would have a password
   * whoever wrote the form chose.
   */
  it('cannot be redeemed by a form on a foreign page', async () => {
    const cookies = await workIn(chefin.email, north.id)

    const invited = await http()
      .post('/staff')
      .set('cookie', cookies)
      .set('origin', origin)
      .send({ email: 'fremd@nord.example.de', name: 'Von Fremd', roles: ['technician'] })
      .expect(201)

    const token = invited.body.token as string

    await http()
      .post(`/invitation/${token}`)
      .set('origin', 'https://fremde-seite.example')
      .send({ password: 'ein-langes-testpasswort' })
      .expect(403)

    // And the link is untouched, so the person it was meant for can still use
    // it. A refusal that burned the invitation would be a way of cancelling
    // somebody else's.
    const offer = await http().get(`/invitation/${token}`).expect(200)
    expect(offer.body.state).toBe('open')
  })

  it('is refused a password too short to be worth having', async () => {
    const cookies = await workIn(chefin.email, north.id)

    const invited = await http()
      .post('/staff')
      .set('cookie', cookies)
      .set('origin', origin)
      .send({ email: 'kurz@nord.example.de', name: 'Kurt Kurz', roles: ['technician'] })
      .expect(201)

    await http()
      .post(`/invitation/${invited.body.token as string}`)
      .set('origin', origin)
      .send({ password: 'kurz' })
      .expect(400)
  })
})

describe('changing what somebody may do', () => {
  it('takes effect at once and stands in the audit log', async () => {
    const cookies = await workIn(chefin.email, north.id)
    const maxId = userIds.get(max.email) as string

    await http()
      .patch(`/staff/${maxId}`)
      .set('cookie', cookies)
      .set('origin', origin)
      .send({ roles: ['office'] })
      .expect(200)

    const asMax = await workIn(max.email, north.id)
    // The office role may write a customer; the technician role may only
    // create one. So this is the change itself, measured on a route.
    await http()
      .post('/customers')
      .set('cookie', asMax)
      .set('origin', origin)
      .send({ kind: 'private', name: 'Kundin nach Rollenwechsel' })
      .expect(201)

    // ADR 0006 asks for a change of rights in the log, and nobody wrote a line
    // for it: `memberships` is an ordinary tenant table and the trigger from
    // 0003 watches it.
    const entries = await logged(north.id, 'memberships', 'roles')
    // An update and not one of the inserts that put these people here, which
    // carry the same field and no old value.
    const change = entries.find((entry) => entry.old_value?.includes('technician'))

    expect(change?.new_value).toContain('office')
    expect(change?.reason).toBe('membership.write')

    // Put back, so that the tests after this one find the fixture they expect.
    await http()
      .patch(`/staff/${maxId}`)
      .set('cookie', cookies)
      .set('origin', origin)
      .send({ roles: ['technician'] })
      .expect(200)
  })

  /**
   * The wall from #62, named before somebody walks into it.
   *
   * The requirement hangs on the role and is checked on every request, so
   * making somebody an owner makes a second factor compulsory for them from
   * their next request onwards. The server does not refuse that, and should
   * not: the screen warns, and the person then has a screen to set the factor
   * up on. What is measured here is that the wall is really there, because
   * that is what the warning is about.
   */
  it('makes a second factor compulsory the moment somebody becomes an owner', async () => {
    const cookies = await workIn(chefin.email, north.id)
    const asMax = await workIn(max.email, north.id)
    const maxId = userIds.get(max.email) as string

    await http().get('/customers').set('cookie', asMax).expect(200)

    await http()
      .patch(`/staff/${maxId}`)
      .set('cookie', cookies)
      .set('origin', origin)
      .send({ roles: ['owner'] })
      .expect(200)

    const stopped = await http().get('/customers').set('cookie', asMax).expect(403)
    expect(stopped.body.message).toContain('zweiter Faktor')

    await http()
      .patch(`/staff/${maxId}`)
      .set('cookie', cookies)
      .set('origin', origin)
      .send({ roles: ['technician'] })
      .expect(200)
  })

  /**
   * The refusal that keeps a business from locking itself out, and the reason
   * it has to work on the asking owner's own row.
   *
   * Only an owner has `membership.write`, so an owner changing somebody else
   * is by definition not touching the last owner: there are two of them, the
   * one asking and the one being changed. The way a business really ends up
   * with nobody is the sole owner deciding they do not need the role any more,
   * or blocking themselves by mistake. An earlier draft refused every
   * operation on one's own row, which looked careful and made the only case
   * that matters unreachable.
   *
   * Both halves are checked here, because they are two different paths to the
   * same empty chair.
   */
  it('never leaves a business without an owner who can get in', async () => {
    const cookies = await workIn(chefin.email, north.id)
    const chefinId = userIds.get(chefin.email) as string
    const maxId = userIds.get(max.email) as string
    const suedId = userIds.get(sued.email) as string

    // Christa is the only owner of the north at this point.
    const refusedDemotion = await http()
      .patch(`/staff/${chefinId}`)
      .set('cookie', cookies)
      .set('origin', origin)
      .send({ roles: ['office'] })
      .expect(409)
    expect(refusedDemotion.body.message).toContain('letzte Inhaber')

    const refusedBlock = await http()
      .put(`/staff/${chefinId}/block`)
      .set('cookie', cookies)
      .set('origin', origin)
      .expect(409)
    expect(refusedBlock.body.message).toContain('letzte Inhaber')

    // The south has an owner of its own, and it does not count here. That is
    // the whole point of doing the counting per business: otherwise one
    // company's staffing would decide what another one may do.
    const southList = await http()
      .get('/staff')
      .set('cookie', await workIn(sued.email, south.id))
      .expect(200)
    expect(southList.body).toHaveLength(1)
    expect(southList.body[0].userId).toBe(suedId)

    // With a second owner in place the same change goes through, which is what
    // makes the refusal above about the last one and not about oneself.
    await http()
      .patch(`/staff/${maxId}`)
      .set('cookie', cookies)
      .set('origin', origin)
      .send({ roles: ['owner'] })
      .expect(200)
    await setUpSecondFactor(max.email)

    await http()
      .patch(`/staff/${chefinId}`)
      .set('cookie', cookies)
      .set('origin', origin)
      .send({ roles: ['office'] })
      .expect(200)

    // And a blocked owner does not count either, which is the part easiest to
    // leave out. Max is the only one left who can get in, so he cannot take
    // himself out.
    const asMax = await workIn(max.email, north.id)
    const stillRefused = await http()
      .put(`/staff/${maxId}/block`)
      .set('cookie', asMax)
      .set('origin', origin)
      .expect(409)
    expect(stillRefused.body.message).toContain('letzte Inhaber')

    // Put the fixture back: Christa an owner again, Max a technician.
    await http()
      .patch(`/staff/${chefinId}`)
      .set('cookie', asMax)
      .set('origin', origin)
      .send({ roles: ['owner'] })
      .expect(200)
    await http()
      .patch(`/staff/${maxId}`)
      .set('cookie', await workIn(chefin.email, north.id))
      .set('origin', origin)
      .send({ roles: ['technician'] })
      .expect(200)
  })
})

describe('blocking somebody', () => {
  /**
   * "Sofort" in the issue means what it says, and a column alone does not
   * deliver it: a session that has already been handed out would go on working
   * until it ran out, which for a registered device is thirty days.
   */
  it('ends what they have open now, not when their session runs out', async () => {
    const cookies = await workIn(chefin.email, north.id)
    const asMax = await workIn(max.email, north.id)
    const maxId = userIds.get(max.email) as string

    await http().get('/customers').set('cookie', asMax).expect(200)

    await http()
      .put(`/staff/${maxId}/block`)
      .set('cookie', cookies)
      .set('origin', origin)
      .expect(200)

    // The session is gone, so the answer is 401 and not 403: there is nothing
    // left to identify.
    await http().get('/customers').set('cookie', asMax).expect(401)

    // And the business's record of them working in it is closed, rather than
    // left open pointing at a session that no longer exists.
    const open = await admin.query(
      `select 1 from tenant_sessions
        where tenant_id = $1 and user_id = $2 and ended_at is null`,
      [north.id, maxId],
    )
    expect(open.rowCount).toBe(0)

    // Signing in again gets nowhere either: the business is not offered, and
    // naming it outright is refused.
    const freshCookies = await signIn(max.email)

    const choices = await http().get('/auth/tenants').set('cookie', freshCookies).expect(200)
    expect(choices.body).toEqual([])

    await http()
      .post('/auth/tenant')
      .set('cookie', freshCookies)
      .set('origin', origin)
      .send({ tenantId: north.id })
      .expect(403)
  })

  it('leaves them in the list and in the history, because deleting would not', async () => {
    const cookies = await workIn(chefin.email, north.id)
    const maxId = userIds.get(max.email) as string

    const list = await http().get('/staff').set('cookie', cookies).expect(200)
    const blocked = (list.body as { userId: string; blockedAt: string | null }[]).find(
      (entry) => entry.userId === maxId,
    )

    expect(blocked?.blockedAt).not.toBeNull()

    // The reason a block is not a delete: everything this person ever wrote
    // still has a name against it, and the log still resolves.
    const entries = await logged(north.id, 'memberships', 'blocked_at')
    expect(entries.at(-1)?.new_value).not.toBeNull()
    expect(entries.at(-1)?.reason).toBe('membership.write')
  })

  it('is undone by letting them back in', async () => {
    const cookies = await workIn(chefin.email, north.id)
    const maxId = userIds.get(max.email) as string

    await http()
      .delete(`/staff/${maxId}/block`)
      .set('cookie', cookies)
      .set('origin', origin)
      .expect(200)

    const asMax = await workIn(max.email, north.id)
    await http().get('/customers').set('cookie', asMax).expect(200)
  })

  /**
   * A block belongs to one business and reaches no further, which is the rule
   * the whole file is built on, checked on the one operation that could break
   * it without looking as though it had.
   */
  it('shuts somebody out of one business and not of the one next door', async () => {
    const cookies = await workIn(chefin.email, north.id)
    const maxId = userIds.get(max.email) as string

    // Max joins the south as well, which is the case ADR 0006 keeps the
    // memberships per business for.
    await addStaffMember(authentication, database, {
      ...max,
      password,
      tenantId: south.id,
      roles: ['technician'],
    })

    await http()
      .put(`/staff/${maxId}/block`)
      .set('cookie', cookies)
      .set('origin', origin)
      .expect(200)

    // Shut out of the north, still at work in the south. A column on the
    // account rather than on the membership would have taken both.
    const asMax = await workIn(max.email, south.id)
    await http().get('/customers').set('cookie', asMax).expect(200)

    const choices = await http().get('/auth/tenants').set('cookie', asMax).expect(200)
    expect(choices.body).toHaveLength(1)
    expect(choices.body[0].id).toBe(south.id)

    await http()
      .delete(`/staff/${maxId}/block`)
      .set('cookie', cookies)
      .set('origin', origin)
      .expect(200)
  })
})

describe('the devices of somebody else', () => {
  /**
   * The phone in the van that was broken into. The person whose phone it is
   * can already cut it off from another device; this is for the case where the
   * phone was the other device.
   */
  it('can be seen and cut off by the owner, for this business only', async () => {
    const cookies = await workIn(chefin.email, north.id)
    const asMax = await workIn(max.email, north.id)
    const maxId = userIds.get(max.email) as string

    const devices = await http().get(`/staff/${maxId}/devices`).set('cookie', cookies).expect(200)

    expect(devices.body.length).toBeGreaterThanOrEqual(1)

    for (const device of devices.body as { sessionId: string }[]) {
      await http()
        .delete(`/staff/${maxId}/devices/${device.sessionId}`)
        .set('cookie', cookies)
        .set('origin', origin)
        .expect(200)
    }

    await http().get('/customers').set('cookie', asMax).expect(401)
  })
})
