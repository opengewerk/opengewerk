import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { eq } from 'drizzle-orm'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { Database } from '../database/database.js'
import { newId } from '../database/identifier.js'
import { jobs } from '../database/schema/index.js'
import {
  allowApplicationLogin,
  applicationDatabaseUrl,
  applyMigrations,
  connect,
  refusedBy,
  resetSchema,
} from '../database/test-database.js'
import { ApiModule } from './api.module.js'
import { as, testIdentities as identities } from './test-identity.js'
import { changed, created, push } from './test-structure.js'

/**
 * Follow-up jobs, #170: a job after a finished job of the same customer, made
 * in the office and linked both ways.
 *
 * What is held here is the rule in the three places it is asked: the routes,
 * which answer with the sentence; the sync, where a job that was taken up
 * again meanwhile is a conflict about one operation and not a refused
 * transmission; and the trigger in the database, for every other way in.
 */

const north = { id: newId<'tenant'>(), name: 'Elektro Nord GmbH' }
const south = { id: newId<'tenant'>(), name: 'Elektro Süd GmbH' }

const office = () => as(north.id, 'office')

let admin: Pool
let database: Database
let app: INestApplication
let berg: string
let kramer: string

function http() {
  return request(app.getHttpServer())
}

interface JobRow {
  readonly id: string
  readonly customerId: string
  readonly predecessorJobId: string | null
  readonly status: string
  readonly number: string | null
}

async function customer(name: string, tenantId = north.id) {
  const answer = await http()
    .post('/customers')
    .set('x-test-identity', as(tenantId, 'office'))
    .send({ kind: 'private', name })
    .expect(201)

  return String((answer.body as { id: string }).id)
}

async function job(values: Record<string, unknown>, expected = 201, tenantId = north.id) {
  const answer = await http()
    .post('/jobs')
    .set('x-test-identity', as(tenantId, 'office'))
    .send({ kind: 'service', designation: 'Zählerschrank Lindenweg', ...values })
    .expect(expected)

  return answer.body as JobRow & { message?: string }
}

async function change(id: string, values: Record<string, unknown>, expected = 200) {
  const answer = await http()
    .patch(`/jobs/${id}`)
    .set('x-test-identity', office())
    .send(values)
    .expect(expected)

  return answer.body as JobRow & { message?: string }
}

/** A finished job of the customer, the one a follow-up comes after. */
async function finished(customerId = berg) {
  return job({ customerId, status: 'completed' })
}

async function stored(id: string) {
  const [row] = await database.forTenant({ tenantId: north.id }, (tx) =>
    tx
      .select()
      .from(jobs)
      .where(eq(jobs.id, id as never)),
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

  database = Database.connect(applicationDatabaseUrl())

  const built = await Test.createTestingModule({
    imports: [ApiModule.create(database, identities)],
  }).compile()

  app = built.createNestApplication()
  await app.init()

  berg = await customer('Familie Berg')
  kramer = await customer('Hausverwaltung Kramer')
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
})

describe('a follow-up job made in the office', () => {
  it('comes after a finished job of the same customer, with a number of its own', async () => {
    const before = await finished()
    const after = await job({ customerId: berg, predecessorJobId: before.id })

    expect(after.predecessorJobId).toBe(before.id)
    expect(after.number).toMatch(/^AU-\d{4}-\d{4}$/)
    expect(after.number).not.toBe(before.number)
  })

  it('may be one of several after the same job', async () => {
    const before = await finished()

    await job({ customerId: berg, predecessorJobId: before.id, designation: 'Wallbox' })
    await job({ customerId: berg, predecessorJobId: before.id, designation: 'Nacharbeit' })

    const all = await http().get('/jobs').set('x-test-identity', office()).expect(200)

    expect((all.body as JobRow[]).filter((one) => one.predecessorJobId === before.id)).toHaveLength(
      2,
    )
  })

  it('does not follow a job that is still running', async () => {
    const running = await job({ customerId: berg, status: 'active' })

    expect((await job({ customerId: berg, predecessorJobId: running.id }, 422)).message).toBe(
      'Ein Folgeauftrag schließt an einen abgeschlossenen Auftrag an.',
    )
  })

  it('is for the customer of the job before it', async () => {
    const before = await finished()

    expect((await job({ customerId: kramer, predecessorJobId: before.id }, 422)).message).toBe(
      'Ein Folgeauftrag ist für denselben Kunden wie der Auftrag davor.',
    )
  })

  it('does not follow a job of another business', async () => {
    const theirs = await job(
      { customerId: await customer('Familie Süd', south.id), status: 'completed' },
      201,
      south.id,
    )

    const refused = await job({ customerId: berg, predecessorJobId: theirs.id }, 422)

    expect(refused.message).toContain('aus predecessorJobId gibt es in diesem Betrieb nicht')
  })

  it('keeps the job it follows, whatever is sent later', async () => {
    const before = await finished()
    const other = await finished()
    const after = await job({ customerId: berg, predecessorJobId: before.id })

    expect((await change(after.id, { predecessorJobId: other.id }, 422)).message).toBe(
      'Der Vorgänger eines Folgeauftrags steht mit dem Anlegen fest.',
    )
    expect((await change(after.id, { predecessorJobId: null }, 422)).message).toBe(
      'Der Vorgänger eines Folgeauftrags steht mit dem Anlegen fest.',
    )

    // A job made without one does not get one afterwards either.
    const plain = await job({ customerId: berg })

    await change(plain.id, { predecessorJobId: before.id }, 422)
  })

  it('stays with the job before it when that one is taken up again', async () => {
    const before = await finished()
    const after = await job({ customerId: berg, predecessorJobId: before.id })

    await change(before.id, { status: 'active' })

    expect((await stored(after.id))?.predecessorJobId).toBe(before.id)
  })

  it('keeps the job before it with its customer', async () => {
    const before = await finished()

    await job({ customerId: berg, predecessorJobId: before.id })

    expect((await change(before.id, { customerId: kramer }, 422)).message).toBe(
      'Auf diesen Auftrag folgen Aufträge für seinen Kunden, er bleibt bei ihm.',
    )
  })
})

