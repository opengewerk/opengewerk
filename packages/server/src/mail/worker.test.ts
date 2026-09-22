import type { TaskId, TenantId } from '@opengewerk/domain'
import { eq } from 'drizzle-orm'
import type { Pool } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { Database } from '../database/database.js'
import { newId } from '../database/identifier.js'
import { mailOutbox, tasks } from '../database/schema/index.js'
import {
  allowApplicationLogin,
  applicationDatabaseUrl,
  applyMigrations,
  connect,
  resetSchema,
} from '../database/test-database.js'
import { SecretKey } from '../secrets/key.js'
import { maximumAttempts } from './outbox.js'
import { saveMailServer } from './server-settings.js'
import { aMailServer, testKey } from './test-mail-server.js'
import { fakeSmtpServer } from './test-smtp.js'
import {
  MailDeliveryError,
  type MailTransport,
  type OutgoingMail,
  smtpTransport,
} from './transport.js'
import { type MailJob, runMailCycle } from './worker.js'

/**
 * The job that turns due tasks into messages and messages into mail, #81.
 *
 * What it has to hold: a message is written once, on the morning a task is
 * due, to the person responsible and nobody else, and it survives a mail
 * server that does not answer. That last one is the acceptance the issue asks
 * a test for, and it is the reason the outbox exists at all.
 */

const north = newId<'tenant'>() as TenantId
const south = newId<'tenant'>() as TenantId
/** A business that has set up no mail server. */
const west = newId<'tenant'>() as TenantId

const people = {
  britta: { name: 'Britta Büro', tenant: north, roles: ['office'] },
  max: { name: 'Max Monteur', tenant: north, roles: ['technician'] },
  gerd: { name: 'Gerd Gesperrt', tenant: north, roles: ['technician'] },
  susi: { name: 'Susi Süd', tenant: south, roles: ['owner'] },
  wera: { name: 'Wera West', tenant: west, roles: ['owner'] },
} as const

type Person = keyof typeof people

/** Thursday the 24th, half past six in Berlin, which is half past four in UTC. */
const morning = new Date('2026-09-24T04:30:00Z')
const before6 = new Date('2026-09-24T03:30:00Z')
const today = '2026-09-24'
const tomorrow = '2026-09-25'

function minutesLater(from: Date, minutes: number): Date {
  return new Date(from.getTime() + minutes * 60_000)
}

let admin: Pool
let database: Database

/** A transport that keeps what it was given and fails when told to. */
function recording() {
  const sent: OutgoingMail[] = []
  let calls = 0
  let failure: MailDeliveryError | null = null

  const transport: MailTransport = {
    send: (mail) => {
      calls += 1

      if (failure) {
        return Promise.reject(failure)
      }

      sent.push(mail)

      return Promise.resolve()
    },
    verify: () => Promise.resolve(),
    close: () => undefined,
  }

  return {
    transport,
    sent,
    calls: () => calls,
    fail: (next: MailDeliveryError | null) => {
      failure = next
    },
  }
}

function job(transport: MailTransport, now: Date): MailJob {
  return {
    database,
    connect: () => transport,
    key: testKey,
    origin: 'https://opengewerk.example.de',
    now: () => now,
  }
}

async function aTask(
  person: Person,
  over: { title?: string; dueOn?: string; status?: 'open' | 'done' } = {},
): Promise<TaskId> {
  const id = newId<'task'>() as TaskId
  const tenantId = people[person].tenant

  await database.forTenant({ tenantId, userId: 'britta' }, (tx) =>
    tx.insert(tasks).values({
      id,
      tenantId,
      title: over.title ?? 'Material für den Zählerschrank bestellen',
      dueOn: over.dueOn ?? today,
      assigneeUserId: person,
      status: over.status ?? 'open',
    }),
  )

  return id
}

async function messages(tenantId: TenantId = north) {
  return database.forTenant({ tenantId }, (tx) => tx.select().from(mailOutbox))
}

