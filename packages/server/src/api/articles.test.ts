import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { contactParentText, missingPermission, type RoleKey } from '@opengewerk/domain'
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
import { todayInGermany } from '../today.js'
import { ApiModule } from './api.module.js'
import { as, testIdentities as identities } from './test-identity.js'
import { created, push } from './test-structure.js'

/**
 * The articles and suppliers of a business (#296): kept by the office at
 * their routes, the catalogue page by page, the purchase prices only for the
 * owner and the office, and on every device nothing but the frequent articles
 * with their selling prices and the suppliers with their people.
 */

const north = { id: newId<'tenant'>(), name: 'Elektro Kohm GmbH' }
const south = { id: newId<'tenant'>(), name: 'Elektro Süd GmbH' }

let admin: Pool
let database: Database
let app: INestApplication

const office = as(north.id, 'office')
const technician = as(north.id, 'technician')

/** Somebody of the first business with a user of their own, for the share of a device. */
function person(userId: string, ...roles: RoleKey[]): string {
  return JSON.stringify({ userId, tenantId: north.id, roles })
}

function http() {
  return request(app.getHttpServer())
}

async function post(path: string, body: Record<string, unknown>, who = office, status = 201) {
  const answer = await http().post(path).set('x-test-identity', who).send(body).expect(status)

  return answer.body as Record<string, unknown> & { id: string; message?: string }
}

async function get(path: string, who = office, status = 200) {
  const answer = await http().get(path).set('x-test-identity', who).expect(status)

  return answer.body as Record<string, unknown>
}

interface Listed {
  readonly total: number
  readonly rows: {
    readonly id: string
    readonly number: string
    readonly designation: string
    readonly priceCents: number | null
    readonly supplierName: string | null
    readonly suppliers: number
    readonly frequent: boolean
  }[]
}

async function list(query: string, who = office) {
  return (await get(`/articles${query}`, who)) as unknown as Listed
}

interface Pulled {
  readonly changes: { entity: string; rows: Record<string, unknown>[] }[]
  readonly narrowed: Record<string, string>
}

async function pull(who: string) {
  const answer = await http().get('/sync?since=0').set('x-test-identity', who).expect(200)

  return answer.body as Pulled
}

function rowsOf(pulled: Pulled, entity: string) {
  return pulled.changes.find((change) => change.entity === entity)?.rows ?? []
}

const today = todayInGermany()
const later = '2099-01-01'

let wholesaler = ''
let kurpfalz = ''
let cable = ''
let breaker = ''

beforeAll(async () => {
  admin = await connect()
  await resetSchema(admin)
  await applyMigrations()
  await allowApplicationLogin(admin)
  await admin.query('insert into tenants (id, name) values ($1, $2), ($3, $4)', [
    north.id,
    north.name,
    south.id,
    south.name,
  ])

  for (const [userId, role] of [
    ['britta', 'office'],
    ['max', 'technician'],
  ] as const) {
    await admin.query('insert into auth_users (id, name, email) values ($1, $2, $3)', [
      userId,
      userId,
      `${userId}@example.de`,
    ])
    await admin.query('insert into memberships (tenant_id, user_id, roles) values ($1, $2, $3)', [
      north.id,
      userId,
      [role],
    ])
  }

  database = Database.connect(applicationDatabaseUrl())

  const built = await Test.createTestingModule({
    imports: [ApiModule.create(database, identities)],
  }).compile()

  app = built.createNestApplication()
  await app.init()

  wholesaler = (
    await post('/suppliers', {
      name: 'Elektro-Großhandel Rhein-Neckar GmbH',
      customerNumber: '448120',
      city: 'Mannheim',
    })
  ).id
  kurpfalz = (await post('/suppliers', { name: 'Kurpfalz Elektrohandel KG' })).id
  cable = (
    await post('/articles', {
      number: '1042',
      designation: 'Mantelleitung NYM-J 3 × 1,5 mm²',
      ean: '2001042000018',
      unit: 'metre',
      groupOfGoods: 'Kabel und Leitungen',
      frequent: true,
      price: { unitPriceCents: 92, validFrom: '2026-03-01' },
    })
  ).id
  breaker = (
    await post('/articles', {
      number: '2101',
      designation: 'Leitungsschutzschalter B16, 1-polig',
      unit: 'piece',
      groupOfGoods: 'Schutzgeräte',
      price: { unitPriceCents: 890, validFrom: '2026-01-01' },
    })
  ).id
  await post(`/articles/${cable}/suppliers`, {
    supplierId: wholesaler,
    supplierNumber: '5700123',
    price: { unitPriceCents: 54, validFrom: '2026-03-01' },
  })
  await post(`/articles/${cable}/suppliers`, { supplierId: kurpfalz, supplierNumber: 'NYM315-100' })
  await post(`/articles/${breaker}/suppliers`, { supplierId: kurpfalz, supplierNumber: 'LS-B16' })
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
})

