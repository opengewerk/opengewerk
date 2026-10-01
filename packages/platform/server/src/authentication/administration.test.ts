import { ConflictException } from '@nestjs/common'
import type { InvitationId, TenantId, TenantIdentity } from '@opengewerk/platform-domain'
import type { Pool } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { newId } from '../database/identifier.js'
import { listColleagues } from './administration.js'
import { authenticationPath } from './authentication.js'
import type { InvitationMail, InvitationMailing } from './invitation-mailing.js'
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
 * Who works in a tenant and what they may do there, end to end and through
 * HTTP.
 *
 * Each check is a way of getting this wrong that leaves something still
 * looking like a working screen: a list that quietly includes the tenant next
 * door, a block that takes effect at the next sign in rather than now, a
 * tenant that talks the last one who leads it out of the role and locks
 * itself out.
 *
 * It runs against a real PostgreSQL, because most of what is being checked is
 * a policy and not a line of TypeScript, and with the probe application, so
 * that nothing in here passes because a role or a word of a real application
 * stands in the foundation.
 */

const north = { id: newId<'tenant'>(), name: 'Mandant Nord' }
const south = { id: newId<'tenant'>(), name: 'Mandant Süd' }

const password = 'ein-ordentlich-langes-passwort'

const lea = { email: 'leitung@nord.example.de', name: 'Lea Leitung' }
const mia = { email: 'mitglied@nord.example.de', name: 'Mia Mitglied' }
const gus = { email: 'gast@nord.example.de', name: 'Gus Gast' }
const sven = { email: 'leitung@sued.example.de', name: 'Sven Süd' }

let foundation: ProbeFoundation
let admin: Pool
let instance: ProbeInstance
/** The same application without anything that sends mail. */
let linksOnly: ProbeInstance

/** The address an authenticator app was fed, per account that has one. */
const secondFactors = new Map<string, string>()
/** The identifiers `addStaffMember` handed back, per address. */
const userIds = new Map<string, string>()

/**
 * What stands in for the part of an application that sends mail: whether the
 * instance sends at all, whether this tenant can, what it was handed, and how
 * a message stands.
 */
const post = {
  sends: true,
  refusal: null as Error | null,
  handed: [] as { tenantId: string; userId: string; invitationId: string }[],
  mails: new Map<string, InvitationMail>(),
}

const mailing: InvitationMailing = {
  get sender() {
    if (!post.sends) {
      return null
    }

    return {
      ready: () => (post.refusal ? Promise.reject(post.refusal) : Promise.resolve()),
      send: (identity: TenantIdentity, invitationId: InvitationId) => {
        post.handed.push({ tenantId: identity.tenantId, userId: identity.userId, invitationId })

        return Promise.resolve()
      },
    }
  },
  mailsOf: (_tx, invitationIds) => {
    const found = new Map<string, InvitationMail>()

    for (const id of invitationIds) {
      const mail = post.mails.get(id)

      if (mail) {
        found.set(id, mail)
      }
    }

    return Promise.resolve(found)
  },
}

function http() {
  return instance.http()
}

