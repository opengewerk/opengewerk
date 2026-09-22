import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { offerOf } from '../authentication/redemption.js'
import { Database } from '../database/database.js'
import { newId } from '../database/identifier.js'
import {
  allowApplicationLogin,
  applicationDatabaseUrl,
  applyMigrations,
  connect,
  resetSchema,
} from '../database/test-database.js'
import { invitationLinks } from '../mail/invitation-link.js'
import { aMailServer, testKey } from '../mail/test-mail-server.js'
import {
  MailDeliveryError,
  type MailTransport,
  type OutgoingMail,
  smtpTransport,
} from '../mail/transport.js'
import { runMailCycle } from '../mail/worker.js'
import { ApiModule } from './api.module.js'
import { as, testIdentities as identities } from './test-identity.js'

/**
 * An invitation sent by mail instead of passed on by the office.
 *
 * What is measured is less that a mail goes out than where the token is and
 * where it is not. It is made when the message is sent and ends up in that
 * message: not in the answer to the office, not in the outbox, not in the
 * audit log. A copy of the database opens nothing, as it did not before.
 */

const north = { id: newId<'tenant'>(), name: 'Elektro Nord GmbH' }
const origin = 'https://opengewerk.example.de'

let admin: Pool
let database: Database
let app: INestApplication
/** The same routes on an instance without a mail server. */
let withoutMail: INestApplication

const owner = () => as(north.id, 'owner')

function invite(fields: Record<string, unknown>, on = app) {
  return request(on.getHttpServer()).post('/staff').set('x-test-identity', owner()).send(fields)
}

/** A transport that keeps what it was given, and fails the first time if asked to. */
function recording(options: { failFirst?: boolean } = {}) {
  const sent: OutgoingMail[] = []
  const tried: OutgoingMail[] = []
  const transport: MailTransport = {
    send: (mail) => {
      tried.push(mail)

      if (options.failFirst && tried.length === 1) {
        return Promise.reject(
          new MailDeliveryError('Die Verbindung brach ab.', 'ECONNECTION', null),
        )
      }

      sent.push(mail)

      return Promise.resolve()
    },
    verify: () => Promise.resolve(),
    close: () => undefined,
  }

  return { sent, tried, transport }
}

function cycle(transport: MailTransport, aheadMs = 1_000) {
  return runMailCycle({
    database,
    connect: () => transport,
    key: testKey,
    origin,
    invitationLinks: invitationLinks(database, origin),
    // A moment ahead, so that a message written by the test is due.
    now: () => new Date(Date.now() + aheadMs),
  })
}

/** The token out of the link in a message. */
function tokenIn(mail: OutgoingMail | undefined): string {
  const found = /\/einladung\/([A-Za-z0-9_-]+)/.exec(mail?.text ?? '')

  return found?.[1] ?? ''
}

async function outboxOf(invitationId: string) {
  const { rows } = await admin.query<{
    kind: string
    body: string
    status: string
    recipient_address: string
    last_error: string | null
  }>(
    'select kind, body, status, recipient_address, last_error from mail_outbox where invitation_id = $1',
    [invitationId],
  )

  return rows
}

beforeAll(async () => {
  admin = await connect()
  await resetSchema(admin)
  await applyMigrations()
  await allowApplicationLogin(admin)

  await admin.query('insert into tenants (id, name) values ($1, $2)', [north.id, north.name])
  await admin.query(
    `insert into letterheads (tenant_id, street, house_number, postal_code, city, phone, email)
     values ($1, 'Hafenstraße', '12', '20457', 'Hamburg', '040 1234567', 'info@elektro-nord.example')`,
    [north.id],
  )
  // The account behind the test identity, whose name the message carries.
  await admin.query(
    "insert into auth_users (id, name, email) values ('test', 'Christa Chefin', 'chefin@nord.example.de')",
  )
  await admin.query(
    "insert into memberships (tenant_id, user_id, roles) values ($1, 'test', '{owner}')",
    [north.id],
  )

  await aMailServer(admin, north.id, { from: 'buero@nord.example.de' })

  database = Database.connect(applicationDatabaseUrl())

  const built = await Test.createTestingModule({
    imports: [
      ApiModule.create(database, identities, {
        mail: { origin, key: testKey, connect: smtpTransport },
      }),
    ],
  }).compile()

  app = built.createNestApplication()
  await app.init()

  const bare = await Test.createTestingModule({
    imports: [ApiModule.create(database, identities)],
  }).compile()

  withoutMail = bare.createNestApplication()
  await withoutMail.init()
})

