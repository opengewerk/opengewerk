import { articleLimits, priceCentsMax } from '@opengewerk/domain'
import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

import { primaryId, reference, syncColumns, timestamps } from './columns.js'
import { lineUnit } from './document-lines.js'
import { tenantIsolation } from './rls.js'
import { suppliers } from './suppliers.js'
import { tenantColumn } from './tenants.js'

const fits = (column: unknown, limit: number) =>
  sql`char_length(${column}) between 1 and ${sql.raw(String(limit))}`

const prices = (column: unknown) => sql`${column} between 0 and ${sql.raw(String(priceCentsMax))}`

/**
 * An article of the business (#296): the own number, what it is called and
 * counted in, and whether every device holds it. The prices are rows of their
 * own, each from a day on, so that a document of last year still finds the
 * price it was written with.
 *
 * The office reads the catalogue at its routes. A device holds the frequent
 * articles with their prices, whatever its role, and later those used lately
 * as well (decided on 27.09.2026): `articlesOnDevices` narrows the pull for
 * every device, the office's included, because a catalogue from DATANORM
 * does not fit on one.
 */
export const articles = pgTable(
  'articles',
  {
    id: primaryId<'article'>(),
    ...tenantColumn,
    number: text('number').notNull(),
    designation: text('designation').notNull(),
    description: text('description'),
    ean: text('ean'),
    unit: lineUnit('unit').notNull(),
    groupOfGoods: text('group_of_goods'),
    frequent: boolean('frequent').notNull().default(false),
    ...timestamps,
    ...syncColumns,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    unique('articles_tenant_id_key').on(table.tenantId, table.id),
    // A number once per business, however it is written: "a-1042" and
    // "A-1042" are the same article to a person at the counter.
    uniqueIndex('articles_number_once')
      .on(table.tenantId, sql`lower(${table.number})`)
      .where(sql`${table.deletedAt} is null`),
    index('articles_group_idx').on(table.tenantId, table.groupOfGoods),
    // The limits of `articleProblems`, which the forms and the routes ask
    // first, held here for every other way in. The check digit of an EAN is
    // the routes' to judge; here only its shape.
    check('articles_number_fits', fits(table.number, articleLimits.number)),
    check('articles_designation_fits', fits(table.designation, articleLimits.designation)),
    check(
      'articles_group_fits',
      sql`char_length(${table.groupOfGoods}) <= ${sql.raw(String(articleLimits.groupOfGoods))}`,
    ),
    check('articles_ean_shaped', sql`${table.ean} ~ '^([0-9]{8}|[0-9]{13})$'`),
  ],
)

/**
 * A selling price from a day on. Never changed: a new price is a new row, and
 * a price entered by mistake is marked deleted, so that the change log says
 * what a document of that day was priced at.
 */
export const articlePrices = pgTable(
  'article_prices',
  {
    id: primaryId<'article-price'>(),
    ...tenantColumn,
    articleId: reference<'article'>('article_id').notNull(),
    validFrom: date('valid_from').notNull(),
    unitPriceCents: integer('unit_price_cents').notNull(),
    ...timestamps,
    ...syncColumns,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    unique('article_prices_tenant_id_key').on(table.tenantId, table.id),
    foreignKey({
      columns: [table.tenantId, table.articleId],
      foreignColumns: [articles.tenantId, articles.id],
      name: 'article_prices_article_in_tenant',
    }).onDelete('cascade'),
    uniqueIndex('article_prices_one_a_day')
      .on(table.tenantId, table.articleId, table.validFrom)
      .where(sql`${table.deletedAt} is null`),
    check('article_prices_in_range', prices(table.unitPriceCents)),
  ],
)

/**
 * That a supplier sells an article, under its own number. Once per pair.
 *
 * No sync columns, and that is the point: the pull sends every table that has
 * a change sequence to every device, and what hangs here leads to the
 * purchase prices, which only the owner and the office read. Kept at the
 * routes of the office, and removed rather than marked, since no device has
 * to hear of it; the change log keeps what was removed.
 */
export const supplierArticles = pgTable(
  'supplier_articles',
  {
    id: primaryId<'supplier-article'>(),
    ...tenantColumn,
    articleId: reference<'article'>('article_id').notNull(),
    supplierId: reference<'supplier'>('supplier_id').notNull(),
    supplierNumber: text('supplier_number'),
    ...timestamps,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    unique('supplier_articles_tenant_id_key').on(table.tenantId, table.id),
    foreignKey({
      columns: [table.tenantId, table.articleId],
      foreignColumns: [articles.tenantId, articles.id],
      name: 'supplier_articles_article_in_tenant',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.tenantId, table.supplierId],
      foreignColumns: [suppliers.tenantId, suppliers.id],
      name: 'supplier_articles_supplier_in_tenant',
    }).onDelete('cascade'),
    uniqueIndex('supplier_articles_once').on(table.tenantId, table.articleId, table.supplierId),
    index('supplier_articles_supplier_idx').on(table.tenantId, table.supplierId),
    check(
      'supplier_articles_number_fits',
      sql`char_length(${table.supplierNumber}) <= ${sql.raw(String(articleLimits.supplierNumber))}`,
    ),
  ],
)

/**
 * A purchase price from a day on, at one supplier. Only the owner and the
 * office read one, and like `supplier_articles` it has no sync columns, so
 * that no pull ever carries one to a device. Never changed: replaced by a
 * price from a later day, or removed.
 */
export const purchasePrices = pgTable(
  'purchase_prices',
  {
    id: primaryId<'purchase-price'>(),
    ...tenantColumn,
    supplierArticleId: reference<'supplier-article'>('supplier_article_id').notNull(),
    validFrom: date('valid_from').notNull(),
    unitPriceCents: integer('unit_price_cents').notNull(),
    ...timestamps,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    unique('purchase_prices_tenant_id_key').on(table.tenantId, table.id),
    foreignKey({
      columns: [table.tenantId, table.supplierArticleId],
      foreignColumns: [supplierArticles.tenantId, supplierArticles.id],
      name: 'purchase_prices_supplier_article_in_tenant',
    }).onDelete('cascade'),
    uniqueIndex('purchase_prices_one_a_day').on(
      table.tenantId,
      table.supplierArticleId,
      table.validFrom,
    ),
    check('purchase_prices_in_range', prices(table.unitPriceCents)),
  ],
)
