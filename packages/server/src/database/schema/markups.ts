import { markupLimits, priceCentsMax } from '@opengewerk/domain'
import { primaryId, reference, tenantIsolation, timestamps } from '@opengewerk/platform-server'
import { tenantColumn } from '@opengewerk/platform-server/schema'
import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  date,
  foreignKey,
  integer,
  pgTable,
  text,
  unique,
} from 'drizzle-orm/pg-core'

import { articlePrices, articles } from './articles.js'
import { suppliers } from './suppliers.js'

const inRange = (column: unknown) =>
  sql`${column} between 0 and ${sql.raw(String(markupLimits.basisPoints))}`

/**
 * A supplier's own markup on material (#463), in place of the business's,
 * and whether it also comes on the metal surcharge (#462). Either may be
 * unset, never both.
 *
 * A table of its own and not a column of `suppliers`: a supplier is master
 * data on every device, and a markup, like a purchase price, never travels.
 * No sync columns, read and written at the routes of the office; removed
 * when the supplier goes back to the business's word on both.
 */
export const supplierMarkups = pgTable(
  'supplier_markups',
  {
    id: primaryId<'supplier-markup'>(),
    ...tenantColumn,
    supplierId: reference<'supplier'>('supplier_id').notNull(),
    basisPoints: integer('basis_points'),
    markupOnMetal: boolean('markup_on_metal'),
    ...timestamps,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    unique('supplier_markups_tenant_id_key').on(table.tenantId, table.id),
    unique('supplier_markups_once').on(table.tenantId, table.supplierId),
    foreignKey({
      columns: [table.tenantId, table.supplierId],
      foreignColumns: [suppliers.tenantId, suppliers.id],
      name: 'supplier_markups_supplier_in_tenant',
    }).onDelete('cascade'),
    check('supplier_markups_in_range', inRange(table.basisPoints)),
    check(
      'supplier_markups_say_something',
      sql`${table.basisPoints} is not null or ${table.markupOnMetal} is not null`,
    ),
  ],
)

/**
 * What an article says about its selling price (#463): fixed, or following
 * the purchase price with a markup of its own. An article without a row
 * follows the purchase price of its main supplier with the markup of that
 * supplier or of the business.
 *
 * Not a column of `articles` for the same reason as `supplier_markups`: an
 * article is on the devices, its markup never is.
 */
export const articleMarkups = pgTable(
  'article_markups',
  {
    id: primaryId<'article-markup'>(),
    ...tenantColumn,
    articleId: reference<'article'>('article_id').notNull(),
    fixed: boolean('fixed').notNull(),
    basisPoints: integer('basis_points'),
    /** Whether the markup also comes on the metal surcharge (#462); null for the supplier's word. */
    markupOnMetal: boolean('markup_on_metal'),
    ...timestamps,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    unique('article_markups_tenant_id_key').on(table.tenantId, table.id),
    unique('article_markups_once').on(table.tenantId, table.articleId),
    foreignKey({
      columns: [table.tenantId, table.articleId],
      foreignColumns: [articles.tenantId, articles.id],
      name: 'article_markups_article_in_tenant',
    }).onDelete('cascade'),
    // Fixed or a markup of its own, never both; a row that says nothing is removed.
    check(
      'article_markups_fixed_without_own',
      sql`not ${table.fixed} or ${table.basisPoints} is null`,
    ),
    check(
      'article_markups_say_something',
      sql`${table.fixed} or ${table.basisPoints} is not null or ${table.markupOnMetal} is not null`,
    ),
    check('article_markups_in_range', inRange(table.basisPoints)),
  ],
)

/**
 * What a selling price that follows a purchase price came from (#463): the
 * purchase price and the markup, so that the office sees why a price is what
 * it is. A selling price entered by hand has none. Beside `article_prices`
 * and not in it: that table is on the devices, and neither figure may be.
 */
export const articlePriceOrigins = pgTable(
  'article_price_origins',
  {
    id: primaryId<'article-price-origin'>(),
    ...tenantColumn,
    articlePriceId: reference<'article-price'>('article_price_id').notNull(),
    /** The purchase price, of the same price unit as the selling price. */
    purchaseCents: integer('purchase_cents').notNull(),
    basisPoints: integer('basis_points').notNull(),
    ...timestamps,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    unique('article_price_origins_tenant_id_key').on(table.tenantId, table.id),
    unique('article_price_origins_once').on(table.tenantId, table.articlePriceId),
    foreignKey({
      columns: [table.tenantId, table.articlePriceId],
      foreignColumns: [articlePrices.tenantId, articlePrices.id],
      name: 'article_price_origins_price_in_tenant',
    }).onDelete('cascade'),
    check(
      'article_price_origins_purchase_in_range',
      sql`${table.purchaseCents} between 0 and ${sql.raw(String(priceCentsMax))}`,
    ),
    check('article_price_origins_in_range', inRange(table.basisPoints)),
  ],
)

/**
 * The selling prices still to be worked out anew after a markup changed
 * (#463): for the articles of one supplier, or of the whole business where
 * `supplier_id` is null, from a day on. One row per business; a further
 * change while it waits widens it. The server works through it in pieces,
 * each in a transaction of its own, so that a catalogue of a wholesaler
 * keeps no device waiting, and takes it up again after a restart.
 */
export const sellingPriceRuns = pgTable(
  'selling_price_runs',
  {
    id: primaryId<'selling-price-run'>(),
    ...tenantColumn,
    supplierId: reference<'supplier'>('supplier_id'),
    fromDay: date('from_day').notNull(),
    /** Who changed the markup; the new prices are written in that name. */
    requestedBy: text('requested_by').notNull(),
    ...timestamps,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    unique('selling_price_runs_tenant_id_key').on(table.tenantId, table.id),
    unique('selling_price_runs_once').on(table.tenantId),
    foreignKey({
      columns: [table.tenantId, table.supplierId],
      foreignColumns: [suppliers.tenantId, suppliers.id],
      name: 'selling_price_runs_supplier_in_tenant',
    }).onDelete('cascade'),
  ],
)