describe('an article kept by the office', () => {
  it('has its selling prices from a day on and the suppliers that sell it', async () => {
    await post(`/articles/${cable}/prices`, { unitPriceCents: 98, validFrom: later })
    const article = await get(`/articles/${cable}`)

    expect(article).toMatchObject({
      number: '1042',
      designation: 'Mantelleitung NYM-J 3 × 1,5 mm²',
      unit: 'metre',
      frequent: true,
    })
    expect((article['prices'] as { validFrom: string }[]).map((price) => price.validFrom)).toEqual([
      later,
      '2026-03-01',
    ])
    const suppliers = article['suppliers'] as {
      supplierName: string
      supplierNumber: string
      purchasePrices: { unitPriceCents: number }[] | null
    }[]

    expect(suppliers.map((supplier) => supplier.supplierName)).toEqual([
      'Elektro-Großhandel Rhein-Neckar GmbH',
      'Kurpfalz Elektrohandel KG',
    ])
    expect(suppliers[0]?.purchasePrices?.map((price) => price.unitPriceCents)).toEqual([54])
    expect(suppliers[1]?.purchasePrices).toEqual([])
  })

  it('shows a technician no purchase price, not even an empty list', async () => {
    const article = await get(`/articles/${cable}`, technician)
    const suppliers = article['suppliers'] as { purchasePrices: unknown }[]

    expect(suppliers).toHaveLength(2)
    expect(suppliers.every((supplier) => supplier.purchasePrices === null)).toBe(true)

    const sold = (
      await http()
        .get(`/suppliers/${wholesaler}/articles`)
        .set('x-test-identity', technician)
        .expect(200)
    ).body as { total: number; rows: { purchase: unknown; supplierNumber: string }[] }

    expect(sold.total).toBe(1)
    expect(sold.rows.map((row) => [row.supplierNumber, row.purchase])).toEqual([['5700123', null]])
  })

  it('shows the office the purchase price of today at a supplier, page by page', async () => {
    const sold = (
      await http()
        .get(`/suppliers/${wholesaler}/articles`)
        .set('x-test-identity', office)
        .expect(200)
    ).body as { rows: { purchase: { unitPriceCents: number } | null }[] }

    expect(sold.rows[0]?.purchase?.unitPriceCents).toBe(54)
    await http()
      .get(`/suppliers/${wholesaler}/articles?limit=101`)
      .set('x-test-identity', office)
      .expect(400)
  })

  it('is kept by the owner and the office, and read by a technician', async () => {
    const refused = await post(
      '/articles',
      { number: '9001', designation: 'Abzweigdose', unit: 'piece' },
      technician,
      403,
    )

    expect(refused.message).toBe(missingPermission('article.write'))
    await http()
      .post(`/articles/${cable}/suppliers/x/prices`)
      .set('x-test-identity', technician)
      .send({ unitPriceCents: 1, validFrom: today })
      .expect(403)
    expect((await list('', technician)).total).toBeGreaterThanOrEqual(2)
  })

  it('wants a number, a designation and a unit it knows, and an EAN that adds up', async () => {
    const noNumber = await post('/articles', { designation: 'X', unit: 'piece' }, office, 400)
    const badEan = await post(
      '/articles',
      { number: '9002', designation: 'X', unit: 'piece', ean: '2001042000019' },
      office,
      400,
    )
    const badUnit = await post(
      '/articles',
      { number: '9003', designation: 'X', unit: 'barrel' },
      office,
      400,
    )

    expect(noNumber.message).toBe('Ein Artikel braucht eine Nummer.')
    expect(badEan.message).toBe('Die Prüfziffer der EAN stimmt nicht.')
    expect(badUnit.message).toBe('Diese Einheit gibt es nicht.')
  })

  it('has its number once per business, however it is written, and frees it when deleted', async () => {
    const taken = await post(
      '/articles',
      { number: ' 1042 ', designation: 'Doppelt', unit: 'metre' },
      office,
      409,
    )

    expect(taken.message).toBe('Diese Nummer hat schon ein anderer Artikel.')

    const first = await post('/articles', { number: 'a-7', designation: 'Erster', unit: 'piece' })
    await post('/articles', { number: 'A-7', designation: 'Zweiter', unit: 'piece' }, office, 409)
    await http().delete(`/articles/${first.id}`).set('x-test-identity', office).expect(200)
    await post('/articles', { number: 'A-7', designation: 'Zweiter', unit: 'piece' })

    // A business next door has its own numbers.
    await post(
      '/articles',
      { number: '1042', designation: 'Nachbar', unit: 'metre' },
      as(south.id, 'office'),
    )
  })

  it('takes one price a day, and a price is removed rather than changed', async () => {
    const day = await post(
      `/articles/${breaker}/prices`,
      { unitPriceCents: 910, validFrom: '2026-10-01' },
      office,
    )
    const again = await post(
      `/articles/${breaker}/prices`,
      { unitPriceCents: 920, validFrom: '2026-10-01' },
      office,
      409,
    )
    const wrong = await post(
      `/articles/${breaker}/prices`,
      { unitPriceCents: -1, validFrom: '2026-10-02' },
      office,
      400,
    )

    expect(again.message).toBe(
      'Für diesen Tag gibt es schon einen Preis. Erst den alten entfernen.',
    )
    expect(wrong.message).toMatch(/zwischen 0 und 999.999,99/)

    await http()
      .delete(`/articles/${breaker}/prices/${day.id}`)
      .set('x-test-identity', office)
      .expect(200)
    await post(`/articles/${breaker}/prices`, { unitPriceCents: 920, validFrom: '2026-10-01' })
  })

  it('is not reached in another business, nor a supplier of it', async () => {
    await get(`/articles/${cable}`, as(south.id, 'office'), 404)
    const foreign = await post('/suppliers', { name: 'Großhandel Süd' }, as(south.id, 'office'))
    const refused = await post(
      `/articles/${breaker}/suppliers`,
      { supplierId: foreign.id },
      office,
      422,
    )

    expect(refused.message).toMatch(/Lieferant/)
  })

  it('names each supplier once', async () => {
    const twice = await post(
      `/articles/${breaker}/suppliers`,
      { supplierId: kurpfalz },
      office,
      409,
    )

    expect(twice.message).toBe('Dieser Lieferant führt den Artikel schon.')
  })

  it('takes its prices and who sells it along when it is deleted', async () => {
    const socket = await post('/articles', {
      number: '5001',
      designation: 'Abzweigdose AP, IP65',
      unit: 'piece',
      price: { unitPriceCents: 340, validFrom: '2026-01-01' },
    })
    const sold = await post(`/articles/${socket.id}/suppliers`, {
      supplierId: wholesaler,
      price: { unitPriceCents: 185, validFrom: '2026-01-01' },
    })

    await http().delete(`/articles/${socket.id}`).set('x-test-identity', office).expect(200)

    const { rows: prices } = await admin.query(
      'select deleted_at from article_prices where article_id = $1',
      [socket.id],
    )
    const { rows: links } = await admin.query('select id from supplier_articles where id = $1', [
      sold.id,
    ])
    const { rows: purchase } = await admin.query(
      'select id from purchase_prices where supplier_article_id = $1',
      [sold.id],
    )

    expect(prices.every((row: { deleted_at: Date | null }) => row.deleted_at !== null)).toBe(true)
    expect(links).toEqual([])
    expect(purchase).toEqual([])
    await get(`/articles/${socket.id}`, office, 404)
  })
})

