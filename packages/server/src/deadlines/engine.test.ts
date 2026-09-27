import {
  coreDeadlineKinds,
  type DeadlineKind,
  deadlineRegistry,
  type DocumentId,
  type TenantId,
} from '@opengewerk/domain'
import { eq } from 'drizzle-orm'
import type { Pool } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { Database } from '../database/database.js'
import { newId } from '../database/identifier.js'
import { deadlines, jobs, mailOutbox, tasks } from '../database/schema/index.js'
import {
  allowApplicationLogin,
  applicationDatabaseUrl,
  applyMigrations,
  connect,
  resetSchema,
} from '../database/test-database.js'
import { aMailServer, testKey } from '../mail/test-mail-server.js'
import type { MailTransport, OutgoingMail } from '../mail/transport.js'
import { runMailCycle } from '../mail/worker.js'
import { type DeadlineJob, type DeadlineRow, runDeadlineCycle, runDeadlinesOf } from './engine.js'
import { deadlineKinds } from './registry.js'

/**
 * The deadline engine of #283, run against a database.
 *
 * What it has to hold, from the acceptance of the issue: a deadline comes out
 * of its source with kind, source, due day, lead and person; when its lead
 * comes, its actions happen once, also after an instance that was down; it
 * follows its source, and one whose source is done or gone no longer fires;
 * the follow-up of an open quote makes a task; and a deadline stays in the
 * business it came from.
 */

const north = newId<'tenant'>() as TenantId
const south = newId<'tenant'>() as TenantId

const people = {
  olga: { name: 'Olga Inhaberin', tenant: north, roles: ['owner'] },
  britta: { name: 'Britta Büro', tenant: north, roles: ['office'] },
  max: { name: 'Max Monteur', tenant: north, roles: ['technician'] },
  susi: { name: 'Susi Süd', tenant: south, roles: ['owner'] },
} as const

/**
 * The quote goes out on the 10th; its follow-up falls due fourteen days
 * later. Years ahead, like the mail tests, because a message gets its time
 * of the next attempt from the database, which runs on the real clock.
 */
const issued = new Date('2037-09-10T08:00:00Z')
const before = new Date('2037-09-12T08:00:00Z')
const dueDay = new Date('2037-09-24T07:00:00Z')

let admin: Pool
let database: Database
let customers: Record<TenantId, string>

function engine(over: Partial<DeadlineJob> = {}): DeadlineJob {
  return { database, ...over }
}

async function aQuote(
  over: { tenant?: TenantId; number?: string; issuedBy?: string | null; issuedAt?: Date } = {},
): Promise<DocumentId> {
  const tenant = over.tenant ?? north
  const id = newId<'document'>() as DocumentId

  await admin.query(
    `insert into documents (id, tenant_id, customer_id, kind, status, number, document_date, issued_at, issued_by, subject)
     values ($1, $2, $3, 'quote', 'issued', $4, $5, $6, $7, 'Wallbox in der Garage')`,
    [
      id,
      tenant,
      customers[tenant],
      over.number ?? 'A-2037-0001',
      (over.issuedAt ?? issued).toISOString().slice(0, 10),
      over.issuedAt ?? issued,
      over.issuedBy === undefined ? 'britta' : over.issuedBy,
    ],
  )

  return id
}

/** A draft order confirmation after the quote: somebody is on it. */
async function follow(quote: DocumentId, tenant: TenantId = north): Promise<string> {
  const id = newId<'document'>()

  await admin.query(
    `insert into documents (id, tenant_id, customer_id, kind, status, document_date, predecessor_document_id, subject)
     values ($1, $2, $3, 'order_confirmation', 'draft', '2037-09-15', $4, 'Auftragsbestätigung')`,
    [id, tenant, customers[tenant], quote],
  )

  return id
}

async function kept(tenant: TenantId = north): Promise<DeadlineRow[]> {
  return database.forTenant({ tenantId: tenant }, (tx) => tx.select().from(deadlines))
}

async function only(tenant: TenantId = north): Promise<DeadlineRow> {
  const rows = await kept(tenant)

  expect(rows).toHaveLength(1)

  return rows[0] as DeadlineRow
}

