import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common'
import {
  type ArticleId,
  type ArticlePriceId,
  articleMetalProblem,
  articleProblems,
  articleUnitProblem,
  isAllowed,
  isCalendarDay,
  lumpSumPriceBaseProblem,
  markupOf,
  markupOnMetalOf,
  markupProblem,
  type Metal,
  metals,
  missingPermission,
  type PurchasePriceId,
  type PriceBase,
  priceBaseOf,
  priceProblems,
  type SupplierArticleId,
  type SupplierId,
  supplierNumberProblem,
  type TenantId,
} from '@opengewerk/domain'
import {
  Database,
  isUniqueViolation,
  isUuid,
  pick,
  requireSomething,
  type TenantTransaction,
} from '@opengewerk/platform-server'
import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  max,
  or,
  type SQL,
  sql,
} from 'drizzle-orm'

import { parameterAt } from '../database/parameters.js'
import {
  articleMarkups,
  articlePriceOrigins,
  articlePrices,
  articles,
  purchasePrices,
  supplierArticleMetals,
  supplierArticles,
  supplierMarkups,
  suppliers,
} from '../database/schema/index.js'
import { articlePricesOn } from '../documents/article-prices.js'
import { articleMetalsOn } from '../pricing/metal-surcharges.js'
import { followPurchasePrices } from '../pricing/selling-prices.js'
import { todayInGermany } from '../today.js'
import { RequiresPermission } from './authorization.js'
import { CurrentIdentity, type RequestIdentity } from './identity.js'
import { requireReferences } from './references.js'

const writableFields = [
  'number',
  'designation',
  'description',
  'ean',
  'unit',
  'groupOfGoods',
  'frequent',
] as const

/**
 * The article of the row, spelt out for the subqueries of the list. Drizzle
 * writes a column of the one table of a select without its table, and inside
 * a subquery that joins two more tables a bare "id" is ambiguous.
 */
const articleOfRow = sql`${sql.identifier('articles')}.${sql.identifier('id')}`

/** The most rows one page of the list carries. */
const pageMax = 100

/**
 * The fields of a request as a form sends them: trimmed, and an empty optional
 * text as nothing. Only the named fields are read and written, never a key the
 * request brings along (CodeQL, js/remote-property-injection).
 */
function tidied<Field extends string>(
  body: unknown,
  fields: readonly Field[],
): Partial<Record<Field, unknown>> {
  const values = pick(body, fields)
  const tidy: Partial<Record<Field, unknown>> = {}

  for (const field of fields) {
    if (!(field in values)) {
      continue
    }

    const value = values[field]

    if (typeof value !== 'string') {
      tidy[field] = value
      continue
    }

    const trimmed = value.trim()
    const optional = field === 'description' || field === 'ean' || field === 'groupOfGoods'
    tidy[field] = optional && trimmed === '' ? null : trimmed
  }

  return tidy
}

/** Refuses with the first of the problems, the sentence the form shows beside the field. */
function requireNoProblem(problems: Readonly<Record<string, string>>): void {
  const [problem] = Object.values(problems)

  if (problem) {
    throw new BadRequestException(problem)
  }
}

/**
 * A price from a day on out of a request body, or a refusal with the sentence
 * of the rule. Its price unit is one when the body names none (#456).
 */
function priceFrom(body: unknown): {
  unitPriceCents: number
  validFrom: string
  priceBase: PriceBase
} {
  const values = pick(body, ['unitPriceCents', 'validFrom', 'priceBase'] as const)
  requireNoProblem(priceProblems(values))

  return {
    unitPriceCents: values.unitPriceCents as number,
    validFrom: values.validFrom as string,
    priceBase: priceBaseOf(values.priceBase),
  }
}

/**
 * Refuses a price for several units of an article counted as a lump sum
 * (#456), the rule a position has as well: "je 100 psch." says nothing.
 */
function perOneForLumpSum(unit: unknown, priceBase: number): void {
  const problem = lumpSumPriceBaseProblem({ unit, priceBase })

  if (problem) {
    throw new BadRequestException(problem)
  }
}

/** `%` and `_` of a search as themselves, not as the wildcards of LIKE. */
function likePattern(search: string): string {
  return `%${search.replaceAll(/[\\%_]/g, '\\$&')}%`
}

function requirePurchaseRight(identity: RequestIdentity, permission: 'purchase.write'): void {
  if (!isAllowed(identity, permission)) {
    throw new ForbiddenException(missingPermission(permission))
  }
}

const numberTaken = 'Diese Nummer hat schon ein anderer Artikel.'
const dayTaken = 'Für diesen Tag gibt es schon einen Preis. Erst den alten entfernen.'

