import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import {
  type Permission,
  permissions,
  type RoleKey,
  roleKeys,
  roles,
  shippedRoles,
  type TenantId,
} from '@opengewerk/domain'
import {
  type Authentication,
  authenticationPath,
  completeRoles,
  Database,
  newId,
  rolesOfTenant,
} from '@opengewerk/platform-server'
import { currentCode } from '@opengewerk/platform-server/testing'
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
  shipRoles,
} from '../database/test-database.js'
import { createOwnTenant, createTenantFor, createTenantWithOwner } from '../instance/tenants.js'
import {
  access,
  addStaffMember,
  createAuthentication,
  SessionIdentitySource,
  setUpInstance,
} from './access.js'

/**
 * The roles of a business as rows, as this application binds them (ADR 0010).
 *
 * How rows turn into rights is the foundation's and tested there. What only
 * this application can get wrong is measured here: that Inhaber, Büro and
 * Monteur, read from the rows of a business, may do exactly what the code
 * says of them, right for right, and that a business has those rows whichever
 * way it came into being. A business without them is one in which nobody
 * holds a right, its owner included.
 */

const north = { id: newId<'tenant'>(), name: 'Elektro Nord GmbH' }

const origin = 'https://opengewerk.example.de'
const password = 'ein-ordentlich-langes-passwort'

/** One person per role, and one who holds two. */
const people = {
  owner: { email: 'chefin@nord.example.de', name: 'Christa Chefin', roles: ['owner'] },
  office: { email: 'buero@nord.example.de', name: 'Beate Büro', roles: ['office'] },
  technician: { email: 'monteur@nord.example.de', name: 'Max Monteur', roles: ['technician'] },
  both: { email: 'beides@nord.example.de', name: 'Bodo Beides', roles: ['office', 'technician'] },
} as const satisfies Record<string, { email: string; name: string; roles: readonly RoleKey[] }>

let admin: Pool
let database: Database
let authentication: Authentication
let identities: SessionIdentitySource
let app: INestApplication

function http() {
  return request(app.getHttpServer())
}

function cookiesOf(answer: { headers: Record<string, unknown> }): string {
  const raw = answer.headers['set-cookie']
  const list = Array.isArray(raw) ? (raw as string[]) : typeof raw === 'string' ? [raw] : []

  return list.map((cookie) => cookie.split(';')[0]).join('; ')
}

/** The address an authenticator app was fed, per account that has one. */
const secondFactors = new Map<string, string>()

function signingIn(email: string) {
  return http()
    .post(`${authenticationPath}/sign-in/email`)
    .set('origin', origin)
    .send({ email, password })
    .expect(200)
}

