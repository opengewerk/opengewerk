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
  Query,
} from '@nestjs/common'
import {
  type ArticleId,
  type ArticlePriceId,
  articleProblems,
  articleUnitProblem,
  isAllowed,
  isCalendarDay,
  lumpSumPriceBaseProblem,
  missingPermission,
  type PurchasePriceId,
  type PriceBase,
  priceBaseOf,
  priceProblems,
  type SupplierArticleId,
  type SupplierId,
  supplierNumberProblem,
} from '@opengewerk/domain'
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

import { Database, type TenantTransaction } from '../database/database.js'
import { isUuid } from '../database/identifier.js'
import {
  articlePrices,
  articles,
  purchasePrices,
  supplierArticles,
  suppliers,
} from '../database/schema/index.js'
import { todayInGermany } from '../today.js'
import { RequiresPermission } from './authorization.js'
import { pick, requireSomething } from './body.js'
import { isUniqueViolation } from './database-errors.js'
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

      return { total: total?.rows ?? 0, rows }
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

      return {
        ...article,
        prices,
        suppliers: links.map((link) => ({
          ...link,
          purchasePrices: readsPurchase
            ? purchase.filter((price) => price.supplierArticleId === link.id)
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

  /** A selling price from a day on. One a day; a price is never changed, only replaced or removed. */
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

      return removed
    })
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