/**
 * The articles of the business (#296), the whole catalogue: listed page by
 * page, since a catalogue from DATANORM does not fit into one answer, and a
 * device holds only the frequent ones through the sync. Kept here and only
 * here, by the owner and the office.
 *
 * The purchase prices, and with them what the business pays, go only to
 * whoever may read them (decided on 27.09.2026); everybody else gets `null`
 * in their place, so that a screen cannot tell a missing price from a hidden
 * one.
 */
@Controller('articles')
export class ArticlesController {
  constructor(private readonly database: Database) {}

  /**
   * One page of the list, by the own number or by name, narrowed by a search
   * over number, name, EAN, supplier and the supplier's number, by the
   * frequent ones and by a group of goods. With the selling price of today and
   * the first supplier, and how many more there are.
   *
   * `on` asks for the selling price of another day: a position takes the one
   * of its document's date (#296), and that is what the choice of an article
   * in a line shows before anybody takes it.
   */
  @Get()
  @RequiresPermission('article.read')
  async list(
    @CurrentIdentity() identity: RequestIdentity,
    @Query('search') search?: string,
    @Query('frequent') frequent?: string,
    @Query('group') group?: string,
    @Query('sort') sort?: string,
    @Query('offset') offset?: string,
    @Query('limit') limit?: string,
    @Query('on') on?: string,
  ) {
    const from = Number(offset ?? 0)
    const size = Number(limit ?? 50)

    if (on !== undefined && !isCalendarDay(on)) {
      throw new BadRequestException('Ein Tag ist ein Datum im Kalender, zum Beispiel 2026-09-28.')
    }

    if (
      !Number.isInteger(from) ||
      from < 0 ||
      !Number.isInteger(size) ||
      size < 1 ||
      size > pageMax
    ) {
      throw new BadRequestException(
        `Eine Seite beginnt ab 0 und hat 1 bis ${String(pageMax)} Zeilen.`,
      )
    }

    const conditions: SQL[] = [isNull(articles.deletedAt)]
    const wanted = search?.trim() ?? ''

    if (wanted !== '') {
      const pattern = likePattern(wanted)
      const bySupplier = sql`exists (select 1 from supplier_articles sa
        join suppliers s on s.id = sa.supplier_id and s.deleted_at is null
        where sa.article_id = ${articleOfRow}
          and (s.name ilike ${pattern} or sa.supplier_number ilike ${pattern}))`

      conditions.push(
        or(
          ilike(articles.number, pattern),
          ilike(articles.designation, pattern),
          ilike(articles.ean, pattern),
          bySupplier,
        ) as SQL,
      )
    }

    if (frequent === 'true') {
      conditions.push(eq(articles.frequent, true))
    }

    if (group !== undefined && group.trim() !== '') {
      conditions.push(eq(articles.groupOfGoods, group.trim()))
    }

    const day = on ?? todayInGermany()
    const where = and(...conditions)
    const order =
      sort === 'designation'
        ? [asc(sql`lower(${articles.designation})`), asc(articles.id)]
        : [asc(sql`lower(${articles.number})`), asc(articles.id)]

    return this.database.forTenant(identity, async (tx) => {
      const [total] = await tx.select({ rows: count() }).from(articles).where(where)
      const rows = await tx
        .select({
          id: articles.id,
          number: articles.number,
          designation: articles.designation,
          description: articles.description,
          unit: articles.unit,
          groupOfGoods: articles.groupOfGoods,
          frequent: articles.frequent,
          priceCents: sql<number | null>`(select p.unit_price_cents from article_prices p
            where p.article_id = ${articleOfRow} and p.deleted_at is null and p.valid_from <= ${day}
            order by p.valid_from desc limit 1)`,
          // The price unit of that same price (#456); one price a day, so both
          // questions find the same row.
          priceBase: sql<PriceBase | null>`(select p.price_base from article_prices p
            where p.article_id = ${articleOfRow} and p.deleted_at is null and p.valid_from <= ${day}
            order by p.valid_from desc limit 1)`,
          supplierName: sql<string | null>`(select s.name from supplier_articles sa
            join suppliers s on s.id = sa.supplier_id and s.deleted_at is null
            where sa.article_id = ${articleOfRow} order by sa.created_at, sa.id limit 1)`,
          suppliers: sql<number>`(select count(*)::int from supplier_articles sa
            join suppliers s on s.id = sa.supplier_id and s.deleted_at is null
            where sa.article_id = ${articleOfRow})`,
        })
        .from(articles)
        .where(where)
        .orderBy(...order)
        .offset(from)
        .limit(size)

      if (on === undefined) {
        return { total: total?.rows ?? 0, rows }
      }

      // Asked for a document's date, the price is the one a line of that day
      // takes, with the metal surcharge in it (#462).
      const lines = await articlePricesOn(
        tx,
        rows.map((row) => row.id),
        day,
      )

      return {
        total: total?.rows ?? 0,
        rows: rows.map((row) => {
          const line = lines.get(row.id)

          return line === undefined
            ? row
            : { ...row, priceCents: line.unitPriceCents, priceBase: line.priceBase }
        }),
      }
    })
  }