/** Gives an account the second factor its role makes compulsory. */
async function setUpSecondFactor(email: string): Promise<void> {
  const cookies = cookiesOf(await signingIn(email))

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

/** Signs in, answers the second factor where one is asked for, and picks the business. */
async function atWorkIn(person: keyof typeof people, tenantId: TenantId): Promise<string> {
  const { email } = people[person]
  const answer = await signingIn(email)
  const totpUri = secondFactors.get(email)

  let cookies = cookiesOf(answer)

  if (answer.body.twoFactorRedirect === true && totpUri) {
    const verified = await http()
      .post(`${authenticationPath}/two-factor/verify-totp`)
      .set('cookie', cookies)
      .set('origin', origin)
      .send({ code: await currentCode(totpUri) })
      .expect(200)

    cookies = cookiesOf(verified) || cookies
  }

  await http()
    .post('/auth/tenant')
    .set('cookie', cookies)
    .set('origin', origin)
    .send({ tenantId })
    .expect(201)

  return cookies
}

async function rolesIn(tenantId: TenantId) {
  return database.forTenant({ tenantId }, (tx) => rolesOfTenant(tx, tenantId))
}

/** Back to the state a freshly started installation is in. */
async function emptyInstance(): Promise<void> {
  await resetSchema(admin)
  await applyMigrations()
  await allowApplicationLogin(admin)
}

beforeAll(async () => {
  admin = await connect()
  await emptyInstance()
  await admin.query('insert into tenants (id, name) values ($1, $2)', [north.id, north.name])
  await shipRoles(admin, north.id)

  database = Database.connect(applicationDatabaseUrl())
  authentication = createAuthentication({
    database,
    secret: 'r'.repeat(64),
    trustedOrigins: [origin],
    rateLimited: false,
  })
  identities = new SessionIdentitySource(authentication, database)

  const built = await Test.createTestingModule({
    imports: [ApiModule.create(database, identities, { authentication, trustedOrigins: [origin] })],
  }).compile()

  app = built.createNestApplication()
  app.use(authenticationPath, toNodeHandler(authentication))
  await app.init()

  for (const person of Object.values(people)) {
    await addStaffMember(authentication, database, {
      email: person.email,
      name: person.name,
      password,
      tenantId: north.id,
      roles: [...person.roles],
    })
  }

  await setUpSecondFactor(people.owner.email)
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
})

describe('what the three roles may do', () => {
  /**
   * Every role against every right, asked where the answer is made: the
   * identity a session resolves to carries the rights, and the guard, the
   * sync and every route ask those and nothing else.
   */
  it('is, read from the rows of the business, exactly what the code says of them', async () => {
    for (const key of roleKeys) {
      const identity = await identities.identify({
        headers: { cookie: await atWorkIn(key, north.id) },
      })

      expect(identity?.roles).toEqual([key])

      for (const permission of permissions) {
        expect({ role: key, permission, held: identity?.rights.includes(permission) }).toEqual({
          role: key,
          permission,
          held: roles[key].permissions.includes(permission),
        })
      }
    }
  })

  it('adds up for somebody who holds two of them', async () => {
    const identity = await identities.identify({
      headers: { cookie: await atWorkIn('both', north.id) },
    })

    const expected = new Set<Permission>([
      ...roles.office.permissions,
      ...roles.technician.permissions,
    ])

    expect(new Set(identity?.rights)).toEqual(expected)
    // The order of the catalogue, each right once.
    expect(identity?.rights).toEqual(permissions.filter((permission) => expected.has(permission)))
  })

  /**
   * The owner is the role that leads a business and the one that works only
   * with a second factor; the other two are neither. These are the two things
   * about a role that are not rights, and they are in the rows as well.
   */
  it('names the owner as the role that leads, with a second factor', async () => {
    expect(
      (await rolesIn(north.id)).map(({ key, leads, secondFactor }) => ({
        key,
        leads,
        secondFactor,
      })),
    ).toEqual([
      { key: 'owner', leads: true, secondFactor: true },
      { key: 'office', leads: false, secondFactor: false },
      { key: 'technician', leads: false, secondFactor: false },
    ])
  })
})

describe('a business, however it comes into being', () => {
  it('has the three roles after the first run', async () => {
    // A second instance beside the first: the first run asks for an empty one.
    await database.close()
    await emptyInstance()
    database = Database.connect(applicationDatabaseUrl())
    authentication = createAuthentication({
      database,
      secret: 'r'.repeat(64),
      trustedOrigins: [origin],
      rateLimited: false,
    })

    const { tenantId, userId } = await setUpInstance(authentication, database, {
      company: 'Elektro Erst GmbH',
      name: 'Olga Owner',
      email: 'olga@erst.example.de',
      password,
    })

    expect(await rolesIn(tenantId)).toEqual(shippedRoles)

    const { rows } = await admin.query<{ roles: string[] }>(
      'select roles from memberships where tenant_id = $1 and user_id = $2',
      [tenantId, userId],
    )

    expect(rows).toEqual([{ roles: ['owner'] }])
  })

  it('has them when an owner opens a further one', async () => {
    const [owner] = (
      await admin.query<{ id: string }>(
        "select id from auth_users where email = 'olga@erst.example.de'",
      )
    ).rows

    const { tenantId } = await createOwnTenant(database, owner?.id ?? '', 'Elektro Zweit GmbH')

    expect(await rolesIn(tenantId)).toEqual(shippedRoles)
  })

  it('has them when an operator creates one for somebody else', async () => {
    const [operator] = (
      await admin.query<{ id: string }>(
        "select id from auth_users where email = 'olga@erst.example.de'",
      )
    ).rows

    const { tenantId } = await createTenantFor(database, operator?.id ?? '', {
      name: 'Elektro Dritt GmbH',
      ownerName: 'Dora Dritt',
      ownerEmail: 'dora@dritt.example.de',
    })

    expect(await rolesIn(tenantId)).toEqual(shippedRoles)
  })

  it('has them when it is created from the command line', async () => {
    const { tenantId } = await createTenantWithOwner(authentication, database, {
      name: 'Elektro Viert GmbH',
      ownerEmail: 'vera@viert.example.de',
      ownerName: 'Vera Viert',
      password,
    })

    expect(await rolesIn(tenantId)).toEqual(shippedRoles)
  })

  /**
   * The one way that is not this version's: the version before goes on
   * running between the migration and the start, and a business it creates in
   * that moment has no roles. The start gives it the three.
   */
  it('has them after the next start when the version before created it', async () => {
    const late = { id: newId<'tenant'>(), name: 'Elektro Spät GmbH' }

    await admin.query('insert into tenants (id, name) values ($1, $2)', [late.id, late.name])
    expect(await rolesIn(late.id)).toEqual([])

    expect(await completeRoles(database, access)).toEqual([late.id])
    expect(await rolesIn(late.id)).toEqual(shippedRoles)
  })
})
