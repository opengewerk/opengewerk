import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import type { TenantId } from '@opengewerk/domain'
import { toNodeHandler } from 'better-auth/node'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { ApiModule } from '../api/api.module.js'
import { Database } from '../database/database.js'
import { newId } from '../database/identifier.js'
import {
  allowApplicationLogin,
  applicationDatabaseUrl,
  applyMigrations,
  connect,
  resetSchema,
} from '../database/test-database.js'
import { passwordResetMails, type ResetRequester } from '../mail/password-reset.js'
import { aMailServer, testKey } from '../mail/test-mail-server.js'
import type { OutgoingMail } from '../mail/transport.js'
import { authenticationPath, createAuthentication } from './authentication.js'
import { SessionIdentitySource } from './session-identity.js'
import { accountExists, addStaffMember, replacePassword } from './staff.js'

/**
 * A password somebody can change, get back through a link in a mail, and, as
 * the way back without a mail, have replaced on the command line (#126).
 * Before, none of the three existed: a generated password stayed valid for
 * good, and a forgotten one meant SQL on the server.
 */

const north = { id: newId<'tenant'>(), name: 'Elektro Nord GmbH' }
const quiet = { id: newId<'tenant'>(), name: 'Elektro Still GmbH' }
const origin = 'https://opengewerk.example.de'
const first = 'das-erste-lange-passwort'
const second = 'das-zweite-lange-passwort'

let admin: Pool
let database: Database
let app: INestApplication
let authentication: ReturnType<typeof createAuthentication>

/** What the mail with the link got, for the tests that follow the link. */
const links: { requester: ResetRequester; token: string }[] = []

function http() {
  return request(app.getHttpServer())
}

async function signIn(email: string, password: string): Promise<string> {
  const answer = await http()
    .post(`${authenticationPath}/sign-in/email`)
    .set('origin', origin)
    .send({ email, password })

  if (answer.status !== 200) {
    return ''
  }

  const raw = answer.headers['set-cookie']
  const cookies = Array.isArray(raw) ? raw : [String(raw)]

  return cookies.map((cookie) => cookie.split(';')[0]).join('; ')
}

async function person(email: string, tenantId = north.id): Promise<void> {
  await addStaffMember(authentication, database, {
    email,
    name: 'Paula Passwort',
    password: first,
    tenantId: tenantId as TenantId,
    roles: ['office'],
  })
}

beforeAll(async () => {
  admin = await connect()
  await resetSchema(admin)
  await applyMigrations()
  await allowApplicationLogin(admin)
  await admin.query('insert into tenants (id, name) values ($1, $2), ($3, $4)', [
    north.id,
    north.name,
    quiet.id,
    quiet.name,
  ])

  database = Database.connect(applicationDatabaseUrl())
  authentication = createAuthentication({
    database,
    secret: 'w'.repeat(64),
    trustedOrigins: [origin],
    rateLimited: false,
    passwordResetMail: (requester, token) => {
      links.push({ requester, token })

      return Promise.resolve()
    },
  })

  const built = await Test.createTestingModule({
    imports: [
      ApiModule.create(database, new SessionIdentitySource(authentication, database), {
        trustedOrigins: [origin],
      }),
    ],
  }).compile()

  app = built.createNestApplication()
  app.use(authenticationPath, toNodeHandler(authentication))
  await app.init()
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
})

describe('changing a password', () => {
  it('takes the old one as confirmation, and signs every other device out', async () => {
    await person('wechsel@nord.example.de')

    const here = await signIn('wechsel@nord.example.de', first)
    const elsewhere = await signIn('wechsel@nord.example.de', first)

    await http()
      .post(`${authenticationPath}/change-password`)
      .set('cookie', here)
      .set('origin', origin)
      .send({ currentPassword: first, newPassword: second, revokeOtherSessions: true })
      .expect(200)

    await http().get('/auth/tenants').set('cookie', elsewhere).expect(401)
    expect(await signIn('wechsel@nord.example.de', first)).toBe('')
    expect(await signIn('wechsel@nord.example.de', second)).not.toBe('')
  })

  it('refuses a new password shorter than twelve characters, as everywhere else', async () => {
    await person('kurz@nord.example.de')

    const here = await signIn('kurz@nord.example.de', first)
    const refused = await http()
      .post(`${authenticationPath}/change-password`)
      .set('cookie', here)
      .set('origin', origin)
      .send({ currentPassword: first, newPassword: 'zu-kurz', revokeOtherSessions: true })

    expect(refused.status).toBe(400)
  })

  it('refuses without the old password', async () => {
    await person('ohne@nord.example.de')

    const here = await signIn('ohne@nord.example.de', first)
    const refused = await http()
      .post(`${authenticationPath}/change-password`)
      .set('cookie', here)
      .set('origin', origin)
      .send({ currentPassword: 'geraten-und-falsch', newPassword: second })

    expect(refused.status).toBeGreaterThanOrEqual(400)
    expect(await signIn('ohne@nord.example.de', first)).not.toBe('')
  })
})