  /** The groups of goods the business has used, for the choice beside the search. */
  @Get('groups')
  @RequiresPermission('article.read')
  async groups(@CurrentIdentity() identity: RequestIdentity) {
    const rows = await this.database.forTenant(identity, (tx) =>
      tx
        .selectDistinct({ group: articles.groupOfGoods })
        .from(articles)
        .where(and(isNull(articles.deletedAt), sql`${articles.groupOfGoods} is not null`))
        .orderBy(asc(articles.groupOfGoods)),
    )

    return rows.map((row) => row.group)
  }

  /**
   * One article with its selling prices, newest first, and the suppliers that
   * sell it under their numbers, each with its purchase prices for whoever may
   * read them.
   */
  @Get(':id')
  @RequiresPermission('article.read')
  one(@CurrentIdentity() identity: RequestIdentity, @Param('id') id: string) {
    const readsPurchase = isAllowed(identity, 'purchase.read')

    return this.database.forTenant(identity, async (tx) => {
      const article = await articleOf(tx, id)
      const prices = await tx
        .select()
        .from(articlePrices)
        .where(and(eq(articlePrices.articleId, article.id), isNull(articlePrices.deletedAt)))
        .orderBy(desc(articlePrices.validFrom))
      const links = await tx
        .select({
          id: supplierArticles.id,
          supplierId: supplierArticles.supplierId,
          supplierName: suppliers.name,
          supplierNumber: supplierArticles.supplierNumber,
          main: supplierArticles.main,
        })
        .from(supplierArticles)
        .innerJoin(
          suppliers,
          and(eq(suppliers.id, supplierArticles.supplierId), isNull(suppliers.deletedAt)),
        )
        .where(eq(supplierArticles.articleId, article.id))
        .orderBy(asc(suppliers.name))
      const purchase =
        readsPurchase && links.length > 0
          ? await tx
              .select()
              .from(purchasePrices)
              .where(
                inArray(
                  purchasePrices.supplierArticleId,
                  links.map((link) => link.id),
                ),
              )
              .orderBy(desc(purchasePrices.validFrom))
          : []

      const pricing = readsPurchase ? await pricingOf(tx, article.id, links, prices) : null
      const metalRows =
        readsPurchase && links.length > 0
          ? await tx
              .select({
                supplierArticleId: supplierArticleMetals.supplierArticleId,
                metal: supplierArticleMetals.metal,
                baseEuros: supplierArticleMetals.baseEuros,
                gramsPerThousand: supplierArticleMetals.gramsPerThousand,
              })
              .from(supplierArticleMetals)
              .where(
                inArray(
                  supplierArticleMetals.supplierArticleId,
                  links.map((link) => link.id),
                ),
              )
              .orderBy(asc(supplierArticleMetals.metal))
          : []

      return {
        ...article,
        prices: prices.map((price) => ({
          ...price,
          origin: pricing?.origins.get(price.id) ?? null,
        })),
        pricing: pricing?.pricing ?? null,
        suppliers: links.map((link) => ({
          ...link,
          purchasePrices: readsPurchase
            ? purchase.filter((price) => price.supplierArticleId === link.id)
            : null,
          markup: pricing?.suppliers.get(link.supplierId) ?? null,
          metals: readsPurchase
            ? metalRows
                .filter((row) => row.supplierArticleId === link.id)
                .map(({ metal, baseEuros, gramsPerThousand }) => ({
                  metal,
                  baseEuros,
                  gramsPerThousand,
                }))
            : null,
        })),
      }
    })
  }

  /** A new article, and with it its first selling price if the form has one. */
  @Post()
  @RequiresPermission('article.write')
  async create(@CurrentIdentity() identity: RequestIdentity, @Body() body: unknown) {
    const values = tidied(body, writableFields)
    requireNoProblem(
      articleProblems({
        number: values['number'],
        designation: values['designation'],
        unit: values['unit'],
        ...values,
      }),
    )
    const first =
      typeof body === 'object' && body !== null && 'price' in body && body.price !== null
        ? priceFrom(body.price)
        : null

    if (first) {
      perOneForLumpSum(values['unit'], first.priceBase)
    }

    try {
      return await this.database.forTenant(identity, async (tx) => {
        const [created] = await tx
          .insert(articles)
          .values({ ...(values as typeof articles.$inferInsert), tenantId: identity.tenantId })
          .returning()

        if (created && first) {
          await tx
            .insert(articlePrices)
            .values({ ...first, articleId: created.id, tenantId: identity.tenantId })
          await fixedByHand(tx, identity.tenantId, created.id)
        }

        return created
      })
    } catch (error) {
      throw isUniqueViolation(error, 'articles_number_once')
        ? new ConflictException(numberTaken)
        : error
    }
  }

