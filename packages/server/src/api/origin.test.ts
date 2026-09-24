import { Test } from '@nestjs/testing'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { logoMediaTypes } from '@opengewerk/domain'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { Database } from '../database/database.js'
import { newId } from '../database/identifier.js'
import {
  allowApplicationLogin,
  applicationDatabaseUrl,
  applyMigrations,
  connect,
  resetSchema,
} from '../database/test-database.js'
import { ApiModule } from './api.module.js'
import { readJsonBodiesOnly, refusalOf } from './origin.js'
import { as, testIdentities } from './test-identity.js'
import { created } from './test-structure.js'

/**
 * The defence against a form on somebody else's page (GHSA-r7rq-234g-3jx8).
 * The session cookie is `SameSite=Lax`, and a page on another subdomain of the
 * same site still gets it sent along; what stands between that page and a
 * change here is the origin it has to name and the JSON it cannot send.
 */

const instance = 'https://opengewerk.example.de'
const foreign = 'https://werbung.example.de'

function changing(headers: Record<string, string>, method = 'POST') {
  return { method, headers }
}

describe('a request that changes something', () => {
  it('is refused from a page anywhere else, and from one that names no page at all', () => {
    for (const origin of [foreign, 'null', 'http://opengewerk.example.de']) {
      const refusal = refusalOf(
        changing({ origin, 'content-type': 'application/json', 'content-length': '2' }),
        [instance],
      )

      expect(refusal?.getStatus()).toBe(403)
    }
  })

  it('goes through from the address of the instance, and without an origin, as from curl', () => {
    const json = { 'content-type': 'application/json; charset=utf-8', 'content-length': '2' }

    expect(refusalOf(changing({ ...json, origin: instance }), [instance])).toBeNull()
    expect(refusalOf(changing(json), [instance])).toBeNull()
  })

  it('is refused as a form, in each of the three encodings HTML knows', () => {
    for (const type of [
      'application/x-www-form-urlencoded',
      'multipart/form-data; boundary=x',
      'text/plain',
    ]) {
      const refusal = refusalOf(changing({ 'content-type': type, 'content-length': '9' }), [
        instance,
      ])

      expect(refusal?.getStatus()).toBe(415)
    }
  })

  /**
   * A browser sends `text/plain` with a parameter from any page without asking
   * first, because only the essence decides whether it asks. A check that
   * looked for "application/json" anywhere in the header let this through.
   */
  it('is read by the essence of its type, so plain text cannot pass as JSON', () => {
    const refusal = refusalOf(
      changing({ 'content-type': 'text/plain; x=application/json', 'content-length': '2' }),
      [instance],
    )

    expect(refusal?.getStatus()).toBe(415)
  })

  it('is refused when it carries a body without saying what it is', () => {
    expect(refusalOf(changing({ 'content-length': '12' }), [instance])?.getStatus()).toBe(415)
    expect(refusalOf(changing({ 'transfer-encoding': 'chunked' }), [instance])?.getStatus()).toBe(
      415,
    )
  })

  it('goes through without a body and without a type, which no form can send', () => {
    expect(refusalOf(changing({}), [instance])).toBeNull()
    expect(refusalOf(changing({ origin: instance }, 'DELETE'), [instance])).toBeNull()
  })

  it('takes on the logo route the images it declares, and says so for anything else', () => {
    const logo = { mediaTypes: logoMediaTypes, refusal: 'Das Logo wird als Bild geschickt.' }

    expect(
      refusalOf(changing({ 'content-type': 'image/png', 'content-length': '8' }, 'PUT'), [], logo),
    ).toBeNull()

    const refusal = refusalOf(
      changing({ 'content-type': 'application/json', 'content-length': '2' }, 'PUT'),
      [],
      logo,
    )

    expect(refusal?.getStatus()).toBe(415)
    expect(refusal?.message).toBe('Das Logo wird als Bild geschickt.')
  })
})

describe('a request that reads', () => {
  it('is not asked where it comes from; a page elsewhere cannot read the answer', () => {
    expect(refusalOf({ method: 'GET', headers: { origin: foreign } }, [instance])).toBeNull()
    expect(refusalOf({ method: 'HEAD', headers: { origin: foreign } }, [instance])).toBeNull()
  })
})

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
    await resetSchema(admin)
    await applyMigrations()
    await allowApplicationLogin(admin)
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
