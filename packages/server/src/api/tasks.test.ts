import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import type { Identity, RoleKey } from '@opengewerk/domain'
import { eq } from 'drizzle-orm'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { Database } from '../database/database.js'
import { newId } from '../database/identifier.js'
import { tasks } from '../database/schema/index.js'
import {
  allowApplicationLogin,
  applicationDatabaseUrl,
  applyMigrations,
  connect,
  foreignKeyViolation,
  refusedBy,
  resetSchema,
} from '../database/test-database.js'
import { ApiModule } from './api.module.js'
import { testIdentities as identities } from './test-identity.js'

/**
 * The tasks of #80, on the server.
 *
 * A task is written and done on a device like everything a technician fills
 * in, so what is held here is the life of one in the sync: who wrote it comes
 * from the request and never from the device, it can only go to somebody who
 * works in the business, and it reaches the devices. Next to that, the one
 * way in that is not a device, a task nobody wrote, which is the seam the
 * deadline engine of phase 2 will use.
 */

const north = { id: newId<'tenant'>(), name: 'Elektro Nord GmbH' }
const south = { id: newId<'tenant'>(), name: 'Elektro Süd GmbH' }

const people = {
  chefin: { name: 'Christa Chefin', tenant: north.id, roles: ['owner'] },
  britta: { name: 'Britta Büro', tenant: north.id, roles: ['office'] },
  max: { name: 'Max Monteur', tenant: north.id, roles: ['technician'] },
  gesperrt: { name: 'Gerd Gesperrt', tenant: north.id, roles: ['technician'] },
  sued: { name: 'Susi Süd', tenant: south.id, roles: ['owner'] },
} as const

type Person = keyof typeof people

let admin: Pool
let database: Database
let app: INestApplication
let customerId: string
let jobId: string

function http() {
  return request(app.getHttpServer())
}

/** The header for one of the people above, in their own business. */
function as(person: Person): string {
  const { tenant, roles } = people[person]

  return JSON.stringify({
    userId: person,
    tenantId: tenant,
    roles: [...roles] as RoleKey[],
  } satisfies Identity)
}

type Values = Record<string, string | number | boolean | null>

function creating(recordId: string, values: Values) {
  return {
    id: newId<'operation'>(),
    entity: 'tasks',
    recordId,
    kind: 'create',
    baseVersion: null,
    patches: Object.entries(values).map(([field, to]) => ({ field, from: null, to })),
    recordedAt: new Date().toISOString(),
  }
}

function changing(recordId: string, values: Values, baseVersion = 1) {
  return { ...creating(recordId, values), kind: 'update', baseVersion }
}

async function push(operations: unknown[], who: Person = 'max', expected = 201) {
  const answer = await http()
    .post('/sync')
    .set('x-test-identity', as(who))
    .send({ deviceId: 'handy-von-max', operations })
    .expect(expected)

  return answer.body as {
    receipts: { outcome: string; reason: string | null; fields: string[] }[]
  }
}

/** A task as the technician writes it at a job: for the office, due on Friday. */
function aTask(over: Values = {}): Values {
  return {
    title: 'Material für den Zählerschrank bestellen',
    dueOn: '2026-09-25',
    assigneeUserId: 'britta',
    status: 'open',
    customerId,
    jobId,
    ...over,
  }
}

async function stored(id: string) {
  const [row] = await database.forTenant({ tenantId: north.id }, (tx) =>
    tx
      .select()
      .from(tasks)
      .where(eq(tasks.id, id as never)),
  )

  return row
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

  // Straight into the tables, as the superuser. How somebody comes to work in
  // a business is the staff tests' subject; here it only matters that they do.
  for (const [userId, person] of Object.entries(people)) {
    await admin.query('insert into auth_users (id, name, email) values ($1, $2, $3)', [
      userId,
      person.name,
      `${userId}@example.de`,
    ])
    await admin.query(
      'insert into memberships (tenant_id, user_id, roles, blocked_at) values ($1, $2, $3, $4)',
      [person.tenant, userId, [...person.roles], userId === 'gesperrt' ? new Date() : null],
    )
  }

  database = Database.connect(applicationDatabaseUrl())

  const built = await Test.createTestingModule({
    imports: [ApiModule.create(database, identities)],
  }).compile()

  app = built.createNestApplication()
  await app.init()

  const customer = await http()
    .post('/customers')
    .set('x-test-identity', as('britta'))
    .send({ kind: 'business', name: 'Hausverwaltung Nordblick GmbH' })
    .expect(201)

  customerId = (customer.body as { id: string }).id

  const job = await http()
    .post('/jobs')
    .set('x-test-identity', as('britta'))
    .send({ customerId, kind: 'service', designation: 'Zählerschrank Lindenweg' })
    .expect(201)

  jobId = (job.body as { id: string }).id
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
})

