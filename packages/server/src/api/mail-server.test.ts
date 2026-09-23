import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { Database } from '../database/database.js'
import { newId } from '../database/identifier.js'
import {
  allowApplicationLogin,
  applicationDatabaseUrl,
  applyMigrations,
  connect,
  resetSchema,
} from '../database/test-database.js'
import type { MailConfiguration } from '../mail/configuration.js'
import { testKey } from '../mail/test-mail-server.js'
import { MailDeliveryError, type MailTransport } from '../mail/transport.js'
import { SecretKey } from '../secrets/key.js'
import { ApiModule } from './api.module.js'
import { as, testIdentities as identities } from './test-identity.js'

/**
 * The mail server of a business, set up in the office.
 *
 * Most of what is held on to here is about the password, and most of it about
 * where it is not: not in an answer, not in plain text in the database, not in
 * the audit log. And about who may see the settings at all, which is the
 * owner and not the office.
 */

const north = { id: newId<'tenant'>(), name: 'Elektro Nord GmbH' }
const south = { id: newId<'tenant'>(), name: 'Elektro Süd' }

const password = 'das-passwort-zum-postfach'

let admin: Pool
let database: Database
let app: INestApplication

/** What the check was handed, and how the stand-in server answers it. */
let tried: MailConfiguration[] = []
let answer: MailDeliveryError | null = null

const standIn: MailTransport = {
  send: () => Promise.resolve(),
  verify: () => (answer ? Promise.reject(answer) : Promise.resolve()),
  close: () => undefined,
}

const owner = (tenant = north) => as(tenant.id, 'owner')
const office = (tenant = north) => as(tenant.id, 'office')

function http() {
  return request(app.getHttpServer())
}

const settings = {
  host: 'smtp.ionos.de',
  port: null,
  security: 'starttls',
  username: 'rechnung@nord.example.de',
  password,
  fromAddress: 'rechnung@nord.example.de',
  signature: 'Viele Grüße\n{benutzer}\n\n{briefkopf}',
}

function save(body: Record<string, unknown>, identity = owner()) {
  return http().put('/settings/mail/server').set('x-test-identity', identity).send(body)
}

async function serverOf(identity = owner()) {
  const read = await http()
    .get('/settings/mail/server')
    .set('x-test-identity', identity)
    .expect(200)

  return (read.body as { server: Record<string, unknown> | null }).server
}

beforeAll(async () => {
  admin = await connect()
  await resetSchema(admin)
  await applyMigrations()
  await allowApplicationLogin(admin)

  for (const tenant of [north, south]) {
    await admin.query('insert into tenants (id, name) values ($1, $2)', [tenant.id, tenant.name])
  }

  database = Database.connect(applicationDatabaseUrl())

  const built = await Test.createTestingModule({
    imports: [
      ApiModule.create(database, identities, {
        mail: {
          origin: 'https://opengewerk.example.de',
          key: testKey,
          connect: (configuration) => {
            tried.push(configuration)

            return standIn
          },
        },
      }),
    ],
  }).compile()

  app = built.createNestApplication()
  await app.init()
})

beforeEach(async () => {
  tried = []
  answer = null
  await admin.query('delete from secrets')
  await admin.query('delete from mail_settings')
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
})

