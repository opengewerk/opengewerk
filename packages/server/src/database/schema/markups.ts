import { markupLimits } from '@opengewerk/domain'
import { primaryId, reference, tenantIsolation, timestamps } from '@opengewerk/platform-server'
import { tenantColumn } from '@opengewerk/platform-server/schema'
import { sql } from 'drizzle-orm'
import { boolean, check, foreignKey, integer, pgTable, unique } from 'drizzle-orm/pg-core'

import { articles } from './articles.js'
import { suppliers } from './suppliers.js'

const inRange = (column: unknown) =>
  sql`${column} between 0 and ${sql.raw(String(markupLimits.basisPoints))}`

/**
 * A supplier's own markup on material (#463), in place of the business's.
 *
 * A table of its own and not a column of `suppliers`: a supplier is master
 * data on every device, and a markup, like a purchase price, never travels.
 * No sync columns, read and written at the routes of the office; removed
 * when the supplier goes back to the business's markup.
 */
export const supplierMarkups = pgTable(
  'supplier_markups',
  {
    id: primaryId<'supplier-markup'>(),
    ...tenantColumn,
    supplierId: reference<'supplier'>('supplier_id').notNull(),
    basisPoints: integer('basis_points').notNull(),
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
    // Either fixed or a markup of its own, never both and never neither.
    check('article_markups_fixed_or_own', sql`${table.fixed} = (${table.basisPoints} is null)`),
    check('article_markups_in_range', inRange(table.basisPoints)),
  ],
)
