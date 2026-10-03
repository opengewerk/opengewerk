import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import type { DocumentId, RoleKey, TenantId } from '@opengewerk/domain'
import { Database, newId } from '@opengewerk/platform-server'
import { eq } from 'drizzle-orm'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { deadlines, tasks } from '../database/schema/index.js'
import {
  allowApplicationLogin,
  applicationDatabaseUrl,
  applyMigrations,
  connect,
  resetSchema,
} from '../database/test-database.js'
import { runDeadlinesOf } from '../deadlines/engine.js'
import { ApiModule } from './api.module.js'
import type {
  BusinessDeadlineEntry as DeadlineEntry,
  BusinessDeadlineKindEntry as DeadlineKindEntry,
} from '../deadlines/routes.js'
import { type Somebody, testIdentities as identities } from './test-identity.js'

/**
 * The routes of the deadlines, #283: the list "Fristen" and the settings of
 * each kind. What they hold: the office reads and changes the deadlines of its
 * own business and nobody else's, only within what the office decides, and a
 * technician does not read the list at all.
 */

const north = newId<'tenant'>() as TenantId
const south = newId<'tenant'>() as TenantId

const people = {
  olga: { name: 'Olga Inhaberin', tenant: north, roles: ['owner'] },
  britta: { name: 'Britta Büro', tenant: north, roles: ['office'] },
  max: { name: 'Max Monteur', tenant: north, roles: ['technician'] },
  gesperrt: { name: 'Gerd Gesperrt', tenant: north, roles: ['technician'] },
  susi: { name: 'Susi Süd', tenant: south, roles: ['owner'] },
} as const

type Person = keyof typeof people

const dueDay = new Date('2037-09-24T07:00:00Z')

let admin: Pool
let database: Database
let app: INestApplication
const customers = {} as Record<TenantId, string>

function http() {
  return request(app.getHttpServer())
}

function as(person: Person): string {
  const { tenant, roles } = people[person]

  return JSON.stringify({
    userId: person,
    tenantId: tenant,
    roles: [...roles] as RoleKey[],
  } satisfies Somebody)
}

async function aQuote(tenant: TenantId = north, number = 'A-2037-0001'): Promise<DocumentId> {
  const id = newId<'document'>() as DocumentId

  await admin.query(
    `insert into documents (id, tenant_id, customer_id, kind, status, number, document_date, issued_at, issued_by, subject)
     values ($1, $2, $3, 'quote', 'issued', $4, '2037-09-10', '2037-09-10T08:00:00Z', $5, 'Wallbox')`,
    [id, tenant, customers[tenant], number, tenant === north ? 'britta' : 'susi'],
  )

  return id
}

async function list(person: Person = 'britta', status?: string): Promise<DeadlineEntry[]> {
  const answer = await http()
    .get(status ? `/deadlines?status=${status}` : '/deadlines')
    .set('x-test-identity', as(person))
    .expect(200)

  return answer.body as DeadlineEntry[]
}

async function theOnly(person: Person = 'britta'): Promise<DeadlineEntry> {
  const rows = await list(person, 'all')

  expect(rows).toHaveLength(1)

  return rows[0] as DeadlineEntry
}

beforeAll(async () => {
  admin = await connect()
  await resetSchema(admin)
  await applyMigrations()
  await allowApplicationLogin(admin)
  await admin.query('insert into tenants (id, name) values ($1, $2), ($3, $4)', [
    north,
    'Elektro Nord GmbH',
    south,
    'Elektro Süd GmbH',
  ])

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

  for (const tenant of [north, south]) {
    const id = newId<'customer'>()

    await admin.query(
      `insert into customers (id, tenant_id, kind, name) values ($1, $2, 'business', 'Hausverwaltung Süd GmbH')`,
      [id, tenant],
    )
    customers[tenant] = id
  }

  database = Database.connect(applicationDatabaseUrl())

  const built = await Test.createTestingModule({
    imports: [ApiModule.create(database, identities)],
  }).compile()

  app = built.createNestApplication()
  await app.init()
})

beforeEach(async () => {
  await admin.query('delete from deadlines')
  await admin.query('delete from deadline_settings')
  await admin.query('delete from tasks')
  await admin.query(
    'begin; set local session_replication_role = replica; delete from documents; commit;',
  )
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
})