beforeAll(async () => {
  admin = await connect()
  await resetSchema(admin)
  await applyMigrations()
  await allowApplicationLogin(admin)
  await admin.query('insert into tenants (id, name) values ($1, $2), ($3, $4), ($5, $6)', [
    north,
    'Elektro Nord GmbH',
    south,
    'Elektro Süd GmbH',
    west,
    'Elektro West',
  ])
  await aMailServer(admin, north, { from: 'rechnung@nord.example.de' })
  await aMailServer(admin, south, { from: 'buero@sued.example.de' })
  await admin.query(
    'insert into letterheads (tenant_id, company_name, email) values ($1, $2, $3)',
    [north, 'Elektro Nord GmbH', 'buero@nord.example.de'],
  )

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

  database = Database.connect(applicationDatabaseUrl())
})

beforeEach(async () => {
  // Every test starts without messages and without tasks. Both tables are
  // cleared as the superuser, past the rule that keeps a message forever.
  await admin.query('delete from mail_outbox')
  await admin.query('delete from tasks')
  await admin.query('update memberships set blocked_at = null')
})

afterAll(async () => {
  await database.close()
  await admin.end()
})

describe('a task due today', () => {
  it('is told to nobody before six in the morning', async () => {
    await aTask('britta')
    const post = recording()

    expect(await runMailCycle(job(post.transport, before6))).toMatchObject({
      written: 0,
      sent: 0,
    })
    expect(await messages()).toHaveLength(0)
  })

  it('reaches the person responsible that morning, sent in the same pass', async () => {
    await aTask('britta')
    const post = recording()

    expect(await runMailCycle(job(post.transport, morning))).toMatchObject({
      written: 1,
      sent: 1,
    })

    const [mail] = post.sent

    expect(mail?.to).toEqual({ name: 'Britta Büro', address: 'britta@example.de' })
    expect(mail?.from).toEqual({ name: 'Elektro Nord GmbH', address: 'rechnung@nord.example.de' })
    expect(mail?.replyTo).toBe('buero@nord.example.de')
    expect(mail?.subject).toBe('Heute fällig: Material für den Zählerschrank bestellen')
    expect(mail?.text).toContain('heute, am 24.09.2026, ist diese Aufgabe fällig:')
    expect(mail?.text).toContain('https://opengewerk.example.de/aufgaben')

    const [row] = await messages()

    expect(row?.status).toBe('sent')
    expect(row?.sentAt?.toISOString()).toBe(morning.toISOString())
    expect(row?.cause).toMatch(/^task_due:.+:2026-09-24$/)
  })

  it('is written once, however often the job comes by', async () => {
    await aTask('britta')
    const post = recording()

    await runMailCycle(job(post.transport, morning))
    expect(await runMailCycle(job(post.transport, minutesLater(morning, 1)))).toMatchObject({
      written: 0,
      sent: 0,
    })
    expect(await messages()).toHaveLength(1)
    expect(post.sent).toHaveLength(1)
  })

  it('is left alone when it is done, gone, due another day or with somebody shut out', async () => {
    await aTask('britta', { status: 'done' })
    await aTask('britta', { dueOn: tomorrow })
    await aTask('gerd')
    const gone = await aTask('max')

    await admin.query("update memberships set blocked_at = now() where user_id = 'gerd'")
    await admin.query('update tasks set deleted_at = now() where id = $1', [gone])

    const post = recording()

    expect(await runMailCycle(job(post.transport, morning))).toMatchObject({ written: 0 })
    expect(post.sent).toHaveLength(0)
  })

  it('gets a new message when it is moved to another day', async () => {
    const id = await aTask('britta')
    const post = recording()

    await runMailCycle(job(post.transport, morning))
    await database.forTenant({ tenantId: north, userId: 'britta' }, (tx) =>
      tx.update(tasks).set({ dueOn: tomorrow }).where(eq(tasks.id, id)),
    )

    const nextMorning = minutesLater(morning, 24 * 60)

    expect(await runMailCycle(job(post.transport, nextMorning))).toMatchObject({
      written: 1,
      sent: 1,
    })
    expect(post.sent.map((mail) => mail.text.includes('25.09.2026'))).toEqual([false, true])
  })

  it('stays in its own business', async () => {
    await aTask('britta')
    await aTask('susi', { title: 'Wartung Notbeleuchtung' })
    const post = recording()

    await runMailCycle(job(post.transport, morning))

    expect((await messages(north)).map((row) => row.recipientAddress)).toEqual([
      'britta@example.de',
    ])
    expect((await messages(south)).map((row) => row.recipientAddress)).toEqual(['susi@example.de'])
    expect((await messages(south))[0]?.senderName).toBe('Elektro Süd GmbH')
  })
})

