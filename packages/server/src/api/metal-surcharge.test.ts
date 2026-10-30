import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { Database, FileStore, newId, type Renderer } from '@opengewerk/platform-server'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { applicationDatabaseUrl, connect, resetToMigrated } from '../database/test-database.js'
import { SellingPrices } from '../pricing/selling-prices.js'
import { todayInGermany } from '../today.js'
import { ApiModule } from './api.module.js'
import { as, testIdentities as identities } from './test-identity.js'
import { invoiceable, readyToInvoice } from './test-invoice.js'

/**
 * The metal surcharge (#462): a supplier's metal prices from a day on, the
 * metal of an article at a supplier, and the price a line takes on a day,
 * with the surcharge in it after the metal price of the main supplier, with
 * or without the markup.
 */

const north = { id: newId<'tenant'>(), name: 'Elektro Kohm GmbH' }

let admin: Pool
let database: Database
let app: INestApplication
let prices: SellingPrices
let storageRoot: string

const owner = as(north.id, 'owner')
const office = as(north.id, 'office')
const technician = as(north.id, 'technician')
const today = todayInGermany()
const standIn: Renderer = () => Promise.resolve(new TextEncoder().encode('%PDF-1.7 Probedruck'))

function http() {
  return request(app.getHttpServer())
}

