import 'reflect-metadata'

import { type DynamicModule, type INestApplication, Module } from '@nestjs/common'
import { APP_FILTER, APP_GUARD } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import type { MemberIdentity, TenantId } from '@opengewerk/platform-domain'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { AUTHORIZATION, AuthorizationGuard } from '../api/authorization.js'
import { databaseErrors } from '../api/database-errors.js'
import { TRUSTED_ORIGINS } from '../api/handed-in.js'
import { IDENTITY_SOURCE } from '../api/identity.js'
import { SameOriginGuard } from '../api/origin.js'
import { headerIdentities, testIdentityHeader } from '../api/test-identity.js'
import {
  probeAccess,
  probeAuthorization,
  type ProbeFoundation,
  probeFoundation,
  type ProbeRight,
} from '../authentication/probe-application.js'
import { Database } from '../database/database.js'
import { newId } from '../database/identifier.js'
import { probeSecrets } from '../database/probe-schema.js'
import { SecretKey } from '../secrets/key.js'
import { secretStore } from '../secrets/store.js'
import type { MailConfiguration } from './configuration.js'
import { MAIL, type MailContext } from './context.js'
import { mailServers } from './server-settings.js'
import { mailSettingsParts } from './settings.controller.js'
import { testKey } from './test-mail-server.js'
import { MailDeliveryError, type MailTransport } from './transport.js'

/**
 * The mail server of a tenant, set up on the settings of an application that
 * is nobody's: the probe application, whose lead may see and change it with
 * the rights to the people of a tenant, and whose members only learn whether
 * the tenant sends mail at all.
 *
 * Most of what is held on to here is about the password, and most of it about
 * where it is not: not in an answer, not in plain text in the database, not in
 * the audit log.
 */

const north = { id: newId<'tenant'>() as TenantId, name: 'Mandant Nord' }
const south = { id: newId<'tenant'>() as TenantId, name: 'Mandant Süd' }
const east = { id: newId<'tenant'>() as TenantId, name: 'Mandant Ost' }

const lead: readonly ProbeRight[] = ['membership.read', 'membership.write', 'members.read']
const member: readonly ProbeRight[] = ['members.read']

const password = 'das-passwort-zum-postfach'

/** What the application says, in words of its own. */
const sentences = {
  notConfigured: 'Dieser Mandant hat keinen Mailserver, eingerichtet wird er in der Probe.',
  noneToRemove: 'Dieser Mandant hat keinen Mailserver, der sich entfernen ließe.',
  senderName: 'Den Namen davor nimmt die Probe aus ihren Stammdaten.',
}

/** The placeholder the probe application allows, and a sentence of its own for any other. */
function signatureProblem(signature: string): string | null {
  const unknown = [...signature.matchAll(/\{[^}]*\}/g)]
    .map(([found]) => found)
    .filter((found) => found !== '{name}')

  return unknown.length > 0 ? `Unbekannte Platzhalter: ${unknown.join(', ')}.` : null
}

let removedAt: Date[] = []

const servers = mailServers({
  secrets: secretStore(probeSecrets),
  purpose: 'mailbox',
  signatureProblem,
  whenRemoved: async (_tx, now) => {
    removedAt.push(now)
  },
  sentences,
})

let foundation: ProbeFoundation
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

const context: MailContext = {
  origin: 'https://probewerk.example.de',
  key: testKey,
  connect: (configuration) => {
    tried.push(configuration)

    return standIn
  },
}

function identityOf(tenant: TenantId, rights: readonly ProbeRight[]): string {
  const identity: MemberIdentity<ProbeRight> = {
    userId: `person-${tenant}`,
    tenantId: tenant,
    roles: [],
    rights: [...rights],
  }

  return JSON.stringify(identity)
}

const leading = (tenant = north.id) => identityOf(tenant, lead)
const working = (tenant = north.id) => identityOf(tenant, member)

function http() {
  return request(app.getHttpServer())
}

const settings = {
  host: 'smtp.ionos.de',
  port: null,
  security: 'starttls',
  username: 'post@nord.example.de',
  password,
  fromAddress: 'post@nord.example.de',
  signature: 'Viele Grüße\n{name}',
}