async function tasksOf(tenant: TenantId = north) {
  return database.forTenant({ tenantId: tenant }, (tx) => tx.select().from(tasks))
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
    await admin.query('insert into memberships (tenant_id, user_id, roles) values ($1, $2, $3)', [
      person.tenant,
      userId,
      [...person.roles],
    ])
  }

  customers = {} as Record<TenantId, string>

  for (const tenant of [north, south]) {
    const id = newId<'customer'>()

    await admin.query(
      `insert into customers (id, tenant_id, kind, name) values ($1, $2, 'business', 'Hausverwaltung Süd GmbH')`,
      [id, tenant],
    )
    customers[tenant] = id
  }

  database = Database.connect(applicationDatabaseUrl())
})

beforeEach(async () => {
  // Past every rule that keeps a row, as the superuser.
  await admin.query('delete from mail_outbox')
  await admin.query('delete from deadlines')
  await admin.query('delete from deadline_settings')
  await admin.query('delete from tasks')
  await admin.query('delete from jobs')
  // An issued document is never deleted, not even by the superuser: the
  // trigger of 0002 holds it. Between two tests it goes all the same, with
  // the triggers off for exactly this one transaction.
  await admin.query(
    'begin; set local session_replication_role = replica; delete from documents; commit;',
  )
  await admin.query('update memberships set blocked_at = null')
})

afterAll(async () => {
  await database.close()
  await admin.end()
})

describe('the kinds of this instance', () => {
  it('are the core kinds, none of a trade', () => {
    // The first kind of a trade comes with the recurring inspection of
    // Elektro (#301), from its package; the core names none (ADR 0008).
    expect(deadlineKinds.kinds.map((kind) => kind.key)).toEqual(
      coreDeadlineKinds.map((kind) => kind.key),
    )
    expect(deadlineKinds.kinds.every((kind) => kind.trade === null)).toBe(true)
  })
})

