import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { berlinClock, permissionsOfRoles, type TenantId } from '@opengewerk/domain'
import { Database, newId } from '@opengewerk/platform-server'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { applicationDatabaseUrl, connect, resetToMigrated } from '../database/test-database.js'
import { ApiModule } from './api.module.js'
import { as, testIdentities as identities } from './test-identity.js'

/**
 * The leads of the office (#312): recorded without a customer, qualified,
 * and made a customer with a site in one step, keeping their source. A lead
 * belongs to the business it was recorded in, and only the owner and the
 * office keep them.
 */

const north = newId<'tenant'>() as TenantId
const south = newId<'tenant'>() as TenantId
const today = berlinClock(new Date()).day

let admin: Pool
let database: Database
let app: INestApplication

const office = (tenant: TenantId = north) => as(tenant, 'office')
const technician = (tenant: TenantId = north) => as(tenant, 'technician')

function http() {
  return request(app.getHttpServer())
}

function refusal(answer: { body: unknown }): string {
  return String((answer.body as { message?: string }).message)
}

const brandt = {
  kind: 'private',
  name: 'Brandt, Familie',
  concern: 'PV-Anlage mit Speicher auf dem Einfamilienhaus',
  email: 'brandt.edingen@example.com',
  phone: '06203 84 21 57',
  street: 'Kastanienweg',
  houseNumber: '9',
  postalCode: '68535',
  city: 'Edingen-Neckarhausen',
  source: 'phone',
  stage: 'qualified',
}

async function lead(values: Record<string, unknown> = {}, tenant: TenantId = north) {
  const answer = await http()
    .post('/prospects')
    .set('x-test-identity', office(tenant))
    .send({ ...brandt, ...values })
    .expect(201)

  return answer.body as Record<string, unknown> & { id: string }
}

beforeAll(async () => {
  admin = await connect()
  await resetToMigrated()
  await admin.query('insert into tenants (id, name) values ($1, $2), ($3, $4)', [
    north,
    'Elektro Nord GmbH',
    south,
    'Elektro Süd GmbH',
  ])

  database = Database.connect(applicationDatabaseUrl())

  const built = await Test.createTestingModule({
    imports: [ApiModule.create(database, identities)],
  }).compile()

  app = built.createNestApplication()
  await app.init()
})

beforeEach(async () => {
  await admin.query('delete from prospects')
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
})

describe('a lead', () => {
  it('is recorded without a customer, new and contacted today unless the office says otherwise', async () => {
    const before = Number(
      (await admin.query<{ count: string }>('select count(*) from customers')).rows[0]?.count,
    )
    const created = await lead({ stage: undefined, concern: '  Wallbox  ' })

    expect(created).toMatchObject({
      name: 'Brandt, Familie',
      source: 'phone',
      stage: 'new',
      lastContactOn: today,
      customerId: null,
      siteId: null,
      convertedAt: null,
      concern: '  Wallbox  ',
    })
    expect(
      Number(
        (await admin.query<{ count: string }>('select count(*) from customers')).rows[0]?.count,
      ),
    ).toBe(before)
  })

  it('needs a name and a source, and a last contact that has been', async () => {
    const without = await http()
      .post('/prospects')
      .set('x-test-identity', office())
      .send({ ...brandt, source: undefined })
      .expect(422)

    expect(refusal(without)).toBe('Woher der Lead kommt, fehlt.')

    const ahead = await http()
      .post('/prospects')
      .set('x-test-identity', office())
      .send({ ...brandt, lastContactOn: '2999-01-01' })
      .expect(422)

    expect(refusal(ahead)).toBe('Der letzte Kontakt liegt nicht in der Zukunft.')
  })

  it('changes its stage and its last contact, checked against what it has', async () => {
    const created = await lead({ stage: 'new' })
    const changed = await http()
      .patch(`/prospects/${created.id}`)
      .set('x-test-identity', office())
      .send({ stage: 'contacted', lastContactOn: today })
      .expect(200)

    expect(changed.body).toMatchObject({ stage: 'contacted', name: 'Brandt, Familie' })

    const nameless = await http()
      .patch(`/prospects/${created.id}`)
      .set('x-test-identity', office())
      .send({ name: ' ' })
      .expect(422)

    expect(refusal(nameless)).toBe('Ein Lead braucht einen Namen.')
  })

  it('is deleted for real while it is no customer', async () => {
    const created = await lead()

    await http().delete(`/prospects/${created.id}`).set('x-test-identity', office()).expect(200)
    expect(
      (await admin.query('select id from prospects where id = $1', [created.id])).rows,
    ).toEqual([])
  })

  it('belongs to the business it was recorded in', async () => {
    const own = await lead()
    const theirs = await lead({ name: 'Café Rosengarten' }, south)

    const listed = await http().get('/prospects').set('x-test-identity', office()).expect(200)

    expect((listed.body as { id: string }[]).map((entry) => entry.id)).toEqual([own.id])
    await http().get(`/prospects/${theirs.id}`).set('x-test-identity', office()).expect(404)
    await http()
      .patch(`/prospects/${theirs.id}`)
      .set('x-test-identity', office())
      .send({ stage: 'dismissed' })
      .expect(404)
    await http().delete(`/prospects/${theirs.id}`).set('x-test-identity', office()).expect(404)
    await http()
      .post(`/prospects/${theirs.id}/conversion`)
      .set('x-test-identity', office())
      .send({})
      .expect(404)
    expect(
      (await admin.query('select stage, customer_id from prospects where id = $1', [theirs.id]))
        .rows,
    ).toEqual([{ stage: 'qualified', customer_id: null }])
  })

  it('is kept by the owner and the office, not by a technician', async () => {
    const created = await lead()

    await http().get('/prospects').set('x-test-identity', as(north, 'owner')).expect(200)
    await http().get('/prospects').set('x-test-identity', technician()).expect(403)
    await http().post('/prospects').set('x-test-identity', technician()).send(brandt).expect(403)
    await http()
      .post(`/prospects/${created.id}/conversion`)
      .set('x-test-identity', technician())
      .send({})
      .expect(403)
  })
})