function save(body: Record<string, unknown>, identity = leading()) {
  return http().put('/settings/mail/server').set(testIdentityHeader, identity).send(body)
}

async function serverOf(identity = leading()) {
  const read = await http()
    .get('/settings/mail/server')
    .set(testIdentityHeader, identity)
    .expect(200)

  return (read.body as { server: Record<string, unknown> | null }).server
}

/** The module of an application, as far as its mail settings go. */
@Module({})
class ProbeMailModule {
  static create(database: Database, mail: MailContext | null): DynamicModule {
    const parts = mailSettingsParts({
      access: probeAccess,
      rights: { status: 'members.read', read: 'membership.read', write: 'membership.write' },
      servers,
    })

    return {
      module: ProbeMailModule,
      controllers: parts.controllers,
      providers: [
        { provide: Database, useValue: database },
        { provide: MAIL, useValue: mail },
        ...parts.providers,
        { provide: IDENTITY_SOURCE, useValue: headerIdentities<MemberIdentity<ProbeRight>>() },
        { provide: AUTHORIZATION, useValue: probeAuthorization },
        { provide: TRUSTED_ORIGINS, useValue: [] },
        { provide: APP_GUARD, useClass: SameOriginGuard },
        { provide: APP_GUARD, useClass: AuthorizationGuard },
        { provide: APP_FILTER, useClass: databaseErrors().DatabaseExceptionFilter },
      ],
    }
  }
}

beforeAll(async () => {
  foundation = await probeFoundation()
  admin = await foundation.kit.connect()
  await foundation.empty(admin)
  await foundation.tenants(admin, [north, south, east])
  database = Database.connect(foundation.kit.applicationDatabaseUrl())

  app = (
    await Test.createTestingModule({
      imports: [ProbeMailModule.create(database, context)],
    }).compile()
  ).createNestApplication()
  await app.init()
}, 60_000)

beforeEach(async () => {
  tried = []
  answer = null
  removedAt = []
  await admin.query('delete from secrets')
  await admin.query('delete from mail_settings')
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
  foundation.remove()
})

describe('the routes of the mail settings', () => {
  it('are refused to an application whose catalogue lacks a right they name', () => {
    expect(() =>
      mailSettingsParts({
        access: probeAccess,
        rights: {
          status: 'members.read',
          read: 'membership.read',
          write: 'letters.write' as ProbeRight,
        },
        servers,
      }),
    ).toThrow('The catalogue lacks a right of the mail settings: letters.write')
  })
})