describe('a quote that went out', () => {
  it('gets a follow-up with kind, source, due day and person, and no reminder yet', async () => {
    const quote = await aQuote()

    expect(await runDeadlinesOf(engine(), north, before)).toMatchObject({
      created: 1,
      reminded: 0,
    })

    const deadline = await only()

    expect(deadline).toMatchObject({
      kind: 'quote.follow_up',
      sourceId: quote,
      sourceLabel: 'A-2037-0001',
      documentId: quote,
      customerId: customers[north],
      anchorOn: '2037-09-10',
      dueOn: '2037-09-24',
      leadDays: null,
      naturalUserId: 'britta',
      status: 'open',
      remindedFor: null,
    })
    expect(await tasksOf()).toHaveLength(0)
  })

  it('makes a task for whoever issued it on the day it is due, written by nobody', async () => {
    await aQuote()
    await runDeadlinesOf(engine(), north, before)

    expect(await runDeadlinesOf(engine(), north, dueDay)).toMatchObject({ reminded: 1 })

    const [task] = await tasksOf()

    expect(task).toMatchObject({
      title: 'Angebot A-2037-0001 nachfassen',
      notes: 'Wiedervorlage eines Angebots',
      dueOn: '2037-09-24',
      assigneeUserId: 'britta',
      customerId: customers[north],
      status: 'open',
      createdBy: null,
    })
    expect(await only()).toMatchObject({ remindedFor: '2037-09-24', taskId: task?.id })
  })

  it('reminds once, however often the engine comes by', async () => {
    await aQuote()

    for (let run = 0; run < 3; run += 1) {
      await runDeadlinesOf(engine(), north, dueDay)
    }

    expect(await tasksOf()).toHaveLength(1)
  })

  it('follows its source at night and reminds from six in the morning', async () => {
    await aQuote()

    // Half past five and half past six in Berlin, in summer time.
    expect(await runDeadlinesOf(engine(), north, new Date('2037-09-24T03:30:00Z'))).toMatchObject({
      created: 1,
      reminded: 0,
    })
    expect(await tasksOf()).toHaveLength(0)
    expect(await runDeadlinesOf(engine(), north, new Date('2037-09-24T04:30:00Z'))).toMatchObject({
      created: 0,
      reminded: 1,
    })
  })

  it('catches up once after an instance that was down past the day', async () => {
    await aQuote()

    // Nothing ran between the quote and three weeks after its day.
    const late = new Date('2037-10-15T09:00:00Z')

    expect(await runDeadlinesOf(engine(), north, late)).toMatchObject({ created: 1, reminded: 1 })
    expect(await runDeadlinesOf(engine(), north, late)).toMatchObject({ created: 0, reminded: 0 })
    expect(await tasksOf()).toHaveLength(1)
  })

  it('reminds its lead before the day, from the setting of the kind and from its own', async () => {
    await aQuote()
    await admin.query(
      `insert into deadline_settings (tenant_id, kind, lead_days) values ($1, 'quote.follow_up', 3)`,
      [north],
    )

    // Three days before the 24th is the 21st: the 20th is too early.
    expect(await runDeadlinesOf(engine(), north, new Date('2037-09-20T09:00:00Z'))).toMatchObject({
      reminded: 0,
    })

    await admin.query('update deadlines set lead_days = 5')

    expect(await runDeadlinesOf(engine(), north, new Date('2037-09-20T09:00:00Z'))).toMatchObject({
      reminded: 1,
    })
  })

  it('follows the interval the business sets, while it is open', async () => {
    await aQuote()
    await runDeadlinesOf(engine(), north, before)
    await admin.query(
      `insert into deadline_settings (tenant_id, kind, interval_days) values ($1, 'quote.follow_up', 21)`,
      [north],
    )

    expect(await runDeadlinesOf(engine(), north, before)).toMatchObject({ moved: 1 })
    expect(await only()).toMatchObject({ anchorOn: '2037-09-10', dueOn: '2037-10-01' })
  })

  it('stays done when the interval changes, because it was done for its day', async () => {
    await aQuote()
    await runDeadlinesOf(engine(), north, before)
    await admin.query(
      `update deadlines set status = 'done', closed_at = now(), closed_by = 'britta'`,
    )
    await admin.query(
      `insert into deadline_settings (tenant_id, kind, interval_days) values ($1, 'quote.follow_up', 21)`,
      [north],
    )

    await runDeadlinesOf(engine(), north, before)

    expect(await only()).toMatchObject({ status: 'done', dueOn: '2037-09-24' })
  })

  it('drops out when a document follows the quote, and comes back when that is thrown away', async () => {
    const quote = await aQuote()
    await runDeadlinesOf(engine(), north, before)

    const confirmation = await follow(quote)

    expect(await runDeadlinesOf(engine(), north, before)).toMatchObject({ dropped: 1 })
    expect(await only()).toMatchObject({ status: 'dropped', closedBy: null })

    // A dropped deadline fires no more, not even on its day.
    expect(await runDeadlinesOf(engine(), north, dueDay)).toMatchObject({ reminded: 0 })
    expect(await tasksOf()).toHaveLength(0)

    await admin.query('update documents set deleted_at = now() where id = $1', [confirmation])

    expect(await runDeadlinesOf(engine(), north, dueDay)).toMatchObject({
      reopened: 1,
      reminded: 1,
    })
    expect(await only()).toMatchObject({ status: 'open', closedAt: null })
  })

  it('is done when the task its reminder made is done, by whoever did it', async () => {
    await aQuote()
    await runDeadlinesOf(engine(), north, dueDay)

    const [task] = await tasksOf()

    await database.forTenant({ tenantId: north, userId: 'max' }, (tx) =>
      tx
        .update(tasks)
        .set({ status: 'done' })
        .where(eq(tasks.id, task?.id as never)),
    )
    await runDeadlinesOf(engine(), north, dueDay)

    expect(await only()).toMatchObject({ status: 'done', closedBy: 'max' })
  })

  it('goes to the owner when whoever issued it is blocked or nobody did', async () => {
    await admin.query(`update memberships set blocked_at = now() where user_id = 'britta'`)
    await aQuote()
    await aQuote({ number: 'A-2037-0002', issuedBy: null })

    await runDeadlinesOf(engine(), north, dueDay)

    expect((await tasksOf()).map((task) => task.assigneeUserId)).toEqual(['olga', 'olga'])
  })

  it('goes to the person the business named for the kind, before whoever issued it', async () => {
    await admin.query(
      `insert into deadline_settings (tenant_id, kind, responsible_user_id) values ($1, 'quote.follow_up', 'max')`,
      [north],
    )
    await aQuote()

    await runDeadlinesOf(engine(), north, dueDay)

    expect((await tasksOf()).map((task) => task.assigneeUserId)).toEqual(['max'])
  })
})

