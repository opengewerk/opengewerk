import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { Database, type MailTransport, newId } from '@opengewerk/platform-server'
import { testKey } from '@opengewerk/platform-server/testing'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import {
  allowApplicationLogin,
  applicationDatabaseUrl,
  applyMigrations,
  connect,
  resetSchema,
} from '../database/test-database.js'
import { ApiModule } from './api.module.js'
import { as, testIdentities as identities } from './test-identity.js'

/**
 * The mail server of a business, as this application binds the routes of the
 * foundation (#23): the owner sets it up and the office only learns whether
 * the business sends mail, a signature knows `{benutzer}` and `{briefkopf}`,
 * the password is sealed as the login to the mailbox, and removing the server
 * gives up on what waits in the outbox of this application. How the routes
 * keep the password out of every answer and the log, check a connection and
 * hold back somebody trying too often, is held in the foundation.
 */

const north = { id: newId<'tenant'>(), name: 'Elektro Nord GmbH' }

const password = 'das-passwort-zum-postfach'

let admin: Pool
let database: Database
let app: INestApplication

const standIn: MailTransport = {
  send: () => Promise.resolve(),
  verify: () => Promise.resolve(),
  close: () => undefined,
}

const owner = () => as(north.id, 'owner')
const office = () => as(north.id, 'office')

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

beforeAll(async () => {
  admin = await connect()
  await resetSchema(admin)
  await applyMigrations()
  await allowApplicationLogin(admin)
  await admin.query('insert into tenants (id, name) values ($1, $2)', [north.id, north.name])

  database = Database.connect(applicationDatabaseUrl())

  const built = await Test.createTestingModule({
    imports: [
      ApiModule.create(database, identities, {
        mail: { origin: 'https://opengewerk.example.de', key: testKey, connect: () => standIn },
      }),
    ],
  }).compile()

  app = built.createNestApplication()
  await app.init()
})

beforeEach(async () => {
  await admin.query('delete from mail_outbox')
  await admin.query('delete from secrets')
  await admin.query('delete from mail_settings')
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
})

describe('the mail server of a business', () => {
  it('is the owner’s to see and change, and the office learns only whether mail goes out', async () => {
    const refused = await http()
      .get('/settings/mail/server')
      .set('x-test-identity', office())
      .expect(403)

    expect((refused.body as { message: string }).message).toContain('E-Mail-Einstellungen ansehen')
    await save(settings, office()).expect(403)
    await http().delete('/settings/mail/server').set('x-test-identity', office()).expect(403)

    await save(settings).expect(200)

    const status = await http().get('/settings/mail').set('x-test-identity', office()).expect(200)

    expect(status.body).toEqual({ configured: true, from: 'rechnung@nord.example.de' })
  })

  it('takes a signature with {benutzer} and {briefkopf}, and names any other placeholder', async () => {
    const saved = await save(settings).expect(200)

    expect(saved.body.server).toMatchObject({ signature: 'Viele Grüße\n{benutzer}\n\n{briefkopf}' })

    const refused = await save({ ...settings, signature: 'Grüße, {name}' }).expect(400)

    expect((refused.body as { message: string }).message).toBe(
      'In der Signatur steht {name}. Möglich sind {benutzer} für den Namen dessen, der die ' +
        'E-Mail verschickt, und {briefkopf} für den Briefkopf.',
    )
  })

  it('says where the name in front of the sender comes from: the letterhead', async () => {
    const refused = await save({
      ...settings,
      fromAddress: 'Elektro Nord <rechnung@nord.example.de>',
    }).expect(400)

    expect((refused.body as { message: string }).message).toContain(
      'Der Name davor kommt aus dem Briefkopf.',
    )
  })

  it('seals the password as the login to a mailbox of the business', async () => {
    await save(settings).expect(200)

    const { rows } = await admin.query<{ purpose: string; sealed: string }>(
      'select purpose, sealed from secrets',
    )

    expect(rows.map((row) => row.purpose)).toEqual(['smtp_password'])
    expect(testKey.unseal(`${north.id}:smtp_password`, rows[0]?.sealed ?? '')).toBe(password)
  })
})

describe('removing the mail server', () => {
  it('gives up on what still waits in the outbox, with the reason', async () => {
    await save(settings).expect(200)
    await admin.query(
      `insert into mail_outbox (tenant_id, kind, cause, sender_name, recipient_address, subject, body)
       values ($1, 'task_due', 'test:waiting', 'Elektro Nord GmbH', 'max@example.de', 'Heute fällig', 'Text')`,
      [north.id],
    )

    await http().delete('/settings/mail/server').set('x-test-identity', owner()).expect(200)

    const { rows: messages } = await admin.query<{ status: string; last_error: string }>(
      'select status, last_error from mail_outbox where tenant_id = $1',
      [north.id],
    )

    expect(messages).toEqual([
      {
        status: 'failed',
        last_error: 'Der Mailserver wurde entfernt, bevor die E-Mail hinausging.',
      },
    ])
  })

  it('says so for the business when there is none', async () => {
    const refused = await http()
      .delete('/settings/mail/server')
      .set('x-test-identity', owner())
      .expect(404)

    expect((refused.body as { message: string }).message).toBe(
      'Für diesen Betrieb ist kein Mailserver eingerichtet.',
    )
  })
})