describe('the list "Fristen"', () => {
  it('names the kind, the source, the customer, the person and the day it reminds', async () => {
    const quote = await aQuote()
    await runDeadlinesOf({ database }, north, new Date('2037-09-12T08:00:00Z'))

    expect(await theOnly()).toMatchObject({
      kind: 'quote.follow_up',
      kindTitle: 'Wiedervorlage eines Angebots',
      trade: null,
      status: 'open',
      anchorOn: '2037-09-10',
      dueOn: '2037-09-24',
      remindOn: '2037-09-24',
      leadDays: 0,
      ownLeadDays: null,
      responsible: { userId: 'britta', name: 'Britta Büro' },
      source: { label: 'A-2037-0001', documentId: quote, installationId: null },
      customer: { id: customers[north], name: 'Hausverwaltung Süd GmbH' },
      remindedFor: null,
      closedBy: null,
    })
  })

  it('shows the open ones unless asked for others', async () => {
    await aQuote()
    await runDeadlinesOf({ database }, north, dueDay)
    await admin.query(
      `update deadlines set status = 'done', closed_at = now(), closed_by = 'britta'`,
    )

    expect(await list()).toHaveLength(0)
    expect(await list('britta', 'done')).toHaveLength(1)
    expect((await list('britta', 'all'))[0]?.closedBy).toEqual({
      userId: 'britta',
      name: 'Britta Büro',
    })

    await http().get('/deadlines?status=gestern').set('x-test-identity', as('britta')).expect(400)
  })

  it('is not for a technician, who gets what a deadline asks as a task', async () => {
    await http().get('/deadlines').set('x-test-identity', as('max')).expect(403)
    await http().get('/deadlines/kinds').set('x-test-identity', as('max')).expect(403)
  })

  it('shows every business its own', async () => {
    await aQuote()
    await aQuote(south, 'A-2037-0100')
    await runDeadlinesOf({ database }, north, dueDay)
    await runDeadlinesOf({ database }, south, dueDay)

    expect((await list('britta')).map((row) => row.source.label)).toEqual(['A-2037-0001'])
    expect((await list('susi')).map((row) => row.source.label)).toEqual(['A-2037-0100'])
  })
})

describe('changing a deadline', () => {
  async function aDeadline(): Promise<DeadlineEntry> {
    await aQuote()
    await runDeadlinesOf({ database }, north, dueDay)

    return theOnly()
  }

  it('gives it a lead of its own and takes it back', async () => {
    const deadline = await aDeadline()

    await http()
      .patch(`/deadlines/${deadline.id}`)
      .set('x-test-identity', as('britta'))
      .send({ leadDays: 3 })
      .expect(200)

    expect(await theOnly()).toMatchObject({ leadDays: 3, ownLeadDays: 3, remindOn: '2037-09-21' })

    await http()
      .patch(`/deadlines/${deadline.id}`)
      .set('x-test-identity', as('britta'))
      .send({ leadDays: null })
      .expect(200)

    expect(await theOnly()).toMatchObject({ leadDays: 0, ownLeadDays: null })
  })

  it('refuses a lead that is no lead, and a body that changes nothing', async () => {
    const deadline = await aDeadline()

    for (const leadDays of [-1, 366, 2.5, 'drei']) {
      await http()
        .patch(`/deadlines/${deadline.id}`)
        .set('x-test-identity', as('britta'))
        .send({ leadDays })
        .expect(400)
    }

    await http()
      .patch(`/deadlines/${deadline.id}`)
      .set('x-test-identity', as('britta'))
      .send({ dueOn: '2037-12-24' })
      .expect(400)
  })

  it('hands it and its open task to another person of the business', async () => {
    const deadline = await aDeadline()

    await http()
      .patch(`/deadlines/${deadline.id}`)
      .set('x-test-identity', as('britta'))
      .send({ responsibleUserId: 'max' })
      .expect(200)

    expect(await theOnly()).toMatchObject({
      responsible: { userId: 'max', name: 'Max Monteur' },
      ownResponsibleUserId: 'max',
    })

    const [task] = await database.forTenant({ tenantId: north }, (tx) => tx.select().from(tasks))

    expect(task?.assigneeUserId).toBe('max')
  })

  it('refuses a person who is blocked or works next door', async () => {
    const deadline = await aDeadline()

    for (const responsibleUserId of ['gesperrt', 'susi']) {
      await http()
        .patch(`/deadlines/${deadline.id}`)
        .set('x-test-identity', as('britta'))
        .send({ responsibleUserId })
        .expect(422)
    }
  })

  it('marks it done with its task, and opens it again', async () => {
    const deadline = await aDeadline()

    await http()
      .post(`/deadlines/${deadline.id}/done`)
      .set('x-test-identity', as('britta'))
      .expect(201)

    expect(await theOnly()).toMatchObject({
      status: 'done',
      closedBy: { userId: 'britta', name: 'Britta Büro' },
    })

    const [task] = await database.forTenant({ tenantId: north }, (tx) => tx.select().from(tasks))

    expect(task?.status).toBe('done')

    await http()
      .post(`/deadlines/${deadline.id}/done`)
      .set('x-test-identity', as('britta'))
      .expect(409)

    await http()
      .post(`/deadlines/${deadline.id}/reopen`)
      .set('x-test-identity', as('britta'))
      .expect(201)

    expect(await theOnly()).toMatchObject({ status: 'open', closedAt: null, closedBy: null })

    // Its task opens with it. Left done, the next pass of the engine would
    // find the task done and close the deadline again within the minute.
    const [reopened] = await database.forTenant({ tenantId: north }, (tx) =>
      tx.select().from(tasks),
    )

    expect(reopened?.status).toBe('open')

    await runDeadlinesOf({ database }, north, new Date(dueDay.getTime() + 60_000))

    expect(await theOnly()).toMatchObject({ status: 'open' })

    await http()
      .post(`/deadlines/${deadline.id}/reopen`)
      .set('x-test-identity', as('britta'))
      .expect(409)
  })

  it('opens again when its task was done in the list of tasks', async () => {
    await aDeadline()
    await admin.query(`update tasks set status = 'done'`)
    await runDeadlinesOf({ database }, north, new Date(dueDay.getTime() + 60_000))

    const closed = await theOnly()

    expect(closed.status).toBe('done')

    await http()
      .post(`/deadlines/${closed.id}/reopen`)
      .set('x-test-identity', as('britta'))
      .expect(201)
    await runDeadlinesOf({ database }, north, new Date(dueDay.getTime() + 120_000))

    expect(await theOnly()).toMatchObject({ status: 'open' })
  })

  it('reopens no deadline that dropped out, that comes back from its source', async () => {
    const deadline = await aDeadline()

    await admin.query(`update deadlines set status = 'dropped', closed_at = now()`)

    await http()
      .post(`/deadlines/${deadline.id}/reopen`)
      .set('x-test-identity', as('britta'))
      .expect(409)
  })

  it('finds no deadline of another business', async () => {
    await aQuote(south, 'A-2037-0100')
    await runDeadlinesOf({ database }, south, dueDay)

    const [theirs] = await database.forTenant({ tenantId: south }, (tx) =>
      tx.select().from(deadlines),
    )

    await http()
      .patch(`/deadlines/${String(theirs?.id)}`)
      .set('x-test-identity', as('britta'))
      .send({ leadDays: 1 })
      .expect(404)
    await http()
      .post(`/deadlines/${String(theirs?.id)}/done`)
      .set('x-test-identity', as('britta'))
      .expect(404)

    const [still] = await database.forTenant({ tenantId: south }, (tx) =>
      tx
        .select()
        .from(deadlines)
        .where(eq(deadlines.id, theirs?.id as never)),
    )

    expect(still).toMatchObject({ leadDays: null, status: 'open' })
  })

  it('is not the technician’s to change', async () => {
    const deadline = await aDeadline()

    await http()
      .post(`/deadlines/${deadline.id}/done`)
      .set('x-test-identity', as('max'))
      .expect(403)
  })
})

