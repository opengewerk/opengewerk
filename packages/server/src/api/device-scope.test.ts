import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import type { Identity, RoleKey, TenantId } from '@opengewerk/domain'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { Database } from '../database/database.js'
import { deviceScope } from '../database/device-scope.js'
import { newId } from '../database/identifier.js'
import {
  allowApplicationLogin,
  applicationDatabaseUrl,
  applyMigrations,
  connect,
  resetSchema,
} from '../database/test-database.js'
import { ApiModule } from './api.module.js'
import { testIdentities as identities } from './test-identity.js'
import { created, push } from './test-structure.js'

/**
 * Each device holds its part of the business, #140. A technician's device
 * gets the jobs the office put them on, with what hangs on them, and what
 * they created themselves; a closed job stays thirty days. The owner and the
 * office keep the whole business.
 */

const north = { id: newId<'tenant'>() as TenantId, name: 'Elektro Nord GmbH' }

const people = {
  britta: { name: 'Britta Büro', roles: ['office'] },
  max: { name: 'Max Monteur', roles: ['technician'] },
  toni: { name: 'Toni Techniker', roles: ['technician'] },
  gesperrt: { name: 'Gerd Gesperrt', roles: ['technician'] },
} as const

type Person = keyof typeof people

let admin: Pool
let database: Database
let app: INestApplication

function http() {
  return request(app.getHttpServer())
}

function as(person: Person): string {
  return JSON.stringify({
    userId: person,
    tenantId: north.id,
    roles: [...people[person].roles] as RoleKey[],
  } satisfies Identity)
}

async function post(path: string, body: Record<string, unknown>, who: Person = 'britta') {
  const answer = await http().post(path).set('x-test-identity', as(who)).send(body).expect(201)

  return String((answer.body as { id: string }).id)
}

async function assign(
  jobId: string,
  userIds: readonly string[],
  expected = 200,
  who: Person = 'britta',
) {
  const answer = await http()
    .put(`/jobs/${jobId}/assignees`)
    .set('x-test-identity', as(who))
    .send({ userIds })
    .expect(expected)

  return answer.body as { userIds?: string[]; message?: string }
}

interface Pulled {
  readonly changes: { entity: string; rows: Record<string, unknown>[] }[]
  readonly narrowed: Record<string, string>
}

async function pull(who: Person) {
  const answer = await http().get('/sync?since=0').set('x-test-identity', as(who)).expect(200)

  return answer.body as Pulled
}

/** The ids a pull brought of one entity, deleted ones left out. */
function idsOf(pulled: Pulled, entity: string): string[] {
  return (pulled.changes.find((change) => change.entity === entity)?.rows ?? [])
    .filter((row) => row['deletedAt'] === null)
    .map((row) => String(row['id']))
}

/** One customer with a site, an installation and a running job there. */
async function household(name: string) {
  const customer = await post('/customers', { kind: 'private', name })
  const site = await post('/sites', { customerId: customer, designation: `Haus ${name}` })
  const installation = await post('/installations', {
    siteId: site,
    kind: 'meter_cabinet',
    designation: 'Zählerschrank',
  })
  const job = await post('/jobs', {
    customerId: customer,
    siteId: site,
    installationId: installation,
    kind: 'service',
    status: 'active',
    designation: `Auftrag ${name}`,
  })

  return { customer, site, installation, job }
}

beforeAll(async () => {
  admin = await connect()
  await resetSchema(admin)
  await applyMigrations()
  await allowApplicationLogin(admin)
  await admin.query('insert into tenants (id, name) values ($1, $2)', [north.id, north.name])

  for (const [userId, person] of Object.entries(people)) {
    await admin.query('insert into auth_users (id, name, email) values ($1, $2, $3)', [
      userId,
      person.name,
      `${userId}@example.de`,
    ])
    await admin.query(
      'insert into memberships (tenant_id, user_id, roles, blocked_at) values ($1, $2, $3, $4)',
      [north.id, userId, [...person.roles], userId === 'gesperrt' ? new Date() : null],
    )
  }

  database = Database.connect(applicationDatabaseUrl())

  const built = await Test.createTestingModule({
    imports: [ApiModule.create(database, identities)],
  }).compile()

  app = built.createNestApplication()
  await app.init()
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
})