describe('the list of articles', () => {
  it('finds by number, name, EAN, supplier and the supplier’s number', async () => {
    const numbers = async (search: string) =>
      (await list(`?search=${encodeURIComponent(search)}`)).rows.map((row) => row.number)

    expect(await numbers('1042')).toEqual(['1042'])
    expect(await numbers('nym-j')).toEqual(['1042'])
    expect(await numbers('2001042')).toEqual(['1042'])
    expect(await numbers('rhein-neckar')).toEqual(['1042'])
    expect(await numbers('LS-B16')).toEqual(['2101'])
    // A wildcard of LIKE is a character like any other.
    expect(await numbers('%')).toEqual([])
  })

  it('narrows to the frequent ones and to a group of goods', async () => {
    expect((await list('?frequent=true')).rows.map((row) => row.number)).toEqual(['1042'])
    expect(
      (await list(`?group=${encodeURIComponent('Schutzgeräte')}`)).rows.map((row) => row.number),
    ).toEqual(['2101'])
    expect(await get('/articles/groups')).toEqual(['Kabel und Leitungen', 'Schutzgeräte'])
  })

  it('shows the price of today, the first supplier and how many there are', async () => {
    const [row] = (await list('?search=1042')).rows

    expect(row).toMatchObject({
      priceCents: 92,
      supplierName: 'Elektro-Großhandel Rhein-Neckar GmbH',
      suppliers: 2,
    })
  })

  it('comes page by page, with the whole count', async () => {
    const first = await list('?limit=1&offset=0')
    const second = await list('?limit=1&offset=1')

    expect(first.total).toBe(second.total)
    expect(first.rows).toHaveLength(1)
    expect(second.rows[0]?.id).not.toBe(first.rows[0]?.id)
    await get('/articles?limit=500', office, 400)
    await get('/articles?offset=-1', office, 400)
  })
})

