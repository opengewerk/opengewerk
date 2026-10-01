import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import type { TenantId } from '@opengewerk/domain'
import {
  type Authentication,
  authenticationPath,
  Database,
  newId,
} from '@opengewerk/platform-server'
import { currentCode } from '@opengewerk/platform-server/testing'
import { toNodeHandler } from 'better-auth/node'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  addStaffMember,
  createAuthentication,
  SessionIdentitySource,
} from '../authentication/access.js'
import {
  allowApplicationLogin,
  applicationDatabaseUrl,
  applyMigrations,
  connect,
  resetSchema,
} from '../database/test-database.js'
import { ApiModule } from './api.module.js'

/**
 * Who works in a business, as this application binds it.
 *
 * The administration itself is the foundation's (ADR 0010) and tested there,
 * with an application that is nobody's: the isolation between two tenants,
 * the link that works once, the block that takes effect now, the last one who
 * leads a tenant. What is measured here is what only this application can
 * get wrong: that the owner is the one role that reaches these routes, that
 * the roles handed out are its own and open what they open here, and that a
 * refusal speaks of a business and its owner.
 *
 * How an invitation goes out by mail is in `invitation-mail.test.ts`.
 */

const north = { id: newId<'tenant'>(), name: 'Elektro Nord GmbH' }

const origin = 'https://opengewerk.example.de'
const password = 'ein-ordentlich-langes-passwort'

const chefin = { email: 'chefin@nord.example.de', name: 'Christa Chefin' }
const beate = { email: 'buero@nord.example.de', name: 'Beate Büro' }
const max = { email: 'monteur@nord.example.de', name: 'Max Monteur' }

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

/**
 * Signs in and answers the second factor if one is asked for, stopping short
 * of the choice of business.
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

function idOf(person: { readonly email: string }): string {
  return userIds.get(person.email) as string
}

beforeAll(async () => {
  admin = await connect()
  await resetSchema(admin)
  await applyMigrations()
  await allowApplicationLogin(admin)
  await admin.query('insert into tenants (id, name) values ($1, $2)', [north.id, north.name])

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

  for (const [person, roles] of [
    [chefin, ['owner']],
    [beate, ['office']],
    [max, ['technician']],
  ] as const) {
    const { userId } = await addStaffMember(authentication, database, {
      ...person,
      password,
      tenantId: north.id,
      roles: [...roles],
    })

    userIds.set(person.email, userId)
  }

  await setUpSecondFactor(chefin.email)
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
})

describe('the people of a business', () => {
  it('are listed for the owner, with the roles of this application', async () => {
    const cookies = await workIn(chefin.email, north.id)
    const answer = await http().get('/staff').set('cookie', cookies).expect(200)

    const roles = new Map(
      (answer.body as { email: string; roles: string[] }[]).map((entry) => [
        entry.email,
        entry.roles,
      ]),
    )

    expect(Object.fromEntries(roles)).toEqual({
      [chefin.email]: ['owner'],
      [beate.email]: ['office'],
      [max.email]: ['technician'],
    })
  })

  /**
   * The office role is not the office application.
   *
   * Somebody who can hand out roles can hand themselves the owner role, so
   * `membership.read` and `membership.write` belong to the owner alone. The
   * screen lives in the office application because that is where a desk is,
   * not because the office role reaches it.
   */
  it('are not open to the office role, although the screen lives in the office', async () => {
    for (const person of [beate, max]) {
      const cookies = await workIn(person.email, north.id)

      const refused = await http().get('/staff').set('cookie', cookies).expect(403)
      expect(refused.body.message).toContain('Zugänge ansehen')

      await http()
        .post('/staff')
        .set('cookie', cookies)
        .set('origin', origin)
        .send({ email: 'neu@nord.example.de', name: 'Neu', roles: ['technician'] })
        .expect(403)
    }
  })
})

describe('a new colleague', () => {
  /**
   * The link end to end in this application: made under "Zugänge", used by
   * the person it was made for, and what they get is the role the owner
   * picked, with what that role opens here and nothing beyond it.
   */
  it('gets in through the link and works with the role the owner picked', async () => {
    const cookies = await workIn(chefin.email, north.id)

    const invited = await http()
      .post('/staff')
      .set('cookie', cookies)
      .set('origin', origin)
      .send({ email: 'neue@nord.example.de', name: 'Nele Neu', roles: ['technician'] })
      .expect(201)

    const token = invited.body.token as string
    const offer = await http().get(`/invitation/${token}`).expect(200)

    expect(offer.body).toMatchObject({ state: 'open', company: north.name, knownAccount: false })

    const chosen = 'was-nur-nele-kennt'

    await http()
      .post(`/invitation/${token}`)
      .set('origin', origin)
      .send({ password: chosen })
      .expect(201)

    const asNele = await workIn('neue@nord.example.de', north.id, chosen)

    await http().get('/customers').set('cookie', asNele).expect(200)
    await http().get('/staff').set('cookie', asNele).expect(403)

    const again = await http()
      .post(`/invitation/${token}`)
      .set('origin', origin)
      .send({ password: chosen })
      .expect(410)
    expect(again.body.message).toBe(
      'Dieser Link wurde schon benutzt. Bitte im Betrieb einen neuen anfordern.',
    )
  })
})