describe('a mail server that does not answer', () => {
  it('loses no message, and each one goes out once it is back', async () => {
    await aTask('britta')
    await aTask('max', { title: 'Prüfprotokoll nachreichen' })
    const post = recording()

    post.fail(new MailDeliveryError('Greeting never received', 'ETIMEDOUT', null))

    expect(await runMailCycle(job(post.transport, morning))).toMatchObject({
      written: 2,
      sent: 0,
      retried: 2,
    })
    // One attempt, and the second message is put back with the same answer
    // instead of waiting for the same timeout again.
    expect(post.calls()).toBe(1)

    for (const row of await messages()) {
      expect(row.status).toBe('pending')
      expect(row.attempts).toBe(1)
      expect(row.lastError).toContain('ETIMEDOUT')
      expect(row.nextAttemptAt.toISOString()).toBe(minutesLater(morning, 1).toISOString())
    }

    // Not due again yet, so not tried again yet.
    await runMailCycle(job(post.transport, morning))
    expect(post.calls()).toBe(1)

    post.fail(null)

    expect(await runMailCycle(job(post.transport, minutesLater(morning, 2)))).toMatchObject({
      sent: 2,
    })
    expect((await messages()).map((row) => row.status)).toEqual(['sent', 'sent'])

    await runMailCycle(job(post.transport, minutesLater(morning, 30)))
    expect(post.sent).toHaveLength(2)
  })

  it('waits longer after every attempt', async () => {
    await aTask('britta')
    const post = recording()

    post.fail(new MailDeliveryError('Connection closed', 'ECONNECTION', null))

    let now = morning
    const waits: number[] = []

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await runMailCycle(job(post.transport, now))

      const [row] = await messages()
      const next = row?.nextAttemptAt ?? now

      waits.push((next.getTime() - now.getTime()) / 60_000)
      now = next
    }

    expect(waits).toEqual([1, 5, 15, 60, 180])
  })

  it('gives up after the last attempt and keeps the message', async () => {
    await aTask('britta')
    const post = recording()

    post.fail(new MailDeliveryError('Connection closed', 'ECONNECTION', null))
    await runMailCycle(job(post.transport, morning))
    await admin.query('update mail_outbox set attempts = $1, next_attempt_at = $2', [
      maximumAttempts - 1,
      morning,
    ])

    expect(await runMailCycle(job(post.transport, minutesLater(morning, 5)))).toMatchObject({
      failed: 1,
    })

    const [row] = await messages()

    expect(row?.status).toBe('failed')
    expect(row?.lastError).toContain('Connection closed')
  })
})

describe('a message the server refuses for good', () => {
  it('is not tried again, and stays with the reason', async () => {
    await aTask('britta')
    const post = recording()

    post.fail(
      new MailDeliveryError('550 5.1.1 Recipient address rejected: User unknown', 'EENVELOPE', 550),
    )

    expect(await runMailCycle(job(post.transport, morning))).toMatchObject({ failed: 1 })

    const [row] = await messages()

    expect(row?.status).toBe('failed')
    expect(row?.lastError).toContain('User unknown')

    post.fail(null)
    await runMailCycle(job(post.transport, minutesLater(morning, 60)))
    expect(post.sent).toHaveLength(0)
  })
})

