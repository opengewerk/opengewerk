import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { Database, newId } from '@opengewerk/platform-server'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { applicationDatabaseUrl, connect, resetToMigrated } from '../database/test-database.js'
import { SellingPrices } from '../pricing/selling-prices.js'
import { todayInGermany } from '../today.js'
import { ApiModule } from './api.module.js'
import { as, testIdentities as identities } from './test-identity.js'

/**
 * The selling prices that follow a purchase price (#463, second part): the
 * markup of the business, of a supplier and of an article, the main supplier,
 * a purchase price entered by hand, what each price came from, and the runs
 * that work a whole supplier or business out anew in the background.
 */

const north = { id: newId<'tenant'>(), name: 'Elektro Kohm GmbH' }

let admin: Pool
let database: Database
let app: INestApplication
let prices: SellingPrices

const owner = as(north.id, 'owner')
const office = as(north.id, 'office')
const technician = as(north.id, 'technician')
const today = todayInGermany()
const later = '2099-01-01'

function http() {
  return request(app.getHttpServer())
}

async function send(
  method: 'post' | 'put',
  path: string,
  body: Record<string, unknown>,
  who = office,
  status = method === 'post' ? 201 : 200,
) {
  const answer = await http()[method](path).set('x-test-identity', who).send(body).expect(status)

  return answer.body as Record<string, unknown> & { id: string; message?: string }
}

async function get(path: string, who = office, status = 200) {
  const answer = await http().get(path).set('x-test-identity', who).expect(status)

  return answer.body as Record<string, unknown>
}

interface Shown {
  readonly prices: {
    readonly validFrom: string
    readonly unitPriceCents: number
    readonly priceBase: number
    readonly origin: { readonly purchaseCents: number; readonly basisPoints: number } | null
  }[]
  readonly pricing: {
    readonly fixed: boolean
    readonly basisPoints: number | null
    readonly markup: number | null
    readonly source: string | null
  } | null
  readonly suppliers: {
    readonly id: string
    readonly main: boolean
    readonly markup: number | null
  }[]
}

async function article(id: string, who = office) {
  return (await get(`/articles/${id}`, who)) as unknown as Shown
}

/** The prices as the screen lists them, newest first: day, cents and what they came from. */
function listed(shown: Shown) {
  return shown.prices.map((price) => [
    price.validFrom,
    price.unitPriceCents,
    price.origin === null ? null : [price.origin.purchaseCents, price.origin.basisPoints],
  ])
}

let wholesaler = ''
let kurpfalz = ''

beforeAll(async () => {
  admin = await connect()
  await resetToMigrated()
  await admin.query('insert into tenants (id, name) values ($1, $2)', [north.id, north.name])

  database = Database.connect(applicationDatabaseUrl())

  const built = await Test.createTestingModule({
    imports: [ApiModule.create(database, identities)],
  }).compile()

  app = built.createNestApplication()
  await app.init()
  prices = app.get(SellingPrices)

  wholesaler = (await send('post', '/suppliers', { name: 'Elektro-Großhandel Rhein-Neckar GmbH' }))
    .id
  kurpfalz = (await send('post', '/suppliers', { name: 'Kurpfalz Elektrohandel KG' })).id
})

afterAll(async () => {
  await prices.settled()
  await app.close()
  await database.close()
  await admin.end()
})