/**
 * Signs in and answers the second factor if one is asked for, stopping short
 * of the choice of tenant.
 *
 * Anybody who has led a tenant here has a factor, because the role gives them
 * no choice, and it stays on the account afterwards. Written once rather than
 * in each test, because none of these tests is about that flow.
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

/** Signs in and picks a tenant, which is where work actually starts. */
async function workIn(email: string, tenantId: TenantId, secret = password): Promise<string> {
  const cookies = await signIn(email, secret)

  await instance.chooseTenant(cookies, tenantId)

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

/** What the audit log of one tenant says about one table and one field. */
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

/** How many invitations there are for an address, used or not. */
async function invitationsFor(email: string): Promise<number> {
  const { rows } = await admin.query<{ count: number }>(
    'select count(*)::int as count from invitations where email = $1',
    [email],
  )

  return rows[0]?.count ?? 0
}

function idOf(person: { readonly email: string }): string {
  return userIds.get(person.email) as string
}

beforeAll(async () => {
  foundation = await probeFoundation()
  admin = await foundation.kit.connect()
  await foundation.empty(admin)
  await admin.query('insert into tenants (id, name) values ($1, $2), ($3, $4)', [
    north.id,
    north.name,
    south.id,
    south.name,
  ])

  const url = foundation.kit.applicationDatabaseUrl()

  instance = await probeInstance(url, { invitationMailing: mailing })
  // The same secret, so that a session of the one is a session of the other.
  linksOnly = await probeInstance(url)

  for (const [person, tenantId, roles] of [
    [lea, north.id, ['lead']],
    [mia, north.id, ['member']],
    [gus, north.id, ['guest']],
    [sven, south.id, ['lead']],
  ] as const) {
    const { userId } = await addStaffMember(instance.authentication, instance.database, {
      ...person,
      password,
      tenantId,
      roles: [...roles],
    })

    userIds.set(person.email, userId)
  }

  await setUpSecondFactor(lea.email)
  await setUpSecondFactor(sven.email)
})

afterAll(async () => {
  await linksOnly.close()
  await instance.close()
  await foundation.kit.resetSchema(admin)
  await admin.end()
  foundation.remove()
})

describe('the list of people in a tenant', () => {
  it('names everybody here, with what they may do and when they were last seen', async () => {
    const cookies = await workIn(lea.email, north.id)
    const answer = await http().get('/staff').set('cookie', cookies).expect(200)

    const byEmail = new Map(
      (answer.body as { email: string; name: string; roles: string[] }[]).map((entry) => [
        entry.email,
        entry,
      ]),
    )

    expect([...byEmail.keys()].sort()).toEqual([lea.email, mia.email, gus.email].sort())
    expect(byEmail.get(gus.email)?.roles).toEqual(['guest'])
    expect(byEmail.get(gus.email)?.name).toBe(gus.name)

    // The person asking has just signed in, so the tenant has seen them.
    const self = answer.body.find((entry: { email: string }) => entry.email === lea.email) as {
      lastSignInAt: string | null
      twoFactorEnabled: boolean
    }
    expect(self.lastSignInAt).not.toBeNull()
    expect(self.twoFactorEnabled).toBe(true)
  })

  /**
   * The half of the isolation that a `where` clause alone would not give.
   *
   * The accounts live outside any tenant and are readable from there, so the
   * only thing keeping one tenant out of the people of another is that the
   * identifiers it asks about came from its own memberships. This is that
   * claim, measured: whoever leads the south sees the south and nothing else,
   * and cannot reach into the north by naming somebody in it.
   */
  it('does not reach into another tenant, by reading or by writing', async () => {
    const cookies = await workIn(sven.email, south.id)

    const list = await http().get('/staff').set('cookie', cookies).expect(200)
    expect(list.body).toHaveLength(1)
    expect(list.body[0].email).toBe(sven.email)

    const stranger = idOf(gus)

    // Not a 403 but a 404, and the same answer as for somebody who does not
    // exist at all. Telling the two apart would make this a way of asking who
    // has an account on the instance.
    const refused = await http()
      .patch(`/staff/${stranger}`)
      .set('cookie', cookies)
      .set('origin', origin)
      .send({ roles: ['lead'] })
      .expect(404)
    expect(refused.body.message).toBe(probeAccess.sentences.notAMember)

    const nobody = await http()
      .patch(`/staff/${newId<'tenant'>()}`)
      .set('cookie', cookies)
      .set('origin', origin)
      .send({ roles: ['lead'] })
      .expect(404)
    expect(nobody.body.message).toBe(probeAccess.sentences.notAMember)

    await http()
      .put(`/staff/${stranger}/block`)
      .set('cookie', cookies)
      .set('origin', origin)
      .expect(404)

    await http().get(`/staff/${stranger}/devices`).set('cookie', cookies).expect(404)

    // And nothing happened to the one who was named.
    const untouched = await admin.query<{ roles: string[]; blocked_at: Date | null }>(
      'select roles, blocked_at from memberships where tenant_id = $1 and user_id = $2',
      [north.id, stranger],
    )
    expect(untouched.rows).toEqual([{ roles: ['guest'], blocked_at: null }])
  })

  /**
   * Somebody who can hand out roles can hand themselves the one that leads,
   * so the two rights of these routes belong to that role alone. Which role
   * holds them is the application's to say; the routes ask for the rights and
   * for nothing else.
   */
  it('is open to whoever holds the two rights, and to nobody else', async () => {
    for (const person of [mia, gus]) {
      const cookies = await workIn(person.email, north.id)

      const refused = await http().get('/staff').set('cookie', cookies).expect(403)
      expect(refused.body.message).toBe('Das Recht membership.read fehlt diesem Zugang.')

      await http().get('/staff/invitations').set('cookie', cookies).expect(403)

      const unwritten = await http()
        .post('/staff')
        .set('cookie', cookies)
        .set('origin', origin)
        .send({ email: 'neu@nord.example.de', name: 'Nora Neu', roles: ['guest'] })
        .expect(403)
      expect(unwritten.body.message).toBe('Das Recht membership.write fehlt diesem Zugang.')
    }

    expect(await invitationsFor('neu@nord.example.de')).toBe(0)
  })
})

describe('somebody new', () => {
  /**
   * The whole point of the link: a password a colleague knows and that then
   * stays for three years is worse than one nobody knows.
   *
   * So what is measured here is not only that the new person gets in. It is
   * that what gets them in is something whoever invited never saw. They are
   * handed a token; the password is typed by the person the token was made
   * for, and the token stops working the moment it is used.
   */
  it('gets in with a password nobody else saw, and the link then stops working', async () => {
    const cookies = await workIn(lea.email, north.id)

    const invited = await http()
      .post('/staff')
      .set('cookie', cookies)
      .set('origin', origin)
      .send({ email: 'Neue@Nord.Example.de ', name: ' Nele Neu ', roles: ['member'] })
      .expect(201)

    const token = invited.body.token as string
    expect(token).toHaveLength(43)
    // One spelling of an address, so that two spellings are not two people.
    expect(invited.body.email).toBe('neue@nord.example.de')

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

    // And in, with the roles that were picked, in the tenant the token named
    // and no other.
    const asNele = await signIn('neue@nord.example.de', chosen)
    const choices = await http().get('/auth/tenants').set('cookie', asNele).expect(200)
    expect(choices.body).toEqual([{ id: north.id, name: north.name, roles: ['member'] }])

    await instance.chooseTenant(asNele, north.id)
    await http().get('/probe/members').set('cookie', asNele).expect(200)

    // Once, and once only.
    const again = await http()
      .post(`/invitation/${token}`)
      .set('origin', origin)
      .send({ password: chosen })
      .expect(410)
    expect(again.body.message).toBe(probeAccess.sentences.unusableLink.redeemed)

    // Used, it is no longer among the links that are still open.
    const open = await http().get('/staff/invitations').set('cookie', cookies).expect(200)
    expect((open.body as { email: string }[]).map((row) => row.email)).not.toContain(
      'neue@nord.example.de',
    )
  })

  it('cannot be invited twice into the same tenant', async () => {
    const cookies = await workIn(lea.email, north.id)

    const refused = await http()
      .post('/staff')
      .set('cookie', cookies)
      .set('origin', origin)
      .send({ email: gus.email, name: gus.name, roles: ['member'] })
      .expect(409)

    expect(refused.body.message).toBe(probeAccess.sentences.alreadyWorksHere)
    expect(await invitationsFor(gus.email)).toBe(0)
  })

  /**
   * Which roles there are is the application's list. A role that is not on it
   * is refused with the ones that are, and an invitation without any role is
   * refused as well: such a person could sign in and do nothing.
   */
  it('is given roles the application has, and at least one of them', async () => {
    const cookies = await workIn(lea.email, north.id)
    const invite = (roles: unknown) =>
      http()
        .post('/staff')
        .set('cookie', cookies)
        .set('origin', origin)
        .send({ email: 'rolle@nord.example.de', name: 'Rolf Rolle', roles })

    const unknown = await invite(['member', 'chief']).expect(400)
    expect(unknown.body.message).toBe('Unbekannte Rollen: chief. Es gibt lead, member, guest.')

    const none = await invite([]).expect(400)
    expect(none.body.message).toContain('Mindestens eine Rolle')

    await invite('member').expect(400)
    await invite([1]).expect(400)

    expect(await invitationsFor('rolle@nord.example.de')).toBe(0)
  })

  it('cannot use a link that was called back', async () => {
    const cookies = await workIn(lea.email, north.id)

    const invited = await http()
      .post('/staff')
      .set('cookie', cookies)
      .set('origin', origin)
      .send({ email: 'irrtum@nord.example.de', name: 'Falsche Adresse', roles: ['guest'] })
      .expect(201)

    const open = await http().get('/staff/invitations').set('cookie', cookies).expect(200)
    const entry = (open.body as { id: string; email: string; mail: unknown }[]).find(
      (row) => row.email === 'irrtum@nord.example.de',
    )

    expect(entry?.id).toBe(invited.body.id)
    // Handed over as a link, there is no message to show.
    expect(entry?.mail).toBeNull()

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

    expect(refused.body.message).toBe(probeAccess.sentences.unusableLink.revoked)

    // Called back once, there is nothing left to call back.
    await http()
      .delete(`/staff/invitations/${entry?.id ?? ''}`)
      .set('cookie', cookies)
      .set('origin', origin)
      .expect(404)
  })

  /**
   * An open invitation for the same address is called back rather than
   * refused or left standing: a second link working alongside the first would
   * be a second way in left over from a mistake.
   */
  it('has one link at a time, the newest', async () => {
    const cookies = await workIn(lea.email, north.id)
    const invite = () =>
      http()
        .post('/staff')
        .set('cookie', cookies)
        .set('origin', origin)
        .send({ email: 'zweimal@nord.example.de', name: 'Zoe Zweimal', roles: ['guest'] })
        .expect(201)

    const first = (await invite()).body.token as string
    const second = (await invite()).body.token as string

    expect(second).not.toBe(first)
    expect((await http().get(`/invitation/${first}`).expect(200)).body.state).toBe('revoked')
    expect((await http().get(`/invitation/${second}`).expect(200)).body.state).toBe('open')

    const open = await http().get('/staff/invitations').set('cookie', cookies).expect(200)
    expect(
      (open.body as { email: string }[]).filter((row) => row.email === 'zweimal@nord.example.de'),
    ).toHaveLength(1)
  })

  /**
   * A link is the tenant's that made it. Whoever leads the tenant next door
   * neither sees it nor can call it back, and gets the answer for a link that
   * is not there.
   */
  it('has a link only the tenant that made it can see or call back', async () => {
    const cookies = await workIn(lea.email, north.id)
    const invited = await http()
      .post('/staff')
      .set('cookie', cookies)
      .set('origin', origin)
      .send({ email: 'nachbar@nord.example.de', name: 'Nadja Nachbar', roles: ['guest'] })
      .expect(201)

    const nextDoor = await workIn(sven.email, south.id)

    const seen = await http().get('/staff/invitations').set('cookie', nextDoor).expect(200)
    expect(seen.body).toEqual([])

    await http()
      .delete(`/staff/invitations/${invited.body.id as string}`)
      .set('cookie', nextDoor)
      .set('origin', origin)
      .expect(404)

    const offer = await http()
      .get(`/invitation/${invited.body.token as string}`)
      .expect(200)
    expect(offer.body.state).toBe('open')
  })
})

describe('an invitation by mail', () => {
  beforeEach(() => {
    post.sends = true
    post.refusal = null
    post.handed.length = 0
    post.mails.clear()
  })

  /**
   * Sent by mail, the token is nobody's to see: not in the answer, and what
   * the table keeps is the hash of one that was thrown away. Whatever sends
   * the message makes the real one when the message leaves.
   */
  it('is handed to what sends it, and no token comes back', async () => {
    const cookies = await workIn(lea.email, north.id)

    const invited = await http()
      .post('/staff')
      .set('cookie', cookies)
      .set('origin', origin)
      .send({ email: 'post@nord.example.de', name: 'Paula Post', roles: ['guest'], send: 'mail' })
      .expect(201)

    expect(invited.body.token).toBeNull()
    expect(post.handed).toEqual([
      { tenantId: north.id, userId: idOf(lea), invitationId: invited.body.id },
    ])

    const stored = await admin.query<{ token_hash: string }>(
      'select token_hash from invitations where email = $1',
      ['post@nord.example.de'],
    )
    expect(stored.rows[0]?.token_hash).toHaveLength(64)
  })

  it('shows how its message stands, under the invitation', async () => {
    const cookies = await workIn(lea.email, north.id)

    const invited = await http()
      .post('/staff')
      .set('cookie', cookies)
      .set('origin', origin)
      .send({
        email: 'stand@nord.example.de',
        name: 'Stefan Stand',
        roles: ['guest'],
        send: 'mail',
      })
      .expect(201)

    post.mails.set(invited.body.id as string, {
      status: 'failed',
      sentAt: null,
      lastError: 'Der Mailserver hat die Nachricht abgelehnt.',
    })

    const open = await http().get('/staff/invitations').set('cookie', cookies).expect(200)
    const entries = open.body as { id: string; email: string; mail: InvitationMail | null }[]

    expect(entries.find((row) => row.id === invited.body.id)?.mail).toEqual({
      status: 'failed',
      sentAt: null,
      lastError: 'Der Mailserver hat die Nachricht abgelehnt.',
    })
    // An invitation nobody mailed has no message, whatever the others have.
    expect(entries.find((row) => row.email === 'nachbar@nord.example.de')?.mail).toBeNull()
  })

  /**
   * Asked before the invitation is made. One written anyway would wait for a
   * mail server nobody set up, and whoever invited would take it for sent.
   */
  it('is refused before anything is written where the tenant cannot send', async () => {
    const cookies = await workIn(lea.email, north.id)

    post.refusal = new ConflictException('Dieser Mandant hat keinen Mailserver.')

    const refused = await http()
      .post('/staff')
      .set('cookie', cookies)
      .set('origin', origin)
      .send({ email: 'ohne@nord.example.de', name: 'Otto Ohne', roles: ['guest'], send: 'mail' })
      .expect(409)

    expect(refused.body.message).toBe('Dieser Mandant hat keinen Mailserver.')
    expect(post.handed).toEqual([])
    expect(await invitationsFor('ohne@nord.example.de')).toBe(0)
  })

  /**
   * An instance that sends no mail, and an application that has nothing that
   * would: both say so, write nothing, and the link to pass on works as ever.
   */
  it('is refused where nothing sends mail, and the link still goes', async () => {
    const cookies = await workIn(lea.email, north.id)
    const wish = { email: 'stumm@nord.example.de', name: 'Stine Stumm', roles: ['guest'] }

    post.sends = false

    for (const answering of [instance, linksOnly]) {
      const refused = await answering
        .http()
        .post('/staff')
        .set('cookie', cookies)
        .set('origin', origin)
        .send({ ...wish, send: 'mail' })
        .expect(503)

      expect(refused.body.message).toBe(
        'Diese Instanz verschickt keine E-Mails, die Einladung lässt sich deshalb nicht per ' +
          'E-Mail schicken. Der Link zum Weitergeben geht trotzdem.',
      )
    }

    expect(await invitationsFor(wish.email)).toBe(0)

    const byHand = await linksOnly
      .http()
      .post('/staff')
      .set('cookie', cookies)
      .set('origin', origin)
      .send({ ...wish, send: 'link' })
      .expect(201)

    expect(byHand.body.token).toHaveLength(43)

    // Without anything that sends, there is no message to show either.
    const open = await linksOnly.http().get('/staff/invitations').set('cookie', cookies).expect(200)
    expect(
      (open.body as { email: string; mail: unknown }[]).every((row) => row.mail === null),
    ).toBe(true)
  })

  it('is a link or a mail and nothing else', async () => {
    const cookies = await workIn(lea.email, north.id)

    const refused = await http()
      .post('/staff')
      .set('cookie', cookies)
      .set('origin', origin)
      .send({ email: 'fax@nord.example.de', name: 'Fritz Fax', roles: ['guest'], send: 'fax' })
      .expect(400)

    expect(refused.body.message).toBe('send ist "link" oder "mail".')
    expect(await invitationsFor('fax@nord.example.de')).toBe(0)
  })
})

describe('changing what somebody may do', () => {
  /**
   * At once means on the session that is already open: the roles are read
   * with every request, so nobody has to sign in again to gain a right or to
   * lose one.
   */
  it('takes effect at once and stands in the audit log', async () => {
    const cookies = await workIn(lea.email, north.id)
    const asGus = await workIn(gus.email, north.id)
    const note = () => http().post('/probe/notes').set('cookie', asGus).set('origin', origin)

    await note().expect(403)

    const changed = await http()
      .patch(`/staff/${idOf(gus)}`)
      .set('cookie', cookies)
      .set('origin', origin)
      .send({ roles: ['member', 'member'] })
      .expect(200)

    // A duplicate would land in the column as written and make two identical
    // memberships look different in the log.
    expect(changed.body).toEqual({ userId: idOf(gus), roles: ['member'] })

    await note().expect(201)

    // A change of rights belongs in the log, and nobody wrote a line for it:
    // `memberships` is an ordinary table of a tenant and the trigger watches
    // it.
    const entries = await logged(north.id, 'memberships', 'roles')
    // An update and not one of the inserts that put these people here, which
    // carry the same field and no old value.
    const change = entries.find((entry) => entry.old_value?.includes('guest'))

    expect(change?.new_value).toContain('member')
    expect(change?.reason).toBe('membership.write')

    // Put back, so that the tests after this one find the people they expect.
    await http()
      .patch(`/staff/${idOf(gus)}`)
      .set('cookie', cookies)
      .set('origin', origin)
      .send({ roles: ['guest'] })
      .expect(200)

    await note().expect(403)
  })

  it('refuses a role the application does not have, and leaves the roles as they were', async () => {
    const cookies = await workIn(lea.email, north.id)

    const refused = await http()
      .patch(`/staff/${idOf(gus)}`)
      .set('cookie', cookies)
      .set('origin', origin)
      .send({ roles: ['chief'] })
      .expect(400)

    expect(refused.body.message).toBe('Unbekannte Rollen: chief. Es gibt lead, member, guest.')

    await http()
      .patch(`/staff/${idOf(gus)}`)
      .set('cookie', cookies)
      .set('origin', origin)
      .send({ roles: [] })
      .expect(400)

    const list = await http().get('/staff').set('cookie', cookies).expect(200)
    const entry = (list.body as { userId: string; roles: string[] }[]).find(
      (row) => row.userId === idOf(gus),
    )
    expect(entry?.roles).toEqual(['guest'])
  })

  /**
   * The requirement hangs on the role and is checked on every request, so
   * giving somebody the role that leads makes a second factor compulsory for
   * them from their next request onwards. The server does not refuse that,
   * and should not: a screen warns, and the person then has a screen to set
   * the factor up on. What is measured here is that the wall is really there,
   * because that is what the warning is about.
   */
  it('makes a second factor compulsory the moment somebody gets a role that asks for one', async () => {
    const cookies = await workIn(lea.email, north.id)
    const asGus = await workIn(gus.email, north.id)

    await http().get('/probe/members').set('cookie', asGus).expect(200)

    await http()
      .patch(`/staff/${idOf(gus)}`)
      .set('cookie', cookies)
      .set('origin', origin)
      .send({ roles: ['lead'] })
      .expect(200)

    const stopped = await http().get('/probe/members').set('cookie', asGus).expect(403)
    expect(stopped.body.message).toContain('zweiter Faktor')

    await http()
      .patch(`/staff/${idOf(gus)}`)
      .set('cookie', cookies)
      .set('origin', origin)
      .send({ roles: ['guest'] })
      .expect(200)

    await http().get('/probe/members').set('cookie', asGus).expect(200)
  })

  /**
   * The refusal that keeps a tenant from locking itself out, and the reason
   * it has to work on the asking person's own row.
   *
   * The way a tenant really ends up with nobody is the only one who leads it
   * deciding they do not need the role any more, or blocking themselves by
   * mistake. An earlier draft refused every operation on one's own row, which
   * looked careful and made the only case that matters unreachable.
   *
   * Both ways to the same empty chair are checked, and the part easiest to
   * leave out: somebody who is blocked does not count as somebody who leads.
   */
  it('never leaves a tenant without somebody who leads it and can get in', async () => {
    const cookies = await workIn(lea.email, north.id)
    const change = (as: string, person: { readonly email: string }, roles: readonly string[]) =>
      http()
        .patch(`/staff/${idOf(person)}`)
        .set('cookie', as)
        .set('origin', origin)
        .send({ roles })
    const block = (as: string, person: { readonly email: string }) =>
      http()
        .put(`/staff/${idOf(person)}/block`)
        .set('cookie', as)
        .set('origin', origin)

    // Lea is the only one who leads the north at this point.
    const refusedChange = await change(cookies, lea, ['member']).expect(409)
    expect(refusedChange.body.message).toBe(probeAccess.sentences.lastLead)

    const refusedBlock = await block(cookies, lea).expect(409)
    expect(refusedBlock.body.message).toBe(probeAccess.sentences.lastLead)

    // The south has somebody who leads it, and that does not count here. That
    // is the whole point of doing the counting per tenant: otherwise the
    // people of one would decide what another may do.
    const southList = await http()
      .get('/staff')
      .set('cookie', await workIn(sven.email, south.id))
      .expect(200)
    expect(
      (southList.body as { roles: string[] }[]).filter((row) => row.roles.includes('lead')),
    ).toHaveLength(1)

    // With a second one in place, shut out, the first still cannot go:
    // somebody who cannot get in does not lead anything.
    await change(cookies, mia, ['lead']).expect(200)
    await setUpSecondFactor(mia.email)
    await block(cookies, mia).expect(200)

    const stillRefused = await change(cookies, lea, ['member']).expect(409)
    expect(stillRefused.body.message).toBe(probeAccess.sentences.lastLead)

    // Let back in, the same change goes through, which is what makes the
    // refusals above about the last one and not about oneself.
    await http()
      .delete(`/staff/${idOf(mia)}/block`)
      .set('cookie', cookies)
      .set('origin', origin)
      .expect(200)
    await change(cookies, lea, ['member']).expect(200)

    // Mia is now the only one left, so she cannot take herself out either way.
    const asMia = await workIn(mia.email, north.id)

    expect((await block(asMia, mia).expect(409)).body.message).toBe(probeAccess.sentences.lastLead)
    expect((await change(asMia, mia, ['guest']).expect(409)).body.message).toBe(
      probeAccess.sentences.lastLead,
    )

    // Put back: Lea leads again, Mia works here.
    await change(asMia, lea, ['lead']).expect(200)
    await change(cookies, mia, ['member']).expect(200)
  })
})

describe('blocking somebody', () => {
  /**
   * At once means what it says, and a column alone does not deliver it: a
   * session that has already been handed out would go on working until it ran
   * out, which for a registered device is thirty days.
   */
  it('ends what they have open now, not when their session runs out', async () => {
    const cookies = await workIn(lea.email, north.id)
    const asGus = await workIn(gus.email, north.id)

    await http().get('/probe/members').set('cookie', asGus).expect(200)

    await http()
      .put(`/staff/${idOf(gus)}/block`)
      .set('cookie', cookies)
      .set('origin', origin)
      .expect(200)

    // The session is gone, so the answer is 401 and not 403: there is nothing
    // left to identify.
    await http().get('/probe/members').set('cookie', asGus).expect(401)

    // And the tenant's record of them working in it is closed, rather than
    // left open pointing at a session that no longer exists.
    const open = await admin.query(
      `select 1 from tenant_sessions
        where tenant_id = $1 and user_id = $2 and ended_at is null`,
      [north.id, idOf(gus)],
    )
    expect(open.rowCount).toBe(0)

    // Signing in again gets nowhere either: the tenant is not offered, and
    // naming it outright is refused.
    const freshCookies = await signIn(gus.email)

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
    const cookies = await workIn(lea.email, north.id)

    const list = await http().get('/staff').set('cookie', cookies).expect(200)
    const blocked = (list.body as { userId: string; blockedAt: string | null }[]).find(
      (entry) => entry.userId === idOf(gus),
    )

    expect(blocked?.blockedAt).not.toBeNull()

    // The reason a block is not a delete: everything this person ever wrote
    // still has a name against it, and the log still resolves.
    const entries = await logged(north.id, 'memberships', 'blocked_at')
    expect(entries.at(-1)?.new_value).not.toBeNull()
    expect(entries.at(-1)?.reason).toBe('membership.write')
  })

  /**
   * The list an application hands work out from: everybody by name, and
   * whoever is shut out still in it, so that what they were given earlier
   * shows a name and not a key.
   */
  it('keeps them among the people of the tenant by name, as no longer active', async () => {
    const colleagues = await listColleagues(instance.database, {
      tenantId: north.id,
      userId: idOf(lea),
    })
    const names = colleagues.map((colleague) => colleague.name)

    expect(names).toEqual([...names].sort((left, right) => left.localeCompare(right, 'de')))
    expect(names).toEqual(expect.arrayContaining([lea.name, mia.name, gus.name, 'Nele Neu']))
    expect(colleagues.find((colleague) => colleague.userId === idOf(gus))?.active).toBe(false)
    expect(colleagues.find((colleague) => colleague.userId === idOf(mia))?.active).toBe(true)
    // Nobody from the tenant next door, and nothing but a name of anybody.
    expect(colleagues.some((colleague) => colleague.userId === idOf(sven))).toBe(false)
    expect(Object.keys(colleagues[0] ?? {}).sort()).toEqual(['active', 'name', 'userId'])
  })

  it('is undone by letting them back in', async () => {
    const cookies = await workIn(lea.email, north.id)

    await http()
      .delete(`/staff/${idOf(gus)}/block`)
      .set('cookie', cookies)
      .set('origin', origin)
      .expect(200)

    const asGus = await workIn(gus.email, north.id)
    await http().get('/probe/members').set('cookie', asGus).expect(200)
  })

  /**
   * A block belongs to one tenant and reaches no further, which is the rule
   * the whole administration is built on, checked on the one operation that
   * could break it without looking as though it had.
   */
  it('shuts somebody out of one tenant and not of the one next door', async () => {
    const cookies = await workIn(lea.email, north.id)

    // Gus joins the south as well, which is the case the memberships are kept
    // per tenant for.
    await addStaffMember(instance.authentication, instance.database, {
      ...gus,
      password,
      tenantId: south.id,
      roles: ['guest'],
    })

    const inTheSouth = await workIn(gus.email, south.id)

    await http()
      .put(`/staff/${idOf(gus)}/block`)
      .set('cookie', cookies)
      .set('origin', origin)
      .expect(200)

    // Shut out of the north, still at work in the south, on the session that
    // was open there. A column on the account rather than on the membership
    // would have taken both.
    await http().get('/probe/members').set('cookie', inTheSouth).expect(200)

    const choices = await http().get('/auth/tenants').set('cookie', inTheSouth).expect(200)
    expect(choices.body).toHaveLength(1)
    expect(choices.body[0].id).toBe(south.id)

    await http()
      .delete(`/staff/${idOf(gus)}/block`)
      .set('cookie', cookies)
      .set('origin', origin)
      .expect(200)
  })
})

describe('the devices of somebody else', () => {
  /**
   * The phone that was stolen. The person whose phone it is can already cut
   * it off from another device; this is for the case where the phone was the
   * other device.
   *
   * For this tenant only: a session of the same person at work next door is
   * neither listed nor within reach, even when it is named outright.
   */
  it('can be seen and cut off by whoever leads the tenant, for this tenant only', async () => {
    const cookies = await workIn(lea.email, north.id)
    const nextDoor = await workIn(sven.email, south.id)
    const inTheNorth = await workIn(gus.email, north.id)
    const inTheSouth = await workIn(gus.email, south.id)
    const sessionsSeen = async (as: string): Promise<string[]> => {
      const answer = await http()
        .get(`/staff/${idOf(gus)}/devices`)
        .set('cookie', as)
        .expect(200)

      return (answer.body as { sessionId: string }[]).map((device) => device.sessionId)
    }

    const here = await sessionsSeen(cookies)
    const there = await sessionsSeen(nextDoor)

    expect(here.length).toBeGreaterThanOrEqual(1)
    expect(there.length).toBeGreaterThanOrEqual(1)
    // Not one session is on both lists.
    expect(here.filter((sessionId) => there.includes(sessionId))).toEqual([])

    // A session at work next door is not there for this tenant, named or not.
    for (const sessionId of there) {
      const reaching = await http()
        .delete(`/staff/${idOf(gus)}/devices/${sessionId}`)
        .set('cookie', cookies)
        .set('origin', origin)
        .expect(404)
      expect(reaching.body.message).toBe(probeAccess.sentences.noSuchSessionHere)
    }

    for (const sessionId of here) {
      await http()
        .delete(`/staff/${idOf(gus)}/devices/${sessionId}`)
        .set('cookie', cookies)
        .set('origin', origin)
        .expect(200)
    }

    await http().get('/probe/members').set('cookie', inTheNorth).expect(401)
    await http().get('/probe/members').set('cookie', inTheSouth).expect(200)

    // And the tenant's record of them at work is closed with the session.
    const open = await admin.query(
      `select 1 from tenant_sessions
        where tenant_id = $1 and user_id = $2 and ended_at is null`,
      [north.id, idOf(gus)],
    )
    expect(open.rowCount).toBe(0)
  })
})
