import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { permissions } from '@opengewerk/domain'
import {
  type Authentication,
  authenticationPath,
  Database,
  instanceIsEmpty,
} from '@opengewerk/platform-server'
import { currentCode } from '@opengewerk/platform-server/testing'
import { toNodeHandler } from 'better-auth/node'
import { eq } from 'drizzle-orm'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  createAuthentication,
  SessionIdentitySource,
  setUpInstance,
} from '../authentication/access.js'
import { authUsers, instanceOperators } from '../database/schema/index.js'
import {
  allowApplicationLogin,
  applicationDatabaseUrl,
  applyMigrations,
  connect,
  resetSchema,
} from '../database/test-database.js'
import { ApiModule } from './api.module.js'

/**
 * The first run of an instance of this application, through HTTP: somebody
 * opens a freshly started installation in a browser and has to get from
 * nothing to a signed in owner.
 *
 * The first run itself is the foundation's (ADR 0010) and is tested there:
 * the setup code, the lock against two at once, the refusals. What is held
 * here is what this application tells it: the first account is an owner, it
 * also runs the instance, the name of a business follows the rule of the
 * settings, and the app on a phone lists the account under OpenGewerk.
 */

const origin = 'https://opengewerk.example.de'
const password = 'ein-ordentlich-langes-passwort'

/** The code of this instance, as `setup.sh` would have written it into the .env (#215). */
const setupCode = 'K7Q4-9PXM'

const firstRun = {
  company: 'Elektro Neubeginn GmbH',
  name: 'Olga Beispiel',
  email: 'chefin@neubeginn.example.de',
  password,
}

/** What the setup screen sends: the code first, then the business and the account. */
const firstRequest = { setupCode, ...firstRun }

let admin: Pool
let database: Database
let authentication: Authentication
let app: INestApplication

function http() {
  return request(app.getHttpServer())
}

/** Back to the state a freshly started installation is in. */
async function emptyInstance(): Promise<void> {
  await resetSchema(admin)
  await applyMigrations()
  await allowApplicationLogin(admin)
}

/** The cookies an answer set, the way a browser would keep them. */
function cookiesOf(answer: { headers: Record<string, unknown> }): string {
  const raw = answer.headers['set-cookie']
  const list = Array.isArray(raw) ? (raw as string[]) : typeof raw === 'string' ? [raw] : []

  return list.map((cookie) => cookie.split(';')[0]).join('; ')
}

/** Who runs the instance, by the address of their account. */
async function operators(): Promise<string[]> {
  const rows = await database.forInstance((tx) =>
    tx
      .select({ email: authUsers.email })
      .from(instanceOperators)
      .innerJoin(authUsers, eq(authUsers.id, instanceOperators.userId)),
  )

  return rows.map((row) => row.email)
}

