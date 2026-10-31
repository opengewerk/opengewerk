import { metalLimits, metals } from '@opengewerk/domain'
import { primaryId, reference, tenantIsolation, timestamps } from '@opengewerk/platform-server'
import { tenantColumn } from '@opengewerk/platform-server/schema'
import { sql } from 'drizzle-orm'
import { check, date, foreignKey, integer, pgEnum, pgTable, unique } from 'drizzle-orm/pg-core'

import { supplierArticles } from './articles.js'
import { suppliers } from './stock.js'

export const metal = pgEnum('metal', metals)

/**
 * The metal an article holds at one supplier (#462): the base its purchase
 * price contains, in euros for 100 kg, and the weight in grams for 1000 of the
 * article's units. Copper comes with the second record of DATANORM (#297);
 * any metal may be entered by hand. Once per link and metal.
 *
 * Like `supplier_articles` without sync columns: it belongs with the purchase
 * prices, which no device holds. Removed rather than marked; the change log
 * keeps what was removed, except where an import wrote it.
 */
export const supplierArticleMetals = pgTable(
  'supplier_article_metals',
  {
    id: primaryId<'supplier-article-metal'>(),
    ...tenantColumn,
    supplierArticleId: reference<'supplier-article'>('supplier_article_id').notNull(),
    metal: metal('metal').notNull(),
    baseEuros: integer('base_euros').notNull(),
    gramsPerThousand: integer('grams_per_thousand').notNull(),
    ...timestamps,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    unique('supplier_article_metals_tenant_id_key').on(table.tenantId, table.id),
    unique('supplier_article_metals_once').on(table.tenantId, table.supplierArticleId, table.metal),
    foreignKey({
      columns: [table.tenantId, table.supplierArticleId],
      foreignColumns: [supplierArticles.tenantId, supplierArticles.id],
      name: 'supplier_article_metals_link_in_tenant',
    }).onDelete('cascade'),
    check(
      'supplier_article_metals_in_range',
      sql`${table.baseEuros} between 0 and ${sql.raw(String(metalLimits.baseEuros))} and ${table.gramsPerThousand} between 0 and ${sql.raw(String(metalLimits.gramsPerThousand))}`,
    ),
  ],
)

/**
 * A supplier's price for a metal from a day on (#462), in cents for 100 kg,
 * as the wholesaler shows it in its portal. Entered in the office, never
 * fetched. Like a purchase price: no sync columns, read by the owner and the
 * office only, inserted and removed, never changed; one a day per metal.
 */
export const supplierMetalPrices = pgTable(
  'supplier_metal_prices',
  {
    id: primaryId<'supplier-metal-price'>(),
    ...tenantColumn,
    supplierId: reference<'supplier'>('supplier_id').notNull(),
    metal: metal('metal').notNull(),
    validFrom: date('valid_from').notNull(),
    priceCents: integer('price_cents').notNull(),
    ...timestamps,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    unique('supplier_metal_prices_tenant_id_key').on(table.tenantId, table.id),
    unique('supplier_metal_prices_one_a_day').on(
      table.tenantId,
      table.supplierId,
      table.metal,
      table.validFrom,
    ),
    foreignKey({
      columns: [table.tenantId, table.supplierId],
      foreignColumns: [suppliers.tenantId, suppliers.id],
      name: 'supplier_metal_prices_supplier_in_tenant',
    }).onDelete('cascade'),
    check(
      'supplier_metal_prices_in_range',
      sql`${table.priceCents} between 1 and ${sql.raw(String(metalLimits.priceCents))}`,
    ),
  ],
)