  @Patch(':id')
  @RequiresPermission('article.write')
  async update(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const values = tidied(body, writableFields)
    requireSomething(values)
    requireNoProblem(articleProblems(values))

    try {
      return await this.database.forTenant(identity, async (tx) => {
        const article = await articleOf(tx, id, 'unit' in values ? 'update' : null)

        if ('unit' in values) {
          await unitKeepsPrices(tx, article.id, values['unit'])
        }

        const [updated] = await tx
          .update(articles)
          .set(values as Partial<typeof articles.$inferInsert>)
          .where(and(eq(articles.id, article.id), isNull(articles.deletedAt)))
          .returning()

        return updated
      })
    } catch (error) {
      throw isUniqueViolation(error, 'articles_number_once')
        ? new ConflictException(numberTaken)
        : error
    }
  }

  /**
   * Marked as deleted, since devices hold the frequent ones. Its prices and
   * who sells it go with it, by the trigger `material_follows_deletion`. A
   * position that took it over keeps its text: it was never the article's.
   */
  @Delete(':id')
  @RequiresPermission('article.write')
  async remove(@CurrentIdentity() identity: RequestIdentity, @Param('id') id: string) {
    return this.database.forTenant(identity, async (tx) => {
      const article = await articleOf(tx, id)
      const [removed] = await tx
        .update(articles)
        .set({ deletedAt: new Date() })
        .where(and(eq(articles.id, article.id), isNull(articles.deletedAt)))
        .returning()

      return removed
    })
  }

  /**
   * A selling price from a day on. One a day; a price is never changed, only
   * replaced or removed. Entered by hand, it makes the article's price fixed
   * (#463): it no longer follows the purchase price.
   */
  @Post(':id/prices')
  @RequiresPermission('article.write')
  async addPrice(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const price = priceFrom(body)

    try {
      return await this.database.forTenant(identity, async (tx) => {
        const article = await articleOf(tx, id, 'share')

        perOneForLumpSum(article.unit, price.priceBase)

        const [created] = await tx
          .insert(articlePrices)
          .values({ ...price, articleId: article.id, tenantId: identity.tenantId })
          .returning()

        await fixedByHand(tx, identity.tenantId, article.id)

        return created
      })
    } catch (error) {
      throw isUniqueViolation(error, 'article_prices_one_a_day')
        ? new ConflictException(dayTaken)
        : error
    }
  }

