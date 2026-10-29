import { ServiceUnavailableException } from '@nestjs/common'
import type { InstanceMailServerState, TenantId } from '@opengewerk/platform-domain'
import type { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import {
  probeAccess,
  type ProbeFoundation,
  probeFoundation,
  type ProbeInstance,
  probeInstance,
  probeOrigin as origin,
  type ProbeVisitors,
  probeVisitors,
} from '../authentication/probe-application.js'
import { addStaffMember } from '../authentication/staff.js'
import { Database } from '../database/database.js'
import { newId } from '../database/identifier.js'
import type { MailContext } from '../mail/context.js'
import { type FakeSmtpServer, fakeSmtpServer } from '../mail/test-smtp.js'
import { smtpTransport } from '../mail/transport.js'
import { SecretKey } from '../secrets/key.js'
import { accountMails, type AccountMessages } from './account-mail.js'
import { InstanceController } from './instance.controller.js'
import {
  instanceMailConnection,
  readInstanceMailServer,
  saveInstanceMailServer,
} from './mail-server.js'

/**
 * The mail server of the instance (opengewerk-haustechnik#81), end to end and
 * through HTTP, with people who really signed in and a mail server that
 * really answers.
 *
 * What it holds: only whoever runs the instance reads it and sets it, and
 * sets it only after confirming again; every change stands in the log of
 * every tenant and is told to whoever leads one through the server of before
 * (opengewerk-haustechnik#360); the password is sealed where it is kept,
 * handed to nobody, and never in the log of the instance, sealed or not; a
 * password kept goes to the server and the login it was typed in for; and a
 * mail to an account goes out through this server and, without it, not at
 * all.
 *
 * The tests build on each other, in the order they stand: an instance has
 * one row of settings.
 */

const password = 'ein-ordentlich-langes-passwort'
const setupCode = 'K7Q4-9PXM'
const mailPassword = 'postfach-der-instanz-4711'

/** Sets the instance up, and so runs it. */
const lea = { email: 'lea@nord.example.de', name: 'Lea Leitung' }
/** Leads the first tenant, and runs nothing. */
const otto = { email: 'otto@nord.example.de', name: 'Otto Zweitleitung' }
/** Leads the second tenant, and never signs in. */
const sue = { email: 'sue@sued.example.de', name: 'Sue Südleitung' }
/** Works in the second tenant without leading it. */
const mia = { email: 'mia@sued.example.de', name: 'Mia Mitglied' }
const south = { id: newId<'tenant'>(), name: 'Mandant Süd' }

/** Unconfirmed, a change of the mail server gets this. */
const unconfirmed =
  'Der Mailserver der Instanz ändert sich erst nach der Bestätigung mit Passwort und Code.'

const key = SecretKey.from('m'.repeat(64))

const messages: AccountMessages = {
  senderName: 'Probewerk',
  accountPath: '/konto',
  passwordReset: ({ name, link }) => ({
    subject: 'Ein neues Passwort',
    body: `Hallo ${name}, hier wählen Sie es: ${link}`,
  }),
  passkeyAdded: ({ name, passkey, link }) => ({
    subject: 'Ein neuer Passkey',
    body: `Hallo ${name}, angelegt wurde „${passkey}“. Ihre Passkeys: ${link}`,
  }),
  recoveryCodesRenewed: ({ name, link }) => ({
    subject: 'Neue Wiederherstellungscodes',
    body: `Hallo ${name}, es gibt neue Codes. Ihr Konto: ${link}`,
  }),
  secondFactorChanged: ({ name, change, link }) => ({
    subject: change === 'app' ? 'Eine App als zweiter Faktor' : 'Der zweite Faktor ist weg',
    body: `Hallo ${name}, Ihr zweiter Faktor hat sich geändert. Ihr Konto: ${link}`,
  }),
  operatorsChanged: ({ name, appointed, person, link }) => ({
    subject: 'Die Verwaltung der Instanz',
    body: `Hallo ${name}, ${person} ${appointed ? 'verwaltet jetzt mit' : 'verwaltet nicht mehr'}. ${link}`,
  }),
  mailServerChanged: ({ name, host, link }) => ({
    subject: 'Ein neuer Mailserver der Instanz',
    body: `Hallo ${name}, Mails an ein Konto gehen jetzt über ${host ?? 'keinen Server'}. ${link}`,
  }),
}

let foundation: ProbeFoundation
let admin: Pool
let instance: ProbeInstance
let visitors: ProbeVisitors
let database: Database
let smtp: FakeSmtpServer
let mail: MailContext

const signedIn = new Map<string, string>()
const as = (person: { email: string }) => signedIn.get(person.email) ?? ''

function get(path: string, person?: { email: string }) {
  const asking = instance.http().get(path)

  return person ? asking.set('cookie', as(person)) : asking
}

function send(
  method: 'post' | 'put' | 'delete',
  path: string,
  person: { email: string },
  body?: object,
) {
  return instance
    .http()
    [method](path)
    .set('cookie', as(person))
    .set('origin', origin)
    .send(body ?? {})
}

const message = (answer: { body: unknown }) => (answer.body as { message: string }).message

/**
 * A change of the mail server, after confirming again on the session as the
 * route asks, and the answer it should get.
 */
function change(method: 'put' | 'delete', person: { email: string }, body?: object) {
  return {
    async expect(status: number) {
      await visitors.reconfirm(person.email, as(person))

      return send(method, '/instance/mail-server', person, body).expect(status)
    },
  }
}

/** The changes of the mail server as the tenants keep them, the oldest first. */
async function changesIn(): Promise<
  {
    tenant_id: string
    host_before: string | null
    from_before: string | null
    host_after: string | null
    from_after: string | null
  }[]
> {
  const { rows } = await admin.query<{
    tenant_id: string
    host_before: string | null
    from_before: string | null
    host_after: string | null
    from_after: string | null
  }>(
    `select tenant_id, host_before, from_before, host_after, from_after
       from account_mail_server_changes order by changed_at, id`,
  )

  return rows
}

/** The settings somebody types in for the mail server of the test. */
function typed(over: object = {}) {
  return {
    host: '127.0.0.1',
    port: smtp.port,
    security: 'none',
    username: 'instanz',
    password: mailPassword,
    fromAddress: 'instanz@nord.example.de',
    ...over,
  }
}

async function state(): Promise<InstanceMailServerState> {
  return (await get('/instance/mail-server', lea).expect(200)).body as InstanceMailServerState
}

/** The row as the database keeps it. */
async function kept(): Promise<Record<string, unknown>> {
  const { rows } = await admin.query<Record<string, unknown>>(
    `select mail_server_host, mail_server_port, mail_server_security, mail_server_username,
            mail_server_from, mail_server_password, mail_server_password_set_at
       from instance_settings`,
  )

  return rows[0] ?? {}
}

/** What the log of the instance says about the settings: the fields it names. */
async function logged(): Promise<
  { field: string; old_value: string | null; new_value: string | null; reason: string | null }[]
> {
  const { rows } = await admin.query<{
    field: string
    old_value: string | null
    new_value: string | null
    reason: string | null
  }>(
    `select field, old_value, new_value, reason from instance_changes
      where table_name = 'instance_settings' order by id`,
  )

  return rows
}

beforeAll(async () => {
  foundation = await probeFoundation()
  admin = await foundation.kit.connect()
  await foundation.empty()

  const url = foundation.kit.applicationDatabaseUrl()

  smtp = await fakeSmtpServer({ credentials: { user: 'instanz', password: mailPassword } })
  mail = { origin, key, connect: (configuration) => smtpTransport(configuration) }
  database = Database.connect(url)
  instance = await probeInstance(url, { setupCode, mail })
  visitors = probeVisitors(instance, password)

  await instance
    .http()
    .post('/setup')
    .set('origin', origin)
    .send({ setupCode, company: 'Mandant Nord', name: lea.name, email: lea.email, password })
    .expect(201)

  const { rows: tenants } = await admin.query<{ id: TenantId }>('select id from tenants')

  await addStaffMember(instance.authentication, instance.database, {
    ...otto,
    password,
    tenantId: tenants[0]?.id as TenantId,
    roles: ['lead'],
  })
  await foundation.tenants(admin, [south])
  await addStaffMember(instance.authentication, instance.database, {
    ...sue,
    password,
    tenantId: south.id,
    roles: ['lead'],
  })
  await addStaffMember(instance.authentication, instance.database, {
    ...mia,
    password,
    tenantId: south.id,
    roles: ['member'],
  })

  await visitors.setUpSecondFactor(lea.email)
  await visitors.setUpSecondFactor(otto.email)

  for (const person of [lea, otto]) {
    signedIn.set(person.email, await visitors.signIn(person.email))
  }
}, 60_000)

afterAll(async () => {
  await instance.close()
  await database.close()
  await smtp.close()
  await foundation.kit.resetSchema(admin)
  await admin.end()
  foundation.remove()
})

describe('who reaches the mail server of the instance', () => {
  it('is whoever runs the instance, and there is none at first', async () => {
    expect(await state()).toEqual({ sends: true, server: null })
    expect(await instanceMailConnection(database, key)).toBeNull()
  })

  it('is nobody who leads a tenant and does not run the instance, and nobody who is not signed in', async () => {
    await get('/instance/mail-server').expect(401)
    await get('/instance/mail-server', otto).expect(403)
    await send('put', '/instance/mail-server', otto, typed()).expect(403)
    await send('post', '/instance/mail-server/check', otto, typed()).expect(403)
    await send('delete', '/instance/mail-server', otto).expect(403)

    expect(await state()).toEqual({ sends: true, server: null })
    expect(smtp.received).toEqual([])
  })
})

describe('changing the mail server of the instance without confirming again', () => {
  it('is refused, and nothing is kept, sent or written into a tenant', async () => {
    for (const [method, body] of [
      ['put', typed()],
      ['delete', undefined],
    ] as const) {
      const refused = await send(method, '/instance/mail-server', lea, body).expect(403)

      expect(message(refused)).toBe(unconfirmed)
    }

    expect(await state()).toEqual({ sends: true, server: null })
    expect(await changesIn()).toEqual([])
    expect(smtp.received).toEqual([])
  })

  it('takes one confirmation for one change, and a change refused spends it as well', async () => {
    await change('put', lea, typed({ password: 'falsch-geraten' })).expect(422)

    const refused = await send('put', '/instance/mail-server', lea, typed()).expect(403)

    expect(message(refused)).toBe(unconfirmed)
    expect(await state()).toEqual({ sends: true, server: null })
    expect(await changesIn()).toEqual([])
  })
})

describe('setting the mail server of the instance up', () => {
  it('refuses what can be named before a server is asked, with the field it is in', async () => {
    for (const [wrong, sentence] of [
      [{ host: 'smtp://mail.example.de' }, 'Der Server ist ein Name'],
      [{ port: 70000 }, 'Der Port ist eine Zahl zwischen 1 und 65535.'],
      [{ security: 'rot13' }, 'Die Verschlüsselung ist'],
      [{ fromAddress: 'Die Instanz' }, 'ist keine E-Mail-Adresse'],
      [{ password: '' }, 'Ein leeres Passwort gibt es nicht.'],
      [{ username: null }, 'Ein Passwort gehört zu einem Benutzernamen.'],
      [{ password: undefined }, 'Zum Benutzernamen fehlt das Passwort.'],
    ] as const) {
      const refused = await change('put', lea, typed(wrong)).expect(400)

      expect(message(refused)).toContain(sentence)
    }

    expect(await state()).toEqual({ sends: true, server: null })
  })

  it('refuses a login the mail server does not take, and keeps nothing', async () => {
    const refused = await change('put', lea, typed({ password: 'falsch-geraten' })).expect(422)

    expect(message(refused)).toContain('Nicht gespeichert.')
    expect(message(refused)).toContain('lehnt die Anmeldung ab')
    expect(await state()).toEqual({ sends: true, server: null })
  })

  it('keeps a server that takes the login, and hands the password to nobody', async () => {
    const saved = await change('put', lea, typed()).expect(200)

    expect(saved.body).toEqual({
      server: {
        host: '127.0.0.1',
        port: smtp.port,
        security: 'none',
        username: 'instanz',
        fromAddress: 'instanz@nord.example.de',
        password: 'set',
        passwordSetAt: expect.any(String) as string,
      },
      check: { outcome: 'ready' },
    })
    expect(JSON.stringify(saved.body)).not.toContain(mailPassword)

    const read = await get('/instance/mail-server', lea).expect(200)

    expect((read.body as InstanceMailServerState).server).toEqual(
      (saved.body as { server: unknown }).server,
    )
    expect(JSON.stringify(read.body)).not.toContain(mailPassword)
  })

  it('writes it into the log of every tenant, by its server and address, as whoever set it up and without the login', async () => {
    const { rows: people } = await admin.query<{ id: string }>(
      'select id from auth_users where email = $1',
      [lea.email],
    )
    const { rows: tenants } = await admin.query<{ id: string }>(
      'select id from tenants order by id',
    )

    expect(tenants).toHaveLength(2)
    expect(
      [...(await changesIn())].sort((left, right) => left.tenant_id.localeCompare(right.tenant_id)),
    ).toEqual(
      tenants.map((tenant) => ({
        tenant_id: tenant.id,
        host_before: null,
        from_before: null,
        host_after: '127.0.0.1',
        from_after: 'instanz@nord.example.de',
      })),
    )

    const { rows: entries } = await admin.query<{
      tenant_id: string
      user_id: string | null
      reason: string | null
      new_value: string | null
    }>(
      `select tenant_id, user_id, reason, new_value from audit_entries
        where table_name = 'account_mail_server_changes' and operation = 'insert'`,
    )

    expect(new Set(entries.map((entry) => entry.tenant_id))).toEqual(
      new Set(tenants.map((tenant) => tenant.id)),
    )
    expect(
      new Set(entries.map((entry) => `${String(entry.user_id)} ${String(entry.reason)}`)),
    ).toEqual(new Set([`${people[0]?.id ?? ''} instance.mail-server`]))
    // Neither the login nor its password, sealed or not.
    expect(entries.map((entry) => entry.new_value)).not.toContain('instanz')
    expect(JSON.stringify(entries)).not.toContain(mailPassword)
    expect(JSON.stringify(entries)).not.toContain('v1:')
  })

  it('keeps the password sealed, for this purpose and under this key alone', async () => {
    const row = await kept()
    const sealed = String(row['mail_server_password'])

    expect(sealed).toMatch(/^v1:/)
    expect(sealed).not.toContain(mailPassword)
    expect(key.unseal('instance:mail-server', sealed)).toBe(mailPassword)
    // Copied to a tenant, or opened with the key of another instance, it opens nothing.
    expect(key.unseal('tenant:mail', sealed)).toBeNull()
    expect(SecretKey.from('n'.repeat(64)).unseal('instance:mail-server', sealed)).toBeNull()
    expect(row['mail_server_password_set_at']).toBeInstanceOf(Date)
  })

  it('says in the log of the instance who set it up and when a password was set, and never the password', async () => {
    const entries = await logged()
    const fields = entries.map((entry) => entry.field)

    expect(fields).toEqual(
      expect.arrayContaining([
        'mail_server_host',
        'mail_server_port',
        'mail_server_security',
        'mail_server_username',
        'mail_server_from',
        'mail_server_password_set_at',
      ]),
    )
    expect(fields).not.toContain('mail_server_password')
    expect(
      new Set(
        entries
          .filter((entry) => entry.field.startsWith('mail_server'))
          .map((entry) => entry.reason),
      ),
    ).toEqual(new Set(['instance.settings']))

    const everything = JSON.stringify(
      (await admin.query('select old_value, new_value from instance_changes')).rows,
    )

    expect(everything).not.toContain(mailPassword)
    expect(everything).not.toContain(String((await kept())['mail_server_password']))
  })

  it('shows the log of the instance to whoever runs it without a password in it', async () => {
    const page = await get('/instance/log', lea).expect(200)

    expect(JSON.stringify(page.body)).toContain('mail_server_host')
    expect(JSON.stringify(page.body)).not.toContain('mail_server_password"')
    expect(JSON.stringify(page.body)).not.toContain(mailPassword)
  })
})

describe('changing the mail server of the instance', () => {
  it('keeps the password where none is typed, for the same server and the same login', async () => {
    const before = String((await kept())['mail_server_password'])
    const saved = await change(
      'put',
      lea,
      typed({ password: undefined, fromAddress: 'konten@nord.example.de' }),
    ).expect(200)

    expect((saved.body as InstanceMailServerState).server).toMatchObject({
      fromAddress: 'konten@nord.example.de',
      password: 'set',
    })
    expect((await kept())['mail_server_password']).toBe(before)
  })

  it('writes a new address into every tenant, and the same server saved again into none', async () => {
    const after = (await changesIn()).slice(-2)

    expect(after.map((row) => [row.from_before, row.from_after])).toEqual([
      ['instanz@nord.example.de', 'konten@nord.example.de'],
      ['instanz@nord.example.de', 'konten@nord.example.de'],
    ])

    const before = (await changesIn()).length

    await change(
      'put',
      lea,
      typed({ password: undefined, fromAddress: 'konten@nord.example.de' }),
    ).expect(200)

    expect(await changesIn()).toHaveLength(before)
  })

  it('sends the kept password to no other server and under no other login', async () => {
    const elsewhere = await fakeSmtpServer()

    try {
      for (const moved of [
        { host: 'localhost', port: elsewhere.port, password: undefined },
        { username: 'jemand-anders', password: undefined },
        // Kept without TLS, it goes nowhere else without TLS, not even to
        // another port of the same server (opengewerk-haustechnik#360).
        { host: '127.0.0.1', port: elsewhere.port, password: undefined },
      ]) {
        for (const path of ['/instance/mail-server', '/instance/mail-server/check'] as const) {
          const refused = path.endsWith('check')
            ? await send('post', path, lea, typed(moved)).expect(400)
            : await change('put', lea, typed(moved)).expect(400)

          expect(message(refused)).toContain(
            'Das gespeicherte Passwort geht nur an den Server und den Benutzernamen',
          )
        }
      }

      expect(elsewhere.received).toEqual([])
      expect((await state()).server).toMatchObject({ host: '127.0.0.1', username: 'instanz' })
    } finally {
      await elsewhere.close()
    }
  })

  it('refuses the same where the settings are saved without a route in front', async () => {
    for (const moved of [
      { host: 'localhost' },
      { username: 'jemand-anders' },
      { port: smtp.port + 1 },
    ]) {
      await expect(
        saveInstanceMailServer(database, 'somebody', key, {
          host: '127.0.0.1',
          port: smtp.port,
          security: 'none',
          username: 'instanz',
          fromAddress: 'konten@nord.example.de',
          ...moved,
        }),
      ).rejects.toThrow('Das gespeicherte Passwort geht nur an den Server und den Benutzernamen')
    }

    expect((await state()).server).toMatchObject({ host: '127.0.0.1', username: 'instanz' })
  })

  it('tries a connection without keeping it', async () => {
    const wrong = await send(
      'post',
      '/instance/mail-server/check',
      lea,
      typed({ password: 'falsch-geraten' }),
    ).expect(200)
    const right = await send('post', '/instance/mail-server/check', lea, typed()).expect(200)

    expect(wrong.body).toMatchObject({ outcome: 'refused' })
    expect(right.body).toEqual({ outcome: 'ready' })
    expect((await state()).server).toMatchObject({ fromAddress: 'konten@nord.example.de' })
  })

  it('holds the row to a mail server that is there whole or not at all', async () => {
    for (const half of [
      `update instance_settings set mail_server_port = null`,
      `update instance_settings set mail_server_from = null`,
      `update instance_settings set mail_server_username = null`,
      `update instance_settings set mail_server_password_set_at = null`,
      `update instance_settings set mail_server_port = 0`,
    ]) {
      await expect(admin.query(half)).rejects.toThrow(/instance_settings_mail_server_/)
    }
  })
})

describe('a mail to an account', () => {
  const otherwise = { id: 'user-1', email: 'mia@nord.example.de', name: 'Mia Mitglied' }

  it('goes out through the mail server of the instance, under the name of the application', async () => {
    const { passwordResetMail, passkeyNotice, recoveryCodesNotice, secondFactorNotice } =
      accountMails(database, mail, messages)
    const before = smtp.received.length

    await passwordResetMail(otherwise, 'einmal-und-nie-wieder')
    await passkeyNotice(otherwise, { id: 'passkey-1', name: 'Telefon' })
    await recoveryCodesNotice(otherwise)
    await secondFactorNotice(otherwise, 'app')

    const [reset, notice, codes, app] = smtp.received.slice(before)
    // A long line is folded on its way, with an equals sign at the fold.
    const unfolded = (data: string | undefined) => (data ?? '').replace(/=\r?\n/g, '')

    expect(reset?.from).toBe('konten@nord.example.de')
    expect(reset?.to).toEqual(['mia@nord.example.de'])
    expect(reset?.data).toContain('From: Probewerk <konten@nord.example.de>')
    expect(unfolded(reset?.data)).toContain(`${origin}/passwort/einmal-und-nie-wieder`)
    expect(notice?.to).toEqual(['mia@nord.example.de'])
    expect(unfolded(notice?.data)).toContain(`${origin}/konto`)
    // New recovery codes are told the same way (opengewerk-haustechnik#360).
    expect(codes?.to).toEqual(['mia@nord.example.de'])
    expect(codes?.data).toContain('Subject: Neue Wiederherstellungscodes')
    expect(unfolded(codes?.data)).toContain(`${origin}/konto`)
    // And the app set up on an account (N6 of the security audit).
    expect(app?.to).toEqual(['mia@nord.example.de'])
    expect(app?.data).toContain('Subject: Eine App als zweiter Faktor')
  })

  it('takes a passkey back with it where the mail server refuses the notice', async () => {
    const strict = await fakeSmtpServer({
      credentials: { user: 'instanz', password: mailPassword },
      refuse: ['mia@nord.example.de'],
    })

    try {
      await change('put', lea, typed({ host: '127.0.0.1', port: strict.port })).expect(200)

      const { passkeyNotice } = accountMails(database, mail, messages)

      await expect(passkeyNotice(otherwise, { id: 'passkey-2', name: 'Telefon' })).rejects.toThrow()
    } finally {
      await change('put', lea, typed()).expect(200)
      await strict.close()
    }
  })

  it('is not sent while the password of the mail server no longer opens', async () => {
    const afterANewSecret = SecretKey.from('n'.repeat(64))
    const { passwordResetMail, passkeyNotice } = accountMails(
      database,
      { ...mail, key: afterANewSecret },
      messages,
    )
    const before = smtp.received.length

    await passwordResetMail(otherwise, 'geht-nicht-hinaus')
    await passkeyNotice(otherwise, { id: 'passkey-3', name: 'Telefon' })

    expect(smtp.received.length).toBe(before)
    expect(await instanceMailConnection(database, afterANewSecret)).toEqual({ state: 'unreadable' })
    expect((await readInstanceMailServer(database, afterANewSecret))?.password).toBe('unreadable')
  })
})

describe('removing the mail server of the instance', () => {
  it('takes the login with it, and after it no mail goes to an account', async () => {
    await change('delete', lea).expect(200)

    expect(await state()).toEqual({ sends: true, server: null })
    expect(Object.values(await kept())).toEqual([null, null, null, null, null, null, null])

    const { passwordResetMail, passkeyNotice } = accountMails(database, mail, messages)
    const before = smtp.received.length

    await passwordResetMail({ id: 'user-1', email: 'mia@nord.example.de', name: 'Mia' }, 'nichts')
    await passkeyNotice(
      { id: 'user-1', email: 'mia@nord.example.de', name: 'Mia' },
      { id: 'passkey-4', name: 'Telefon' },
    )

    expect(smtp.received.length).toBe(before)
  })

  it('says so where there is none to remove', async () => {
    const refused = await change('delete', lea).expect(404)

    expect(message(refused)).toBe('Die Instanz hat keinen Mailserver, der sich entfernen ließe.')
  })
})

/**
 * Whoever leads a tenant hears of a change by mail, through the server of
 * before. On an instance of its own over the same database, the only one here
 * that is handed the words of the application: its mails go out after the
 * answer, and the tests above count the mails of the server in between.
 */
describe('whoever leads a tenant, told of a change of the mail server', () => {
  let told: ProbeInstance
  let other: FakeSmtpServer

  const leads = [lea.email, otto.email, sue.email]

  /** The mails a server got for whoever leads, in the order they came. */
  const toLeads = (server: FakeSmtpServer) =>
    server.received.filter((mail) => mail.to.some((to) => [...leads, mia.email].includes(to)))

  /**
   * Waits until a change has sent its mails, through whichever of the two
   * servers, and hands back what each of them got. A change tells everybody
   * who leads once, so it is over when as many have arrived in all.
   */
  async function toldOf(change: () => Promise<unknown>) {
    const before = { smtp: toLeads(smtp).length, other: toLeads(other).length }

    await change()
    await vi.waitFor(
      () => {
        expect(toLeads(smtp).length + toLeads(other).length).toBe(
          before.smtp + before.other + leads.length,
        )
      },
      { timeout: 10_000 },
    )

    return { smtp: toLeads(smtp).slice(before.smtp), other: toLeads(other).slice(before.other) }
  }

  function changeOn(method: 'put' | 'delete', body?: object) {
    return {
      async expect(status: number) {
        await visitors.reconfirm(lea.email, as(lea))

        return told
          .http()
          [method]('/instance/mail-server')
          .set('cookie', as(lea))
          .set('origin', origin)
          .send(body ?? {})
          .expect(status)
      },
    }
  }

  beforeAll(async () => {
    told = await probeInstance(foundation.kit.applicationDatabaseUrl(), {
      mail,
      accountMessages: messages,
    })
    other = await fakeSmtpServer({ credentials: { user: 'instanz', password: mailPassword } })
  })

  afterAll(async () => {
    await told.close()
    await other.close()
  })

  it('are told through the server of before, each once, and nothing through the new one', async () => {
    // The server of before, set up on the instance that tells nobody.
    await change('put', lea, typed()).expect(200)

    const got = await toldOf(() =>
      changeOn('put', typed({ port: other.port, fromAddress: 'neu@nord.example.de' })).expect(200),
    )

    expect(got.smtp.flatMap((mail) => mail.to).sort()).toEqual([...leads].sort())
    expect(new Set(got.smtp.map((mail) => mail.from))).toEqual(new Set(['instanz@nord.example.de']))
    expect(got.smtp[0]?.data).toContain('Subject: Ein neuer Mailserver der Instanz')
    expect(got.other).toEqual([])
  })

  it('are told of a removal through the server that goes, and every tenant keeps it', async () => {
    const got = await toldOf(() => changeOn('delete').expect(200))

    expect(got.other.flatMap((mail) => mail.to).sort()).toEqual([...leads].sort())
    expect(got.smtp).toEqual([])
    expect((await changesIn()).slice(-2)).toEqual([
      expect.objectContaining({
        host_before: '127.0.0.1',
        from_before: 'neu@nord.example.de',
        host_after: null,
        from_after: null,
      }),
      expect.objectContaining({
        host_before: '127.0.0.1',
        from_before: 'neu@nord.example.de',
        host_after: null,
        from_after: null,
      }),
    ])
  })
})

/**
 * Whoever is named to run the instance could change its mail server next, so
 * everybody who runs it learns of it by mail, and the one taken off learns of
 * that (opengewerk-haustechnik#360). Through the mail server of the instance
 * as it is.
 */
describe('everybody who runs the instance, told of a change among them', () => {
  let told: ProbeInstance
  let ottoId = ''

  /** The mails about the area of the instance, to whom, in the order they came. */
  const aboutTheArea = () =>
    smtp.received.filter((mail) => mail.data?.includes('Subject: Die Verwaltung der Instanz'))

  function confirmedOn(method: 'post' | 'put' | 'delete', path: string, body?: object) {
    return {
      async expect(status: number) {
        await visitors.reconfirm(lea.email, as(lea))

        return told
          .http()
          [method](path)
          .set('cookie', as(lea))
          .set('origin', origin)
          .send(body ?? {})
          .expect(status)
      },
    }
  }

  beforeAll(async () => {
    told = await probeInstance(foundation.kit.applicationDatabaseUrl(), {
      mail,
      accountMessages: messages,
    })
    await confirmedOn('put', '/instance/mail-server', typed()).expect(200)
  })

  afterAll(async () => {
    await told.close()
  })

  it('are told when somebody is named, the new one with them', async () => {
    const before = aboutTheArea().length

    const named = await confirmedOn('post', '/instance/operators', { email: otto.email }).expect(
      201,
    )

    ottoId = (named.body as { userId: string }).userId
    await vi.waitFor(() => {
      expect(aboutTheArea().length).toBe(before + 2)
    })

    const got = aboutTheArea().slice(before)

    expect(got.flatMap((mail) => mail.to).sort()).toEqual([lea.email, otto.email].sort())
    expect(got[0]?.data).toContain(`${otto.name} verwaltet jetzt mit`)
  })

  it('are told when somebody is taken off, and so is the one taken off', async () => {
    const before = aboutTheArea().length

    await confirmedOn('delete', `/instance/operators/${ottoId}`).expect(200)
    await vi.waitFor(() => {
      expect(aboutTheArea().length).toBe(before + 2)
    })

    const got = aboutTheArea().slice(before)

    expect(got.flatMap((mail) => mail.to).sort()).toEqual([lea.email, otto.email].sort())
    expect(got[0]?.data).toContain(`${otto.name} verwaltet nicht mehr`)
  })
})

/**
 * Last of the tests that ask a mail server: the allowance is one for
 * everybody who runs the instance, and it stays used up for ten minutes.
 */
describe('trying the mail server of the instance over and over', () => {
  it('is refused after thirty tries in ten minutes, saving included', async () => {
    let tries = 0
    let refused: { body: unknown } | null = null

    while (refused === null && tries < 40) {
      const answer = await send('post', '/instance/mail-server/check', lea, typed())

      if (answer.status === 429) {
        refused = answer
      } else {
        expect(answer.status).toBe(200)
        tries += 1
      }
    }

    expect(refused).not.toBeNull()
    expect(tries).toBeLessThanOrEqual(30)
    expect(message(refused ?? { body: {} })).toContain('In ein paar Minuten geht es wieder.')
    // Saving counts against the same allowance.
    await change('put', lea, typed()).expect(429)
  })
})

/**
 * Whoever leads a tenant takes the second factor of somebody who has lost it,
 * and the person learns of it by mail (N6 of the security audit), through the
 * mail server of the instance.
 */
describe('somebody whose second factor is taken away', () => {
  let told: ProbeInstance

  beforeAll(async () => {
    told = await probeInstance(foundation.kit.applicationDatabaseUrl(), {
      mail,
      accountMessages: messages,
    })
  })

  afterAll(async () => {
    await told.close()
  })

  it('is told by mail', async () => {
    const nina = { email: 'nina@nord.example.de', name: 'Nina Nord' }
    const { rows: tenants } = await admin.query<{ id: TenantId }>(
      `select tenant_id as id from memberships m join auth_users u on u.id = m.user_id
        where u.email = $1`,
      [lea.email],
    )
    const north = tenants[0]?.id as TenantId
    const { userId } = await addStaffMember(told.authentication, told.database, {
      ...nina,
      password,
      tenantId: north,
      roles: ['member'],
    })

    await visitors.setUpSecondFactor(nina.email)
    await visitors.reconfirm(lea.email, as(lea))
    await told
      .http()
      .put('/instance/mail-server')
      .set('cookie', as(lea))
      .set('origin', origin)
      .send(typed())
      .expect(200)
    await told.chooseTenant(as(lea), north)
    await told
      .http()
      .delete(`/staff/${userId}/second-factor`)
      .set('cookie', as(lea))
      .set('origin', origin)
      .expect(200)

    await vi.waitFor(
      () => {
        const toNina = smtp.received.filter((mail) => mail.to.includes(nina.email))

        expect(toNina).toHaveLength(1)
        expect(toNina[0]?.data).toContain('Subject: Der zweite Faktor ist weg')
      },
      { timeout: 10_000 },
    )
  })
})

describe('an instance that sends no mail', () => {
  it('says so, and keeps no mail server', async () => {
    const closed = new InstanceController(database, probeAccess, null, null)
    const somebody = { userId: 'user-1', sessionId: 'session-1' } as never

    expect(await closed.mailServer()).toEqual({ sends: false, server: null })
    await expect(closed.saveMailServer(somebody, typed())).rejects.toThrow(
      ServiceUnavailableException,
    )
    await expect(closed.tryTheMailServer(typed())).rejects.toThrow(ServiceUnavailableException)
  })
})
