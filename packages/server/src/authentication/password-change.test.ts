import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import type { TenantId } from '@opengewerk/domain'
import {
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
import { aMailServer, testKey } from '@opengewerk/platform-server/testing'

import { ApiModule } from '../api/api.module.js'
import {
  allowApplicationLogin,
  applicationDatabaseUrl,
  applyMigrations,
  connect,
  resetSchema,
  shipRoles,
} from '../database/test-database.js'
import { passwordResetMails } from '../mail/password-reset.js'
import { addStaffMember, createAuthentication, SessionIdentitySource } from './access.js'

/**
 * The mail with the link to a new password (#126), which is what this
 * application adds to the foundation's part: changing a password, the link
 * and the way back on the command line are tested there (ADR 0010). An
 * account belongs to the instance and every mail server to a business, so
 * which server the link goes through is this application's to decide.
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
  return passwordResetMails(database, {
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
  await resetSchema(admin)
  await applyMigrations()
  await allowApplicationLogin(admin)
  await admin.query('insert into tenants (id, name) values ($1, $2), ($3, $4)', [
    north.id,
    north.name,
    quiet.id,
    quiet.name,
  ])
  await shipRoles(admin, north.id, quiet.id)

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
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
})

describe('the mail with the link', () => {
  it('goes out through the mail server of a business the account works in', async () => {
    const userId = await person('mail@nord.example.de')
    const before = sent.length

    await sender()({ id: userId, email: 'mail@nord.example.de', name: 'Paula Passwort' }, 'geheim')

    expect(sent.slice(before)).toHaveLength(1)
    expect(sent.at(-1)?.from).toEqual({ name: north.name, address: 'buero@nord.example.de' })
    expect(sent.at(-1)?.text).toContain(`${origin}/passwort/geheim`)
    expect(sent.at(-1)?.text).toContain('eine Stunde')
  })

  it('does not go out for an account whose business sends no mail', async () => {
    const userId = await person('still@still.example.de', quiet.id)
    const before = sent.length

    await sender()({ id: userId, email: 'still@still.example.de', name: '' }, 'geheim')

    expect(sent.slice(before)).toEqual([])
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
})