beforeEach(async () => {
  // Each test looks at what one pass did. A message another test left waiting
  // would go out in that pass as well. Cleared as the superuser.
  await admin.query('delete from mail_outbox')
})

afterAll(async () => {
  await app.close()
  await withoutMail.close()
  await database.close()
  await admin.end()
})

describe('an invitation by mail', () => {
  it('goes out with a link the office never saw, and the link works', async () => {
    const invited = await invite({
      email: 'nele@nord.example.de',
      name: 'Nele Neu',
      roles: ['technician'],
      send: 'mail',
    }).expect(201)

    // No token in the answer: it does not exist yet.
    expect(invited.body).toMatchObject({ token: null, email: 'nele@nord.example.de' })

    const id = invited.body.id as string
    const [written] = await outboxOf(id)

    expect(written).toMatchObject({
      kind: 'invitation',
      status: 'pending',
      recipient_address: 'nele@nord.example.de',
    })
    expect(written?.body).toContain('{{link}}')

    const post = recording()

    expect(await cycle(post.transport)).toMatchObject({ sent: 1 })

    const [mail] = post.sent

    expect(mail?.to).toEqual({ name: 'Nele Neu', address: 'nele@nord.example.de' })
    expect(mail?.from.name).toBe('Elektro Nord GmbH')
    expect(mail?.subject).toBe('Einladung zu OpenGewerk von Elektro Nord GmbH')
    expect(mail?.text).toContain('Christa Chefin hat Sie eingeladen, bei Elektro Nord GmbH')
    expect(mail?.text).toContain(`${origin}/einladung/`)
    expect(mail?.text).not.toContain('{{link}}')

    const token = tokenIn(mail)

    expect(token).toHaveLength(43)
    expect(await offerOf(database, token)).toMatchObject({
      state: 'open',
      company: north.name,
      name: 'Nele Neu',
      email: 'nele@nord.example.de',
    })

    // And the token is in the mail and nowhere else: the row keeps the
    // placeholder, and no entry of the audit log carries it.
    const [kept] = await outboxOf(id)

    expect(kept?.status).toBe('sent')
    expect(kept?.body).toContain('{{link}}')
    expect(kept?.body).not.toContain(token)

    const logged = await admin.query<{ count: string }>(
      `select count(*) from audit_entries
        where position($1 in coalesce(old_value, '') || coalesce(new_value, '')) > 0`,
      [token],
    )

    expect(logged.rows[0]?.count).toBe('0')
  })

  it('shows the office how the message stands, under the invitation', async () => {
    const invited = await invite({
      email: 'otto@nord.example.de',
      name: 'Otto Offen',
      roles: ['office'],
      send: 'mail',
    }).expect(201)

    const list = () =>
      request(app.getHttpServer())
        .get('/staff/invitations')
        .set('x-test-identity', owner())
        .expect(200)
    const entryOf = (answer: { body: unknown }) =>
      (
        answer.body as { id: string; mail: { status: string; sentAt: string | null } | null }[]
      ).find((entry) => entry.id === invited.body.id)

    expect(entryOf(await list())?.mail).toMatchObject({ status: 'pending', sentAt: null })

    await cycle(recording().transport)

    const sent = entryOf(await list())?.mail

    expect(sent?.status).toBe('sent')
    expect(sent?.sentAt).not.toBeNull()
  })

  it('is not sent once the office called it back', async () => {
    const invited = await invite({
      email: 'irrtum@nord.example.de',
      name: 'Falsche Adresse',
      roles: ['technician'],
      send: 'mail',
    }).expect(201)

    await request(app.getHttpServer())
      .delete(`/staff/invitations/${invited.body.id as string}`)
      .set('x-test-identity', owner())
      .expect(200)

    const post = recording()

    expect(await cycle(post.transport)).toMatchObject({ sent: 0, failed: 1 })
    expect(post.tried).toHaveLength(0)

    const [given] = await outboxOf(invited.body.id as string)

    expect(given?.status).toBe('failed')
    expect(given?.last_error).toContain('nicht mehr offen')
  })

  /**
   * A message that did not go out still made a token on its way. The next
   * attempt makes another one, and only the link that arrives works.
   */
  it('makes a new link for a second attempt, and the first one stops working', async () => {
    const invited = await invite({
      email: 'zweiter@nord.example.de',
      name: 'Zora Zweiter',
      roles: ['technician'],
      send: 'mail',
    }).expect(201)

    const post = recording({ failFirst: true })

    expect(await cycle(post.transport)).toMatchObject({ sent: 0, retried: 1 })

    // One minute later, the first wait after a failure.
    expect(await cycle(post.transport, 2 * 60_000)).toMatchObject({ sent: 1 })

    const first = tokenIn(post.tried[0])
    const second = tokenIn(post.sent[0])

    expect(first).toHaveLength(43)
    expect(second).toHaveLength(43)
    expect(second).not.toBe(first)
    expect(await offerOf(database, first)).toBeNull()
    expect(await offerOf(database, second)).toMatchObject({ state: 'open' })

    const [sent] = await outboxOf(invited.body.id as string)

    expect(sent?.status).toBe('sent')
  })
})

