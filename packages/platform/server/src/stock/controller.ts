import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  type Provider,
  Put,
  Query,
  type Type,
} from '@nestjs/common'
import {
  type StockArticleId,
  stockMovementProblems,
  type StockSupplierId,
  type StoreId,
  storeArticleProblems,
  storeProblems,
} from '@opengewerk/platform-domain'
import { and, eq, isNull, sql } from 'drizzle-orm'

import { RequiresPermission } from '../api/authorization.js'
import { pick, requireSomething } from '../api/body.js'
import { CurrentIdentity, type RequestIdentity } from '../api/identity.js'
import type { AccessRules } from '../authentication/access.js'
import { Database, type TenantTransaction } from '../database/database.js'
import { isUuid } from '../database/identifier.js'
import type { StockTables } from '../database/schema/stock.js'

export const STOCK_ROUTES = Symbol('StockRoutes')

const noStore = 'Diesen Lagerort gibt es nicht oder nicht mehr.'
const noArticle = 'Diesen Artikel gibt es nicht oder nicht mehr.'
const noSupplier = 'Diesen Lieferanten gibt es nicht oder nicht mehr.'
const notStocked = 'Dieser Artikel zählt nicht in einer Menge, die ein Lager führt.'
const stillHolds = 'Der Lagerort hat noch Bestand. Erst umlagern oder auf null zählen.'

/**
 * The tables of the stock as the foundation knows them. An application hands
 * its own, with columns of its own beside, as these: the routes read and
 * write only what every stock has, and an application's fields of a store by
 * name (`storeFields`).
 */
type AnyStock = StockTables

export interface StockRoutes {
  /** The stock of the application, made with `stockSchema`. */
  readonly tables: AnyStock
  /**
   * Columns of the application at a store that its routes write, such as
   * whether it is a vehicle; each is checked by `storeProblems` below.
   */
  readonly storeFields?: readonly string[]
  /**
   * What is wrong with the application's fields of a store, as the store
   * would stand afterwards, by field. The foundation checks its own.
   */
  readonly storeProblems?: (
    store: Readonly<Record<string, unknown>>,
  ) => Readonly<Record<string, string>>
  /**
   * Whether an article may lie in a store: an application whose articles are
   * also sold by the hour or as a lump sum keeps those out.
   */
  readonly stockable?: (unit: string) => boolean
}

export interface StockRights<Right extends string> {
  /** Reading the stores, their stock and their bookings. */
  readonly read: Right
  /** Keeping the stores and booking receipts, transfers and counts. */
  readonly write: Right
}

/** The stock of one article in one store, in thousandths of its unit. */
export interface StockLevel {
  readonly storeId: string
  readonly articleId: string
  readonly levelMilli: number
}

/**
 * The stock the bookings make, per store and article, as `stockLevel` of the
 * domain works it out: the last count sets it to what was found, and every
 * booking taken in after it adds or takes away. In the order the server took
 * them in, which is the order of their creation and, within a transaction,
 * of their keys.
 */
export async function stockLevels(
  tx: TenantTransaction,
  storeId: string | null = null,
): Promise<StockLevel[]> {
  const ofStore = storeId === null ? sql`` : sql`and store_id = ${storeId}`
  const { rows } = await tx.execute<{ store_id: string; article_id: string; level: string }>(sql`
    with moved as (
      select store_id, article_id, kind, quantity_milli, created_at, id
        from stock_movements where deleted_at is null ${ofStore}
    ), counted as (
      select distinct on (store_id, article_id) store_id, article_id, created_at, id, quantity_milli
        from moved where kind = 'count'
       order by store_id, article_id, created_at desc, id desc
    )
    select moved.store_id, moved.article_id,
           coalesce(counted.quantity_milli, 0) + coalesce(sum(
             case when moved.kind in ('receipt', 'transfer_in') then moved.quantity_milli
                  when moved.kind in ('withdrawal', 'transfer_out', 'write_off') then -moved.quantity_milli
                  else 0 end
           ) filter (where counted.id is null or (moved.created_at, moved.id) > (counted.created_at, counted.id)), 0) as level
      from moved
      left join counted on counted.store_id = moved.store_id and counted.article_id = moved.article_id
     group by moved.store_id, moved.article_id, counted.quantity_milli`)

  return rows.map((row) => ({
    storeId: row.store_id,
    articleId: row.article_id,
    levelMilli: Number(row.level),
  }))
}