describe('making a customer out of a lead', () => {
  it('makes the customer and a site at its address in one step, and the source stays on the customer', async () => {
    const created = await lead()
    const answer = await http()
      .post(`/prospects/${created.id}/conversion`)
      .set('x-test-identity', office())
      .send({})
      .expect(201)
    const converted = answer.body as { customerId: string; siteId: string; convertedAt: string }

    expect(converted.convertedAt).not.toBeNull()

    const { rows: madeCustomers } = await admin.query(
      `select tenant_id, kind, name, email, phone, street, house_number, postal_code, city, country, source
         from customers where id = $1`,
      [converted.customerId],
    )
    expect(madeCustomers).toEqual([
      {
        tenant_id: north,
        kind: 'private',
        name: 'Brandt, Familie',
        email: 'brandt.edingen@example.com',
        phone: '06203 84 21 57',
        street: 'Kastanienweg',
        house_number: '9',
        postal_code: '68535',
        city: 'Edingen-Neckarhausen',
        country: 'DE',
        source: 'phone',
      },
    ])

    const { rows: madeSites } = await admin.query(
      'select tenant_id, customer_id, designation, street, house_number, postal_code, city from sites where id = $1',
      [converted.siteId],
    )
    expect(madeSites).toEqual([
      {
        tenant_id: north,
        customer_id: converted.customerId,
        designation: 'Kastanienweg 9',
        street: 'Kastanienweg',
        house_number: '9',
        postal_code: '68535',
        city: 'Edingen-Neckarhausen',
      },
    ])
  })

  it('puts the site at another address under another name when the office says so', async () => {
    const created = await lead()
    const answer = await http()
      .post(`/prospects/${created.id}/conversion`)
      .set('x-test-identity', office())
      .send({
        designation: 'Ferienhaus',
        address: { street: 'Seeweg', houseNumber: '2', postalCode: '79856', city: 'Hinterzarten' },
      })
      .expect(201)
    const { siteId } = answer.body as { siteId: string }

    expect(
      (
        await admin.query('select designation, street, city, country from sites where id = $1', [
          siteId,
        ])
      ).rows,
    ).toEqual([
      { designation: 'Ferienhaus', street: 'Seeweg', city: 'Hinterzarten', country: 'DE' },
    ])
  })

  it('happens once, and leaves the lead as it was from then on', async () => {
    const created = await lead()

    await http()
      .post(`/prospects/${created.id}/conversion`)
      .set('x-test-identity', office())
      .send({})
      .expect(201)

    const customersAfter = async () =>
      (await admin.query<{ count: number }>('select count(*)::int as count from customers')).rows
    const made = await customersAfter()
    const again = await http()
      .post(`/prospects/${created.id}/conversion`)
      .set('x-test-identity', office())
      .send({})
      .expect(409)

    expect(refusal(again)).toBe('Aus diesem Lead ist schon ein Kunde geworden.')

    const changed = await http()
      .patch(`/prospects/${created.id}`)
      .set('x-test-identity', office())
      .send({ name: 'Brandt' })
      .expect(409)

    expect(refusal(changed)).toContain('Geändert wird jetzt der Kunde')
    await http().delete(`/prospects/${created.id}`).set('x-test-identity', office()).expect(409)
    expect(await customersAfter()).toEqual(made)
  })

  it('makes no customer out of a dismissed lead', async () => {
    const created = await lead({ stage: 'dismissed' })
    const answer = await http()
      .post(`/prospects/${created.id}/conversion`)
      .set('x-test-identity', office())
      .send({})
      .expect(409)

    expect(refusal(answer)).toContain('abgesagt')
  })

  it('asks whoever does it to create customers and keep sites as well', async () => {
    const created = await lead()
    const withoutSites = JSON.stringify({
      userId: 'lena',
      tenantId: north,
      roles: ['office'],
      rights: [...permissionsOfRoles(['office'])].filter((right) => right !== 'site.write'),
    })
    const answer = await http()
      .post(`/prospects/${created.id}/conversion`)
      .set('x-test-identity', withoutSites)
      .send({})
      .expect(403)

    expect(refusal(answer)).toContain('Objekte')
    expect(
      (await admin.query('select customer_id from prospects where id = $1', [created.id])).rows,
    ).toEqual([{ customer_id: null }])
  })
})