describe('the signature of an invitation', () => {
  it('names the one who invited, in place of {benutzer}', async () => {
    await aMailServer(admin, north.id, {
      from: 'buero@nord.example.de',
      signature: 'Viele Grüße\n{benutzer}\n\n{briefkopf}',
    })

    try {
      await invite({
        email: 'signatur@nord.example.de',
        name: 'Sina Signatur',
        roles: ['technician'],
        send: 'mail',
      }).expect(201)

      const post = recording()

      await cycle(post.transport)

      expect(post.sent[0]?.text).toContain(
        '-- \nViele Grüße\nChrista Chefin\n\nElektro Nord GmbH\nHafenstraße 12\n20457 Hamburg',
      )
    } finally {
      await aMailServer(admin, north.id, { from: 'buero@nord.example.de' })
    }
  })
})

describe('an invitation passed on by the office', () => {
  it('still hands the token back once and writes no message', async () => {
    const invited = await invite({
      email: 'link@nord.example.de',
      name: 'Lina Link',
      roles: ['technician'],
    }).expect(201)

    expect(invited.body.token).toHaveLength(43)
    expect(await outboxOf(invited.body.id as string)).toEqual([])
  })
})

describe('the way it is sent', () => {
  it('is a link or a mail and nothing else', async () => {
    const refused = await invite({
      email: 'fax@nord.example.de',
      name: 'Fax Fehler',
      roles: ['technician'],
      send: 'fax',
    }).expect(400)

    expect(refused.body.message).toContain('send')
  })

  it('is refused by mail for a business without a mail server, before anything is written', async () => {
    await admin.query('delete from mail_settings where tenant_id = $1', [north.id])

    try {
      const refused = await invite({
        email: 'keinserver@nord.example.de',
        name: 'Kai Kein',
        roles: ['technician'],
        send: 'mail',
      }).expect(409)

      expect(refused.body.message).toContain('kein Mailserver eingerichtet')

      const { rows } = await admin.query('select id from invitations where email = $1', [
        'keinserver@nord.example.de',
      ])

      expect(rows).toEqual([])
    } finally {
      await aMailServer(admin, north.id, { from: 'buero@nord.example.de' })
    }
  })

  it('is refused by mail on an instance without a mail server, before anything is written', async () => {
    const refused = await invite(
      {
        email: 'ohne@nord.example.de',
        name: 'Olaf Ohne',
        roles: ['technician'],
        send: 'mail',
      },
      withoutMail,
    ).expect(503)

    expect(refused.body.message).toContain('verschickt keine E-Mails')

    const { rows } = await admin.query('select id from invitations where email = $1', [
      'ohne@nord.example.de',
    ])

    expect(rows).toEqual([])
  })
})