function refuse(problems: Readonly<Record<string, string>>): void {
  const problem = Object.values(problems)[0]

  if (problem !== undefined) {
    throw new BadRequestException(problem)
  }
}

/** A text as a form hands it over: trimmed, and an empty one is none. */
function tidied(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value
  }

  const trimmed = value.trim()

  return trimmed === '' ? null : trimmed
}

function tidiedAll(values: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values).map(([field, value]) => [field, tidied(value)]))
}

async function storeOf(tx: TenantTransaction, tables: AnyStock, id: string) {
  const { stores } = tables
  const [store] = isUuid(id)
    ? await tx
        .select()
        .from(stores)
        .where(and(eq(stores.id, id as StoreId), isNull(stores.deletedAt)))
    : []

  if (!store) {
    throw new NotFoundException(noStore)
  }

  return store as Record<string, unknown> & { readonly id: StoreId; readonly name: string }
}

async function stockedArticle(tx: TenantTransaction, routes: StockRoutes, id: unknown) {
  const { articles } = routes.tables
  const [article] =
    typeof id === 'string' && isUuid(id)
      ? await tx
          .select({ id: articles.id, unit: articles.unit })
          .from(articles)
          .where(and(eq(articles.id, id as StockArticleId), isNull(articles.deletedAt)))
      : []

  if (!article) {
    throw new BadRequestException(noArticle)
  }

  if (routes.stockable && !routes.stockable(article.unit)) {
    throw new BadRequestException(notStocked)
  }

  return article
}

async function requireSupplier(
  tx: TenantTransaction,
  tables: AnyStock,
  id: unknown,
): Promise<void> {
  const { suppliers } = tables
  const [found] =
    typeof id === 'string' && isUuid(id)
      ? await tx
          .select({ id: suppliers.id })
          .from(suppliers)
          .where(and(eq(suppliers.id, id as StockSupplierId), isNull(suppliers.deletedAt)))
      : []

  if (!found) {
    throw new BadRequestException(noSupplier)
  }
}

/** One booking, by whoever asks; written once. */
async function book(
  tx: TenantTransaction,
  tables: AnyStock,
  identity: RequestIdentity,
  booking: Readonly<Record<string, unknown>>,
) {
  const [booked] = await tx
    .insert(tables.stockMovements)
    .values({ ...booking, tenantId: identity.tenantId, bookedBy: identity.userId } as never)
    .returning()

  return booked
}

/**
 * The stores of an application, what they keep and the bookings their stock
 * is made of (ADR 0011, opengewerk#298): listed with what is wrong in them,
 * kept, and booked by the office. A booking is written once and never
 * changed; a correction is a new one, a count that sets the stock to what was
 * found and says why. A store with stock is not taken away.
 *
 * Who may is the application's to say, with two rights. A withdrawal for a
 * job is no route of its own here: an application books it from what it
 * knows, such as a signed report.
 *
 * Made by a function because the rights are the application's. Nothing but
 * its routes is on the class.
 */