describe('what a device holds', () => {
  it('is the frequent articles with their prices, for the office as for a technician', async () => {
    for (const who of [person('britta', 'office'), person('max', 'technician')]) {
      const pulled = await pull(who)
      const articles = rowsOf(pulled, 'articles')
      const prices = rowsOf(pulled, 'article_prices')

      expect(articles.map((row) => row['number'])).toEqual(['1042'])
      expect(new Set(prices.map((row) => row['articleId']))).toEqual(new Set([cable]))
      // What hangs on the suppliers never travels.
      expect(rowsOf(pulled, 'supplier_articles')).toEqual([])
      expect(rowsOf(pulled, 'purchase_prices')).toEqual([])
    }
  })

  it('changes its name when an article joins, so that a device fetches the set anew', async () => {
    const before = (await pull(person('max', 'technician'))).narrowed['articles']

    await http()
      .patch(`/articles/${breaker}`)
      .set('x-test-identity', office)
      .send({ frequent: true })
      .expect(200)

    const after = await pull(person('max', 'technician'))

    expect(after.narrowed['articles']).not.toBe(before)
    expect(after.narrowed['article_prices']).toBe(after.narrowed['articles'])
    expect(
      rowsOf(after, 'articles')
        .map((row) => row['number'])
        .sort(),
    ).toEqual(['1042', '2101'])

    await http()
      .patch(`/articles/${breaker}`)
      .set('x-test-identity', office)
      .send({ frequent: false })
      .expect(200)
    expect((await pull(person('max', 'technician'))).narrowed['articles']).toBe(before)
  })

  it('writes no article: the office keeps them at their routes', async () => {
    const answer = await push(app, office, [
      created('articles', newId<'article'>(), {
        number: '9100',
        designation: 'Vom Gerät',
        unit: 'piece',
      }),
    ])

    expect(answer.receipts[0]).toMatchObject({ outcome: 'conflict', reason: 'online_only' })
  })
})

