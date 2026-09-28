import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common'
import { isAllowed, type SupplierId, supplierProblems } from '@opengewerk/domain'
import { and, asc, count, desc, eq, inArray, isNull, lte, sql } from 'drizzle-orm'

import { Database } from '../database/database.js'
import { articles, purchasePrices, supplierArticles, suppliers } from '../database/schema/index.js'
import { todayInGermany } from '../today.js'
import { RequiresPermission } from './authorization.js'
import { pick, requireSomething } from './body.js'
import { CurrentIdentity, type RequestIdentity } from './identity.js'

const writableFields = [
  'name',
  'customerNumber',
  'email',
  'phone',
  'street',
  'houseNumber',
  'postalCode',
  'city',
  'country',
  'notes',
] as const

/** Refuses with the first of `supplierProblems`, the sentence the form shows beside the field. */
export function requireSupplierFields(values: Readonly<Record<string, unknown>>): void {
  const [problem] = Object.values(supplierProblems(values))

  if (problem) {
    throw new BadRequestException(problem)
  }
}

/**
 * The suppliers of the business (#296): master data like the customers, on
 * every device and created through the outbox on the screens; corrected and
 * removed here, with a connection (ADR 0005). What a supplier sells is read
 * here as well, and its purchase prices only by whoever may read them.
 */
@Controller('suppliers')
export class SuppliersController {
  constructor(private readonly database: Database) {}

  @Get()
  @RequiresPermission('supplier.read')
  list(@CurrentIdentity() identity: RequestIdentity) {
    return this.database.forTenant(identity, (tx) =>
      tx.select().from(suppliers).where(isNull(suppliers.deletedAt)).orderBy(asc(suppliers.name)),
    )
  }

  /** How many articles each supplier sells, for the column "Artikel" of the list. */
  @Get('article-counts')
  @RequiresPermission('supplier.read')
  async articleCounts(@CurrentIdentity() identity: RequestIdentity) {
    const rows = await this.database.forTenant(identity, (tx) =>
      tx
        .select({ supplierId: supplierArticles.supplierId, articles: count() })
        .from(supplierArticles)
        .innerJoin(
          articles,
          and(eq(articles.id, supplierArticles.articleId), isNull(articles.deletedAt)),
        )
        .groupBy(supplierArticles.supplierId),
    )

    return Object.fromEntries(rows.map((row) => [row.supplierId, row.articles]))
  }

  @Post()
  @RequiresPermission('supplier.write')
  async create(@CurrentIdentity() identity: RequestIdentity, @Body() body: unknown) {
    const values = pick(body, writableFields)
    requireSupplierFields({ name: values.name, ...values })

    const [created] = await this.database.forTenant(identity, (tx) =>
      tx
        .insert(suppliers)
        .values({ ...(values as typeof suppliers.$inferInsert), tenantId: identity.tenantId })
        .returning(),
    )

    return created
  }

  @Patch(':id')
  @RequiresPermission('supplier.write')
  async update(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const values = pick(body, writableFields)
    requireSomething(values)
    requireSupplierFields(values)

    const [updated] = await this.database.forTenant(identity, (tx) =>
      tx
        .update(suppliers)
        .set(values as Partial<typeof suppliers.$inferInsert>)
        .where(and(eq(suppliers.id, id as SupplierId), isNull(suppliers.deletedAt)))
        .returning(),
    )

    if (!updated) {
      // The same answer for one that does not exist and one of another
      // business, so that nothing is learnt about the ids of others.
      throw new NotFoundException()
    }

    return updated
  }

  /**
   * Marked as deleted, not removed, since every device holds it. What it sells
   * and its people go with it, by the trigger `material_follows_deletion`.
   */
  @Delete(':id')
  @RequiresPermission('supplier.write')
  async remove(@CurrentIdentity() identity: RequestIdentity, @Param('id') id: string) {
    const [removed] = await this.database.forTenant(identity, (tx) =>
      tx
        .update(suppliers)
        .set({ deletedAt: new Date() })
        .where(and(eq(suppliers.id, id as SupplierId), isNull(suppliers.deletedAt)))
        .returning(),
    )

    if (!removed) {
      throw new NotFoundException()
    }

    return removed
  }

  /**
   * The articles a supplier sells, under its numbers, by the own number, page
   * by page: after a DATANORM import a supplier sells tens of thousands. The
   * purchase price of today goes only to whoever may read purchase prices;
   * everybody else gets `null` there, not a missing field, so that a screen
   * cannot tell an article without a price from one it may not see.
   */
  @Get(':id/articles')
  @RequiresPermission('article.read')
  async articles(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('id') id: string,
    @Query('offset') offset?: string,
    @Query('limit') limit?: string,
  ) {
    const readsPurchase = isAllowed(identity, 'purchase.read')
    const today = todayInGermany()
    const from = Number(offset ?? 0)
    const size = Number(limit ?? 50)

    if (!Number.isInteger(from) || from < 0 || !Number.isInteger(size) || size < 1 || size > 100) {
      throw new BadRequestException('Eine Seite beginnt ab 0 und hat 1 bis 100 Zeilen.')
    }

    return this.database.forTenant(identity, async (tx) => {
      const [supplier] = await tx
        .select({ id: suppliers.id })
        .from(suppliers)
        .where(and(eq(suppliers.id, id as SupplierId), isNull(suppliers.deletedAt)))

      if (!supplier) {
        throw new NotFoundException()
      }

      const sold = and(eq(supplierArticles.supplierId, supplier.id), isNull(articles.deletedAt))
      const [total] = await tx
        .select({ rows: count() })
        .from(supplierArticles)
        .innerJoin(articles, eq(articles.id, supplierArticles.articleId))
        .where(sold)
      const rows = await tx
        .select({
          supplierArticleId: supplierArticles.id,
          supplierNumber: supplierArticles.supplierNumber,
          articleId: articles.id,
          number: articles.number,
          designation: articles.designation,
          unit: articles.unit,
          frequent: articles.frequent,
        })
        .from(supplierArticles)
        .innerJoin(articles, eq(articles.id, supplierArticles.articleId))
        .where(sold)
        .orderBy(asc(sql`lower(${articles.number})`), asc(articles.id))
        .offset(from)
        .limit(size)

      const prices = new Map<
        string,
        { unitPriceCents: number; priceBase: number; validFrom: string }
      >()

      if (readsPurchase && rows.length > 0) {
        const found = await tx
          .select({
            supplierArticleId: purchasePrices.supplierArticleId,
            unitPriceCents: purchasePrices.unitPriceCents,
            priceBase: purchasePrices.priceBase,
            validFrom: purchasePrices.validFrom,
          })
          .from(purchasePrices)
          .where(
            and(
              inArray(
                purchasePrices.supplierArticleId,
                rows.map((row) => row.supplierArticleId),
              ),
              lte(purchasePrices.validFrom, today),
            ),
          )
          .orderBy(desc(purchasePrices.validFrom))

        for (const price of found) {
          if (!prices.has(price.supplierArticleId)) {
            prices.set(price.supplierArticleId, {
              unitPriceCents: price.unitPriceCents,
              priceBase: price.priceBase,
              validFrom: price.validFrom,
            })
          }
        }
      }

      return {
        total: total?.rows ?? 0,
        rows: rows.map((row) => ({
          ...row,
          purchase: readsPurchase ? (prices.get(row.supplierArticleId) ?? null) : null,
        })),
      }
    })
  }
}