function stockController(rights: StockRights<string>): Type<unknown> {
  @Controller('stores')
  class StockController {
    constructor(
      readonly database: Database,
      @Inject(STOCK_ROUTES) readonly routes: StockRoutes,
    ) {}

    /** The stores, each with how many articles it keeps, how many below their minimum and how many below zero. */
    @Get()
    @RequiresPermission(rights.read)
    list(@CurrentIdentity() identity: RequestIdentity) {
      const { stores, storeArticles } = this.routes.tables

      return this.database.forTenant(identity, async (tx) => {
        const rows = await tx
          .select()
          .from(stores)
          .where(isNull(stores.deletedAt))
          .orderBy(sql`lower(${stores.name})`)
        const levels = await stockLevels(tx)
        const kept = await tx
          .select({
            storeId: storeArticles.storeId,
            articleId: storeArticles.articleId,
            minimumMilli: storeArticles.minimumMilli,
          })
          .from(storeArticles)
          .where(isNull(storeArticles.deletedAt))

        return rows.map((store) => {
          const level = new Map(
            levels
              .filter((row) => row.storeId === store.id)
              .map((row) => [row.articleId, row.levelMilli]),
          )
          const minimum = new Map(
            kept
              .filter((row) => row.storeId === store.id)
              .map((row) => [String(row.articleId), row.minimumMilli]),
          )
          const articles = new Set([...level.keys(), ...minimum.keys()])
          const below = [...articles].filter((article) => {
            const at = minimum.get(article)

            return at !== undefined && at !== null && (level.get(article) ?? 0) < at
          })

          return {
            ...store,
            articles: articles.size,
            belowMinimum: below.filter((article) => (level.get(article) ?? 0) >= 0).length,
            belowZero: [...level.values()].filter((value) => value < 0).length,
          }
        })
      })
    }

    @Post()
    @RequiresPermission(rights.write)
    create(@CurrentIdentity() identity: RequestIdentity, @Body() body: unknown) {
      const values = tidiedAll(pick(body, ['name', 'location', ...(this.routes.storeFields ?? [])]))

      refuse(storeProblems({ name: null, ...values }))
      refuse(this.routes.storeProblems?.(values) ?? {})

      return this.database.forTenant(identity, async (tx) => {
        const [created] = await tx
          .insert(this.routes.tables.stores)
          .values({ ...values, tenantId: identity.tenantId } as never)
          .returning()

        return created
      })
    }

    @Patch(':id')
    @RequiresPermission(rights.write)
    change(
      @CurrentIdentity() identity: RequestIdentity,
      @Param('id') id: string,
      @Body() body: unknown,
    ) {
      const values = tidiedAll(pick(body, ['name', 'location', ...(this.routes.storeFields ?? [])]))

      requireSomething(values)
      refuse(storeProblems(values))

      return this.database.forTenant(identity, async (tx) => {
        const current = await storeOf(tx, this.routes.tables, id)

        refuse(this.routes.storeProblems?.({ ...current, ...values }) ?? {})

        const { stores } = this.routes.tables
        const [changed] = await tx
          .update(stores)
          .set({ ...values, updatedAt: new Date() } as never)
          .where(eq(stores.id, current.id))
          .returning()

        return changed
      })
    }

    /** Marked as deleted, and only once nothing lies in it any more. */
    @Delete(':id')
    @RequiresPermission(rights.write)
    remove(@CurrentIdentity() identity: RequestIdentity, @Param('id') id: string) {
      return this.database.forTenant(identity, async (tx) => {
        const current = await storeOf(tx, this.routes.tables, id)
        const levels = await stockLevels(tx, current.id)

        if (levels.some((row) => row.levelMilli !== 0)) {
          throw new ConflictException(stillHolds)
        }

        const { stores } = this.routes.tables
        const [removed] = await tx
          .update(stores)
          .set({ deletedAt: new Date() } as never)
          .where(eq(stores.id, current.id))
          .returning()

        return removed
      })
    }

    /** A store with what it keeps: every article it has a place, a minimum or a booking for. */
    @Get(':id')
    @RequiresPermission(rights.read)
    one(@CurrentIdentity() identity: RequestIdentity, @Param('id') id: string) {
      const { articles, storeArticles } = this.routes.tables

      return this.database.forTenant(identity, async (tx) => {
        const store = await storeOf(tx, this.routes.tables, id)
        const levels = new Map(
          (await stockLevels(tx, store.id)).map((row) => [row.articleId, row.levelMilli]),
        )
        const kept = await tx
          .select({
            id: storeArticles.id,
            articleId: storeArticles.articleId,
            bin: storeArticles.bin,
            minimumMilli: storeArticles.minimumMilli,
          })
          .from(storeArticles)
          .where(and(eq(storeArticles.storeId, store.id), isNull(storeArticles.deletedAt)))
        const ids = [...new Set([...levels.keys(), ...kept.map((row) => row.articleId)])]
        const named =
          ids.length === 0
            ? []
            : await tx
                .select({
                  id: articles.id,
                  number: articles.number,
                  designation: articles.designation,
                  unit: articles.unit,
                })
                .from(articles)
                .where(sql`${articles.id} = any(${sql.param(ids)}::uuid[])`)
        const place = new Map(kept.map((row) => [row.articleId, row]))
        const stock = named
          .map((article) => ({
            articleId: article.id,
            number: article.number,
            designation: article.designation,
            unit: article.unit,
            storeArticleId: place.get(article.id)?.id ?? null,
            bin: place.get(article.id)?.bin ?? null,
            minimumMilli: place.get(article.id)?.minimumMilli ?? null,
            levelMilli: levels.get(article.id) ?? 0,
          }))
          .sort((left, right) => left.number.localeCompare(right.number, 'de', { numeric: true }))

        return { ...store, stock }
      })
    }

    /** Where an article lies in a store and its minimum there, written for the first time or anew. */
    @Put(':id/articles/:articleId')
    @RequiresPermission(rights.write)
    keep(
      @CurrentIdentity() identity: RequestIdentity,
      @Param('id') id: string,
      @Param('articleId') articleId: string,
      @Body() body: unknown,
    ) {
      const values = tidiedAll(pick(body, ['bin', 'minimumMilli']))

      refuse(storeArticleProblems(values))

      return this.database.forTenant(identity, async (tx) => {
        const store = await storeOf(tx, this.routes.tables, id)
        const article = await stockedArticle(tx, this.routes, articleId)
        const { storeArticles } = this.routes.tables
        const [existing] = await tx
          .select({ id: storeArticles.id })
          .from(storeArticles)
          .where(and(eq(storeArticles.storeId, store.id), eq(storeArticles.articleId, article.id)))

        if (existing) {
          const [changed] = await tx
            .update(storeArticles)
            .set({ ...values, deletedAt: null, updatedAt: new Date() } as never)
            .where(eq(storeArticles.id, existing.id))
            .returning()

          return changed
        }

        const [created] = await tx
          .insert(storeArticles)
          .values({
            tenantId: identity.tenantId,
            storeId: store.id,
            articleId: article.id,
            ...values,
          } as never)
          .returning()

        return created
      })
    }

    /**
     * The bookings of a store, the latest first, with the article, the other
     * store and the supplier by name. Who booked is the account; a screen names
     * the people of the business itself.
     */
    @Get(':id/movements')
    @RequiresPermission(rights.read)
    movements(
      @CurrentIdentity() identity: RequestIdentity,
      @Param('id') id: string,
      @Query('offset') offset?: string,
      @Query('limit') limit?: string,
    ) {
      const from = Number(offset ?? 0)
      const size = Number(limit ?? 20)

      if (
        !Number.isInteger(from) ||
        from < 0 ||
        !Number.isInteger(size) ||
        size < 1 ||
        size > 100
      ) {
        throw new BadRequestException('Eine Seite beginnt ab 0 und hat 1 bis 100 Zeilen.')
      }

      return this.database.forTenant(identity, async (tx) => {
        const store = await storeOf(tx, this.routes.tables, id)
        const { rows: counted } = await tx.execute<{ total: string }>(sql`
          select count(*) as total from stock_movements where store_id = ${store.id} and deleted_at is null`)
        const { rows } = await tx.execute(sql`
          select m.*, a.number as article_number, a.designation as article_designation, a.unit as article_unit,
                 o.name as counterpart_name, s.name as supplier_name
            from stock_movements m
            join articles a on a.id = m.article_id
            left join stores o on o.id = m.counterpart_store_id
            left join suppliers s on s.id = m.supplier_id
           where m.store_id = ${store.id} and m.deleted_at is null
           order by m.created_at desc, m.id desc
           offset ${from} limit ${size}`)

        return { total: Number(counted[0]?.total ?? 0), rows }
      })
    }

    /** What came in, from a supplier where it is said. */
    @Post(':id/receipts')
    @RequiresPermission(rights.write)
    receipt(
      @CurrentIdentity() identity: RequestIdentity,
      @Param('id') id: string,
      @Body() body: unknown,
    ) {
      const values = tidiedAll(pick(body, ['articleId', 'quantityMilli', 'supplierId', 'reason']))

      refuse(stockMovementProblems({ ...values, kind: 'receipt' }))

      return this.database.forTenant(identity, async (tx) => {
        const store = await storeOf(tx, this.routes.tables, id)
        const article = await stockedArticle(tx, this.routes, values['articleId'])

        if (values['supplierId'] !== undefined && values['supplierId'] !== null) {
          await requireSupplier(tx, this.routes.tables, values['supplierId'])
        }

        return book(tx, this.routes.tables, identity, {
          storeId: store.id,
          articleId: article.id,
          kind: 'receipt',
          quantityMilli: values['quantityMilli'],
          supplierId: values['supplierId'] ?? null,
          reason: values['reason'] ?? null,
        })
      })
    }

    /** Moved from this store into another: two bookings, one out of each, naming the other store. */
    @Post(':id/transfers')
    @RequiresPermission(rights.write)
    transfer(
      @CurrentIdentity() identity: RequestIdentity,
      @Param('id') id: string,
      @Body() body: unknown,
    ) {
      const values = tidiedAll(pick(body, ['articleId', 'quantityMilli', 'toStoreId']))

      refuse(
        stockMovementProblems({
          kind: 'transfer_out',
          quantityMilli: values['quantityMilli'],
          storeId: id,
          counterpartStoreId: values['toStoreId'],
        }),
      )

      return this.database.forTenant(identity, async (tx) => {
        const from = await storeOf(tx, this.routes.tables, id)
        const to = await storeOf(tx, this.routes.tables, String(values['toStoreId']))
        const article = await stockedArticle(tx, this.routes, values['articleId'])
        const out = await book(tx, this.routes.tables, identity, {
          storeId: from.id,
          articleId: article.id,
          kind: 'transfer_out',
          quantityMilli: values['quantityMilli'],
          counterpartStoreId: to.id,
        })
        const into = await book(tx, this.routes.tables, identity, {
          storeId: to.id,
          articleId: article.id,
          kind: 'transfer_in',
          quantityMilli: values['quantityMilli'],
          counterpartStoreId: from.id,
        })

        return [out, into]
      })
    }

    /** What was found, which the stock is set to, and why. */
    @Post(':id/counts')
    @RequiresPermission(rights.write)
    count(
      @CurrentIdentity() identity: RequestIdentity,
      @Param('id') id: string,
      @Body() body: unknown,
    ) {
      const values = tidiedAll(pick(body, ['articleId', 'quantityMilli', 'reason']))

      refuse(stockMovementProblems({ ...values, kind: 'count', reason: values['reason'] ?? null }))

      return this.database.forTenant(identity, async (tx) => {
        const store = await storeOf(tx, this.routes.tables, id)
        const article = await stockedArticle(tx, this.routes, values['articleId'])

        return book(tx, this.routes.tables, identity, {
          storeId: store.id,
          articleId: article.id,
          kind: 'count',
          quantityMilli: values['quantityMilli'],
          reason: values['reason'],
        })
      })
    }
  }

  return StockController
}

/** What the routes of the stock are put together from. */
export interface StockParts<Right extends string> {
  /** The rights of the application, which have to hold the ones named below. */
  readonly access: Pick<AccessRules<Right>, 'catalogue'>
  readonly rights: StockRights<Right>
  readonly routes: StockRoutes
}

/**
 * The routes of the stock and what they are handed, for the module of an
 * application, the way `contactParts` puts the contacts together. Refuses an
 * application whose catalogue lacks a right it names: that would only show
 * with the first request.
 */
export function stockParts<Right extends string>(
  parts: StockParts<Right>,
): { readonly controllers: Type<unknown>[]; readonly providers: Provider[] } {
  for (const right of [parts.rights.read, parts.rights.write]) {
    if (!parts.access.catalogue.isRight(right)) {
      throw new Error(`The catalogue lacks a right of the stock: ${right}`)
    }
  }

  return {
    controllers: [stockController(parts.rights)],
    providers: [{ provide: STOCK_ROUTES, useValue: parts.routes }],
  }
}