beforeAll(async () => {
  admin = await connect()
  await emptyInstance()

  database = Database.connect(applicationDatabaseUrl())
  authentication = createAuthentication({
    database,
    secret: 'z'.repeat(64),
    trustedOrigins: [origin],
    // Off, because nothing here is about the limits and every request comes
    // from the same address.
    rateLimited: false,
  })

  const built = await Test.createTestingModule({
    imports: [
      ApiModule.create(database, new SessionIdentitySource(authentication, database), {
        authentication,
        setupCode,
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

describe('an instance nobody has used yet', () => {
  /**
   * The point of the whole issue, in one test: from nothing to a session, with
   * no psql and no command line anywhere in it.
   */
  it('takes somebody from nothing to a signed in owner', async () => {
    await emptyInstance()

    expect((await http().get('/setup').expect(200)).body).toEqual({ needed: true })

    const created = await http().post('/setup').set('origin', origin).send(firstRequest).expect(201)
    const tenantId = created.body.tenantId as string

    expect((await http().get('/setup').expect(200)).body).toEqual({ needed: false })

    const answer = await http()
      .post(`${authenticationPath}/sign-in/email`)
      .set('origin', origin)
      .send({ email: firstRun.email, password })
      .expect(200)

    const choices = await http().get('/auth/tenants').set('cookie', cookiesOf(answer)).expect(200)

    // The owner, with what the role adds up to in the rows the first run
    // wrote: every right there is, and the second factor it asks for.
    expect(choices.body).toEqual([
      {
        id: tenantId,
        name: firstRun.company,
        roles: ['owner'],
        roleLabels: ['Inhaber'],
        rights: permissions,
        secondFactor: true,
      },
    ])
  })

  /**
   * The area of the instance (#188) is shut to everybody but its operators,
   * and somebody has to be the first. The one who set the instance up is the
   * one who runs it, in the same transaction, so there is no moment with an
   * instance and nobody to run it.
   */
  it('makes the account of the first run the first operator of the instance', async () => {
    await emptyInstance()

    await http().post('/setup').set('origin', origin).send(firstRequest).expect(201)

    expect(await operators()).toEqual([firstRun.email])
  })

  /**
   * Two people opening the screen at the same moment end up with one
   * business, and with one operator: the account of the run that lost is gone
   * with everything it was about to become.
   */
  it('ends up with one business and one operator when two first runs start at once', async () => {
    await emptyInstance()

    const results = await Promise.allSettled([
      setUpInstance(authentication, database, firstRun),
      setUpInstance(authentication, database, {
        ...firstRun,
        company: 'Elektro Zweitversuch GmbH',
        email: 'zweite@neubeginn.example.de',
      }),
    ])

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(await operators()).toHaveLength(1)
    expect(await instanceIsEmpty(database)).toBe(false)
  })

  it('turns down a name for the business that the settings would refuse as well (#276)', async () => {
    await emptyInstance()

    const refused = await http()
      .post('/setup')
      .set('origin', origin)
      .send({ ...firstRequest, company: 'x'.repeat(121) })
      .expect(400)

    expect(refused.body.message).toContain('länger als 120 Zeichen')
    expect(await instanceIsEmpty(database)).toBe(true)
  })

  /**
   * An .env from before #215, or one filled in by hand without the line: the
   * module of this application hands the missing code on as missing, and the
   * first run is refused rather than taken from anybody.
   */
  it('refuses every first run on an instance without a code', async () => {
    await emptyInstance()

    const built = await Test.createTestingModule({
      imports: [
        ApiModule.create(database, new SessionIdentitySource(authentication, database), {
          authentication,
          trustedOrigins: [origin],
        }),
      ],
    }).compile()
    const withoutCode = built.createNestApplication()
    await withoutCode.init()

    try {
      const refused = await request(withoutCode.getHttpServer())
        .post('/setup')
        .set('origin', origin)
        .send(firstRequest)
        .expect(503)

      expect(refused.body.message).toContain('keinen Einrichtungscode')
      expect(await instanceIsEmpty(database)).toBe(true)
    } finally {
      await withoutCode.close()
    }
  })
})

describe('the second factor an owner cannot work without', () => {
  /**
   * The dead end from #62, and the way through it, end to end.
   *
   * ADR 0006 makes a second factor compulsory for the owner and checks it on
   * every request. The only account a new instance can have is an owner, so
   * until there was a screen for it the instance was unusable by the one
   * person who had an account on it. This is that screen's flow: set the
   * factor up before choosing a business, then choose one and work.
   */
  it('is set up before the business is chosen, and the owner then gets in', async () => {
    await emptyInstance()

    const created = await http().post('/setup').set('origin', origin).send(firstRequest).expect(201)
    const tenantId = created.body.tenantId as string

    const signedIn = await http()
      .post(`${authenticationPath}/sign-in/email`)
      .set('origin', origin)
      .send({ email: firstRun.email, password })
      .expect(200)

    const cookies = cookiesOf(signedIn)

    // Without the factor, the owner is stopped in front of the data.
    await http()
      .post('/auth/tenant')
      .set('cookie', cookies)
      .set('origin', origin)
      .send({ tenantId })
      .expect(201)
    await http().get('/customers').set('cookie', cookies).expect(403)

    const started = await http()
      .post(`${authenticationPath}/two-factor/enable`)
      .set('cookie', cookies)
      .set('origin', origin)
      .send({ password, method: 'totp' })
      .expect(200)

    // What the app on a phone lists the account under: this application.
    expect(started.body.totpURI).toContain('otpauth://totp/')
    expect(decodeURIComponent(started.body.totpURI as string)).toContain('OpenGewerk')

    const verified = await http()
      .post(`${authenticationPath}/two-factor/verify-totp`)
      .set('cookie', cookies)
      .set('origin', origin)
      .send({ code: await currentCode(started.body.totpURI as string) })
      .expect(200)

    // better-auth replaces the session the first time a factor is confirmed,
    // so from here on the new cookie is the one that counts.
    const now = cookiesOf(verified) || cookies

    // The request that was refused before the factor existed.
    await http().get('/customers').set('cookie', now).expect(200)
  })
})