describe('changing what somebody may do', () => {
  it('hands out the roles of this application, and they open what they open here', async () => {
    const cookies = await workIn(chefin.email, north.id)
    const asMax = await workIn(max.email, north.id)
    const change = (roles: readonly string[]) =>
      http()
        .patch(`/staff/${idOf(max)}`)
        .set('cookie', cookies)
        .set('origin', origin)
        .send({ roles })
    // What the office may and a technician may not: read the deadlines.
    const deadlines = () => http().get('/deadlines').set('cookie', asMax)

    const unknown = await change(['chief']).expect(400)
    expect(unknown.body.message).toBe(
      'Unbekannte Rollen: chief. Es gibt owner, office, technician.',
    )

    const before = (await deadlines()).status

    await change(['office']).expect(200)

    const after = (await deadlines()).status

    // The same session, a request later: the roles are read every time.
    expect({ before, after }).toEqual({ before: 403, after: 200 })

    // ADR 0006 asks for a change of rights in the log, and nobody wrote a line
    // for it: `memberships` is an ordinary tenant table and the trigger from
    // 0003 watches it.
    const { rows } = await admin.query<{ new_value: string | null; reason: string | null }>(
      `select new_value, reason from audit_entries
        where tenant_id = $1 and table_name = 'memberships' and field = 'roles'
          and old_value like '%technician%'
        order by sequence`,
      [north.id],
    )

    expect(rows.at(-1)?.new_value).toContain('office')
    expect(rows.at(-1)?.reason).toBe('membership.write')

    await change(['technician']).expect(200)
  })

  /**
   * The wall from #62, named before somebody walks into it.
   *
   * The requirement hangs on the role and is checked on every request, so
   * making somebody an owner makes a second factor compulsory for them from
   * their next request onwards. The server does not refuse that, and should
   * not: the screen warns, and the person then has a screen to set the factor
   * up on. What is measured here is that the wall is really there for the
   * owner of this application, because that is what the warning is about.
   */
  it('makes a second factor compulsory the moment somebody becomes an owner', async () => {
    const cookies = await workIn(chefin.email, north.id)
    const asMax = await workIn(max.email, north.id)

    await http().get('/customers').set('cookie', asMax).expect(200)

    await http()
      .patch(`/staff/${idOf(max)}`)
      .set('cookie', cookies)
      .set('origin', origin)
      .send({ roles: ['owner'] })
      .expect(200)

    const stopped = await http().get('/customers').set('cookie', asMax).expect(403)
    expect(stopped.body.message).toContain('zweiter Faktor')

    await http()
      .patch(`/staff/${idOf(max)}`)
      .set('cookie', cookies)
      .set('origin', origin)
      .send({ roles: ['technician'] })
      .expect(200)
  })
})

describe('a refusal', () => {
  /**
   * The sentences the foundation cannot know, because they name what this
   * application calls a tenant and the role that leads it.
   */
  it('speaks of a business and its owner', async () => {
    const cookies = await workIn(chefin.email, north.id)

    const twice = await http()
      .post('/staff')
      .set('cookie', cookies)
      .set('origin', origin)
      .send({ email: max.email, name: max.name, roles: ['office'] })
      .expect(409)
    expect(twice.body.message).toBe('Diese Adresse arbeitet schon in diesem Betrieb.')

    const lastOwner =
      'Das ist der letzte Inhaber dieses Betriebs. Erst einen zweiten Inhaber einsetzen, ' +
      'sonst kann niemand mehr Zugänge verwalten.'

    const demoted = await http()
      .patch(`/staff/${idOf(chefin)}`)
      .set('cookie', cookies)
      .set('origin', origin)
      .send({ roles: ['office'] })
      .expect(409)
    expect(demoted.body.message).toBe(lastOwner)

    const blocked = await http()
      .put(`/staff/${idOf(chefin)}/block`)
      .set('cookie', cookies)
      .set('origin', origin)
      .expect(409)
    expect(blocked.body.message).toBe(lastOwner)

    const stranger = await http()
      .put(`/staff/${newId<'tenant'>()}/block`)
      .set('cookie', cookies)
      .set('origin', origin)
      .expect(404)
    expect(stranger.body.message).toBe('Dieses Konto arbeitet nicht in diesem Betrieb.')

    const session = await http()
      .delete(`/staff/${idOf(max)}/devices/keine-sitzung`)
      .set('cookie', cookies)
      .set('origin', origin)
      .expect(404)
    expect(session.body.message).toBe('Diese Sitzung gibt es in diesem Betrieb nicht.')
  })
})