  @Delete(':id/prices/:priceId')
  @RequiresPermission('article.write')
  async removePrice(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('id') id: string,
    @Param('priceId') priceId: string,
  ) {
    if (!isUuid(priceId)) {
      throw new NotFoundException()
    }

    return this.database.forTenant(identity, async (tx) => {
      const article = await articleOf(tx, id)
      const [removed] = await tx
        .update(articlePrices)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(articlePrices.id, priceId as ArticlePriceId),
            eq(articlePrices.articleId, article.id),
            isNull(articlePrices.deletedAt),
          ),
        )
        .returning()

      if (!removed) {
        throw new NotFoundException()
      }

      return removed
    })
  }

  /**
   * That a supplier sells the article, under its number, and with a first
   * purchase price if the request has one, which asks for the right to keep
   * purchase prices on top.
   */
  @Post(':id/suppliers')
  @RequiresPermission('article.write')
  async addSupplier(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const values = tidied(body, ['supplierId', 'supplierNumber'] as const)

    if (typeof values['supplierId'] !== 'string' || !isUuid(values['supplierId'])) {
      throw new BadRequestException('Pflichtangaben fehlen: supplierId')
    }

    const numberProblem = supplierNumberProblem(values['supplierNumber'])

    if (numberProblem) {
      throw new BadRequestException(numberProblem)
    }

    const first =
      typeof body === 'object' && body !== null && 'price' in body && body.price !== null
        ? priceFrom(body.price)
        : null

    if (first) {
      requirePurchaseRight(identity, 'purchase.write')
    }

    try {
      return await this.database.forTenant(identity, async (tx) => {
        const article = await articleOf(tx, id, 'share')

        if (first) {
          perOneForLumpSum(article.unit, first.priceBase)
        }

        await requireReferences(
          tx,
          supplierArticles,
          { articleId: article.id, supplierId: values['supplierId'] },
          true,
        )
        const [created] = await tx
          .insert(supplierArticles)
          .values({
            articleId: article.id,
            supplierId: values['supplierId'] as SupplierId,
            supplierNumber: (values['supplierNumber'] as string | null | undefined) ?? null,
            tenantId: identity.tenantId,
          })
          .returning()

        if (created && first) {
          await tx
            .insert(purchasePrices)
            .values({ ...first, supplierArticleId: created.id, tenantId: identity.tenantId })
        }

        // The first supplier of an article is its main one.
        await followPurchasePrices(tx, identity.tenantId, [article.id], todayInGermany())

        return created
      })
    } catch (error) {
      throw isUniqueViolation(error, 'supplier_articles_once')
        ? new ConflictException('Dieser Lieferant führt den Artikel schon.')
        : error
    }
  }

  /** The supplier's number for the article. */
  @Patch(':id/suppliers/:linkId')
  @RequiresPermission('article.write')
  async updateSupplier(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('id') id: string,
    @Param('linkId') linkId: string,
    @Body() body: unknown,
  ) {
    const values = tidied(body, ['supplierNumber'] as const)
    requireSomething(values)
    const numberProblem = supplierNumberProblem(values['supplierNumber'])

    if (numberProblem) {
      throw new BadRequestException(numberProblem)
    }

    return this.database.forTenant(identity, async (tx) => {
      const link = await linkOf(tx, id, linkId)
      const [updated] = await tx
        .update(supplierArticles)
        .set({
          supplierNumber: (values['supplierNumber'] as string | null | undefined) ?? null,
          updatedAt: new Date(),
        })
        .where(eq(supplierArticles.id, link.id))
        .returning()

      return updated
    })
  }

  /** The supplier no longer sells it: removed, and its purchase prices with it. */
  @Delete(':id/suppliers/:linkId')
  @RequiresPermission('article.write')
  async removeSupplier(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('id') id: string,
    @Param('linkId') linkId: string,
  ) {
    return this.database.forTenant(identity, async (tx) => {
      const link = await linkOf(tx, id, linkId)
      const [removed] = await tx
        .delete(supplierArticles)
        .where(eq(supplierArticles.id, link.id))
        .returning()

      // Where it was the main one, the oldest left follows it.
      await followPurchasePrices(tx, identity.tenantId, [link.articleId], todayInGermany())

      return removed
    })
  }

  /** A purchase price from a day on at one supplier, for whoever keeps purchase prices. */
  @Post(':id/suppliers/:linkId/prices')
  @RequiresPermission('purchase.write')
  async addPurchasePrice(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('id') id: string,
    @Param('linkId') linkId: string,
    @Body() body: unknown,
  ) {
    const price = priceFrom(body)

    try {
      return await this.database.forTenant(identity, async (tx) => {
        const link = await linkOf(tx, id, linkId, 'share')

        perOneForLumpSum(link.articleUnit, price.priceBase)

        const [created] = await tx
          .insert(purchasePrices)
          .values({ ...price, supplierArticleId: link.id, tenantId: identity.tenantId })
          .returning()

        // From its day on, and never backwards.
        await followPurchasePrices(tx, identity.tenantId, [link.articleId], todayInGermany())

        return created
      })
    } catch (error) {
      throw isUniqueViolation(error, 'purchase_prices_one_a_day')
        ? new ConflictException(dayTaken)
        : error
    }
  }

  @Delete(':id/suppliers/:linkId/prices/:priceId')
  @RequiresPermission('purchase.write')
  async removePurchasePrice(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('id') id: string,
    @Param('linkId') linkId: string,
    @Param('priceId') priceId: string,
  ) {
    if (!isUuid(priceId)) {
      throw new NotFoundException()
    }

    return this.database.forTenant(identity, async (tx) => {
      const link = await linkOf(tx, id, linkId)
      const [removed] = await tx
        .delete(purchasePrices)
        .where(
          and(
            eq(purchasePrices.id, priceId as PurchasePriceId),
            eq(purchasePrices.supplierArticleId, link.id),
          ),
        )
        .returning()

      if (!removed) {
        throw new NotFoundException()
      }

      await followPurchasePrices(tx, identity.tenantId, [link.articleId], todayInGermany())

      return removed
    })
  }

  /**
   * The purchase price of the article's main supplier on a day (#463), for a
   * position in the office that shows it beside its unit price, with the
   * supplier's name. `purchase` is null where there is none.
   */
  @Get(':id/purchase')
  @RequiresPermission('purchase.read')
  purchaseOn(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('id') id: string,
    @Query('on') on: string | undefined,
  ) {
    if (!isCalendarDay(on)) {
      throw new BadRequestException('Der Tag muss ein Datum der Form 2026-01-01 sein.')
    }

    return this.database.forTenant(identity, async (tx) => {
      const article = await articleOf(tx, id)
      const found = await tx.execute(sql`
        select p.unit_price_cents as cents, p.price_base, s.name as supplier_name
          from supplier_articles l
          join purchase_prices p on p.supplier_article_id = l.id
          join suppliers s on s.id = l.supplier_id
         where l.article_id = ${article.id} and l.main and p.valid_from <= ${on}
         order by p.valid_from desc
         limit 1`)
      const row = found.rows[0]
      // The metal of the main supplier with its price of the day (#462), and
      // whether the markup comes on the surcharge.
      const metal = (await articleMetalsOn(tx, [article.id], on)).get(article.id) ?? null

      return {
        purchase:
          row === undefined
            ? null
            : {
                cents: Number(row['cents']),
                priceBase: Number(row['price_base']) as PriceBase,
                supplierName: row['supplier_name'] as string,
              },
        metal,
      }
    })
  }

  /**
   * How the article's selling price comes about (#463): fixed, or following
   * the purchase price of its main supplier with a markup of its own or,
   * without one, the supplier's or the business's. From today on, at once.
   */
  @Put(':id/pricing')
  @RequiresPermission('purchase.write')
  async setPricing(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const { fixed, basisPoints, markupOnMetal: said } = pricingFrom(body)

    return this.database.forTenant(identity, async (tx) => {
      const article = await articleOf(tx, id, 'share')
      const [held] = await tx
        .select({ id: articleMarkups.id, markupOnMetal: articleMarkups.markupOnMetal })
        .from(articleMarkups)
        .where(eq(articleMarkups.articleId, article.id))
      // Not in the request: what the article said about the metal stays (#462).
      const markupOnMetal = said === undefined ? (held?.markupOnMetal ?? null) : said

      if (!fixed && basisPoints === null && markupOnMetal === null) {
        // The supplier's or the business's: nothing of its own to say.
        if (held) {
          await tx.delete(articleMarkups).where(eq(articleMarkups.id, held.id))
        }
      } else if (held) {
        await tx
          .update(articleMarkups)
          .set({ fixed, basisPoints, markupOnMetal, updatedAt: new Date() })
          .where(eq(articleMarkups.id, held.id))
      } else {
        await tx.insert(articleMarkups).values({
          tenantId: identity.tenantId,
          articleId: article.id,
          fixed,
          basisPoints,
          markupOnMetal,
        })
      }

      const added = await followPurchasePrices(
        tx,
        identity.tenantId,
        [article.id],
        todayInGermany(),
      )

      return { fixed, basisPoints, markupOnMetal, prices: added }
    })
  }

  /**
   * The metal of the article at one supplier (#462), all of it: a metal the
   * request leaves out is taken off the link. Entered by hand where the
   * catalogue says nothing or says it wrong; the next import writes the copper
   * its catalogue names.
   */
  @Put(':id/suppliers/:linkId/metals')
  @RequiresPermission('purchase.write')
  async setMetals(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('id') id: string,
    @Param('linkId') linkId: string,
    @Body() body: unknown,
  ) {
    const wanted = linkMetalsFrom(body)

    return this.database.forTenant(identity, async (tx) => {
      const link = await linkOf(tx, id, linkId, 'share')
      const held = await tx
        .select()
        .from(supplierArticleMetals)
        .where(eq(supplierArticleMetals.supplierArticleId, link.id))

      for (const metal of metals) {
        const before = held.find((row) => row.metal === metal)
        const after = wanted.find((row) => row.metal === metal)

        if (after === undefined) {
          if (before !== undefined) {
            await tx.delete(supplierArticleMetals).where(eq(supplierArticleMetals.id, before.id))
          }
        } else if (before === undefined) {
          await tx.insert(supplierArticleMetals).values({
            tenantId: identity.tenantId,
            supplierArticleId: link.id,
            ...after,
          })
        } else if (
          before.baseEuros !== after.baseEuros ||
          before.gramsPerThousand !== after.gramsPerThousand
        ) {
          await tx
            .update(supplierArticleMetals)
            .set({
              baseEuros: after.baseEuros,
              gramsPerThousand: after.gramsPerThousand,
              updatedAt: new Date(),
            })
            .where(eq(supplierArticleMetals.id, before.id))
        }
      }

      return { metals: wanted }
    })
  }

  /** Another supplier becomes the main one, whose purchase price makes the selling price. */
  @Put(':id/suppliers/:linkId/main')
  @RequiresPermission('purchase.write')
  async setMain(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('id') id: string,
    @Param('linkId') linkId: string,
  ) {
    return this.database.forTenant(identity, async (tx) => {
      const link = await linkOf(tx, id, linkId, 'share')

      if (!link.main) {
        // The old one first: one main supplier per article (`supplier_articles_one_main`).
        await tx
          .update(supplierArticles)
          .set({ main: false, updatedAt: new Date() })
          .where(
            and(eq(supplierArticles.articleId, link.articleId), eq(supplierArticles.main, true)),
          )
        await tx
          .update(supplierArticles)
          .set({ main: true, updatedAt: new Date() })
          .where(eq(supplierArticles.id, link.id))
        await followPurchasePrices(tx, identity.tenantId, [link.articleId], todayInGermany())
      }

      return { id: link.id, main: true }
    })
  }
}

