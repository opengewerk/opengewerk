import { stockLimits, stockMovementKinds, stockUnits } from '@opengewerk/platform-domain'
import { type BuildColumns, type BuildExtraConfigColumns, sql } from 'drizzle-orm'
import {
  check,
  foreignKey,
  index,
  integer,
  type PgColumnBuilderBase,
  pgTable,
  type PgTableExtraConfigValue,
  type PgTableWithColumns,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

import { primaryId, reference, syncColumns, timestamps } from './columns.js'
import { memberships } from './memberships.js'
import { tenantIsolation } from './rls.js'
import { tenantColumn } from './tenants.js'

// The stock as a building block (ADR 0011): articles, suppliers, stores, the
// minimum a store keeps of an article, and the bookings. Tables an
// application makes with this function and its own columns, like the
// contacts, so that the foundation knows neither a price nor what a
// withdrawal hangs on. They carry the columns of the sync; an article, a
// supplier and a store are marked and never removed, a booking is written
// once, which the migration of the application holds with a trigger.

/** A text from one character up to the bound. */
const fits = (column: unknown, most: number) =>
  sql`char_length(${column}) between 1 and ${sql.raw(String(most))}`

/** A text the row may leave empty, bounded where it is there. */
const fitsIfThere = (column: unknown, most: number) =>
  sql`${column} is null or char_length(${column}) <= ${sql.raw(String(most))}`

/** One of the words of a list, as a check of the database. */
const oneOf = (column: unknown, words: readonly string[]) =>
  sql`${column} in (${sql.raw(words.map((word) => `'${word}'`).join(', '))})`

function articleParts() {
  return {
    id: primaryId<'article'>(),
    ...tenantColumn,
    number: text('number').notNull(),
    designation: text('designation').notNull(),
    description: text('description'),
    ean: text('ean'),
    unit: text('unit').notNull(),
    ...timestamps,
    ...syncColumns,
  }
}

function supplierParts() {
  return {
    id: primaryId<'supplier'>(),
    ...tenantColumn,
    name: text('name').notNull(),
    customerNumber: text('customer_number'),
    email: text('email'),
    phone: text('phone'),
    street: text('street'),
    houseNumber: text('house_number'),
    postalCode: text('postal_code'),
    city: text('city'),
    country: text('country').notNull().default('DE'),
    notes: text('notes'),
    ...timestamps,
    ...syncColumns,
  }
}

function storeParts() {
  return {
    id: primaryId<'store'>(),
    ...tenantColumn,
    name: text('name').notNull(),
    location: text('location'),
    ...timestamps,
    ...syncColumns,
  }
}

function storeArticleParts() {
  return {
    id: primaryId<'store-article'>(),
    ...tenantColumn,
    storeId: reference<'store'>('store_id').notNull(),
    articleId: reference<'article'>('article_id').notNull(),
    minimumMilli: integer('minimum_milli'),
    ...timestamps,
    ...syncColumns,
  }
}

function movementParts() {
  return {
    id: primaryId<'stock-movement'>(),
    ...tenantColumn,
    storeId: reference<'store'>('store_id').notNull(),
    articleId: reference<'article'>('article_id').notNull(),
    kind: text('kind').notNull(),
    quantityMilli: integer('quantity_milli').notNull(),
    supplierId: reference<'supplier'>('supplier_id'),
    reason: text('reason'),
    bookedBy: text('booked_by').notNull(),
    bookedAt: timestamp('booked_at', { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
    ...syncColumns,
  }
}

export type StockArticleColumns = ReturnType<typeof articleParts>
export type StockMovementColumns = ReturnType<typeof movementParts>

/** Columns an application adds to a table of the stock; none may take a name the table has. */
export type OwnStockColumns = Record<string, PgColumnBuilderBase>

/** The articles of an application with these columns of its own. */
export type StockArticlesTable<Own extends OwnStockColumns = Record<never, never>> =
  PgTableWithColumns<{
    name: 'articles'
    schema: undefined
    columns: BuildColumns<'articles', StockArticleColumns & Own, 'pg'>
    dialect: 'pg'
  }>

/** The bookings of an application with these columns of its own. */
export type StockMovementsTable<Own extends OwnStockColumns = Record<never, never>> =
  PgTableWithColumns<{
    name: 'stock_movements'
    schema: undefined
    columns: BuildColumns<'stock_movements', StockMovementColumns & Own, 'pg'>
    dialect: 'pg'
  }>

/** A table of the stock without columns of the application, as drizzle names its type. */
type PlainTable<
  Name extends string,
  Columns extends Record<string, PgColumnBuilderBase>,
> = PgTableWithColumns<{
  name: Name
  schema: undefined
  columns: BuildColumns<Name, Columns, 'pg'>
  dialect: 'pg'
}>

/** The tables of the stock of an application. */
export interface StockTables<
  OwnArticle extends OwnStockColumns = Record<never, never>,
  OwnMovement extends OwnStockColumns = Record<never, never>,
> {
  readonly articles: StockArticlesTable<OwnArticle>
  readonly suppliers: PlainTable<'suppliers', ReturnType<typeof supplierParts>>
  readonly stores: PlainTable<'stores', ReturnType<typeof storeParts>>
  readonly storeArticles: PlainTable<'store_articles', ReturnType<typeof storeArticleParts>>
  readonly stockMovements: StockMovementsTable<OwnMovement>
}

/** What an application says about a table of the stock: its own columns and their constraints. */
export interface OwnStockTable<Name extends string, Columns, Own extends OwnStockColumns> {
  readonly columns?: Own
  readonly constraints?: (
    table: BuildExtraConfigColumns<Name, Columns & Own, 'pg'>,
  ) => PgTableExtraConfigValue[]
}

/** What an application says about its stock. */
export interface StockOptions<
  OwnArticle extends OwnStockColumns,
  OwnMovement extends OwnStockColumns,
> {
  /** Columns of the application at an article, such as a price. */
  readonly articles?: OwnStockTable<'articles', StockArticleColumns, OwnArticle>
  /** Columns of the application at a booking, such as what a withdrawal hangs on. */
  readonly movements?: OwnStockTable<'stock_movements', StockMovementColumns, OwnMovement>
}

/** The columns of the application, refused where one takes the name of a column the table has. */
function ownColumns<Own extends OwnStockColumns>(
  table: string,
  base: Readonly<Record<string, unknown>>,
  own: Own | undefined,
): Own {
  const columns = own ?? ({} as Own)
  const taken = Object.keys(columns).filter((name) => name in base)

  if (taken.length > 0) {
    throw new Error(`The ${table} have these columns already: ${taken.join(', ')}.`)
  }

  return columns
}

/**
 * The stock of an application (ADR 0011): five tables, made with the columns
 * of the application's own at the articles and the bookings. Called without
 * options it is the stock as the foundation knows it.
 *
 * The checks hold the bounds of `domain` for every way in: a number of an
 * article once per tenant however it is written, an EAN of its shape, a unit
 * of the list, a quantity from zero, a booking that adds or takes more than
 * nothing, a count with its reason and a supplier only at a receipt.
 */
export function stockSchema<
  OwnArticle extends OwnStockColumns = Record<never, never>,
  OwnMovement extends OwnStockColumns = Record<never, never>,
>(options: StockOptions<OwnArticle, OwnMovement> = {}): StockTables<OwnArticle, OwnMovement> {
  const articleBase = articleParts()
  const ownArticle = ownColumns('articles', articleBase, options.articles?.columns)
  const articles = pgTable(
    'articles',
    { ...articleBase, ...ownArticle } as StockArticleColumns & OwnArticle,
    (table) => [
      tenantIsolation(table.tenantId),
      unique('articles_tenant_id_key').on(table.tenantId, table.id),
      // A number once per tenant, however it is written: "a-1042" and
      // "A-1042" are the same article to a person at the shelf.
      uniqueIndex('articles_number_once')
        .on(table.tenantId, sql`lower(${table.number})`)
        .where(sql`${table.deletedAt} is null`),
      // A scan finds an article by its EAN.
      index('articles_ean_idx')
        .on(table.tenantId, table.ean)
        .where(sql`${table.ean} is not null and ${table.deletedAt} is null`),
      check('articles_number_fits', fits(table.number, stockLimits.articleNumber)),
      check('articles_designation_fits', fits(table.designation, stockLimits.designation)),
      check('articles_description_fits', fitsIfThere(table.description, stockLimits.description)),
      check('articles_ean_shaped', sql`${table.ean} ~ '^([0-9]{8}|[0-9]{13})$'`),
      check('articles_unit_known', oneOf(table.unit, stockUnits)),
      ...(options.articles?.constraints?.(table) ?? []),
    ],
  )

  const suppliers = pgTable('suppliers', supplierParts(), (table) => [
    tenantIsolation(table.tenantId),
    unique('suppliers_tenant_id_key').on(table.tenantId, table.id),
    check('suppliers_name_fits', fits(table.name, stockLimits.supplierName)),
    check(
      'suppliers_customer_number_fits',
      fitsIfThere(table.customerNumber, stockLimits.customerNumber),
    ),
    check('suppliers_country_code', sql`${table.country} ~ '^[A-Z]{2}$'`),
  ])

  const stores = pgTable('stores', storeParts(), (table) => [
    tenantIsolation(table.tenantId),
    unique('stores_tenant_id_key').on(table.tenantId, table.id),
    check('stores_name_fits', fits(table.name, stockLimits.storeName)),
    check('stores_location_fits', fitsIfThere(table.location, stockLimits.location)),
  ])

  const storeArticles = pgTable('store_articles', storeArticleParts(), (table) => [
    tenantIsolation(table.tenantId),
    unique('store_articles_tenant_id_key').on(table.tenantId, table.id),
    // What a store keeps of an article is one row.
    unique('store_articles_once').on(table.tenantId, table.storeId, table.articleId),
    foreignKey({
      columns: [table.tenantId, table.storeId],
      foreignColumns: [stores.tenantId, stores.id],
      name: 'store_articles_in_a_store_here',
    }),
    foreignKey({
      columns: [table.tenantId, table.articleId],
      foreignColumns: [articles.tenantId, articles.id],
      name: 'store_articles_of_an_article_here',
    }),
    check(
      'store_articles_minimum_from_zero',
      sql`${table.minimumMilli} is null or ${table.minimumMilli} between 0 and ${sql.raw(String(stockLimits.quantityMilli))}`,
    ),
  ])

  const movementBase = movementParts()
  const ownMovement = ownColumns('stock movements', movementBase, options.movements?.columns)
  const stockMovements = pgTable(
    'stock_movements',
    { ...movementBase, ...ownMovement } as StockMovementColumns & OwnMovement,
    (table) => [
      tenantIsolation(table.tenantId),
      unique('stock_movements_tenant_id_key').on(table.tenantId, table.id),
      foreignKey({
        columns: [table.tenantId, table.storeId],
        foreignColumns: [stores.tenantId, stores.id],
        name: 'stock_movements_in_a_store_here',
      }),
      foreignKey({
        columns: [table.tenantId, table.articleId],
        foreignColumns: [articles.tenantId, articles.id],
        name: 'stock_movements_of_an_article_here',
      }),
      foreignKey({
        columns: [table.tenantId, table.supplierId],
        foreignColumns: [suppliers.tenantId, suppliers.id],
        name: 'stock_movements_from_a_supplier_here',
      }),
      foreignKey({
        columns: [table.tenantId, table.bookedBy],
        foreignColumns: [memberships.tenantId, memberships.userId],
        name: 'stock_movements_by_somebody_here',
      }),
      // The bookings of one article in one store, in the order they came.
      index('stock_movements_of_an_article_idx').on(
        table.tenantId,
        table.storeId,
        table.articleId,
        table.createdAt,
      ),
      check('stock_movements_kind_known', oneOf(table.kind, stockMovementKinds)),
      check(
        'stock_movements_quantity_from_zero',
        sql`${table.quantityMilli} between 0 and ${sql.raw(String(stockLimits.quantityMilli))}`,
      ),
      // Only a count may find nothing; a receipt and a withdrawal move something.
      check(
        'stock_movements_moves_something',
        sql`${table.kind} = 'count' or ${table.quantityMilli} > 0`,
      ),
      check(
        'stock_movements_count_with_a_reason',
        sql`${table.kind} <> 'count' or ${table.reason} is not null`,
      ),
      check('stock_movements_reason_fits', fitsIfThere(table.reason, stockLimits.note)),
      check(
        'stock_movements_supplier_at_a_receipt',
        sql`${table.supplierId} is null or ${table.kind} = 'receipt'`,
      ),
      ...(options.movements?.constraints?.(table) ?? []),
    ],
  )

  return { articles, suppliers, stores, storeArticles, stockMovements }
}

/** A booking as every table of bookings has it, whatever else its application keeps beside. */
export type StockMovementRow = StockMovementsTable['$inferSelect']
