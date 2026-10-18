import { sql } from 'drizzle-orm'
import { check, getTableConfig, integer, text } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'

import { stockSchema } from './stock.js'

// The tables of the stock as an application makes them (ADR 0011), asked of
// the tables and of no database: what the foundation gives every stock, and
// that what an application adds arrives beside it. What a database makes of
// them, the tests of the application that binds them hold.

const columnsOf = (table: Parameters<typeof getTableConfig>[0]) =>
  getTableConfig(table).columns.map((column) => column.name)

const checksOf = (table: Parameters<typeof getTableConfig>[0]) =>
  getTableConfig(table).checks.map((each) => each.name)

describe('the tables of the stock', () => {
  it('are made with the columns of the application at an article and a booking', () => {
    const plain = stockSchema()
    const own = stockSchema({
      articles: { columns: { priceCents: integer('price_cents') } },
      movements: { columns: { activityId: text('activity_id') } },
    })

    expect(columnsOf(plain.articles)).not.toContain('price_cents')
    expect(columnsOf(own.articles)).toContain('price_cents')
    expect(columnsOf(own.articles)).toEqual(expect.arrayContaining(columnsOf(plain.articles)))
    expect(columnsOf(own.stockMovements)).toContain('activity_id')
    expect(getTableConfig(own.stockMovements).name).toBe('stock_movements')
  })

  it('refuses a column of the application under a name a table has', () => {
    expect(() => stockSchema({ articles: { columns: { number: text('no') } } })).toThrow(
      'The articles have these columns already: number.',
    )
    expect(() => stockSchema({ movements: { columns: { reason: text('why') } } })).toThrow(
      'The stock movements have these columns already: reason.',
    )
  })

  it('travel: every table carries the columns of the sync', () => {
    const travelling = ['version', 'updated_by', 'device_id', 'deleted_at', 'change_sequence']

    for (const table of Object.values(stockSchema())) {
      expect(columnsOf(table)).toEqual(expect.arrayContaining(travelling))
    }
  })

  it('keep the tenants apart, and hold the rules of a booking and an article in the database', () => {
    for (const table of Object.values(stockSchema())) {
      expect(getTableConfig(table).policies.map((policy) => policy.name)).toContain(
        'tenant_isolation',
      )
    }

    const { articles, stockMovements, storeArticles } = stockSchema()

    expect(checksOf(stockMovements)).toEqual(
      expect.arrayContaining([
        'stock_movements_kind_known',
        'stock_movements_quantity_from_zero',
        'stock_movements_moves_something',
        'stock_movements_count_with_a_reason',
        'stock_movements_write_off_with_a_reason',
        'stock_movements_supplier_at_a_receipt',
        'stock_movements_transfer_names_its_store',
        'stock_movements_transfer_elsewhere',
      ]),
    )
    expect(checksOf(articles)).toEqual(
      expect.arrayContaining(['articles_ean_shaped', 'articles_unit_known']),
    )
    expect(getTableConfig(storeArticles).uniqueConstraints.map((each) => each.name)).toContain(
      'store_articles_once',
    )
    expect(checksOf(storeArticles)).toEqual(
      expect.arrayContaining(['store_articles_bin_fits', 'store_articles_minimum_from_zero']),
    )
  })

  it('carry the checks of the application beside their own', () => {
    const { stockMovements } = stockSchema({
      movements: {
        columns: { activityId: text('activity_id') },
        constraints: (table) => [
          check(
            'stock_movements_withdrawal_at_an_activity',
            sql`${table.kind} <> 'withdrawal' or ${table.activityId} is not null`,
          ),
        ],
      },
    })

    expect(checksOf(stockMovements)).toEqual(
      expect.arrayContaining([
        'stock_movements_withdrawal_at_an_activity',
        'stock_movements_kind_known',
      ]),
    )
  })
})