/**
 * What the request says about an article's selling price, refused where it
 * says nothing that fits. `markupOnMetal` is the article's word on the metal
 * surcharge (#462): true, false, null for its supplier's, or left out to keep
 * what it said.
 */
function pricingFrom(body: unknown): {
  fixed: boolean
  basisPoints: number | null
  markupOnMetal: boolean | null | undefined
} {
  const fields = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>
  const fixed = fields['fixed']
  const basisPoints = fields['basisPoints'] ?? null
  const markupOnMetal = fields['markupOnMetal']

  if (markupOnMetal !== undefined && markupOnMetal !== null && typeof markupOnMetal !== 'boolean') {
    throw new BadRequestException('Der Aufschlag auf den Metallzuschlag ist an, aus oder offen.')
  }

  if (typeof fixed !== 'boolean') {
    throw new BadRequestException('Pflichtangaben fehlen: fixed')
  }

  if (fixed && basisPoints !== null) {
    throw new BadRequestException('Ein fester Verkaufspreis hat keinen Aufschlag.')
  }

  const problem = basisPoints === null ? null : markupProblem(basisPoints)

  if (problem) {
    throw new BadRequestException(problem)
  }

  return { fixed, basisPoints: basisPoints as number | null, markupOnMetal }
}

/** The metals of a link as the request names them, each once, refused where one does not fit. */
function linkMetalsFrom(
  body: unknown,
): { readonly metal: Metal; readonly baseEuros: number; readonly gramsPerThousand: number }[] {
  const listed =
    typeof body === 'object' && body !== null ? (body as Record<string, unknown>)['metals'] : null

  if (!Array.isArray(listed)) {
    throw new BadRequestException('Pflichtangaben fehlen: metals')
  }

  return listed.map((entry: unknown, index) => {
    const fields = (typeof entry === 'object' && entry !== null ? entry : {}) as Record<
      string,
      unknown
    >
    const metal = fields['metal']

    if (
      typeof metal !== 'string' ||
      !(metals as readonly string[]).includes(metal) ||
      listed.findIndex(
        (other: unknown) => (other as Record<string, unknown> | null)?.['metal'] === metal,
      ) !== index
    ) {
      throw new BadRequestException('Jedes Metall steht einmal da, Kupfer oder Aluminium.')
    }

    const problem = articleMetalProblem(fields['baseEuros'], fields['gramsPerThousand'])

    if (problem) {
      throw new BadRequestException(problem)
    }

    return {
      metal: metal as Metal,
      baseEuros: fields['baseEuros'] as number,
      gramsPerThousand: fields['gramsPerThousand'] as number,
    }
  })
}

