import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { type IsoDate, shippedRules, vatOn } from '@opengewerk/domain'
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
import { as, testIdentities as identities } from './test-identity.js'

/**
 * What a business sets for itself, and the line between that and what the law
 * sets for everybody.
 */

const north = { id: newId<'tenant'>(), name: 'Elektro Nord GmbH' }

let admin: Pool
let database: Database
let app: INestApplication

const owner = () => as(north.id, 'owner')
const office = () => as(north.id, 'office')

function http() {
  return request(app.getHttpServer())
}

beforeAll(async () => {
  admin = await connect()
  await resetSchema(admin)
  await applyMigrations()
  await allowApplicationLogin(admin)
  await admin.query('insert into tenants (id, name) values ($1, $2)', [north.id, north.name])

  database = Database.connect(applicationDatabaseUrl())

  const built = await Test.createTestingModule({
    imports: [ApiModule.create(database, identities)],
  }).compile()

  app = built.createNestApplication()
  await app.init()
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
})

describe('a setting a business makes', () => {
  it('is superseded from a date, not overwritten', async () => {
    await http()
      .post('/settings/parameters')
      .set('x-test-identity', owner())
      .send({ key: 'small_business.claimed', from: '2024-01-01', value: 1 })
      .expect(201)

    await http()
      .post('/settings/parameters')
      .set('x-test-identity', owner())
      .send({
        key: 'small_business.claimed',
        from: '2026-01-01',
        value: 0,
        note: 'Grenze gerissen',
      })
      .expect(201)

    // What applied in 2025 still applies to 2025. An invoice from then was
    // written by a business that claimed the rule, and no later decision
    // changes that.
    const then = await http()
      .get('/settings/parameters/on?key=small_business.claimed&date=2025-06-01')
      .set('x-test-identity', office())
      .expect(200)
    expect(then.body.parameter.value).toBe(1)

    const now = await http()
      .get('/settings/parameters/on?key=small_business.claimed&date=2026-06-01')
      .set('x-test-identity', office())
      .expect(200)
    expect(now.body.parameter.value).toBe(0)

    // And the old period is still there, closed rather than gone.
    const history = await http()
      .get('/settings/parameters')
      .set('x-test-identity', office())
      .expect(200)
    const periods = (
      history.body as { key: string; validFrom: string; validUntil: string }[]
    ).filter((entry) => entry.key === 'small_business.claimed')
    expect(periods).toHaveLength(2)
    expect(periods.some((entry) => entry.validUntil === '2025-12-31')).toBe(true)
  })

  it('only ever moves forward', async () => {
    // A period slipped in behind an existing one would leave two of them over
    // the same day, and the answer to "what applied then" would depend on
    // which row came back first.
    const refused = await http()
      .post('/settings/parameters')
      .set('x-test-identity', owner())
      .send({ key: 'small_business.claimed', from: '2025-01-01', value: 1 })
      .expect(400)

    expect(refused.body.message).toMatch(/nur später/)
  })

  it('refuses the same day twice, with a sentence rather than a constraint', () => {
    // The boundary, and it matters more than it looks: the unique index would
    // catch it too, but as a database error nobody can act on. Two periods
    // starting on the same day is a question without an answer, and saying so
    // is part of the answer.
    return http()
      .post('/settings/parameters')
      .set('x-test-identity', owner())
      .send({ key: 'small_business.claimed', from: '2026-01-01', value: 1 })
      .expect(400)
      .expect((answer) => {
        expect(answer.body.message).toMatch(/bereits ein Wert ab 2026-01-01/)
      })
  })

  it('cannot be a legal parameter, because the key will not take one', async () => {
    // The seam between the two. There is no row a business could write that
    // moves a threshold: the keys are an enum of settings, and no rule key is
    // among them.
    await http()
      .post('/settings/parameters')
      .set('x-test-identity', owner())
      .send({ key: 'vat.standard', from: '2026-01-01', value: 500 })
      .expect(400)

    // And the rate is unchanged by the attempt.
    expect(
      vatOn(shippedRules, { netCents: 10_000, rate: 'standard' }, '2026-01-01' as IsoDate)
        .basisPoints,
    ).toBe(1900)
  })

  it('is read by the office and set by the owner', async () => {
    await http().get('/settings/parameters').set('x-test-identity', office()).expect(200)

    await http()
      .post('/settings/parameters')
      .set('x-test-identity', office())
      .send({ key: 'invoice.payment_term_days', from: '2026-01-01', value: 14 })
      .expect(403)
  })

  it('refuses a value that is not a whole number', async () => {
    await http()
      .post('/settings/parameters')
      .set('x-test-identity', owner())
      .send({ key: 'invoice.payment_term_days', from: '2027-01-01', value: 14.5 })
      .expect(400)
  })
})