describe('the mail server of a tenant', () => {
  it('is not for whoever lacks the rights the application named for it', async () => {
    await http().get('/settings/mail/server').set(testIdentityHeader, working()).expect(403)
    await save(settings, working()).expect(403)
    await http().delete('/settings/mail/server').set(testIdentityHeader, working()).expect(403)
    await http()
      .post('/settings/mail/server/check')
      .set(testIdentityHeader, working())
      .send(settings)
      .expect(403)
  })

  it('tells whoever reads the settings whether the tenant sends mail, and from where, and nothing else', async () => {
    const before = await http().get('/settings/mail').set(testIdentityHeader, working()).expect(200)

    expect(before.body).toEqual({ configured: false, from: null })

    await save(settings).expect(200)

    const after = await http().get('/settings/mail').set(testIdentityHeader, working()).expect(200)

    expect(after.body).toEqual({ configured: true, from: 'post@nord.example.de' })
  })

  it('is set up, and the password never comes back', async () => {
    expect(await serverOf()).toBeNull()

    const saved = await save(settings).expect(200)

    expect(saved.body.check).toEqual({ outcome: 'ready' })
    expect(saved.body.server).toMatchObject({
      host: 'smtp.ionos.de',
      port: 587,
      security: 'starttls',
      username: 'post@nord.example.de',
      fromAddress: 'post@nord.example.de',
      signature: 'Viele Grüße\n{name}',
      password: 'set',
    })
    expect(JSON.stringify(saved.body)).not.toContain(password)
    expect(JSON.stringify(await serverOf())).not.toContain(password)
  })

  it('keeps the password sealed under the purpose the application named, and out of the audit log', async () => {
    await save(settings).expect(200)

    const { rows: sealed } = await admin.query<{ purpose: string; sealed: string }>(
      'select purpose, sealed from secrets',
    )

    expect(sealed.map((row) => row.purpose)).toEqual(['mailbox'])
    expect(sealed[0]?.sealed).not.toContain(password)
    expect(testKey.unseal(`${north.id}:mailbox`, sealed[0]?.sealed ?? '')).toBe(password)

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
   * the answer says why, so that nobody finds out from a message that never
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
    const saved = await save({ ...withoutPassword, signature: '{name}\nMandant Nord' }).expect(200)

    expect(saved.body.check).toMatchObject({ outcome: 'unreachable' })
    expect(saved.body.server).toMatchObject({ signature: '{name}\nMandant Nord' })

    // Another port is another connection, and that one is not kept untried.
    await save({ ...withoutPassword, port: 2525 }).expect(422)
    expect(await serverOf()).toMatchObject({ port: 587 })
  })

  it('refuses what can be named wrong before a server is asked, a signature in the words of the application', async () => {
    const { password: _typed, ...withoutPassword } = settings
    const messageOf = async (body: Record<string, unknown>) =>
      ((await save(body).expect(400)).body as { message: string }).message

    expect(await messageOf({ ...settings, host: 'smtp://smtp.ionos.de' })).toContain(
      'ohne "smtp://" davor',
    )
    expect(await messageOf({ ...settings, signature: 'Grüße, {name} {firma}' })).toBe(
      'Unbekannte Platzhalter: {firma}.',
    )
    expect(await messageOf({ ...settings, fromAddress: 'Mandant <post@nord.example.de>' })).toBe(
      '"Mandant <post@nord.example.de>" ist keine E-Mail-Adresse. Als Absender steht hier nur ' +
        `die Adresse. ${sentences.senderName}`,
    )
    expect(await messageOf(withoutPassword)).toContain('Zum Benutzernamen fehlt das Passwort')
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
      SecretKey.from('ein anderes Geheimnis').seal(`${north.id}:mailbox`, password),
    ])

    expect(await serverOf()).toMatchObject({ password: 'unreadable' })

    const { password: _typed, ...withoutPassword } = settings
    const refused = await save(withoutPassword).expect(400)

    expect((refused.body as { message: string }).message).toContain('nicht mehr lesen')

    await save(settings).expect(200)
    expect(await serverOf()).toMatchObject({ password: 'set' })
  })

  it('belongs to its own tenant', async () => {
    await save(settings).expect(200)

    expect(await serverOf(leading(south.id))).toBeNull()

    const status = await http().get('/settings/mail').set(testIdentityHeader, working(south.id))

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
      .set(testIdentityHeader, leading())
      .send({ ...withoutPassword, port: 2525 })
      .expect(200)

    expect(checked.body).toEqual({ outcome: 'ready' })
    expect(tried).toEqual([
      {
        host: 'smtp.ionos.de',
        port: 2525,
        security: 'starttls',
        user: 'post@nord.example.de',
        password,
        from: 'post@nord.example.de',
      },
    ])
  })

  /**
   * Whoever may change the settings does not know the password, or need not.
   * Pointed at a server of their own, the check would hand it over there, and
   * so would every message after a save (opengewerk-haustechnik#31).
   */
  it('sends the password kept to no other server and with no other login', async () => {
    await save(settings).expect(200)
    tried = []

    const { password: _typed, ...withoutPassword } = settings
    const elsewhere = [
      { ...withoutPassword, host: 'mail.angreifer.example' },
      { ...withoutPassword, username: 'jemand@angreifer.example' },
    ]

    for (const body of elsewhere) {
      const checked = await http()
        .post('/settings/mail/server/check')
        .set(testIdentityHeader, leading())
        .send(body)
        .expect(400)

      expect((checked.body as { message: string }).message).toContain(
        'Für einen anderen Server oder Benutzernamen gehört es neu eingegeben.',
      )
      await save(body).expect(400)
    }

    expect(tried).toEqual([])
    expect(await serverOf()).toMatchObject({
      host: 'smtp.ionos.de',
      username: 'post@nord.example.de',
    })

    // The same server, written another way, is the same server.
    await save({ ...withoutPassword, host: 'SMTP.IONOS.DE' }).expect(200)
    // With the password typed in, any server is fine.
    await save({ ...settings, host: 'mail.nord.example.de' }).expect(200)
  })

  it('names the login when the server refuses it, and saves nothing', async () => {
    answer = new MailDeliveryError('535 Authentication failed', 'EAUTH', 535)

    const checked = await http()
      .post('/settings/mail/server/check')
      .set(testIdentityHeader, leading())
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
  it('is refused after thirty tries in ten minutes, for this tenant alone', async () => {
    const check = (tenant: TenantId) =>
      http()
        .post('/settings/mail/server/check')
        .set(testIdentityHeader, leading(tenant))
        .send(settings)

    for (let attempt = 0; attempt < 30; attempt += 1) {
      await check(east.id).expect(200)
    }

    const refused = await check(east.id).expect(429)

    expect((refused.body as { message: string }).message).toContain('zehn Minuten')
    // Another tenant is not held up by it.
    await check(south.id).expect(200)
  })
})