describe('a link to a new password', () => {
  /** Asks for a link and waits for the mail, which the route does not await. */
  async function askFor(email: string): Promise<number> {
    const before = links.length
    const answer = await http()
      .post(`${authenticationPath}/request-password-reset`)
      .set('origin', origin)
      .send({ email })

    await vi.waitFor(() => {
      expect(links.length).toBeGreaterThanOrEqual(before)
    })

    return answer.status
  }

  it('is sent for an account, and answered the same for an address without one', async () => {
    await person('vergessen@nord.example.de')

    const before = links.length

    expect(await askFor('niemand@nord.example.de')).toBe(200)
    expect(links.length).toBe(before)

    expect(await askFor('vergessen@nord.example.de')).toBe(200)
    await vi.waitFor(() => {
      expect(links.at(-1)?.requester.email).toBe('vergessen@nord.example.de')
    })
  })

  it('sets a new password once, and ends every session that was open', async () => {
    await person('link@nord.example.de')

    const open = await signIn('link@nord.example.de', first)

    await askFor('link@nord.example.de')
    await vi.waitFor(() => {
      expect(links.at(-1)?.requester.email).toBe('link@nord.example.de')
    })

    const token = links.at(-1)?.token ?? ''

    await http()
      .post(`${authenticationPath}/reset-password`)
      .set('origin', origin)
      .send({ token, newPassword: second })
      .expect(200)

    await http().get('/auth/tenants').set('cookie', open).expect(401)
    expect(await signIn('link@nord.example.de', second)).not.toBe('')

    const again = await http()
      .post(`${authenticationPath}/reset-password`)
      .set('origin', origin)
      .send({ token, newPassword: 'noch-ein-anderes-passwort' })

    expect(again.status).toBeGreaterThanOrEqual(400)
  })
})

describe('the mail with the link', () => {
  function sender() {
    const sent: OutgoingMail[] = []
    const send = passwordResetMails(database, {
      origin,
      key: testKey,
      connect: () => ({
        send: (mail) => {
          sent.push(mail)

          return Promise.resolve()
        },
        verify: () => Promise.resolve(),
        close: () => undefined,
      }),
    })

    return { sent, send }
  }

  it('goes out through the mail server of a business the account works in', async () => {
    await aMailServer(admin, north.id, { from: 'buero@nord.example.de' })
    await person('mail@nord.example.de')

    const [row] = (
      await admin.query<{ id: string }>(
        "select id from auth_users where email = 'mail@nord.example.de'",
      )
    ).rows
    const { sent, send } = sender()

    await send(
      { id: row?.id ?? '', email: 'mail@nord.example.de', name: 'Paula Passwort' },
      'geheim',
    )

    expect(sent).toHaveLength(1)
    expect(sent[0]?.from).toEqual({ name: north.name, address: 'buero@nord.example.de' })
    expect(sent[0]?.text).toContain(`${origin}/passwort/geheim`)
    expect(sent[0]?.text).toContain('eine Stunde')
  })

  it('does not go out for an account whose business sends no mail', async () => {
    await person('still@still.example.de', quiet.id)

    const [row] = (
      await admin.query<{ id: string }>(
        "select id from auth_users where email = 'still@still.example.de'",
      )
    ).rows
    const { sent, send } = sender()

    await send({ id: row?.id ?? '', email: 'still@still.example.de', name: '' }, 'geheim')

    expect(sent).toEqual([])
  })
})

describe('the way back on the command line', () => {
  it('replaces the password, ends every session, and says when there is no such account', async () => {
    await person('konsole@nord.example.de')

    // Asked before the question for the new password.
    expect(await accountExists(database, ' Konsole@nord.example.de ')).toBe(true)
    expect(await accountExists(database, 'gibt-es-nicht@nord.example.de')).toBe(false)

    const open = await signIn('konsole@nord.example.de', first)

    expect(
      await replacePassword(authentication, database, {
        email: 'Konsole@nord.example.de',
        password: second,
      }),
    ).toBe(true)
    await http().get('/auth/tenants').set('cookie', open).expect(401)
    expect(await signIn('konsole@nord.example.de', second)).not.toBe('')
    expect(
      await replacePassword(authentication, database, {
        email: 'gibt-es-nicht@nord.example.de',
        password: second,
      }),
    ).toBe(false)
  })
})