/**
 * What the office reads about an article's selling price (#463): whether it
 * is fixed, its own markup, the one that applies and where that comes from,
 * the own markups of its suppliers, and what each price that follows came
 * from. Only for whoever may read purchase prices.
 */
async function pricingOf(
  tx: TenantTransaction,
  articleId: ArticleId,
  links: readonly { readonly supplierId: SupplierId; readonly main: boolean }[],
  prices: readonly { readonly id: ArticlePriceId }[],
) {
  const [own] = await tx
    .select({
      fixed: articleMarkups.fixed,
      basisPoints: articleMarkups.basisPoints,
      markupOnMetal: articleMarkups.markupOnMetal,
    })
    .from(articleMarkups)
    .where(eq(articleMarkups.articleId, articleId))
  const supplierRows =
    links.length > 0
      ? await tx
          .select({
            supplierId: supplierMarkups.supplierId,
            basisPoints: supplierMarkups.basisPoints,
            markupOnMetal: supplierMarkups.markupOnMetal,
          })
          .from(supplierMarkups)
          .where(
            inArray(
              supplierMarkups.supplierId,
              links.map((link) => link.supplierId),
            ),
          )
      : []
  const originRows =
    prices.length > 0
      ? await tx
          .select({
            articlePriceId: articlePriceOrigins.articlePriceId,
            purchaseCents: articlePriceOrigins.purchaseCents,
            basisPoints: articlePriceOrigins.basisPoints,
          })
          .from(articlePriceOrigins)
          .where(
            inArray(
              articlePriceOrigins.articlePriceId,
              prices.map((price) => price.id),
            ),
          )
      : []
  const suppliersOwn = new Map(supplierRows.map((row) => [row.supplierId, row.basisPoints]))
  const main = links.find((link) => link.main)
  const supplier = main === undefined ? null : (suppliersOwn.get(main.supplierId) ?? null)
  const today = todayInGermany()
  const business = (await parameterAt(tx, 'material.markup_basis_points', today))?.value ?? null
  // What the article's main supplier, else the business, says about the
  // markup on the metal surcharge (#462), for "Wie beim Lieferanten".
  const supplierOnMetal =
    main === undefined
      ? null
      : (supplierRows.find((row) => row.supplierId === main.supplierId)?.markupOnMetal ?? null)
  const businessOnMetal = (await parameterAt(tx, 'material.markup_on_metal', today))?.value === 1
  const markup = markupOf(own, supplier, business)
  const source =
    markup === null
      ? null
      : own?.basisPoints !== null && own?.basisPoints !== undefined
        ? ('article' as const)
        : supplier !== null
          ? ('supplier' as const)
          : ('business' as const)

  return {
    pricing: {
      fixed: own?.fixed ?? false,
      basisPoints: own?.basisPoints ?? null,
      markup,
      source,
      // What applies without a markup of its own, and the business's, which
      // a supplier without its own has.
      inherited: supplier ?? business,
      business,
      markupOnMetal: own?.markupOnMetal ?? null,
      metalInherited: markupOnMetalOf(null, supplierOnMetal, businessOnMetal),
      metalInheritedFrom: supplierOnMetal === null ? ('business' as const) : ('supplier' as const),
    },
    suppliers: suppliersOwn,
    origins: new Map(
      originRows.map((row) => [
        row.articlePriceId,
        { purchaseCents: row.purchaseCents, basisPoints: row.basisPoints },
      ]),
    ),
  }
}