describe('a supplier', () => {
  it('is created by the office through the outbox, and refused a technician', async () => {
    const id = newId<'supplier'>()
    const answer = await push(app, office, [
      created('suppliers', id, { name: 'Leuchten Wagner GmbH', city: 'Ludwigshafen' }),
    ])

    expect(answer.receipts[0]).toMatchObject({ outcome: 'applied' })

    // The sync answers a missing right for the whole transmission, with the
    // operation named, as it does for every other entity.
    const refused = await push(
      app,
      technician,
      [created('suppliers', newId<'supplier'>(), { name: 'Vom Monteur' })],
      400,
    )

    expect(refused.message).toBe(missingPermission('supplier.write'))
  })

  it('wants a name, from the outbox as from the route', async () => {
    const answer = await push(
      app,
      office,
      [created('suppliers', newId<'supplier'>(), { name: '  ', city: 'Mannheim' })],
      400,
    )
    const route = await post('/suppliers', { city: 'Mannheim' }, office, 400)

    expect(answer.message).toBe('Ein Lieferant braucht einen Namen.')
    expect(route.message).toBe('Ein Lieferant braucht einen Namen.')
  })

  it('is on every device, with its people', async () => {
    const contact = await post('/contacts', {
      supplierId: wholesaler,
      familyName: 'Stein',
      givenName: 'Jörg',
      role: 'Innendienst',
    })
    const pulled = await pull(person('max', 'technician'))

    expect(rowsOf(pulled, 'suppliers').map((row) => row['id'])).toContain(wholesaler)
    expect(rowsOf(pulled, 'contacts').map((row) => row['id'])).toContain(contact.id)
  })

  it('has people only the office adds, and a contact hangs on one thing', async () => {
    const refused = await push(
      app,
      technician,
      [
        created('contacts', newId<'contact'>(), {
          supplierId: wholesaler,
          familyName: 'Vom Monteur',
        }),
      ],
      400,
    )
    const route = await post(
      '/contacts',
      { supplierId: wholesaler, familyName: 'Vom Monteur' },
      technician,
      403,
    )
    const several = await post(
      '/contacts',
      { supplierId: wholesaler, customerId: newId<'customer'>(), familyName: 'Doppelt' },
      office,
      400,
    )

    expect(refused.message).toBe(missingPermission('supplier.write'))
    expect(route.message).toBe(missingPermission('supplier.write'))
    expect(several.message).toBe(contactParentText.several)
  })

  it('counts the articles it sells', async () => {
    const counts = await get('/suppliers/article-counts')

    expect(counts[kurpfalz]).toBe(2)
    expect(counts[wholesaler]).toBe(1)
  })

  it('takes what it sells and its people along when it is deleted', async () => {
    const gone = await post('/suppliers', { name: 'Schließt bald' })
    const contact = await post('/contacts', { supplierId: gone.id, familyName: 'Weg' })
    await post(`/articles/${breaker}/suppliers`, {
      supplierId: gone.id,
      price: { unitPriceCents: 500, validFrom: '2026-01-01' },
    })

    await http().delete(`/suppliers/${gone.id}`).set('x-test-identity', office).expect(200)

    const { rows: links } = await admin.query(
      'select id from supplier_articles where supplier_id = $1',
      [gone.id],
    )
    const { rows: people } = await admin.query('select deleted_at from contacts where id = $1', [
      contact.id,
    ])

    expect(links).toEqual([])
    expect((people[0] as { deleted_at: Date | null }).deleted_at).not.toBeNull()
  })
})