describe('the businesses', () => {
  it('each keep their own deadlines', async () => {
    await aQuote({ tenant: south, number: 'A-2037-0100', issuedBy: 'susi' })
    await aQuote()

    await runDeadlineCycle(engine({ now: () => dueDay }))

    expect((await kept(north)).map((row) => row.sourceLabel)).toEqual(['A-2037-0001'])
    expect((await kept(south)).map((row) => row.sourceLabel)).toEqual(['A-2037-0100'])
    expect((await tasksOf(south)).map((task) => task.assigneeUserId)).toEqual(['susi'])
    expect((await kept(north))[0]?.tenantId).toBe(north)
  })
})

describe('the four actions', () => {
  const everything: DeadlineKind = {
    key: 'probe.everything',
    trade: null,
    title: 'Probe',
    about: 'Eine Frist, die alles tut.',
    source: 'quote',
    intervalDays: 14,
    leadDays: 0,
    responsible: 'source',
    actions: ['task', 'reminder', 'service_job', 'status'],
    taskTitle: 'Probe zu {quelle}',
  }

  function sentTo(sent: OutgoingMail[]): MailTransport {
    return {
      send: (mail) => {
        sent.push(mail)

        return Promise.resolve()
      },
      verify: () => Promise.resolve(),
      close: () => undefined,
    }
  }

  it('write a task, a service job, a change of status and a message, each once', async () => {
    const registry = deadlineRegistry([everything])
    const changed: string[] = []
    const job = engine({
      registry,
      statusHandlers: {
        'probe.everything': (_tx, deadline) => {
          changed.push(deadline.sourceLabel)

          return Promise.resolve()
        },
      },
    })

    await aMailServer(admin, north, { from: 'rechnung@nord.example.de' })
    await aQuote()
    await runDeadlinesOf(job, north, dueDay)
    await runDeadlinesOf(job, north, dueDay)

    expect(await tasksOf()).toHaveLength(1)
    expect(changed).toEqual(['A-2037-0001'])

    const serviceJobs = await database.forTenant({ tenantId: north }, (tx) =>
      tx.select().from(jobs),
    )

    expect(serviceJobs).toHaveLength(1)
    expect(serviceJobs[0]).toMatchObject({
      kind: 'service',
      status: 'draft',
      designation: 'Probe: A-2037-0001',
      customerId: customers[north],
    })
    expect(serviceJobs[0]?.number).toMatch(/^AU-\d{4}-\d{4}$/)

    const sent: OutgoingMail[] = []
    const mailJob = {
      database,
      connect: () => sentTo(sent),
      key: testKey,
      origin: 'https://opengewerk.example.de',
      deadlineKinds: registry,
      now: () => new Date(dueDay.getTime() + 60_000),
    }

    await runMailCycle(mailJob)
    await runMailCycle(mailJob)

    // The task it made is due today as well and has its own message; the
    // one about the deadline comes once beside it.
    const aboutTheDeadline = sent.filter((mail) => mail.subject.startsWith('Frist am'))

    expect(aboutTheDeadline).toHaveLength(1)
    expect(aboutTheDeadline[0]?.to).toEqual({ name: 'Britta Büro', address: 'britta@example.de' })
    expect(aboutTheDeadline[0]?.subject).toBe('Frist am 24.09.2037: Probe, A-2037-0001')
    expect(aboutTheDeadline[0]?.text).toContain('https://opengewerk.example.de/fristen')

    const rows = await database.forTenant({ tenantId: north }, (tx) =>
      tx.select().from(mailOutbox).where(eq(mailOutbox.kind, 'deadline_due')),
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]?.cause).toMatch(/^deadline_due:.+:2037-09-24$/)
  })

  it('roll back together when one of them fails, and try again the next time', async () => {
    // A kind that changes a status and has nobody to change it.
    const job = engine({ registry: deadlineRegistry([everything]), statusHandlers: {} })

    await aQuote()

    await expect(runDeadlinesOf(job, north, dueDay)).rejects.toThrow(/has no handler/)
    expect(await tasksOf()).toHaveLength(0)
    expect(await only()).toMatchObject({ remindedFor: null })
  })
})
