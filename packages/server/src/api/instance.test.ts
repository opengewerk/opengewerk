import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import {
  businessNameProblem,
  type InstanceLogPage,
  type InstanceTenantView,
  type OperatorView,
  type RoleKey,
  shippedRoles,
  type TenantId,
} from '@opengewerk/domain'
import { Database, hashToken, newId } from '@opengewerk/platform-server'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { customers, memberships } from '../database/schema/index.js'
import {
  applicationDatabaseUrl,
  connect,
  resetToMigrated,
  shipRoles,
} from '../database/test-database.js'
import { ApiModule } from './api.module.js'
import { testIdentities as identities } from './test-identity.js'

/**
 * The area of the instance (#188) and further businesses (#142), as this
 * application has them.
 *
 * The area itself is the foundation's (ADR 0010) and is tested there, with an
 * application that is nobody's: who gets in, the settings, the log, the last
 * operator, what a further tenant begins with. What is held here is what only
 * this application can get wrong: that being an owner opens nothing there,
 * that its refusals speak of "Betreiber", "Betrieb" and "Inhaber", that an
 * owner creates a further business for himself and the office does not, that
 * whoever is put at the head of a business is its owner, and that a new
 * business has none of the customers of the first.
 */

const first = newId<'tenant'>() as TenantId

const people = {
  // The operator, owner of the first business, with a second factor.
  olga: { name: 'Olga Owner', email: 'olga@nord.example.de', roles: ['owner'], secondFactor: true },
  // Owner too, but no operator.
  otto: { name: 'Otto Owner', email: 'otto@nord.example.de', roles: ['owner'], secondFactor: true },
  britta: {
    name: 'Britta Büro',
    email: 'britta@nord.example.de',
    roles: ['office'],
    secondFactor: false,
  },
  // An operator without a second factor.
  paul: {
    name: 'Paul Plain',
    email: 'paul@nord.example.de',
    roles: ['technician'],
    secondFactor: false,
  },
} as const

type Person = keyof typeof people

let admin: Pool
let database: Database
let app: INestApplication

function as(person: Person, tenantId: TenantId = first): string {
  return JSON.stringify({
    userId: person,
    tenantId,
    roles: [...people[person].roles] as RoleKey[],
  })
}

function http() {
  return request(app.getHttpServer())
}

const message = (answer: { body: unknown }) => (answer.body as { message: string }).message

beforeAll(async () => {
  admin = await connect()
  await resetToMigrated()
  await admin.query('insert into tenants (id, name) values ($1, $2)', [first, 'Elektro Nord GmbH'])
  await shipRoles(admin, first)

  database = Database.connect(applicationDatabaseUrl())

  for (const [userId, person] of Object.entries(people)) {
    await admin.query(
      'insert into auth_users (id, name, email, two_factor_enabled) values ($1, $2, $3, $4)',
      [userId, person.name, person.email, person.secondFactor],
    )
    await database.forTenant({ tenantId: first, reason: 'membership.create' }, (tx) =>
      tx.insert(memberships).values({ tenantId: first, userId, roles: [...person.roles] }),
    )
  }

  await admin.query(`insert into instance_operators (user_id) values ('olga'), ('paul')`)

  app = (
    await Test.createTestingModule({ imports: [ApiModule.create(database, identities)] }).compile()
  ).createNestApplication()
  await app.init()
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
})

describe('who gets into the area of the instance', () => {
  it('lets an operator with a second factor in, and tells an owner he is none', async () => {
    const olga = await http().get('/instance/access').set('x-test-identity', as('olga')).expect(200)
    const otto = await http().get('/instance/access').set('x-test-identity', as('otto')).expect(200)

    expect(olga.body).toEqual({ operator: true, secondFactor: true })
    expect(otto.body).toEqual({ operator: false, secondFactor: true })

    await http().get('/instance/settings').set('x-test-identity', as('olga')).expect(200)
  })

  it('refuses an owner who is no operator in the words of this application, and an operator without a second factor', async () => {
    for (const path of ['/instance/settings', '/instance/operators', '/instance/log']) {
      const refused = await http().get(path).set('x-test-identity', as('otto')).expect(403)

      expect(message(refused)).toBe('Diesen Bereich erreicht nur ein Betreiber der Instanz.')
    }

    const paul = await http()
      .get('/instance/settings')
      .set('x-test-identity', as('paul'))
      .expect(403)

    expect(message(paul)).toContain('zweiter Faktor')
  })
})

describe('the operators', () => {
  it('are named and taken away, and a refusal calls them what this application calls them', async () => {
    const named = await http()
      .post('/instance/operators')
      .set('x-test-identity', as('olga'))
      .send({ email: 'Otto@Nord.example.de' })
      .expect(201)

    expect((named.body as OperatorView).userId).toBe('otto')

    const twice = await http()
      .post('/instance/operators')
      .set('x-test-identity', as('olga'))
      .send({ email: 'otto@nord.example.de' })
      .expect(409)

    expect(message(twice)).toBe('Dieses Konto ist schon Betreiber.')

    const oneself = await http()
      .delete('/instance/operators/olga')
      .set('x-test-identity', as('olga'))
      .expect(409)

    expect(message(oneself)).toBe('Sich selbst entfernt kein Betreiber; das macht ein anderer.')

    const stranger = await http()
      .delete('/instance/operators/britta')
      .set('x-test-identity', as('olga'))
      .expect(404)

    expect(message(stranger)).toBe('Dieses Konto ist kein Betreiber.')

    await http().delete('/instance/operators/otto').set('x-test-identity', as('olga')).expect(200)

    // Taken away, and at once: being an owner still opens nothing.
    await http().get('/instance/settings').set('x-test-identity', as('otto')).expect(403)
  })
})