describe('a follow-up job through the outbox', () => {
  function followUp(recordId: string, customerId: string, predecessorJobId: string) {
    return created('jobs', recordId, {
      customerId,
      kind: 'service',
      status: 'draft',
      designation: 'Wallbox',
      predecessorJobId,
    })
  }

  it('lands when the job before it is finished', async () => {
    const before = await finished()
    const id = newId<'job'>()
    const { receipts } = await push(app, office(), [followUp(id, berg, before.id)])

    expect(receipts.map((receipt) => receipt.outcome)).toEqual(['applied'])
    expect((await stored(id))?.predecessorJobId).toBe(before.id)
  })

  it('is a conflict about itself when the job before it was taken up again meanwhile', async () => {
    const before = await finished()

    await change(before.id, { status: 'active' })

    // Something else in the same transmission, which lands all the same.
    const job = followUp(newId<'job'>(), berg, before.id)
    const other = created('customers', newId<'customer'>(), {
      kind: 'private',
      name: 'Familie Nach',
    })
    const { receipts } = await push(app, office(), [job, other])
    const receiptOf = (operation: { id: string }) =>
      receipts.find((receipt) => receipt.operationId === operation.id)

    expect(receiptOf(job)).toMatchObject({
      outcome: 'conflict',
      reason: 'changed_elsewhere',
      fields: ['predecessorJobId'],
    })
    expect(receiptOf(other)).toMatchObject({ outcome: 'applied' })
  })

  it('is a conflict when the job before it is for somebody else', async () => {
    const before = await finished()
    const { receipts } = await push(app, office(), [followUp(newId<'job'>(), kramer, before.id)])

    expect(receipts[0]).toMatchObject({
      outcome: 'conflict',
      reason: 'changed_elsewhere',
      fields: ['predecessorJobId'],
    })
  })

  it('is a conflict when the job before it is not there', async () => {
    const { receipts } = await push(app, office(), [followUp(newId<'job'>(), berg, newId<'job'>())])

    expect(receipts[0]).toMatchObject({
      outcome: 'conflict',
      reason: 'record_missing',
      fields: ['predecessorJobId'],
    })
  })

  it('refuses the transmission that moves a follow-up to another job', async () => {
    const before = await finished()
    const other = await finished()
    const after = await job({ customerId: berg, predecessorJobId: before.id })

    const refused = await push(
      app,
      office(),
      [changed('jobs', after.id, { predecessorJobId: { from: before.id, to: other.id } })],
      400,
    )

    expect(refused.message).toBe('Der Vorgänger eines Folgeauftrags steht mit dem Anlegen fest.')
  })

  it('is a conflict when a job with follow-ups is moved to another customer', async () => {
    const before = await finished()

    await job({ customerId: berg, predecessorJobId: before.id })

    const { receipts } = await push(app, office(), [
      changed('jobs', before.id, { customerId: { from: berg, to: kramer } }),
    ])

    expect(receipts[0]).toMatchObject({
      outcome: 'conflict',
      reason: 'changed_elsewhere',
      fields: ['customerId'],
    })
  })
})

/**
 * Straight at the database as the superuser, past every check of the routes
 * and the sync: row-level security does not apply to it, the trigger does.
 */
describe('the database behind it', () => {
  it('refuses a follow-up of a job that is not finished', async () => {
    const running = await job({ customerId: berg, status: 'active' })
    const refusal = await refusedBy(
      admin.query(
        `insert into jobs (tenant_id, customer_id, kind, designation, predecessor_job_id)
           values ($1, $2, 'service', 'Wallbox', $3)`,
        [north.id, berg, running.id],
      ),
    )

    expect(refusal.code).toBe('23514')
  })

  it('refuses a follow-up for another customer, and a new predecessor later', async () => {
    const before = await finished()
    const after = await job({ customerId: berg, predecessorJobId: before.id })
    const other = await finished()

    expect(
      (
        await refusedBy(
          admin.query(
            `insert into jobs (tenant_id, customer_id, kind, designation, predecessor_job_id)
               values ($1, $2, 'service', 'Wallbox', $3)`,
            [north.id, kramer, before.id],
          ),
        )
      ).code,
    ).toBe('23514')
    expect(
      (
        await refusedBy(
          admin.query('update jobs set predecessor_job_id = $1 where id = $2', [
            other.id,
            after.id,
          ]),
        )
      ).code,
    ).toBe('23514')
    expect(
      (
        await refusedBy(
          admin.query('update jobs set customer_id = $1 where id = $2', [kramer, before.id]),
        )
      ).code,
    ).toBe('23514')
  })

  it('refuses a job that follows itself', async () => {
    const id = newId<'job'>()
    const refusal = await refusedBy(
      admin.query(
        `insert into jobs (id, tenant_id, customer_id, kind, designation, predecessor_job_id)
           values ($1, $2, $3, 'service', 'Wallbox', $1)`,
        [id, north.id, berg],
      ),
    )

    expect(refusal).toEqual({ code: '23514', constraint: 'jobs_not_own_predecessor' })
  })
})