describe('the mail server of a business', () => {
  it('is not the office’s to see or to change', async () => {
    const refused = await http()
      .get('/settings/mail/server')
      .set('x-test-identity', office())
      .expect(403)

    expect((refused.body as { message: string }).message).toContain('mail.read')
    await save(settings, office()).expect(403)
    await http().delete('/settings/mail/server').set('x-test-identity', office()).expect(403)
  })

  it('tells the office whether the business sends mail, and from where, and nothing else', async () => {
    const before = await http().get('/settings/mail').set('x-test-identity', office()).expect(200)

    expect(before.body).toEqual({ configured: false, from: null })

    await save(settings).expect(200)

    const after = await http().get('/settings/mail').set('x-test-identity', office()).expect(200)

    expect(after.body).toEqual({ configured: true, from: 'rechnung@nord.example.de' })
  })

  it('is set up by the owner, and the password never comes back', async () => {
    expect(await serverOf()).toBeNull()

    const saved = await save(settings).expect(200)

    expect(saved.body.check).toEqual({ outcome: 'ready' })
    expect(saved.body.server).toMatchObject({
      host: 'smtp.ionos.de',
      port: 587,
      security: 'starttls',
      username: 'rechnung@nord.example.de',
      fromAddress: 'rechnung@nord.example.de',
      signature: 'Viele Grüße\n{benutzer}\n\n{briefkopf}',
      password: 'set',
    })
    expect(JSON.stringify(saved.body)).not.toContain(password)
    expect(JSON.stringify(await serverOf())).not.toContain(password)
  })

  it('keeps the password sealed, and out of the audit log', async () => {
    await save(settings).expect(200)

    const { rows: sealed } = await admin.query<{ sealed: string }>('select sealed from secrets')

    expect(sealed).toHaveLength(1)
    expect(sealed[0]?.sealed).not.toContain(password)
    expect(testKey.unseal(`${north.id}:smtp_password`, sealed[0]?.sealed ?? '')).toBe(password)

    // The log sees that a password was set, and when, and never the value or
    // the seal around it.
    const { rows: logged } = await admin.query<{ table_name: string; field: string }>(
      `select table_name, field from audit_entries
        where position($1 in coalesce(old_value, '') || coalesce(new_value, '')) > 0
           or position($2 in coalesce(old_value, '') || coalesce(new_value, '')) > 0`,
      [password, sealed[0]?.sealed ?? ''],
    )

    expect(logged).toEqual([])

    const { rows: marked } = await admin.query<{ field: string }>(
      "select field from audit_entries where table_name = 'mail_settings' and field = 'password_set_at'",
    )

    expect(marked.length).toBeGreaterThan(0)
  })

  it('keeps the password when it is not sent again, and forgets it with the login', async () => {
    await save(settings).expect(200)

    const { password: _typed, ...withoutPassword } = settings
    const changed = await save({ ...withoutPassword, port: 465, security: 'tls' }).expect(200)

    expect(changed.body.server).toMatchObject({ port: 465, security: 'tls', password: 'set' })

    const relay = await save({ ...withoutPassword, username: null }).expect(200)

    expect(relay.body.server).toMatchObject({
      username: null,
      password: 'none',
      passwordSetAt: null,
    })

    const { rows } = await admin.query('select id from secrets')

    expect(rows).toEqual([])
  })

  /**
   * Saving asks the server first. A connection it refuses is not kept, and
   * the answer says why, so that nobody finds out from an invoice that never
   * arrived.
   */
  it('keeps a new connection only when the server takes it, and says why not', async () => {
    answer = new MailDeliveryError('535 Authentication failed', 'EAUTH', 535)

    const refused = await save(settings).expect(422)

    expect((refused.body as { message: string }).message).toMatch(
      /^Nicht gespeichert\. Der Mailserver smtp\.ionos\.de:587 lehnt die Anmeldung ab/,
    )
    expect(await serverOf()).toBeNull()
    expect(tried).toHaveLength(1)
  })

  it('saves a new signature through a server that is down this minute, and says so', async () => {
    await save(settings).expect(200)
    answer = new MailDeliveryError('connect ECONNREFUSED', 'ECONNECTION', null)

    const { password: _typed, ...withoutPassword } = settings
    const saved = await save({ ...withoutPassword, signature: '{benutzer}\nElektro Nord' }).expect(
      200,
    )

    expect(saved.body.check).toMatchObject({ outcome: 'unreachable' })
    expect(saved.body.server).toMatchObject({ signature: '{benutzer}\nElektro Nord' })

    // Another port is another connection, and that one is not kept untried.
    await save({ ...withoutPassword, port: 2525 }).expect(422)
    expect(await serverOf()).toMatchObject({ port: 587 })
  })

  it('refuses what can be named wrong before a server is asked', async () => {
    const { password: _typed, ...withoutPassword } = settings

    expect(
      (
        (await save({ ...settings, host: 'smtp://smtp.ionos.de' }).expect(400)).body as {
          message: string
        }
      ).message,
    ).toContain('ohne "smtp://" davor')
    expect(
      (
        (await save({ ...settings, signature: 'Grüße, {name}' }).expect(400)).body as {
          message: string
        }
      ).message,
    ).toContain('{name}')
    expect(
      ((await save(withoutPassword).expect(400)).body as { message: string }).message,
    ).toContain('Zum Benutzernamen fehlt das Passwort')
    expect(await serverOf()).toBeNull()
  })

  /**
   * SESSION_SECRET was changed. The screen says the password has to be
   * entered again, and saving without one is refused rather than kept with a
   * login that cannot sign in.
   */
  it('says when the password no longer opens, and wants it again', async () => {
    await save(settings).expect(200)
    await admin.query('update secrets set sealed = $1', [
      SecretKey.from('ein anderes Geheimnis').seal(`${north.id}:smtp_password`, password),
    ])

    expect(await serverOf()).toMatchObject({ password: 'unreadable' })

    const { password: _typed, ...withoutPassword } = settings
    const refused = await save(withoutPassword).expect(400)

    expect((refused.body as { message: string }).message).toContain('nicht mehr lesen')

    await save(settings).expect(200)
    expect(await serverOf()).toMatchObject({ password: 'set' })
  })

  it('belongs to its own business', async () => {
    await save(settings).expect(200)

    expect(await serverOf(owner(south))).toBeNull()

    const status = await http().get('/settings/mail').set('x-test-identity', office(south))

    expect(status.body).toEqual({ configured: false, from: null })
  })
})