describe('the settings of each kind', () => {
  it('list the kinds with what the business set', async () => {
    const answer = await http()
      .get('/settings/deadlines')
      .set('x-test-identity', as('olga'))
      .expect(200)

    expect(answer.body as DeadlineKindEntry[]).toEqual([
      expect.objectContaining({
        key: 'quote.follow_up',
        title: 'Wiedervorlage eines Angebots',
        intervalDays: 14,
        leadDays: 0,
        responsible: 'source',
        actions: ['task'],
        setting: {
          intervalDays: null,
          intervalMonths: null,
          leadDays: null,
          responsibleUserId: null,
        },
      }),
    ])
  })

  it('take a lead, an interval and a person from the owner', async () => {
    const answer = await http()
      .put('/settings/deadlines/quote.follow_up')
      .set('x-test-identity', as('olga'))
      .send({ leadDays: 2, intervalDays: 21, responsibleUserId: 'britta' })
      .expect(200)

    expect((answer.body as DeadlineKindEntry).setting).toEqual({
      leadDays: 2,
      intervalDays: 21,
      intervalMonths: null,
      responsibleUserId: 'britta',
    })

    // Back to the kind's own values, all three at once.
    const back = await http()
      .put('/settings/deadlines/quote.follow_up')
      .set('x-test-identity', as('olga'))
      .send({ leadDays: null, intervalDays: null, responsibleUserId: null })
      .expect(200)

    expect((back.body as DeadlineKindEntry).setting).toEqual({
      leadDays: null,
      intervalDays: null,
      intervalMonths: null,
      responsibleUserId: null,
    })
  })

  it('refuse what is out of bounds, a kind nobody knows and a person who cannot take it', async () => {
    await http()
      .put('/settings/deadlines/quote.follow_up')
      .set('x-test-identity', as('olga'))
      .send({ intervalDays: 0 })
      .expect(400)
    await http()
      .put('/settings/deadlines/quote.follow_up')
      .set('x-test-identity', as('olga'))
      .send({ leadDays: 400 })
      .expect(400)
    await http()
      .put('/settings/deadlines/elektro.anything')
      .set('x-test-identity', as('olga'))
      .send({ leadDays: 1 })
      .expect(404)
    await http()
      .put('/settings/deadlines/quote.follow_up')
      .set('x-test-identity', as('olga'))
      .send({ responsibleUserId: 'gesperrt' })
      .expect(422)
  })

  it('are read by the office and set only by the owner', async () => {
    await http().get('/settings/deadlines').set('x-test-identity', as('britta')).expect(200)
    await http()
      .put('/settings/deadlines/quote.follow_up')
      .set('x-test-identity', as('britta'))
      .send({ leadDays: 1 })
      .expect(403)
  })
})