describe('the device of a technician', () => {
  it('holds the jobs its person is on, with what hangs on them, and nothing else', async () => {
    const berg = await household('Berg')
    const kramer = await household('Kramer')

    await assign(berg.job, ['max'])

    const quote = await post('/documents', {
      customerId: berg.customer,
      jobId: berg.job,
      kind: 'quote',
      documentDate: '2026-09-21',
    })
    const elsewhere = await post('/documents', {
      customerId: kramer.customer,
      jobId: kramer.job,
      kind: 'quote',
      documentDate: '2026-09-21',
    })
    const contact = await post('/contacts', { customerId: berg.customer, familyName: 'Berg' })
    const theirs = await post('/contacts', { customerId: kramer.customer, familyName: 'Kramer' })

    const pulled = await pull('max')

    expect(idsOf(pulled, 'jobs')).toContain(berg.job)
    expect(idsOf(pulled, 'jobs')).not.toContain(kramer.job)
    expect(idsOf(pulled, 'customers')).toContain(berg.customer)
    expect(idsOf(pulled, 'customers')).not.toContain(kramer.customer)
    expect(idsOf(pulled, 'sites')).toEqual([berg.site])
    expect(idsOf(pulled, 'installations')).toEqual([berg.installation])
    expect(idsOf(pulled, 'documents')).toContain(quote)
    expect(idsOf(pulled, 'documents')).not.toContain(elsewhere)
    expect(idsOf(pulled, 'contacts')).toContain(contact)
    expect(idsOf(pulled, 'contacts')).not.toContain(theirs)
    expect(pulled.narrowed['jobs']).toMatch(/^jobs:[0-9a-f]{16}$/)
    expect(pulled.narrowed['customers']).toBe(pulled.narrowed['jobs'])
  })

  it('holds a task handed to its person, wherever the task hangs', async () => {
    const kramer = await household('Kramer')
    // Tasks are written through the outbox, on site as in the office.
    const task = newId<'task'>()

    await push(app, as('britta'), [
      created('tasks', task, {
        title: 'Zählerstand ablesen',
        dueOn: '2026-09-30',
        assigneeUserId: 'max',
        status: 'open',
        customerId: kramer.customer,
        jobId: kramer.job,
      }),
    ])

    expect(idsOf(await pull('max'), 'tasks')).toContain(task)
    expect(idsOf(await pull('toni'), 'tasks')).not.toContain(task)
  })

  it('holds what its person created, before it is on any job', async () => {
    const id = newId<'customer'>()

    await push(app, as('toni'), [
      created('customers', id, { kind: 'private', name: 'Neu entdeckter Bauherr' }),
    ])

    expect(idsOf(await pull('toni'), 'customers')).toContain(id)
    expect(idsOf(await pull('max'), 'customers')).not.toContain(id)
  })

  it('keeps a closed job thirty days, and then lets it go', async () => {
    const lang = await household('Lang')

    await assign(lang.job, ['toni'])
    await http()
      .patch(`/jobs/${lang.job}`)
      .set('x-test-identity', as('britta'))
      .send({ status: 'completed' })
      .expect(200)

    const now = new Date()
    const soon = new Date(now.getTime() + 29 * 24 * 60 * 60 * 1000)
    const later = new Date(now.getTime() + 31 * 24 * 60 * 60 * 1000)
    const scopes = await database.forTenant({ tenantId: north.id }, async (tx) => ({
      today: await deviceScope(tx, 'toni', now),
      soon: await deviceScope(tx, 'toni', soon),
      later: await deviceScope(tx, 'toni', later),
    }))

    expect(scopes.today.jobIds).toContain(lang.job)
    expect(scopes.soon.jobIds).toContain(lang.job)
    expect(scopes.later.jobIds).not.toContain(lang.job)
    expect(scopes.later.value).not.toBe(scopes.today.value)
  })

  it('is narrowed to something else once its person is put on another job', async () => {
    const before = await pull('toni')
    const neu = await household('Neu')

    await assign(neu.job, ['toni'])

    const after = await pull('toni')

    expect(after.narrowed['jobs']).not.toBe(before.narrowed['jobs'])
    expect(idsOf(after, 'jobs')).toContain(neu.job)
  })
})

describe('the device of the office', () => {
  it('holds the whole business', async () => {
    const berg = await household('Berg')
    const kramer = await household('Kramer')
    const pulled = await pull('britta')

    expect(idsOf(pulled, 'jobs')).toEqual(expect.arrayContaining([berg.job, kramer.job]))
    expect(pulled.narrowed['jobs']).toBe('all')
  })
})

describe('who is on a job', () => {
  it('is set as a whole list, and a person taken off is marked, not removed', async () => {
    const job = (await household('Liste')).job

    expect(await assign(job, ['toni', 'max', 'max'])).toEqual({ userIds: ['max', 'toni'] })
    expect(await assign(job, ['max'])).toEqual({ userIds: ['max'] })

    const { rows } = await admin.query<{ user_id: string; deleted_at: Date | null }>(
      'select user_id, deleted_at from job_assignments where job_id = $1 order by user_id',
      [job],
    )

    expect(rows.map((row) => [row.user_id, row.deleted_at === null])).toEqual([
      ['max', true],
      ['toni', false],
    ])
  })

  it('is only somebody who works in the business and is not shut out', async () => {
    const job = (await household('Fremd')).job

    expect((await assign(job, ['niemand'], 422)).message).toContain('arbeitet')
    expect((await assign(job, ['gesperrt'], 422)).message).toContain('gesperrt')
  })

  it('is decided in the office, not on site', async () => {
    const job = (await household('Baustelle')).job

    await assign(job, ['max'], 403, 'max')
  })

  it('is asked of a job that is there', async () => {
    await assign(newId<'job'>(), ['max'], 404)
  })
})

describe('the day a job was closed', () => {
  it('is set when it is finished, kept, and emptied when it is taken up again', async () => {
    const job = (await household('Tag')).job
    const closedAt = async () =>
      (
        await admin.query<{ closed_at: Date | null }>('select closed_at from jobs where id = $1', [
          job,
        ])
      ).rows[0]?.closed_at ?? null

    expect(await closedAt()).toBeNull()

    await http()
      .patch(`/jobs/${job}`)
      .set('x-test-identity', as('britta'))
      .send({ status: 'completed' })
      .expect(200)

    const first = await closedAt()

    expect(first).toBeInstanceOf(Date)

    // Written by hand, it stays what the status made it.
    await admin.query("update jobs set closed_at = '2020-01-01' where id = $1", [job])
    expect((await closedAt())?.getTime()).toBe(first?.getTime())

    await http()
      .patch(`/jobs/${job}`)
      .set('x-test-identity', as('britta'))
      .send({ status: 'active' })
      .expect(200)

    expect(await closedAt()).toBeNull()
  })
})