describe('further businesses', () => {
  it('lets an owner create one for himself, where he is owner at once', async () => {
    const created = await http()
      .post('/tenants')
      .set('x-test-identity', as('olga'))
      .send({ name: '  Kohm Solar GmbH ' })
      .expect(201)
    const { tenantId, name } = created.body as { tenantId: TenantId; name: string }

    expect(name).toBe('Kohm Solar GmbH')

    const { rows } = await admin.query<{ roles: string[] }>(
      'select roles from memberships where tenant_id = $1 and user_id = $2',
      [tenantId, 'olga'],
    )

    expect(rows[0]?.roles).toEqual(['owner'])

    // It begins with the three roles of this application.
    const roles = await admin.query<{ key: string }>(
      'select key from tenant_roles where tenant_id = $1 order by id',
      [tenantId],
    )

    expect(roles.rows.map((row) => row.key)).toEqual(shippedRoles.map((role) => role.key))

    // As separate from the first as a stranger's: nothing of the first in it.
    await database.forTenant({ tenantId: first, userId: 'olga' }, (tx) =>
      tx
        .insert(customers)
        .values({ tenantId: first, kind: 'business', name: 'Hausverwaltung Süd GmbH' }),
    )
    const inside = await http()
      .get('/customers')
      .set('x-test-identity', as('olga', tenantId))
      .expect(200)

    expect(inside.body).toEqual([])
  })

  it('refuses the office, and a name the rule of this application refuses', async () => {
    await http()
      .post('/tenants')
      .set('x-test-identity', as('britta'))
      .send({ name: 'Büro GmbH' })
      .expect(403)

    const blank = await http()
      .post('/tenants')
      .set('x-test-identity', as('olga'))
      .send({ name: '   ' })
      .expect(400)

    // The rule of the first run and of "Briefkopf" (#276), and its sentence.
    expect(message(blank)).toBe(businessNameProblem('   '))

    const missing = await http()
      .post('/tenants')
      .set('x-test-identity', as('olga'))
      .send({})
      .expect(400)

    expect(message(missing)).toBe('Der Name des Betriebs fehlt.')
  })

  it('lets an operator create one for somebody else, with an invitation to be its owner', async () => {
    const created = await http()
      .post('/instance/tenants')
      .set('x-test-identity', as('olga'))
      .send({
        name: 'Elektro Weber OHG',
        leadName: 'Anna Weber',
        leadEmail: 'Anna@Elektro-Weber.de',
      })
      .expect(201)
    const { tenantId, token } = created.body as { tenantId: string; token: string }

    const { rows } = await admin.query<{ email: string; roles: string[]; invited_by: string }>(
      'select email, roles, invited_by from invitations where tenant_id = $1 and token_hash = $2',
      [tenantId, hashToken(token)],
    )

    expect(rows).toEqual([{ email: 'anna@elektro-weber.de', roles: ['owner'], invited_by: 'olga' }])

    const nameless = await http()
      .post('/instance/tenants')
      .set('x-test-identity', as('olga'))
      .send({ name: 'Elektro Ohne OHG', leadName: '', leadEmail: 'ohne@example.de' })
      .expect(400)

    expect(message(nameless)).toBe('Der Name des Inhabers fehlt.')

    const list = await http()
      .get('/instance/tenants')
      .set('x-test-identity', as('olga'))
      .expect(200)
    const weber = (list.body as InstanceTenantView[]).find((tenant) => tenant.id === tenantId)

    expect(weber).toMatchObject({
      name: 'Elektro Weber OHG',
      leads: [],
      members: 0,
      invitedLeads: ['anna@elektro-weber.de'],
    })

    // Who leads a business of this application is its owners.
    const nord = (list.body as InstanceTenantView[]).find((tenant) => tenant.id === first)

    expect(nord?.leads.map((lead) => lead.name)).toEqual(['Olga Owner', 'Otto Owner'])
  })

  it('writes a business created into the log of the instance', async () => {
    const answer = await http().get('/instance/log').set('x-test-identity', as('olga')).expect(200)
    const log = answer.body as InstanceLogPage
    const created = log.changes.filter(
      (change) => change.table === 'tenants' && change.operation === 'insert',
    )
    const byName = new Map(created.map((change) => [log.titles[change.recordId]?.title, change]))

    expect(byName.get('Kohm Solar GmbH')?.reason).toBe('tenant.create')
    expect(byName.get('Kohm Solar GmbH')?.userId).toBe('olga')
    expect(byName.get('Elektro Weber OHG')?.reason).toBe('instance.tenant')
    expect(byName.get('Elektro Weber OHG')?.userId).toBe('olga')
    // The first came in the way this test wrote it, straight into the
    // database, and the log says so rather than naming a way it did not take.
    expect(byName.get('Elektro Nord GmbH')?.reason).toBeNull()
    expect(byName.get('Elektro Nord GmbH')?.databaseRole).not.toBe('opengewerk_app')
    expect(log.people['olga']).toBe('Olga Owner')
  })
})