describe('removing the mail server', () => {
  it('forgets the login, and hands what was still waiting to the application, once', async () => {
    await save(settings).expect(200)

    await http().delete('/settings/mail/server').set(testIdentityHeader, leading()).expect(200)

    expect(await serverOf()).toBeNull()
    expect(await admin.query('select id from secrets').then(({ rows }) => rows)).toEqual([])
    expect(removedAt).toHaveLength(1)
  })

  it('says so in the words of the application when there is none', async () => {
    const refused = await http()
      .delete('/settings/mail/server')
      .set(testIdentityHeader, leading())
      .expect(404)

    expect((refused.body as { message: string }).message).toBe(sentences.noneToRemove)
    expect(removedAt).toEqual([])
  })
})

describe('the mail server for whoever sends', () => {
  it('refuses a wish to send without one, in the words of the application', async () => {
    await expect(servers.requireMailServer(database, { tenantId: north.id })).rejects.toThrow(
      sentences.notConfigured,
    )

    await save(settings).expect(200)
    await expect(
      servers.requireMailServer(database, { tenantId: north.id }),
    ).resolves.toBeUndefined()
  })

  it('is opened for a job with the password, and is not when the password does not open', async () => {
    expect(await servers.connectionOf(database, north.id, testKey)).toBeNull()

    await save(settings).expect(200)

    expect(await servers.connectionOf(database, north.id, testKey)).toEqual({
      state: 'ready',
      configuration: {
        host: 'smtp.ionos.de',
        port: 587,
        security: 'starttls',
        from: 'post@nord.example.de',
        user: 'post@nord.example.de',
        password,
      },
    })
    expect(
      await servers.connectionOf(database, north.id, SecretKey.from('ein anderes Geheimnis')),
    ).toEqual({ state: 'unreadable' })
  })

  it('is a relay without a login when there is no user name, and needs no password', async () => {
    await save({ ...settings, username: null, password: undefined }).expect(200)

    expect(await servers.connectionOf(database, north.id, testKey)).toMatchObject({
      state: 'ready',
      configuration: { user: null, password: null },
    })
  })
})

describe('a mail server without a context to send with', () => {
  it('is not offered at all on a closed instance, and says why where it would be read', async () => {
    const closed = (
      await Test.createTestingModule({
        imports: [ProbeMailModule.create(database, null)],
      }).compile()
    ).createNestApplication()
    await closed.init()

    try {
      const status = await request(closed.getHttpServer())
        .get('/settings/mail')
        .set(testIdentityHeader, working())
        .expect(200)
      const server = await request(closed.getHttpServer())
        .get('/settings/mail/server')
        .set(testIdentityHeader, leading())
        .expect(503)

      expect(status.body).toEqual({ configured: false, from: null })
      expect((server.body as { message: string }).message).toContain('verschickt keine E-Mails')
    } finally {
      await closed.close()
    }
  })
})