describe('the way out', () => {
  /**
   * The whole path of a login: saved in the office, sealed into `secrets`,
   * opened by the job and handed to the server, which takes it or not.
   */
  it('is a real SMTP conversation with the login of the business, end to end', async () => {
    await aTask('britta')
    const server = await fakeSmtpServer({ credentials: { user: 'rechnung', password: 'richtig' } })
    const owner = { userId: 'britta', tenantId: north, roles: ['owner' as const] }

    await saveMailServer(database, owner, testKey, {
      host: '127.0.0.1',
      port: server.port,
      security: 'none',
      username: 'rechnung',
      password: 'richtig',
      fromAddress: 'rechnung@nord.example.de',
      signature: null,
    })

    const through: MailJob = {
      ...job(recording().transport, morning),
      connect: (configuration) =>
        smtpTransport(configuration, { connection: 2_000, greeting: 2_000, socket: 5_000 }),
    }

    try {
      expect(await runMailCycle(through)).toMatchObject({ sent: 1 })
      expect(server.received.map((mail) => [mail.from, mail.to])).toEqual([
        ['rechnung@nord.example.de', ['britta@example.de']],
      ])
      expect(server.received[0]?.data).toContain('https://opengewerk.example.de/aufgaben')
    } finally {
      await server.close()
      await admin.query("delete from secrets where purpose = 'smtp_password'")
      await aMailServer(admin, north, { from: 'rechnung@nord.example.de' })
    }
  })
})

describe('a business', () => {
  it('without a mail server is passed over, and nothing is written for it', async () => {
    await aTask('wera', { title: 'Angebot für die Wallbox nachfassen' })
    const post = recording()

    await runMailCycle(job(post.transport, morning))

    expect(await messages(west)).toEqual([])
    expect(post.sent.map((mail) => mail.to.address)).not.toContain('wera@example.de')
  })

  it('goes out from its own address', async () => {
    await aTask('britta')
    await aTask('susi', { title: 'Wartung Notbeleuchtung' })
    const post = recording()

    await runMailCycle(job(post.transport, morning))

    expect(
      post.sent
        .map((mail) => [mail.to.address, mail.from.address])
        .sort((a, b) => (a[0] ?? '').localeCompare(b[0] ?? '')),
    ).toEqual([
      ['britta@example.de', 'rechnung@nord.example.de'],
      ['susi@example.de', 'buero@sued.example.de'],
    ])
  })

  /**
   * SESSION_SECRET was changed, and the password sealed under the old one no
   * longer opens. What is due is still written, and waits: every try would
   * count against the message with an answer that cannot change.
   */
  it('whose password no longer opens keeps its messages waiting, untried', async () => {
    await aTask('susi', { title: 'Wartung Notbeleuchtung' })
    await admin.query("update mail_settings set username = 'rechnung' where tenant_id = $1", [
      south,
    ])
    await admin.query(
      "insert into secrets (tenant_id, purpose, sealed) values ($1, 'smtp_password', $2)",
      [south, SecretKey.from('ein anderes Geheimnis').seal(`${south}:smtp_password`, 'geheim')],
    )

    const post = recording()

    try {
      await runMailCycle(job(post.transport, morning))

      const [waiting] = await messages(south)

      expect(waiting?.status).toBe('pending')
      expect(waiting?.attempts).toBe(0)
      expect(post.calls()).toBe(0)
    } finally {
      await admin.query('delete from secrets where tenant_id = $1', [south])
      await aMailServer(admin, south, { from: 'buero@sued.example.de' })
    }
  })

  it('signs a message nobody sent by hand without the line that names the sender', async () => {
    await aMailServer(admin, north, {
      from: 'rechnung@nord.example.de',
      signature: 'Viele Grüße\n\nIhr Ansprechpartner: {benutzer}\n\n{briefkopf}',
    })
    await aTask('britta')
    const post = recording()

    try {
      await runMailCycle(job(post.transport, morning))

      const text = post.sent[0]?.text ?? ''

      expect(text).toContain('-- \nViele Grüße\n\nElektro Nord GmbH\nbuero@nord.example.de')
      expect(text).not.toContain('Ansprechpartner')
      expect(text).not.toContain('{')
    } finally {
      await aMailServer(admin, north, { from: 'rechnung@nord.example.de' })
    }
  })
})
