import type { TenantId } from '@opengewerk/platform-domain'
import { eq } from 'drizzle-orm'
import type { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { newId } from '../database/identifier.js'
import { auditEntries, invitations } from '../schema.js'
import { mintToken } from './invitation.js'
import {
  type ProbeFoundation,
  probeFoundation,
  type ProbeInstance,
  probeInstance,
  probeOrigin as origin,
} from './probe-application.js'
import { addStaffMember } from './staff.js'

/**
 * The far end of a one time link, through HTTP: somebody who was handed a
 * token and nothing else gets an account with a password nobody else knows,
 * and a place in the tenant the link was made for. Once, and only while the
 * link is good.
 *
 * How a link comes into being is the administration of a tenant and tested
 * with it. Here the invitation is a row, written the way that would write it.
 */

const north = { id: newId<'tenant'>(), name: 'Mandant Nord' }
const south = { id: newId<'tenant'>(), name: 'Mandant Süd' }
const password = 'ein-ordentlich-langes-passwort'

let foundation: ProbeFoundation
let admin: Pool
let instance: ProbeInstance
let inviter = ''

function http() {
  return instance.http()
}

/** An invitation into a tenant, and the token only the invited person gets. */
async function invite(
  person: { readonly email: string; readonly name: string },
  options: {
    readonly tenantId?: TenantId
    readonly roles?: readonly string[]
    readonly expiresAt?: Date
    readonly revokedAt?: Date
  } = {},
): Promise<string> {
  const tenantId = options.tenantId ?? north.id
  const { token, hash } = mintToken()

  await instance.database.forTenant(
    { tenantId, userId: inviter, reason: 'membership.write' },
    (tx) =>
      tx.insert(invitations).values({
        tenantId,
        email: person.email,
        name: person.name,
        roles: options.roles ?? ['member'],
        tokenHash: hash,
        invitedBy: inviter,
        expiresAt: options.expiresAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        revokedAt: options.revokedAt ?? null,
      }),
  )

  return token
}

function redeem(token: string, body: Record<string, unknown> = { password }) {
  return http().post(`/invitation/${token}`).set('origin', origin).send(body)
}

async function rolesIn(tenantId: TenantId, email: string): Promise<readonly string[] | undefined> {
  const { rows } = await admin.query<{ roles: string[] }>(
    `select m.roles from memberships m join auth_users u on u.id = m.user_id
      where m.tenant_id = $1 and u.email = $2`,
    [tenantId, email],
  )

  return rows[0]?.roles
}

/** Waits until this many sessions stand in line for a row somebody else holds. */
async function standingInLine(sessions: number): Promise<void> {
  const deadline = Date.now() + 10_000

  for (;;) {
    const { rows } = await admin.query<{ waiting: number }>(
      `select count(*)::int as waiting from pg_stat_activity
        where datname = current_database() and wait_event_type = 'Lock'`,
    )

    if ((rows[0]?.waiting ?? 0) >= sessions) {
      return
    }

    if (Date.now() > deadline) {
      throw new Error(`Fewer than ${String(sessions)} sessions came to wait for the row.`)
    }

    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

beforeAll(async () => {
  foundation = await probeFoundation()
  admin = await foundation.kit.connect()
  await foundation.empty(admin)
  await foundation.tenants(admin, [north, south])

  instance = await probeInstance(foundation.kit.applicationDatabaseUrl())

  inviter = (
    await addStaffMember(instance.authentication, instance.database, {
      email: 'leitung@example.de',
      name: 'Lea Leitung',
      password,
      tenantId: north.id,
      roles: ['lead'],
    })
  ).userId
  // The same person leads the tenant next door, so that a link into it has
  // somebody who made it.
  await addStaffMember(instance.authentication, instance.database, {
    email: 'leitung@example.de',
    name: 'Lea Leitung',
    password,
    tenantId: south.id,
    roles: ['lead'],
  })
})

afterAll(async () => {
  await instance.close()
  await foundation.kit.resetSchema(admin)
  await admin.end()
  foundation.remove()
})

describe('what a link is an invitation to', () => {
  it('names the tenant and the person, and says that a password is to be chosen', async () => {
    const token = await invite({ email: 'neu@example.de', name: 'Nina Neu' })

    const offer = await http().get(`/invitation/${token}`).expect(200)

    expect(offer.body).toMatchObject({
      state: 'open',
      company: north.name,
      name: 'Nina Neu',
      email: 'neu@example.de',
      knownAccount: false,
    })
  })

  it('is not there for a token that was never made, and costs no query for one that has no shape', async () => {
    const unknown = await http().get(`/invitation/${mintToken().token}`).expect(404)

    expect(unknown.body.message).toBe('Diesen Link gibt es nicht.')

    await http().get('/invitation/kein-token').expect(404)
    await redeem('kein-token').expect(404)
  })
})

describe('using a link', () => {
  it('gives somebody an account with their own password and a place in the tenant, once', async () => {
    const token = await invite(
      { email: 'kollegin@example.de', name: 'Karla Kollegin' },
      { roles: ['member'] },
    )

    const redeemed = await redeem(token).expect(201)

    expect(redeemed.body).toEqual({
      tenantId: north.id,
      company: north.name,
      email: 'kollegin@example.de',
      created: true,
    })
    expect(await rolesIn(north.id, 'kollegin@example.de')).toEqual(['member'])

    // Signing in afterwards is the ordinary sign in, with the password only
    // this person knows.
    const cookies = await instance.signIn('kollegin@example.de', password)

    expect(cookies).not.toBe('')
    expect((await http().get('/auth/tenants').set('cookie', cookies).expect(200)).body).toEqual([
      { id: north.id, name: north.name, roles: ['member'] },
    ])

    // And the link stops working, with the sentence of the application that
    // says where to ask for a new one.
    const again = await redeem(token).expect(410)

    expect(again.body.message).toBe(
      'Dieser Link wurde schon benutzt. Bitte beim Mandanten einen neuen anfordern.',
    )
    expect((await http().get(`/invitation/${token}`).expect(200)).body.state).toBe('redeemed')
  })

  it('stands in the log of the tenant, with the person who came in', async () => {
    const token = await invite({ email: 'protokoll@example.de', name: 'Paul Protokoll' })

    await redeem(token).expect(201)

    const { rows } = await admin.query<{ id: string }>(
      "select id from auth_users where email = 'protokoll@example.de'",
    )
    const joined = rows[0]?.id ?? ''

    expect(joined).not.toBe('')

    // The link marked as used and the membership, both with the one who is
    // joining on them, which is the honest answer to "how did this person get
    // in".
    const entries = await instance.database.forTenant({ tenantId: north.id }, (tx) =>
      tx
        .select({ tableName: auditEntries.tableName, reason: auditEntries.reason })
        .from(auditEntries)
        .where(eq(auditEntries.userId, joined)),
    )

    expect(new Set(entries.map((entry) => entry.tableName))).toEqual(
      new Set(['invitations', 'memberships']),
    )
    expect(new Set(entries.map((entry) => entry.reason))).toEqual(new Set(['invitation.redeem']))
  })

  it('is refused a password too short to be worth having, and stays usable', async () => {
    const token = await invite({ email: 'kurz@example.de', name: 'Karl Kurz' })

    const refused = await redeem(token, { password: 'kurz' }).expect(400)

    expect(refused.body.message).toContain('zu kurz')
    expect(await rolesIn(north.id, 'kurz@example.de')).toBeUndefined()
    expect((await http().get(`/invitation/${token}`).expect(200)).body.state).toBe('open')
  })

  /**
   * An address that already has an account keeps its password. The other way
   * round, a link made in one tenant would set a password on an account that
   * may belong to the tenant next door.
   */
  it('leaves the password of an account that is already on the instance', async () => {
    await addStaffMember(instance.authentication, instance.database, {
      email: 'beide@example.de',
      name: 'Bodo Beide',
      password,
      tenantId: north.id,
      roles: ['member'],
    })

    const token = await invite(
      { email: 'beide@example.de', name: 'Bodo Beide' },
      { tenantId: south.id },
    )

    expect((await http().get(`/invitation/${token}`).expect(200)).body).toMatchObject({
      company: south.name,
      knownAccount: true,
    })

    // No password is asked for, and one that is sent changes nothing.
    const redeemed = await redeem(token, { password: 'ein-ganz-anderes-passwort' }).expect(201)

    expect(redeemed.body).toMatchObject({ tenantId: south.id, created: false })
    expect(await instance.signIn('beide@example.de', 'ein-ganz-anderes-passwort')).toBe('')

    const cookies = await instance.signIn('beide@example.de', password)
    const choices = await http().get('/auth/tenants').set('cookie', cookies).expect(200)

    expect((choices.body as { id: string }[]).map((row) => row.id).sort()).toEqual(
      [north.id, south.id].sort(),
    )
  })

  it('is refused for a link that was called back or has run out, each with its own sentence', async () => {
    const revoked = await invite(
      { email: 'zurueck@example.de', name: 'Zora Zurück' },
      { revokedAt: new Date() },
    )
    const expired = await invite(
      { email: 'spaet@example.de', name: 'Sven Spät' },
      { expiresAt: new Date(Date.now() - 60_000) },
    )

    expect((await redeem(revoked).expect(410)).body.message).toBe(
      'Dieser Link wurde zurückgezogen. Bitte beim Mandanten nachfragen.',
    )
    expect((await redeem(expired).expect(410)).body.message).toBe(
      'Dieser Link ist abgelaufen. Bitte beim Mandanten einen neuen anfordern.',
    )
    expect((await http().get(`/invitation/${revoked}`).expect(200)).body.state).toBe('revoked')
    expect((await http().get(`/invitation/${expired}`).expect(200)).body.state).toBe('expired')
    expect(await rolesIn(north.id, 'zurueck@example.de')).toBeUndefined()
    expect(await rolesIn(north.id, 'spaet@example.de')).toBeUndefined()
  })

  /**
   * Two people with the same link at the same moment, for an account that is
   * on the instance already: the update that marks the link used is the
   * guard, the second one finds nothing left to mark and takes everything it
   * wrote back with it.
   *
   * The row is held until both have read the link as open and stand in line
   * to mark it. Left to chance, the second one reads the link on a quicker
   * machine only after the first is through and is turned away a step earlier,
   * with a 410, and the guard is never asked.
   */
  it('works once when it is used twice at the same moment', async () => {
    await addStaffMember(instance.authentication, instance.database, {
      email: 'doppelt@example.de',
      name: 'Dora Doppelt',
      password,
      tenantId: south.id,
      roles: ['member'],
    })

    const token = await invite({ email: 'doppelt@example.de', name: 'Dora Doppelt' })
    const holder = await admin.connect()

    try {
      await holder.query('begin')
      await holder.query(`select id from invitations where email = 'doppelt@example.de' for update`)

      const both = Promise.all([redeem(token), redeem(token)])

      await standingInLine(2)
      await holder.query('commit')

      const answers = await both

      expect(answers.map((answer) => answer.status).sort()).toEqual([201, 409])
      expect(answers.find((answer) => answer.status === 409)?.body.message).toBe(
        'Dieser Link wurde gerade eben schon benutzt.',
      )
      expect(await rolesIn(north.id, 'doppelt@example.de')).toEqual(['member'])
    } finally {
      // A notice and nothing else after the commit. After a failure above it
      // lets the two requests go, so that the test ends.
      await holder.query('rollback')
      holder.release()
    }
  })

  /**
   * The same for somebody new. Here the second one is stopped a step earlier,
   * by the account it would make a second time, and leaves nothing behind
   * either: one account, one membership.
   */
  it('makes one account when a link for somebody new is used twice at the same moment', async () => {
    const token = await invite({ email: 'zweimal@example.de', name: 'Zoe Zweimal' })
    const answers = await Promise.all([redeem(token), redeem(token)])
    const statuses = answers.map((answer) => answer.status).sort()

    expect(statuses[0]).toBe(201)
    expect(statuses[1]).toBeGreaterThanOrEqual(400)
    expect(statuses[1]).toBeLessThan(500)

    const { rows } = await admin.query<{ accounts: number; members: number }>(
      `select (select count(*) from auth_users where email = 'zweimal@example.de')::int as accounts,
              (select count(*) from memberships m join auth_users u on u.id = m.user_id
                where u.email = 'zweimal@example.de')::int as members`,
    )

    expect(rows).toEqual([{ accounts: 1, members: 1 }])
  })

  /**
   * A public route that changes something, and therefore one that has to
   * refuse a form on a stranger's page by itself.
   */
  it('cannot be used by a form on a foreign page', async () => {
    const token = await invite({ email: 'fremd@example.de', name: 'Fritz Fremd' })

    await http()
      .post(`/invitation/${token}`)
      .set('origin', 'https://fremde-seite.example.com')
      .send({ password })
      .expect(403)
    await http().post(`/invitation/${token}`).type('form').send({ password }).expect(415)

    expect(await rolesIn(north.id, 'fremd@example.de')).toBeUndefined()
    expect((await http().get(`/invitation/${token}`).expect(200)).body.state).toBe('open')
  })
})
