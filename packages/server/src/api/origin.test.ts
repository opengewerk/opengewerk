import { Test } from '@nestjs/testing'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { Database, newId, readJsonBodiesOnly } from '@opengewerk/platform-server'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { applicationDatabaseUrl, connect, resetToMigrated } from '../database/test-database.js'
import { ApiModule } from './api.module.js'
import { as, testIdentities } from './test-identity.js'
import { created } from './test-structure.js'

/**
 * The defence against a form on somebody else's page (GHSA-r7rq-234g-3jx8),
 * in front of the routes of this application. The check itself is the
 * foundation's and is tested there; here it is that every route stands behind
 * it, the ones with a body of their own included.
 */

const instance = 'https://opengewerk.example.de'
const foreign = 'https://werbung.example.de'

describe('the routes of the application', () => {
  const north = newId<'tenant'>()

  let admin: Pool
  let database: Database
  let app: NestExpressApplication

  function http() {
    return request(app.getHttpServer())
  }

  async function customers(): Promise<number> {
    const { rows } = await admin.query<{ count: string }>('select count(*) from customers')

    return Number(rows[0]?.count)
  }

  beforeAll(async () => {
    admin = await connect()
    await resetToMigrated()
    await admin.query('insert into tenants (id, name) values ($1, $2)', [north, 'Elektro Nord'])

    database = Database.connect(applicationDatabaseUrl())

    const built = await Test.createTestingModule({
      imports: [ApiModule.create(database, testIdentities, { trustedOrigins: [instance] })],
    }).compile()

    // Read the way an instance reads, with the parsers of `main.ts` and not
    // with the ones Nest brings, so that a limit of the parser is the real one.
    app = built.createNestApplication<NestExpressApplication>({ bodyParser: false })
    readJsonBodiesOnly(app)
    await app.init()
  })

  afterAll(async () => {
    await app.close()
    await database.close()
    await admin.end()
  })

  it('refuse a change from a foreign page, although the session in it is valid', async () => {
    const refused = await http()
      .post('/customers')
      .set('x-test-identity', as(north, 'office'))
      .set('origin', foreign)
      .send({ kind: 'private', name: 'Familie Berg' })
      .expect(403)

    expect((refused.body as { message: string }).message).toContain('fremden Adresse')
    expect(await customers()).toBe(0)
  })

  it('refuse a foreign page before asking who is calling', async () => {
    await http()
      .post('/customers')
      .set('origin', foreign)
      .send({ kind: 'private', name: 'Familie Berg' })
      .expect(403)
  })

  it('refuse a form, which is all a foreign page can send without asking', async () => {
    const refused = await http()
      .post('/customers')
      .set('x-test-identity', as(north, 'office'))
      .type('form')
      .send({ kind: 'private', name: 'Familie Berg' })
      .expect(415)

    expect((refused.body as { message: string }).message).toContain('JSON')
    expect(await customers()).toBe(0)
  })

  it('answer a body on the logo route that is no image with the sentence for the logo', async () => {
    const refused = await http()
      .put('/settings/letterhead/logo')
      .set('x-test-identity', as(north, 'owner'))
      .send({ logo: 'ein Bild' })
      .expect(415)

    expect((refused.body as { message: string }).message).toContain('PNG oder JPEG')
  })

  it('take JSON from the address of the instance', async () => {
    await http()
      .post('/customers')
      .set('x-test-identity', as(north, 'office'))
      .set('origin', instance)
      .send({ kind: 'private', name: 'Familie Berg' })
      .expect(201)

    expect(await customers()).toBe(1)
  })

  /**
   * A day's work from a cellar (#202). Six hundred new customers stand in for
   * it: well over the 100 kB every route reads, and a transmission the outbox
   * really sends, not a body made up for the parser.
   */
  it('take an outbox well over 100 kB in one transmission', async () => {
    const operations = Array.from({ length: 600 }, (_, index) =>
      created('customers', newId<'customer'>(), {
        kind: 'private',
        name: `Familie Nummer ${String(index + 1)} aus dem Keller`,
      }),
    )
    const body = { deviceId: 'geraet-im-keller', operations }

    expect(JSON.stringify(body).length).toBeGreaterThan(100 * 1024)

    await http().post('/sync').set('x-test-identity', as(north, 'office')).send(body).expect(201)

    expect(await customers()).toBe(601)
  })

  it('read no more than 100 kB at any other route', async () => {
    await http()
      .post('/customers')
      .set('x-test-identity', as(north, 'office'))
      .send({ kind: 'private', name: 'Familie Berg', notes: 'x'.repeat(200 * 1024) })
      .expect(413)
  })
})