/**
 * A selling price entered by hand is fixed (#463, decided on 28.09.2026): it
 * stays until somebody enters another, whatever the purchase price does, and
 * an import leaves it alone. An article with a markup of its own gives it up.
 */
async function fixedByHand(
  tx: TenantTransaction,
  tenantId: TenantId,
  articleId: ArticleId,
): Promise<void> {
  const [said] = await tx
    .select({ id: articleMarkups.id, fixed: articleMarkups.fixed })
    .from(articleMarkups)
    .where(eq(articleMarkups.articleId, articleId))

  if (said === undefined) {
    await tx.insert(articleMarkups).values({ tenantId, articleId, fixed: true, basisPoints: null })
  } else if (!said.fixed) {
    await tx
      .update(articleMarkups)
      .set({ fixed: true, basisPoints: null, updatedAt: new Date() })
      .where(eq(articleMarkups.id, said.id))
  }
}

/**
 * The article of the path, not deleted, or a 404, the same for one of another
 * business. Held with FOR SHARE where a row is about to hang on it, so that it
 * is not deleted or made a lump sum between the look and the write, and with
 * FOR UPDATE where its unit changes, so that no price for several units comes
 * in between the look at its prices and the change (#456).
 */
async function articleOf(
  tx: TenantTransaction,
  id: string,
  hold: 'share' | 'update' | null = null,
) {
  if (!isUuid(id)) {
    throw new NotFoundException()
  }

  const query = tx
    .select()
    .from(articles)
    .where(and(eq(articles.id, id as ArticleId), isNull(articles.deletedAt)))
  const [article] = hold === null ? await query : await query.for(hold)

  if (!article) {
    throw new NotFoundException()
  }

  return article
}

/**
 * The supplier of an article by the id of the link, both of the path, or a
 * 404, with the article held as `articleOf` holds it.
 */
async function linkOf(
  tx: TenantTransaction,
  id: string,
  linkId: string,
  hold: 'share' | null = null,
) {
  const article = await articleOf(tx, id, hold)

  if (!isUuid(linkId)) {
    throw new NotFoundException()
  }

  const [link] = await tx
    .select()
    .from(supplierArticles)
    .where(
      and(
        eq(supplierArticles.id, linkId as SupplierArticleId),
        eq(supplierArticles.articleId, article.id),
      ),
    )
    .for('update')

  if (!link) {
    throw new NotFoundException()
  }

  // What the article is counted in, which a purchase price's unit depends on.
  return { ...link, articleUnit: article.unit }
}

/**
 * Refuses a unit an article's prices do not allow (#456): an article with a
 * price for several units, selling or purchase, does not become a lump sum,
 * since "je 100 psch." says nothing and an invoice from a report would take
 * such a price into a line the database refuses. The article is held FOR
 * UPDATE by then, and every new price holds it FOR SHARE.
 */
async function unitKeepsPrices(
  tx: TenantTransaction,
  articleId: ArticleId,
  unit: unknown,
): Promise<void> {
  if (unit !== 'flat_rate') {
    return
  }

  const [selling] = await tx
    .select({ widest: max(articlePrices.priceBase) })
    .from(articlePrices)
    .where(and(eq(articlePrices.articleId, articleId), isNull(articlePrices.deletedAt)))
  const [purchase] = await tx
    .select({ widest: max(purchasePrices.priceBase) })
    .from(purchasePrices)
    .innerJoin(supplierArticles, eq(supplierArticles.id, purchasePrices.supplierArticleId))
    .where(eq(supplierArticles.articleId, articleId))
  const problem = articleUnitProblem(
    unit,
    priceBaseOf(Math.max(selling?.widest ?? 1, purchase?.widest ?? 1)),
  )

  if (problem) {
    throw new BadRequestException(problem)
  }
}