describe('the selling price of an article that follows its purchase price', () => {
  let cable = ''
  let link = ''

  it('comes from the markup of the business, then of the supplier, then of the article', async () => {
    cable = (
      await send('post', '/articles', {
        number: '1042',
        designation: 'NYM-J 3 × 1,5',
        unit: 'metre',
      })
    ).id
    link = (
      await send('post', `/articles/${cable}/suppliers`, {
        supplierId: wholesaler,
        price: { unitPriceCents: 5400, priceBase: 100, validFrom: '2026-03-01' },
      })
    ).id

    // No markup yet: no selling price comes from the purchase price.
    expect(listed(await article(cable))).toEqual([])
    expect((await article(cable)).pricing).toEqual({
      fixed: false,
      basisPoints: null,
      markup: null,
      source: null,
      inherited: null,
      business: null,
    })

    // The business's, set by the owner under "Einstellungen", worked out in the background.
    await send(
      'post',
      '/settings/parameters',
      {
        key: 'material.markup_basis_points',
        from: today,
        value: 2500,
      },
      owner,
    )
    await prices.settled()
    expect(listed(await article(cable))).toEqual([[today, 6750, [5400, 2500]]])
    expect((await article(cable)).pricing).toMatchObject({ markup: 2500, source: 'business' })

    // The supplier's own takes its place on the same day.
    expect(
      await send('put', `/suppliers/${wholesaler}/markup`, { basisPoints: 2200 }),
    ).toMatchObject({ basisPoints: 2200, pending: true })
    await prices.settled()
    expect(listed(await article(cable))).toEqual([[today, 6588, [5400, 2200]]])
    expect(await get(`/suppliers/${wholesaler}/markup`)).toEqual({
      basisPoints: 2200,
      business: 2500,
      pending: false,
    })

    // The article's own, at once.
    await send('put', `/articles/${cable}/pricing`, { fixed: false, basisPoints: 3000 })
    const own = await article(cable)

    expect(listed(own)).toEqual([[today, 7020, [5400, 3000]]])
    expect(own.pricing).toEqual({
      fixed: false,
      basisPoints: 3000,
      markup: 3000,
      source: 'article',
      inherited: 2200,
      business: 2500,
    })
    expect(own.suppliers).toEqual([expect.objectContaining({ id: link, main: true, markup: 2200 })])
  })

  it('follows a purchase price entered by hand from its day on, and stays once it is fixed', async () => {
    await send('post', `/articles/${cable}/suppliers/${link}/prices`, {
      unitPriceCents: 5600,
      priceBase: 100,
      validFrom: later,
    })
    expect(listed(await article(cable))).toEqual([
      [later, 7280, [5600, 3000]],
      [today, 7020, [5400, 3000]],
    ])

    await send('put', `/articles/${cable}/pricing`, { fixed: true })
    await send('post', `/articles/${cable}/suppliers/${link}/prices`, {
      unitPriceCents: 9900,
      priceBase: 100,
      validFrom: '2098-01-01',
    })

    const fixed = await article(cable)

    expect(fixed.pricing).toMatchObject({
      fixed: true,
      basisPoints: null,
      markup: null,
      source: null,
    })
    expect(listed(fixed).map((price) => price[1])).toEqual([7280, 7020])
  })

  it('follows the main supplier, and another one made main', async () => {
    const clamp = (
      await send('post', '/articles', { number: '5002', designation: 'Klemme', unit: 'piece' })
    ).id

    await send('post', `/articles/${clamp}/suppliers`, {
      supplierId: wholesaler,
      price: { unitPriceCents: 100, validFrom: '2026-03-01' },
    })
    const second = (
      await send('post', `/articles/${clamp}/suppliers`, {
        supplierId: kurpfalz,
        price: { unitPriceCents: 200, validFrom: '2026-03-01' },
      })
    ).id

    // The wholesaler brought it first: 1,00 € with its 22 %.
    expect(listed(await article(clamp))).toEqual([[today, 122, [100, 2200]]])

    await send('put', `/articles/${clamp}/suppliers/${second}/main`, {})

    const moved = await article(clamp)

    // Kurpfalz has no markup of its own: 2,00 € with the business's 25 %.
    expect(listed(moved)).toEqual([[today, 250, [200, 2500]]])
    expect(moved.suppliers.map((supplier) => [supplier.id, supplier.main])).toEqual([
      [expect.any(String), false],
      [second, true],
    ])
  })

  it('travels to a device as a selling price, and what it came from never does', async () => {
    const answer = await http().get('/sync?since=0').set('x-test-identity', technician).expect(200)
    const entities = (answer.body as { changes: { entity: string }[] }).changes.map(
      (change) => change.entity,
    )

    expect(entities).not.toContain('article_price_origins')
    expect(entities).not.toContain('selling_price_runs')
  })

  it('is shown to whoever may read purchase prices, and set by whoever may keep them', async () => {
    const shown = await article(cable, technician)

    expect(shown.pricing).toBeNull()
    expect(shown.prices.every((price) => price.origin === null)).toBe(true)
    expect(shown.suppliers.every((supplier) => supplier.markup === null)).toBe(true)

    await send('put', `/articles/${cable}/pricing`, { fixed: true }, technician, 403)
    await send('put', `/suppliers/${wholesaler}/markup`, { basisPoints: 1 }, technician, 403)
    await get(`/suppliers/${wholesaler}/markup`, technician, 403)
    // The business's markup is a setting, which the office reads and the owner sets.
    await send(
      'post',
      '/settings/parameters',
      {
        key: 'material.markup_basis_points',
        from: today,
        value: 1,
      },
      office,
      403,
    )
  })

  it('refuses a markup out of range, and a fixed price with a markup', async () => {
    const sentence =
      'Ein Aufschlag liegt zwischen 0 und 1.000 % und hat höchstens zwei Stellen nach dem Komma.'

    expect(
      (
        await send(
          'put',
          `/articles/${cable}/pricing`,
          { fixed: false, basisPoints: 100_001 },
          office,
          400,
        )
      ).message,
    ).toBe(sentence)
    expect(
      (await send('put', `/suppliers/${wholesaler}/markup`, { basisPoints: -1 }, office, 400))
        .message,
    ).toBe(sentence)
    expect(
      (
        await send(
          'put',
          `/articles/${cable}/pricing`,
          { fixed: true, basisPoints: 100 },
          office,
          400,
        )
      ).message,
    ).toBe('Ein fester Verkaufspreis hat keinen Aufschlag.')
  })
})