async function send(
  method: 'post' | 'put' | 'delete',
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

/** The price a line takes on a day, as the choice of an article shows it. */
async function lineCents(number: string, day: string) {
  const page = (await get(`/articles?search=${number}&on=${day}`)) as {
    rows: { priceCents: number | null; priceBase: number | null }[]
  }

  return page.rows[0]?.priceCents ?? null
}

let wholesaler = ''
let nordlicht = ''
let customerId = ''
// H05V-U 1 mm², following its purchase price; and a wire with a fixed price.
let cable = ''
let cableLink = ''
let wire = ''
let wireLink = ''

beforeAll(async () => {
  admin = await connect()
  await resetToMigrated()
  await admin.query('insert into tenants (id, name) values ($1, $2)', [north.id, north.name])
  await readyToInvoice(admin, north.id)

  storageRoot = mkdtempSync(join(tmpdir(), 'opengewerk-metall-'))
  database = Database.connect(applicationDatabaseUrl())

  const built = await Test.createTestingModule({
    imports: [
      ApiModule.create(database, identities, {
        files: new FileStore(storageRoot),
        renderer: standIn,
      }),
    ],
  }).compile()

  app = built.createNestApplication()
  await app.init()
  prices = app.get(SellingPrices)

  customerId = (
    await send('post', '/customers', { kind: 'private', name: 'Familie Berg', ...invoiceable })
  ).id
  wholesaler = (await send('post', '/suppliers', { name: 'Elektro-Großhandel Rhein-Neckar GmbH' }))
    .id
  nordlicht = (await send('post', '/suppliers', { name: 'Nordlicht Elektro GmbH' })).id
  cable = (
    await send('post', '/articles', { number: '1001', designation: 'H05V-U 1 mm²', unit: 'metre' })
  ).id
  cableLink = (
    await send('post', `/articles/${cable}/suppliers`, {
      supplierId: wholesaler,
      // 14,18 € for 100 m, the list price of the issue.
      price: { unitPriceCents: 1418, priceBase: 100, validFrom: '2020-01-01' },
    })
  ).id
  wire = (
    await send('post', '/articles', {
      number: '1002',
      designation: 'H07V-K 1 mm²',
      unit: 'metre',
      price: { unitPriceCents: 500, priceBase: 100, validFrom: '2020-01-01' },
    })
  ).id
  wireLink = (await send('post', `/articles/${wire}/suppliers`, { supplierId: wholesaler })).id

  // The business sells with 22 % from today on; the cable follows.
  await send(
    'post',
    '/settings/parameters',
    { key: 'material.markup_basis_points', from: today, value: 2200 },
    owner,
  )
  await prices.settled()
})

afterAll(async () => {
  await prices.settled()
  await app.close()
  await database.close()
  await admin.end()
  rmSync(storageRoot, { recursive: true, force: true })
})

describe("a supplier's metal prices", () => {
  it('are entered from a day on, one a day per metal, and listed newest first', async () => {
    await send('post', `/suppliers/${wholesaler}/metal-prices`, {
      metal: 'copper',
      validFrom: '2020-06-01',
      priceCents: 100_000,
    })
    const current = await send('post', `/suppliers/${wholesaler}/metal-prices`, {
      metal: 'copper',
      validFrom: today,
      priceCents: 140_267,
    })
    const aluminium = await send('post', `/suppliers/${wholesaler}/metal-prices`, {
      metal: 'aluminium',
      validFrom: '2020-06-01',
      priceCents: 31_840,
    })

    const listed = await get(`/suppliers/${wholesaler}/metal-prices`)

    expect(listed['total']).toBe(3)
    expect(listed['rows']).toEqual([
      { id: current.id, metal: 'copper', validFrom: today, priceCents: 140_267 },
      expect.objectContaining({ metal: 'copper', validFrom: '2020-06-01', priceCents: 100_000 }),
      { id: aluminium.id, metal: 'aluminium', validFrom: '2020-06-01', priceCents: 31_840 },
    ])
    // What applies today, for "Gilt": the copper of today and the aluminium of before.
    expect([...(listed['current'] as string[])].sort()).toEqual([current.id, aluminium.id].sort())

    const taken = await send(
      'post',
      `/suppliers/${wholesaler}/metal-prices`,
      { metal: 'copper', validFrom: today, priceCents: 139_000 },
      office,
      409,
    )

    expect(taken.message).toBe(
      'Für diesen Tag gibt es schon einen Preis für dieses Metall. Erst den alten entfernen.',
    )
  })

  it('are refused for a metal it does not know and for a price of nothing', async () => {
    await send(
      'post',
      `/suppliers/${wholesaler}/metal-prices`,
      { metal: 'gold', validFrom: today, priceCents: 1 },
      office,
      400,
    )
    await send(
      'post',
      `/suppliers/${wholesaler}/metal-prices`,
      { metal: 'copper', validFrom: '2020-07-01', priceCents: 0 },
      office,
      400,
    )
    await send(
      'post',
      `/suppliers/${wholesaler}/metal-prices`,
      { metal: 'copper', validFrom: '01.07.2020', priceCents: 100 },
      office,
      400,
    )
  })

  it('are removed one by one, and only of their own supplier', async () => {
    const mistake = await send('post', `/suppliers/${wholesaler}/metal-prices`, {
      metal: 'aluminium',
      validFrom: '2021-01-01',
      priceCents: 99_999,
    })
    const other = (await send('post', '/suppliers', { name: 'Kurpfalz Elektrohandel KG' })).id

    await send('delete', `/suppliers/${other}/metal-prices/${mistake.id}`, {}, office, 404)
    await send('delete', `/suppliers/${wholesaler}/metal-prices/${mistake.id}`, {}, office)
    expect((await get(`/suppliers/${wholesaler}/metal-prices`))['total']).toBe(3)
  })

  it('belong to the office and the owner, never to a technician', async () => {
    await get(`/suppliers/${wholesaler}/metal-prices`, technician, 403)
    await send(
      'post',
      `/suppliers/${wholesaler}/metal-prices`,
      { metal: 'copper', validFrom: '2022-01-01', priceCents: 100 },
      technician,
      403,
    )
    await get(`/suppliers/${wholesaler}/metal-prices`, owner)
  })
})

describe('the metal of an article at a supplier', () => {
  it('is entered by hand, all of it, and shown to whoever reads purchase prices', async () => {
    const copper = { metal: 'copper', baseEuros: 150, gramsPerThousand: 9_600 }

    await send('put', `/articles/${cable}/suppliers/${cableLink}/metals`, {
      metals: [copper, { metal: 'aluminium', baseEuros: 0, gramsPerThousand: 1_000 }],
    })
    // Left out is taken off.
    await send('put', `/articles/${cable}/suppliers/${cableLink}/metals`, { metals: [copper] })
    await send('put', `/articles/${wire}/suppliers/${wireLink}/metals`, { metals: [copper] })

    // A second supplier with copper on no base and a dearer copper: not the
    // main one, so neither counts for a line.
    const second = (await send('post', `/articles/${cable}/suppliers`, { supplierId: nordlicht }))
      .id

    await send('put', `/articles/${cable}/suppliers/${second}/metals`, {
      metals: [{ metal: 'copper', baseEuros: 0, gramsPerThousand: 9_600 }],
    })
    await send('post', `/suppliers/${nordlicht}/metal-prices`, {
      metal: 'copper',
      validFrom: '2020-01-01',
      priceCents: 200_000,
    })

    const shown = (await get(`/articles/${cable}`)) as { suppliers: { metals: unknown }[] }

    expect(shown.suppliers[0]?.metals).toEqual([copper])

    const seen = (await get(`/articles/${cable}`, technician)) as {
      suppliers: { metals: unknown }[]
    }

    expect(seen.suppliers[0]?.metals).toBeNull()
  })

  it('is refused with figures that do not fit, a metal twice, and without the right', async () => {
    const path = `/articles/${cable}/suppliers/${cableLink}/metals`

    await send(
      'put',
      path,
      { metals: [{ metal: 'copper', baseEuros: 150.5, gramsPerThousand: 1 }] },
      office,
      400,
    )
    await send(
      'put',
      path,
      {
        metals: [
          { metal: 'copper', baseEuros: 150, gramsPerThousand: 1 },
          { metal: 'copper', baseEuros: 128, gramsPerThousand: 1 },
        ],
      },
      office,
      400,
    )
    await send(
      'put',
      path,
      { metals: [{ metal: 'silver', baseEuros: 1, gramsPerThousand: 1 }] },
      office,
      400,
    )
    await send('put', path, {}, office, 400)
    await send('put', path, { metals: [] }, technician, 403)
  })
})

describe('the price a line takes on a day', () => {
  it('holds the metal surcharge of the main supplier, after the metal price of that day', async () => {
    // 17,30 € for 100 m from 14,18 € and 22 %, and 12,03 € of copper at 1.402,67 €.
    expect(await lineCents('1001', today)).toBe(2933)
    // The fixed wire: 5,00 € and the copper of 2020, 1.000,00 € for 100 kg: 8,16 €.
    expect(await lineCents('1002', '2021-06-01')).toBe(1316)
    // Before the first metal price, the selling price alone.
    expect(await lineCents('1002', '2020-03-01')).toBe(500)
    expect(await lineCents('1002', today)).toBe(1703)
  })

  it('names the surcharge beside the purchase price, for the office only', async () => {
    const answer = await get(`/articles/${cable}/purchase?on=${today}`)

    expect(answer).toEqual({
      purchase: {
        cents: 1418,
        priceBase: 100,
        supplierName: 'Elektro-Großhandel Rhein-Neckar GmbH',
      },
      metal: {
        supplierName: 'Elektro-Großhandel Rhein-Neckar GmbH',
        metals: [
          {
            metal: 'copper',
            baseEuros: 150,
            gramsPerThousand: 9_600,
            centsPerHundredKg: 140_267,
            priceFrom: today,
          },
        ],
        markupOnMetal: false,
      },
    })
    await get(`/articles/${cable}/purchase?on=${today}`, technician, 403)
  })

  it('marks the surcharge up where the narrowest word says so, and a fixed price never', async () => {
    await send(
      'post',
      '/settings/parameters',
      { key: 'material.markup_on_metal', from: today, value: 1 },
      owner,
    )
    // 12,0256 € with 22 % are 14,67 €.
    expect(await lineCents('1001', today)).toBe(3197)
    // A fixed price came from no markup, so its surcharge takes none.
    expect(await lineCents('1002', today)).toBe(1703)

    // The supplier says no, without a markup of its own and without a run.
    expect(await send('put', `/suppliers/${wholesaler}/markup`, { markupOnMetal: false })).toEqual({
      basisPoints: null,
      markupOnMetal: false,
      pending: false,
    })
    expect(await get(`/suppliers/${wholesaler}/markup`)).toEqual({
      basisPoints: null,
      business: 2200,
      markupOnMetal: false,
      businessOnMetal: true,
      pending: false,
    })
    expect(await lineCents('1001', today)).toBe(2933)

    // The article says yes, and keeps saying it when its markup changes.
    await send('put', `/articles/${cable}/pricing`, {
      fixed: false,
      basisPoints: null,
      markupOnMetal: true,
    })
    expect(await lineCents('1001', today)).toBe(3197)
    await send('put', `/articles/${cable}/pricing`, { fixed: false, basisPoints: 2500 })

    const shown = (await get(`/articles/${cable}`)) as { pricing: Record<string, unknown> }

    expect(shown.pricing).toMatchObject({
      basisPoints: 2500,
      markupOnMetal: true,
      metalInherited: false,
      metalInheritedFrom: 'supplier',
    })
    // 17,73 € from 14,18 € and 25 %, and 12,0256 € with 25 %, 15,03 €.
    expect(await lineCents('1001', today)).toBe(3276)

    // Back to the supplier's word: no row is left that says nothing.
    await send('put', `/articles/${cable}/pricing`, {
      fixed: false,
      basisPoints: null,
      markupOnMetal: null,
    })
    expect(
      Number(
        (
          await admin.query<{ count: string }>(
            'select count(*) from article_markups where article_id = $1',
            [cable],
          )
        ).rows[0]?.count,
      ),
    ).toBe(0)
    await send('put', `/suppliers/${wholesaler}/markup`, { markupOnMetal: null })
    expect(
      Number(
        (
          await admin.query<{ count: string }>(
            'select count(*) from supplier_markups where supplier_id = $1',
            [wholesaler],
          )
        ).rows[0]?.count,
      ),
    ).toBe(0)
  })

  it('goes into the unit price of a line an invoice takes from a report', async () => {
    const report = await send('post', '/documents', {
      customerId,
      kind: 'time_and_material_report',
      documentDate: today,
    })

    await send('post', `/documents/${report.id}/lines`, {
      designation: 'H07V-K 1 mm²',
      quantityMilli: 12_500,
      unit: 'metre',
      unitPriceCents: 0,
      articleId: wire,
    })
    await send('post', `/documents/${report.id}/issue`, {})

    const invoice = await send('post', `/documents/${report.id}/successors`, {
      kind: 'final_invoice',
      documentDate: today,
    })
    const lines = (
      await http().get(`/documents/${invoice.id}/lines`).set('x-test-identity', office).expect(200)
    ).body as { unitPriceCents: number; priceBase: number; netCents: number }[]

    // 17,03 € for 100 m, the surcharge in it; 12,5 m are 2,13 €.
    expect(lines[0]).toMatchObject({ unitPriceCents: 1703, priceBase: 100, netCents: 213 })
  })
})