describe('checking the connection', () => {
  it('tries the settings from the form, with the password kept when none is typed', async () => {
    await save(settings).expect(200)
    // Saving asked the server as well; what counts here is the check alone.
    tried = []

    const { password: _typed, ...withoutPassword } = settings
    const checked = await http()
      .post('/settings/mail/server/check')
      .set('x-test-identity', owner())
      .send({ ...withoutPassword, port: 2525 })
      .expect(200)

    expect(checked.body).toEqual({ outcome: 'ready' })
    expect(tried).toEqual([
      {
        host: 'smtp.ionos.de',
        port: 2525,
        security: 'starttls',
        user: 'rechnung@nord.example.de',
        password,
        from: 'rechnung@nord.example.de',
      },
    ])
  })

  it('names the login when the server refuses it, and saves nothing', async () => {
    answer = new MailDeliveryError('535 Authentication failed', 'EAUTH', 535)

    const checked = await http()
      .post('/settings/mail/server/check')
      .set('x-test-identity', owner())
      .send(settings)
      .expect(200)

    expect(checked.body).toMatchObject({ outcome: 'refused' })
    expect((checked.body as { reason: string }).reason).toContain('Benutzername und Passwort')
    expect(await serverOf()).toBeNull()
  })

  /**
   * Every check is a connection this instance opens to a server somebody
   * named, with a login somebody typed. Unlimited, it would be a way to try
   * one password after the other against somebody else's mailbox, with the
   * instance doing the connecting (GHSA-5664-h6fc-v729).
   */
  it('is refused after thirty tries in ten minutes, for this business alone', async () => {
    const east = { id: newId<'tenant'>(), name: 'Elektro Ost' }

    await admin.query('insert into tenants (id, name) values ($1, $2)', [east.id, east.name])

    const check = (tenant: { id: string; name: string }) =>
      http()
        .post('/settings/mail/server/check')
        .set('x-test-identity', owner(tenant as typeof north))
        .send(settings)

    for (let attempt = 0; attempt < 30; attempt += 1) {
      await check(east).expect(200)
    }

    const refused = await check(east).expect(429)

    expect((refused.body as { message: string }).message).toContain('zehn Minuten')
    // Another business is not held up by it.
    await check(south).expect(200)
  })
})

describe('removing the mail server', () => {
  it('forgets the login and gives up on what was still waiting', async () => {
    await save(settings).expect(200)
    await admin.query(
      `insert into mail_outbox (tenant_id, kind, cause, sender_name, recipient_address, subject, body)
       values ($1, 'task_due', 'test:waiting', 'Elektro Nord GmbH', 'max@example.de', 'Heute fällig', 'Text')`,
      [north.id],
    )

    await http().delete('/settings/mail/server').set('x-test-identity', owner()).expect(200)

    expect(await serverOf()).toBeNull()

    const { rows: secrets } = await admin.query('select id from secrets')
    const { rows: messages } = await admin.query<{ status: string; last_error: string }>(
      'select status, last_error from mail_outbox where tenant_id = $1',
      [north.id],
    )

    expect(secrets).toEqual([])
    expect(messages).toEqual([
      {
        status: 'failed',
        last_error: 'Der Mailserver wurde entfernt, bevor die E-Mail hinausging.',
      },
    ])

    await admin.query('delete from mail_outbox')
  })

  it('says so when there is none', async () => {
    await http().delete('/settings/mail/server').set('x-test-identity', owner()).expect(404)
  })
})