describe('a run of the selling prices', () => {
  it('that waits is widened to the whole business where another supplier comes, from the earlier day', async () => {
    const actor = { tenantId: north.id, userId: 'test', reason: 'test' }
    const run = async () =>
      (
        await admin.query<{ supplier_id: string | null; from_day: string }>(
          `select supplier_id, from_day::text from selling_price_runs`,
        )
      ).rows

    await database.forTenant(actor, async (tx) => {
      await prices.request(tx, { ...actor, supplierId: wholesaler as never, from: later as never })
      await prices.request(tx, {
        ...actor,
        supplierId: wholesaler as never,
        from: '2098-01-01' as never,
      })
    })
    expect(await run()).toEqual([{ supplier_id: wholesaler, from_day: '2098-01-01' }])

    await database.forTenant(actor, (tx) =>
      prices.request(tx, { ...actor, supplierId: kurpfalz as never, from: later as never }),
    )
    expect(await run()).toEqual([{ supplier_id: null, from_day: '2098-01-01' }])

    await admin.query('delete from selling_price_runs')
  })

  it('is taken up again after a restart, and gone once it is done', async () => {
    const tape = (
      await send('post', '/articles', { number: '5003', designation: 'Isolierband', unit: 'piece' })
    ).id
    const solar = (await send('post', '/suppliers', { name: 'Solar-Direkt Süd GmbH' })).id

    // Its markup came in directly, as if the server had stopped right after.
    await send('post', `/articles/${tape}/suppliers`, {
      supplierId: solar,
      price: { unitPriceCents: 400, validFrom: '2026-03-01' },
    })
    await admin.query(
      `insert into supplier_markups (tenant_id, supplier_id, basis_points) values ($1, $2, 5000)`,
      [north.id, solar],
    )
    await admin.query(
      `insert into selling_price_runs (tenant_id, supplier_id, from_day, requested_by)
         values ($1, $2, '2026-01-01', 'test')`,
      [north.id, solar],
    )

    await prices.resume()
    await prices.settled()

    // Never backwards: from today, though the run was noted for January.
    expect(listed(await article(tape))).toEqual([[today, 600, [400, 5000]]])
    expect(
      (await admin.query('select count(*)::int as runs from selling_price_runs')).rows[0],
    ).toEqual({ runs: 0 })
  })
})
