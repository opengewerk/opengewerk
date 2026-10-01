import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import type {
  InstanceLogPage,
  InstanceSettingsView,
  InstanceTenantView,
  OperatorView,
  RoleKey,
  TenantId,
} from '@opengewerk/domain'
import { Database, hashToken, newId } from '@opengewerk/platform-server'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { customers, memberships } from '../database/schema/index.js'
import {
  allowApplicationLogin,
  applicationDatabaseUrl,
  applyMigrations,
  connect,
  resetSchema,
} from '../database/test-database.js'
import { ApiModule } from './api.module.js'
import { testIdentities as identities } from './test-identity.js'

/**
 * The area of the instance (#188) and further businesses (#142). What the
 * routes hold: only an operator with a second factor gets in, being an owner
 * opens nothing there, every change lands in the log of the instance, an
 * owner creates a business for himself and nobody else does, and a new
 * business is as separate from the first as a stranger's.
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

beforeAll(async () => {
  admin = await connect()
  await resetSchema(admin)
  await applyMigrations()
  await allowApplicationLogin(admin)
  await admin.query('insert into tenants (id, name) values ($1, $2)', [first, 'Elektro Nord GmbH'])

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
  it('tells everybody whether they may, for the entry in the menu', async () => {
    const olga = await http().get('/instance/access').set('x-test-identity', as('olga')).expect(200)
    const otto = await http().get('/instance/access').set('x-test-identity', as('otto')).expect(200)

    expect(olga.body).toEqual({ operator: true, secondFactor: true })
    expect(otto.body).toEqual({ operator: false, secondFactor: true })
  })

  it('lets an operator with a second factor in', async () => {
    await http().get('/instance/settings').set('x-test-identity', as('olga')).expect(200)
  })

  it('refuses an owner who is no operator, and an operator without a second factor', async () => {
    const otto = await http()
      .get('/instance/settings')
      .set('x-test-identity', as('otto'))
      .expect(403)
    const paul = await http()
      .get('/instance/settings')
      .set('x-test-identity', as('paul'))
      .expect(403)

    expect((otto.body as { message: string }).message).toContain('nur ein Betreiber')
    expect((paul.body as { message: string }).message).toContain('zweiter Faktor')

    for (const path of ['/instance/operators', '/instance/log', '/instance/tenants']) {
      await http().get(path).set('x-test-identity', as('otto')).expect(403)
    }
  })

  it('refuses without a session', async () => {
    await http().get('/instance/settings').expect(401)
  })
})

describe('the settings of the instance', () => {
  it('start with no mail server in the own network and the backup at half past two', async () => {
    const answer = await http()
      .get('/instance/settings')
      .set('x-test-identity', as('olga'))
      .expect(200)

    expect(answer.body).toEqual({ mailInternalHosts: [], backupTime: '02:30', takenOverAt: null })
  })

  it('take mail servers and a time, and refuse what is neither', async () => {
    const saved = await http()
      .put('/instance/settings')
      .set('x-test-identity', as('olga'))
      .send({
        mailInternalHosts: ['mail.intern.example', ' 192.168.1.20 ', ''],
        backupTime: '03:15',
      })
      .expect(200)

    expect(saved.body as InstanceSettingsView).toMatchObject({
      mailInternalHosts: ['mail.intern.example', '192.168.1.20'],
      backupTime: '03:15',
    })

    await http()
      .put('/instance/settings')
      .set('x-test-identity', as('olga'))
      .send({ mailInternalHosts: ['smtp://mail.intern.example:25'] })
      .expect(400)
    await http()
      .put('/instance/settings')
      .set('x-test-identity', as('olga'))
      .send({ backupTime: '25:00' })
      .expect(400)
  })

  it('write every change into the log of the instance, with person and way', async () => {
    const answer = await http().get('/instance/log').set('x-test-identity', as('olga')).expect(200)
    const log = answer.body as InstanceLogPage
    const change = log.changes.find(
      (entry) =>
        entry.table === 'instance_settings' &&
        entry.fields.some((field) => field.field === 'backup_time'),
    )

    expect(change?.userId).toBe('olga')
    expect(change?.reason).toBe('instance.settings')
    expect(change?.fields.find((field) => field.field === 'backup_time')).toMatchObject({
      before: '02:30:00',
      after: '03:15:00',
    })
    expect(log.people['olga']).toBe('Olga Owner')
  })
})

describe('the operators', () => {
  it('names an account that exists, and no other, and no one twice', async () => {
    const named = await http()
      .post('/instance/operators')
      .set('x-test-identity', as('olga'))
      .send({ email: 'Otto@Nord.example.de' })
      .expect(201)

    expect((named.body as OperatorView).userId).toBe('otto')

    await http()
      .post('/instance/operators')
      .set('x-test-identity', as('olga'))
      .send({ email: 'niemand@example.de' })
      .expect(404)
    await http()
      .post('/instance/operators')
      .set('x-test-identity', as('olga'))
      .send({ email: 'otto@nord.example.de' })
      .expect(409)

    const list = await http()
      .get('/instance/operators')
      .set('x-test-identity', as('olga'))
      .expect(200)

    expect((list.body as OperatorView[]).map((operator) => operator.userId)).toEqual([
      'olga',
      'paul',
      'otto',
    ])
  })

  it('takes the role from another, never from oneself', async () => {
    await http().delete('/instance/operators/olga').set('x-test-identity', as('olga')).expect(409)
    await http().delete('/instance/operators/otto').set('x-test-identity', as('olga')).expect(200)

    // Taken away, and at once: the next request of the former operator is refused.
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

  it('refuses the office, and a business without a name', async () => {
    await http()
      .post('/tenants')
      .set('x-test-identity', as('britta'))
      .send({ name: 'Büro GmbH' })
      .expect(403)
    await http()
      .post('/tenants')
      .set('x-test-identity', as('olga'))
      .send({ name: '   ' })
      .expect(400)
  })

  it('lets an operator create one for somebody else, with an invitation to be its owner', async () => {
    const created = await http()
      .post('/instance/tenants')
      .set('x-test-identity', as('olga'))
      .send({
        name: 'Elektro Weber OHG',
        ownerName: 'Anna Weber',
        ownerEmail: 'Anna@Elektro-Weber.de',
      })
      .expect(201)
    const { tenantId, token } = created.body as { tenantId: string; token: string }

    const { rows } = await admin.query<{ email: string; roles: string[]; invited_by: string }>(
      'select email, roles, invited_by from invitations where tenant_id = $1 and token_hash = $2',
      [tenantId, hashToken(token)],
    )

    expect(rows).toEqual([{ email: 'anna@elektro-weber.de', roles: ['owner'], invited_by: 'olga' }])

    // The operator did not become a member of it.
    const members = await admin.query('select 1 from memberships where tenant_id = $1', [tenantId])

    expect(members.rowCount).toBe(0)

    const list = await http()
      .get('/instance/tenants')
      .set('x-test-identity', as('olga'))
      .expect(200)
    const weber = (list.body as InstanceTenantView[]).find((tenant) => tenant.id === tenantId)

    expect(weber).toMatchObject({
      name: 'Elektro Weber OHG',
      owners: [],
      members: 0,
      invitedOwners: ['anna@elektro-weber.de'],
    })

    const nord = (list.body as InstanceTenantView[]).find((tenant) => tenant.id === first)

    expect(nord?.owners.map((owner) => owner.name)).toEqual(['Olga Owner', 'Otto Owner'])
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
  })
})
