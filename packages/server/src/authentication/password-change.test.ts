import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import type { TenantId } from '@opengewerk/domain'
import {
  accountMails,
  type Authentication,
  authenticationPath,
  Database,
  newId,
  type OutgoingMail,
} from '@opengewerk/platform-server'
import { toNodeHandler } from 'better-auth/node'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  aMailServer,
  anInstanceMailServer,
  noInstanceMailServer,
  testKey,
} from '@opengewerk/platform-server/testing'

import { ApiModule } from '../api/api.module.js'
import {
  applicationDatabaseUrl,
  connect,
  resetToMigrated,
  shipRoles,
} from '../database/test-database.js'
import { accountMessages } from '../mail/account-messages.js'
import { addStaffMember, createAuthentication, SessionIdentitySource } from './access.js'

/**
 * The mail with the link to a new password (#126), which is what this
 * application adds to the foundation's part: changing a password, the link
 * and the way back on the command line are tested there (ADR 0010), and so
 * is through which server the link goes: the mail server of the instance,
 * and the one of no business (opengewerk-haustechnik#81). Held here is the
 * binding, the words of this application, and that a business which sends
 * mail of its own has no part in it.
 */

const north = { id: newId<'tenant'>(), name: 'Elektro Nord GmbH' }
const quiet = { id: newId<'tenant'>(), name: 'Elektro Still GmbH' }
const origin = 'https://opengewerk.example.de'
const first = 'das-erste-lange-passwort'

let admin: Pool
let database: Database
let app: INestApplication
let authentication: Authentication

/** Every message the mail servers of this file were handed. */
const sent: OutgoingMail[] = []

/** The mail of this application, through a mail server that keeps what it is given. */
function sender() {
  return accountMails(
    database,
    {
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
    },
    accountMessages,
  ).passwordResetMail
}

async function person(email: string, tenantId = north.id): Promise<string> {
  const { userId } = await addStaffMember(authentication, database, {
    email,
    name: 'Paula Passwort',
    password: first,
    tenantId: tenantId as TenantId,
    roles: ['office'],
  })

  return userId
}

beforeAll(async () => {
  admin = await connect()
  await resetToMigrated()
  // One business, which sends mail of its own; the second comes with the
  // last test. Neither has a part in a mail to an account.
  await admin.query('insert into tenants (id, name) values ($1, $2)', [north.id, north.name])
  await shipRoles(admin, north.id)

  database = Database.connect(applicationDatabaseUrl())
  authentication = createAuthentication({
    database,
    secret: 'w'.repeat(64),
    trustedOrigins: [origin],
    rateLimited: false,
    passwordResetMail: sender(),
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

  await aMailServer(admin, north.id, { from: 'buero@nord.example.de' })
  await anInstanceMailServer(admin, 'konten@opengewerk.example.de')
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
})

describe('the mail with the link', () => {
  it('goes out through the mail server of the instance, under the name of this application', async () => {
    const userId = await person('mail@nord.example.de')
    const before = sent.length

    await sender()({ id: userId, email: 'mail@nord.example.de', name: 'Paula Passwort' }, 'geheim')

    expect(sent.slice(before)).toHaveLength(1)
    // Not from the business the account works in, though it sends mail.
    expect(sent.at(-1)?.from).toEqual({
      name: 'OpenGewerk',
      address: 'konten@opengewerk.example.de',
    })
    expect(sent.at(-1)?.text).toContain(`${origin}/passwort/geheim`)
    expect(sent.at(-1)?.text).toContain('eine Stunde')
    expect(sent.at(-1)?.text).not.toContain(north.name)
  })

  it('does not go out while the instance has no mail server, though the business of the account sends mail', async () => {
    const userId = await person('still@nord.example.de')
    const before = sent.length

    await noInstanceMailServer(admin)

    try {
      await sender()({ id: userId, email: 'still@nord.example.de', name: '' }, 'geheim')

      expect(sent.slice(before)).toEqual([])
    } finally {
      await anInstanceMailServer(admin, 'konten@opengewerk.example.de')
    }
  })

  /**
   * The two are bound: asking the foundation's route for a link sends the mail
   * of this application, with a link that sets a new password.
   */
  it('is sent when somebody asks for a link, and the link in it works', async () => {
    await person('vergessen@nord.example.de')

    const before = sent.length

    await request(app.getHttpServer())
      .post(`${authenticationPath}/request-password-reset`)
      .set('origin', origin)
      .send({ email: 'vergessen@nord.example.de' })
      .expect(200)

    // The route does not wait for the mail.
    await vi.waitFor(() => {
      expect(sent.length).toBe(before + 1)
    })

    const mail = sent.at(-1)

    expect(mail?.to).toEqual({ name: 'Paula Passwort', address: 'vergessen@nord.example.de' })

    const token = /\/passwort\/([^\s]+)/.exec(mail?.text ?? '')?.[1] ?? ''

    await request(app.getHttpServer())
      .post(`${authenticationPath}/reset-password`)
      .set('origin', origin)
      .send({ token, newPassword: 'das-zweite-lange-passwort' })
      .expect(200)

    await request(app.getHttpServer())
      .post(`${authenticationPath}/sign-in/email`)
      .set('origin', origin)
      .send({ email: 'vergessen@nord.example.de', password: 'das-zweite-lange-passwort' })
      .expect(200)
  })

  /**
   * With a second business, its lead could take the account into it and set
   * up a mail server of their own (opengewerk-haustechnik#31). The link goes
   * through neither of them: it has the mail server of the instance, on an
   * instance with one business and with several. Last in this file, because
   * it leaves the second business behind.
   */
  it('goes out through the mail server of the instance on an instance with a second business as well', async () => {
    const userId = await person('zweiter@nord.example.de')

    await admin.query('insert into tenants (id, name) values ($1, $2)', [quiet.id, quiet.name])
    await shipRoles(admin, quiet.id)
    await aMailServer(admin, quiet.id, { from: 'buero@still.example.de' })

    const before = sent.length

    await sender()({ id: userId, email: 'zweiter@nord.example.de', name: '' }, 'geheim')

    expect(sent.slice(before).map((mail) => mail.from.address)).toEqual([
      'konten@opengewerk.example.de',
    ])
  })
})
