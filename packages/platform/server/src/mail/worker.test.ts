import type { Id, TenantId } from '@opengewerk/platform-domain'
import type { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { hashToken } from '../authentication/invitation.js'
import { type ProbeFoundation, probeFoundation } from '../authentication/probe-application.js'
import { Database } from '../database/database.js'
import { newId } from '../database/identifier.js'
import { probeMailOutbox, probeSecrets } from '../database/probe-schema.js'
import { SecretKey } from '../secrets/key.js'
import { secretStore } from '../secrets/store.js'
import { invitationLinkPlaceholder, invitationLinks } from './invitation-link.js'
import { mailOutboxStore } from './outbox.js'
import { mailServers } from './server-settings.js'
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
 * The job that sends what an application wrote into its outbox, on an
 * application that is nobody's: the probe application tells people that a
 * parcel waits at the desk, a cause no real application has (#23). What the
 * job has to hold is the same for every application: a message is written
 * where the tenant can send, goes out from the tenant's own address, survives
 * a mail server that does not answer and is given up on for an answer that
 * will not change.
 */

const north = { id: newId<'tenant'>() as TenantId, name: 'Mandant Nord' }
const south = { id: newId<'tenant'>() as TenantId, name: 'Mandant Süd' }
/** A tenant that set up no mail server. */
const west = { id: newId<'tenant'>() as TenantId, name: 'Mandant West' }

const origin = 'https://probewerk.example.de'
const outbox = mailOutboxStore(probeMailOutbox)

const servers = mailServers({
  secrets: secretStore(probeSecrets),
  purpose: 'mailbox',
  signatureProblem: () => null,
  sentences: {
    notConfigured: 'Dieser Mandant hat keinen Mailserver.',
    noneToRemove: 'Dieser Mandant hat keinen Mailserver, der sich entfernen ließe.',
    senderName: 'Den Namen davor nimmt die Probe aus ihren Stammdaten.',
  },
})

const sentences = {
  passwordUnreadable: (tenantId: TenantId) =>
    `Das Passwort zum Mailserver des Mandanten ${tenantId} öffnet nicht mehr.`,
  tenantFailed: (tenantId: TenantId) =>
    `Der Versand für den Mandanten ${tenantId} ist gescheitert.`,
}

let foundation: ProbeFoundation
let admin: Pool
let database: Database

/** The parcels waiting at the desk of each tenant, which the probe application raises as causes. */
let waiting: Map<TenantId, string[]>
/** The tenants the job asked to raise what is due, in the order it asked. */
let raisedFor: TenantId[]

/**
 * The cause of the probe application: one message per parcel waiting, written
 * once, however often the job comes by.
 */
async function raise(tenantId: TenantId): Promise<number> {
  raisedFor.push(tenantId)

  const parcels = waiting.get(tenantId) ?? []

  if (parcels.length === 0) {
    return 0
  }

  const written = await database.forTenant({ tenantId, reason: 'mail' }, (tx) =>
    tx
      .insert(probeMailOutbox)
      .values(
        parcels.map((parcelNumber) => ({
          tenantId,
          kind: 'parcel_waiting' as const,
          cause: `parcel:${parcelNumber}`,
          parcelNumber,
          senderName: 'Empfang',
          recipientAddress: `${parcelNumber.toLowerCase()}@empfaenger.example.de`,
          recipientName: 'Erika Empfängerin',
          subject: 'Ein Paket wartet',
          body: `Am Empfang wartet das Paket ${parcelNumber}.`,
        })),
      )
      .onConflictDoNothing({ target: [probeMailOutbox.tenantId, probeMailOutbox.cause] })
      .returning({ id: probeMailOutbox.id }),
  )

  return written.length
}

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

/**
 * The clock of the job, ahead of the database's: a message gets its first
 * moment from the database, and the job only finds it due once its own clock
 * has passed that moment.
 */
const soon = () => new Date(Date.now() + 1_000)

function minutesLater(from: Date, minutes: number): Date {
  return new Date(from.getTime() + minutes * 60_000)
}

function job(
  transport: MailTransport,
  now: Date,
  over: Partial<MailJob<typeof probeMailOutbox.$inferSelect>> = {},
): MailJob<typeof probeMailOutbox.$inferSelect> {
  return {
    database,
    servers,
    outbox,
    connect: () => transport,
    key: testKey,
    raise,
    sentences,
    now: () => now,
    ...over,
  }
}

async function messages(tenantId: TenantId = north.id) {
  const { rows } = await admin.query<{
    id: string
    kind: string
    body: string
    status: string
    attempts: number
    last_error: string | null
  }>(
    'select id, kind, body, status, attempts, last_error from mail_outbox where tenant_id = $1 order by created_at',
    [tenantId],
  )

  return rows
}

/** An open invitation into the north, with the account of who invited. */
async function anInvitation(over: { revoked?: boolean } = {}): Promise<string> {
  const id = newId<'invitation'>()

  await admin.query(
    `insert into invitations (id, tenant_id, email, name, roles, token_hash, invited_by, expires_at, revoked_at)
     values ($1, $2, 'gast@example.de', 'Gerda Gast', '{member}', $3, 'lena', now() + interval '7 days', $4)`,
    [id, north.id, `nicht-mehr-gueltig-${id}`, over.revoked ? new Date() : null],
  )

  return id
}

/** A message about an invitation, as an application writes it: the link only as a placeholder. */
async function aMessageAbout(invitationId: string) {
  await database.forTenant({ tenantId: north.id, reason: 'mail' }, (tx) =>
    tx.insert(probeMailOutbox).values({
      tenantId: north.id,
      kind: 'guest_invited',
      cause: `invitation:${invitationId}`,
      invitationId: invitationId as Id<'invitation'>,
      senderName: 'Mandant Nord',
      recipientAddress: 'gast@example.de',
      subject: 'Sie sind eingeladen',
      body: `Mit diesem Link legen Sie Ihr Passwort fest:\n${invitationLinkPlaceholder}\n`,
    }),
  )
}

beforeAll(async () => {
  foundation = await probeFoundation()
  admin = await foundation.kit.connect()
  await foundation.empty(admin)
  await foundation.tenants(admin, [north, south, west])
  await admin.query(
    "insert into auth_users (id, name, email) values ('lena', 'Lena Leitung', 'lena@example.de')",
  )
  database = Database.connect(foundation.kit.applicationDatabaseUrl())
}, 60_000)

beforeEach(async () => {
  waiting = new Map()
  raisedFor = []
  await admin.query('delete from mail_outbox')
  await admin.query('delete from invitations')
  await admin.query('delete from secrets')
  await aMailServer(admin, north.id, { from: 'post@nord.example.de' })
  await aMailServer(admin, south.id, { from: 'post@sued.example.de' })
})

afterEach(() => {
  vi.restoreAllMocks()
})

afterAll(async () => {
  await database.close()
  await admin.end()
  foundation.remove()
})

describe('a cause of the application', () => {
  it('goes out in the same pass it is raised in, from the address of its tenant', async () => {
    waiting.set(north.id, ['P-0042'])
    const post = recording()

    expect(await runMailCycle(job(post.transport, soon()))).toEqual({
      written: 1,
      sent: 1,
      retried: 0,
      failed: 0,
    })
    expect(post.sent).toEqual([
      {
        from: { name: 'Empfang', address: 'post@nord.example.de' },
        replyTo: null,
        to: { name: 'Erika Empfängerin', address: 'p-0042@empfaenger.example.de' },
        subject: 'Ein Paket wartet',
        text: 'Am Empfang wartet das Paket P-0042.',
        attachments: [],
      },
    ])
    expect((await messages())[0]?.status).toBe('sent')
  })

  it('is raised only for a tenant with a mail server, and nothing is written for the others', async () => {
    waiting.set(west.id, ['P-0007'])
    const post = recording()

    await runMailCycle(job(post.transport, soon()))

    expect(raisedFor).toEqual(expect.arrayContaining([north.id, south.id]))
    expect(raisedFor).not.toContain(west.id)
    expect(await messages(west.id)).toEqual([])
    expect(post.calls()).toBe(0)
  })

  it('carries the files the application makes for it as it goes out, from what it keeps beside it', async () => {
    waiting.set(north.id, ['P-0042'])
    const post = recording()

    await runMailCycle(
      job(post.transport, soon(), {
        attachments: (message) =>
          Promise.resolve([
            {
              filename: `${message.parcelNumber ?? 'leer'}.txt`,
              content: Buffer.from('Lieferschein'),
              contentType: 'text/plain',
            },
          ]),
      }),
    )

    expect(post.sent[0]?.attachments.map((file) => file.filename)).toEqual(['P-0042.txt'])
  })

  it('waits when its file cannot be made right now', async () => {
    waiting.set(north.id, ['P-0042'])
    const post = recording()

    const report = await runMailCycle(
      job(post.transport, soon(), {
        attachments: () =>
          Promise.reject(
            new MailDeliveryError('Der Drucker antwortet nicht.', 'EATTACHMENT', null),
          ),
      }),
    )

    expect(report).toMatchObject({ sent: 0, retried: 1, failed: 0 })
    expect((await messages())[0]).toMatchObject({ status: 'pending', attempts: 1 })
  })
})

describe('a mail server that does not answer', () => {
  it('loses no message, is asked once per pass, and each message goes out once it is back', async () => {
    waiting.set(north.id, ['P-0001', 'P-0002'])
    const post = recording()
    const now = soon()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    post.fail(new MailDeliveryError('Verbindung abgelehnt', 'ECONNECTION', null))
    const down = await runMailCycle(job(post.transport, now))

    expect(down).toMatchObject({ written: 2, sent: 0, retried: 2, failed: 0 })
    // After a failure about the server itself, the rest of the pass is put
    // back with the same answer instead of waiting for the same timeout again.
    expect(post.calls()).toBe(1)
    expect((await messages()).map((message) => message.status)).toEqual(['pending', 'pending'])

    post.fail(null)
    const back = await runMailCycle(job(post.transport, minutesLater(now, 2)))

    expect(back).toMatchObject({ written: 0, sent: 2 })
    expect((await messages()).map((message) => message.status)).toEqual(['sent', 'sent'])
  })
})

describe('a message the server refuses for good', () => {
  it('is not tried again, and stays with the reason', async () => {
    waiting.set(north.id, ['P-0042'])
    const post = recording()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    post.fail(new MailDeliveryError('Postfach unbekannt', 'EENVELOPE', 550))

    const report = await runMailCycle(job(post.transport, soon()))

    expect(report).toMatchObject({ sent: 0, retried: 0, failed: 1 })
    expect((await messages())[0]).toMatchObject({
      status: 'failed',
      last_error: 'EENVELOPE: Postfach unbekannt',
    })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('p-0042@empfaenger.example.de'))
  })
})

describe('a tenant whose password no longer opens', () => {
  it('keeps its messages waiting, untried, and is said once in the words of the application', async () => {
    waiting.set(north.id, ['P-0042'])
    await admin.query("update mail_settings set username = 'post' where tenant_id = $1", [north.id])
    await admin.query(
      "insert into secrets (tenant_id, purpose, sealed) values ($1, 'mailbox', $2)",
      [north.id, SecretKey.from('ein anderes Geheimnis').seal(`${north.id}:mailbox`, 'geheim')],
    )
    const post = recording()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    await runMailCycle(job(post.transport, soon()))
    await runMailCycle(job(post.transport, minutesLater(soon(), 2)))

    expect((await messages())[0]).toMatchObject({ status: 'pending', attempts: 0 })
    expect(post.calls()).toBe(0)
    expect(warn.mock.calls).toEqual([[sentences.passwordUnreadable(north.id)]])
  })
})

describe('a tenant whose pass fails', () => {
  it('does not stop the others, and is said in the words of the application', async () => {
    waiting.set(south.id, ['P-0100'])
    const post = recording()
    const complain = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const failing = new Error('Die Probe ist durcheinander.')

    const report = await runMailCycle(
      job(post.transport, soon(), {
        raise: (tenantId) => (tenantId === north.id ? Promise.reject(failing) : raise(tenantId)),
      }),
    )

    expect(report).toMatchObject({ written: 1, sent: 1 })
    expect(post.sent.map((mail) => mail.from.address)).toEqual(['post@sued.example.de'])
    expect(complain).toHaveBeenCalledWith(sentences.tenantFailed(north.id), failing)
  })
})

describe('a message about an invitation', () => {
  it('carries a link made as it goes out, and the outbox never holds one that works', async () => {
    const invitationId = await anInvitation()
    await aMessageAbout(invitationId)
    const post = recording()

    await runMailCycle(
      job(post.transport, soon(), { invitationLinks: invitationLinks(database, origin) }),
    )

    const text = post.sent[0]?.text ?? ''
    const token = /\/einladung\/([A-Za-z0-9_-]{43})\n/.exec(text)?.[1] ?? ''
    const { rows } = await admin.query<{ token_hash: string }>(
      'select token_hash from invitations where id = $1',
      [invitationId],
    )

    expect(
      text.startsWith(
        'Mit diesem Link legen Sie Ihr Passwort fest:\nhttps://probewerk.example.de/einladung/',
      ),
    ).toBe(true)
    expect(rows[0]?.token_hash).toBe(hashToken(token))
    expect((await messages())[0]?.body).toContain(invitationLinkPlaceholder)
  })

  it('is given up on when the invitation is no longer open', async () => {
    await aMessageAbout(await anInvitation({ revoked: true }))
    const post = recording()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    await runMailCycle(
      job(post.transport, soon(), { invitationLinks: invitationLinks(database, origin) }),
    )

    expect(post.calls()).toBe(0)
    expect((await messages())[0]).toMatchObject({
      status: 'failed',
      last_error:
        'EINVITATION: Die Einladung ist nicht mehr offen: zurückgezogen, schon benutzt oder abgelaufen.',
    })
  })

  it('is given up on by a job that has no links to give', async () => {
    await aMessageAbout(await anInvitation())
    const post = recording()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    await runMailCycle(job(post.transport, soon()))

    expect(post.calls()).toBe(0)
    expect((await messages())[0]?.status).toBe('failed')
  })
})

describe('the way out', () => {
  it('is a real SMTP conversation with the login of the tenant, end to end', async () => {
    waiting.set(north.id, ['P-0042'])
    const server = await fakeSmtpServer({ credentials: { user: 'post', password: 'richtig' } })

    await servers.saveMailServer(database, { tenantId: north.id, userId: 'lena' }, testKey, {
      host: '127.0.0.1',
      port: server.port,
      security: 'none',
      username: 'post',
      password: 'richtig',
      fromAddress: 'post@nord.example.de',
      signature: null,
    })

    try {
      const report = await runMailCycle(
        job(recording().transport, soon(), {
          connect: (configuration) =>
            smtpTransport(configuration, { connection: 2_000, greeting: 2_000, socket: 5_000 }),
        }),
      )

      expect(report).toMatchObject({ sent: 1 })
      expect(server.received.map((mail) => [mail.from, mail.to])).toEqual([
        ['post@nord.example.de', ['p-0042@empfaenger.example.de']],
      ])
      expect(server.received[0]?.data).toContain('Am Empfang wartet das Paket P-0042.')
    } finally {
      await server.close()
    }
  })
})