describe('a task written on a device', () => {
  it('lands with the person who wrote it, taken from the request', async () => {
    const id = newId<'task'>()
    const { receipts } = await push([creating(id, aTask())])

    expect(receipts.map((receipt) => receipt.outcome)).toEqual(['applied'])

    const row = await stored(id)

    expect(row?.createdBy).toBe('max')
    expect(row?.assigneeUserId).toBe('britta')
    expect(row?.status).toBe('open')
    expect(row?.jobId).toBe(jobId)
  })

  it('is refused when the device names an author itself', async () => {
    // The author is reserved in the policy, so the merge already says no, for
    // this one operation and with the field it hangs on.
    const id = newId<'task'>()
    const { receipts } = await push([creating(id, aTask({ createdBy: 'chefin' }))])

    expect(receipts.map((receipt) => [receipt.outcome, receipt.reason, receipt.fields])).toEqual([
      ['conflict', 'set_by_server', ['createdBy']],
    ])
    expect(await stored(id)).toBeUndefined()
  })

  it('keeps its author, whoever changes it afterwards', async () => {
    const id = newId<'task'>()
    await push([creating(id, aTask())])

    const { receipts } = await push([changing(id, { status: 'done' })], 'britta')

    expect(receipts.map((receipt) => receipt.outcome)).toEqual(['applied'])

    const row = await stored(id)

    expect(row?.status).toBe('done')
    expect(row?.createdBy).toBe('max')
    expect(row?.updatedBy).toBe('britta')
  })

  it('travels to the devices, which is what the stamp trigger is for', async () => {
    const id = newId<'task'>()
    await push([creating(id, aTask({ title: 'Prüfprotokoll nachreichen' }))])

    const answer = await http().get('/sync?since=0').set('x-test-identity', as('max')).expect(200)
    const pulled = answer.body as {
      changes: { entity: string; rows: { id: string; changeSequence: number }[] }[]
    }
    const row = pulled.changes
      .find((change) => change.entity === 'tasks')
      ?.rows.find((candidate) => candidate.id === id)

    expect(row).toBeDefined()
    expect(row?.changeSequence).toBeGreaterThan(0)
  })
})

describe('the person a task goes to', () => {
  it('works in this business, and one from next door is a conflict about that one task', async () => {
    const stranger = newId<'task'>()
    const fine = newId<'task'>()
    const { receipts } = await push([
      creating(stranger, aTask({ assigneeUserId: 'sued' })),
      creating(fine, aTask({ title: 'Kunden zurückrufen' })),
    ])

    expect(receipts.map((receipt) => [receipt.outcome, receipt.reason, receipt.fields])).toEqual([
      ['conflict', 'record_missing', ['assigneeUserId']],
      ['applied', null, []],
    ])
    expect(await stored(stranger)).toBeUndefined()
    expect(await stored(fine)).toBeDefined()
  })

  it('is not somebody shut out of the business', async () => {
    const { receipts } = await push([
      creating(newId<'task'>(), aTask({ assigneeUserId: 'gesperrt' })),
    ])

    expect(receipts.map((receipt) => receipt.reason)).toEqual(['record_missing'])
  })

  it('is asked again when the task is handed on', async () => {
    const id = newId<'task'>()
    await push([creating(id, aTask())])

    const { receipts } = await push([changing(id, { assigneeUserId: 'sued' })], 'britta')

    expect(receipts.map((receipt) => receipt.reason)).toEqual(['record_missing'])
    expect((await stored(id))?.assigneeUserId).toBe('britta')
  })

  it('is held by the key in the database as well, past every check in the application', async () => {
    const refusal = await refusedBy(
      database.forTenant({ tenantId: north.id, userId: 'britta' }, (tx) =>
        tx.insert(tasks).values({
          tenantId: north.id,
          title: 'An jemanden von nebenan',
          dueOn: '2026-09-25',
          assigneeUserId: 'sued',
        }),
      ),
    )

    expect(refusal).toEqual({
      code: foreignKeyViolation,
      constraint: 'tasks_assignee_works_here',
    })
  })
})

describe('a task nobody wrote', () => {
  it('can be written, the way the deadline engine will write one, and has no author', async () => {
    // A transaction that acts for no person: no user id, only a reason for the
    // log. The same table and the same triggers as for anybody else.
    const [written] = await database.forTenant({ tenantId: north.id, reason: 'deadline' }, (tx) =>
      tx
        .insert(tasks)
        .values({
          tenantId: north.id,
          title: 'E-Check Hausverwaltung fällig',
          dueOn: '2026-10-01',
          assigneeUserId: 'britta',
          customerId: customerId as never,
        })
        .returning(),
    )

    expect(written?.createdBy).toBeNull()
    expect(written?.status).toBe('open')
    expect(written?.changeSequence).toBeGreaterThan(0)
  })

  it('cannot be passed off as written by somebody, whatever the insert says', async () => {
    const [written] = await database.forTenant({ tenantId: north.id, reason: 'deadline' }, (tx) =>
      tx
        .insert(tasks)
        .values({
          tenantId: north.id,
          title: 'Wartung Notbeleuchtung',
          dueOn: '2026-10-01',
          assigneeUserId: 'britta',
          createdBy: 'chefin',
        })
        .returning(),
    )

    expect(written?.createdBy).toBeNull()
  })
})

describe('the names of the people', () => {
  it('are there for everybody who reads tasks, the technician included', async () => {
    const answer = await http()
      .get('/tasks/assignees')
      .set('x-test-identity', as('max'))
      .expect(200)

    expect(answer.body).toEqual([
      { userId: 'britta', name: 'Britta Büro', active: true },
      { userId: 'chefin', name: 'Christa Chefin', active: true },
      { userId: 'gesperrt', name: 'Gerd Gesperrt', active: false },
      { userId: 'max', name: 'Max Monteur', active: true },
    ])
  })

  it('name nobody from the business next door', async () => {
    const answer = await http()
      .get('/tasks/assignees')
      .set('x-test-identity', as('sued'))
      .expect(200)

    expect(answer.body).toEqual([{ userId: 'sued', name: 'Susi Süd', active: true }])
  })
})
