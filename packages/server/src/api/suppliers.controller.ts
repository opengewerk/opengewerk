import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common'
import {
  isAllowed,
  isCalendarDay,
  markupProblem,
  type Metal,
  metalPriceProblem,
  metals,
  type SupplierId,
  type SupplierMetalPriceId,
  supplierProblems,
} from '@opengewerk/domain'
import {
  Database,
  isUniqueViolation,
  isUuid,
  pick,
  requireSomething,
  type TenantTransaction,
} from '@opengewerk/platform-server'
import { and, asc, count, desc, eq, inArray, isNull, lte, sql } from 'drizzle-orm'

import { parameterAt } from '../database/parameters.js'
import {
  articles,
  purchasePrices,
  supplierArticles,
  supplierMarkups,
  supplierMetalPrices,
  suppliers,
} from '../database/schema/index.js'
import { SellingPrices } from '../pricing/selling-prices.js'
import { todayInGermany } from '../today.js'
import { RequiresPermission } from './authorization.js'
import { CurrentIdentity, type RequestIdentity } from './identity.js'

const writableFields = [
  'name',
  'customerNumber',
  'shortCode',
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
  constructor(
    private readonly database: Database,
    private readonly sellingPrices: SellingPrices,
  ) {}

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
          main: supplierArticles.main,
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

  /**
   * The supplier's own markup on material (#463), the business's beside it,
   * and whether selling prices are still being worked out anew. With them
   * what the supplier and the business say about the markup on the metal
   * surcharge (#462).
   */
  @Get(':id/markup')
  @RequiresPermission('purchase.read')
  async markup(@CurrentIdentity() identity: RequestIdentity, @Param('id') id: string) {
    const held = await this.database.forTenant(identity, async (tx) => {
      const supplier = await supplierOf(tx, id)
      const [own] = await tx
        .select({
          basisPoints: supplierMarkups.basisPoints,
          markupOnMetal: supplierMarkups.markupOnMetal,
        })
        .from(supplierMarkups)
        .where(eq(supplierMarkups.supplierId, supplier.id))
      const today = todayInGermany()
      const business = await parameterAt(tx, 'material.markup_basis_points', today)
      const onMetal = await parameterAt(tx, 'material.markup_on_metal', today)

      return {
        basisPoints: own?.basisPoints ?? null,
        business: business?.value ?? null,
        markupOnMetal: own?.markupOnMetal ?? null,
        businessOnMetal: onMetal?.value === 1,
      }
    })

    return { ...held, pending: await this.sellingPrices.pending(identity.tenantId) }
  }

  /**
   * Sets the supplier's own markup, or with null takes it back to the
   * business's. The selling prices of the articles it is the main supplier of
   * follow from today on, worked out in the background. `markupOnMetal` says
   * whether the markup comes on the metal surcharge (#462), null for the
   * business's word; either field left out stays as it was, and a change of
   * the metal alone works out no selling price.
   */
  @Put(':id/markup')
  @RequiresPermission('purchase.write')
  async setMarkup(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const fields = (typeof body === 'object' && body !== null ? body : {}) as Record<
      string,
      unknown
    >
    const marks = 'basisPoints' in fields
    const saidPoints = fields['basisPoints'] ?? null
    const saidMetal = fields['markupOnMetal']
    const problem = saidPoints === null ? null : markupProblem(saidPoints)

    if (problem) {
      throw new BadRequestException(problem)
    }

    if (saidMetal !== undefined && saidMetal !== null && typeof saidMetal !== 'boolean') {
      throw new BadRequestException('Der Aufschlag auf den Metallzuschlag ist an, aus oder offen.')
    }

    const written = await this.database.forTenant(identity, async (tx) => {
      const supplier = await supplierOf(tx, id)

      // First, before the markup is written and logged (`request`).
      if (marks) {
        await this.sellingPrices.request(tx, {
          tenantId: identity.tenantId,
          userId: identity.userId,
          supplierId: supplier.id,
          from: todayInGermany(),
        })
      }

      const [held] = await tx
        .select({
          basisPoints: supplierMarkups.basisPoints,
          markupOnMetal: supplierMarkups.markupOnMetal,
        })
        .from(supplierMarkups)
        .where(eq(supplierMarkups.supplierId, supplier.id))
      const basisPoints = marks ? (saidPoints as number | null) : (held?.basisPoints ?? null)
      const markupOnMetal =
        saidMetal === undefined ? (held?.markupOnMetal ?? null) : (saidMetal as boolean | null)

      if (basisPoints === null && markupOnMetal === null) {
        await tx.delete(supplierMarkups).where(eq(supplierMarkups.supplierId, supplier.id))
      } else {
        await tx
          .insert(supplierMarkups)
          .values({
            tenantId: identity.tenantId,
            supplierId: supplier.id,
            basisPoints,
            markupOnMetal,
          })
          .onConflictDoUpdate({
            target: [supplierMarkups.tenantId, supplierMarkups.supplierId],
            set: { basisPoints, markupOnMetal, updatedAt: new Date() },
          })
      }

      return { basisPoints, markupOnMetal }
    })

    if (marks) {
      this.sellingPrices.start(identity.tenantId)
    }

    return { ...written, pending: marks }
  }

  /**
   * The supplier's metal prices (#462), newest first, a page of them: one a
   * day per metal, entered in the office as the wholesaler shows them.
   */
  @Get(':id/metal-prices')
  @RequiresPermission('purchase.read')
  async metalPrices(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('id') id: string,
    @Query('offset') offset?: string,
    @Query('limit') limit?: string,
  ) {
    const from = Number(offset ?? 0)
    const size = Number(limit ?? 20)

    if (!Number.isInteger(from) || from < 0 || !Number.isInteger(size) || size < 1 || size > 100) {
      throw new BadRequestException('Eine Seite beginnt ab 0 und hat 1 bis 100 Zeilen.')
    }

    return this.database.forTenant(identity, async (tx) => {
      const supplier = await supplierOf(tx, id)
      const of = eq(supplierMetalPrices.supplierId, supplier.id)
      const [total] = await tx.select({ rows: count() }).from(supplierMetalPrices).where(of)
      const rows = await tx
        .select({
          id: supplierMetalPrices.id,
          metal: supplierMetalPrices.metal,
          validFrom: supplierMetalPrices.validFrom,
          priceCents: supplierMetalPrices.priceCents,
        })
        .from(supplierMetalPrices)
        .where(of)
        .orderBy(desc(supplierMetalPrices.validFrom), asc(supplierMetalPrices.metal))
        .offset(from)
        .limit(size)
      // The price each metal has today, for "Gilt".
      const current = await tx.execute(sql`
        select distinct on (metal) id from supplier_metal_prices
         where supplier_id = ${supplier.id} and valid_from <= ${todayInGermany()}::date
         order by metal, valid_from desc`)

      return {
        total: total?.rows ?? 0,
        current: current.rows.map((row) => row['id'] as string),
        rows,
      }
    })
  }

  /** A metal price from a day on, for whoever keeps purchase prices. */
  @Post(':id/metal-prices')
  @RequiresPermission('purchase.write')
  async addMetalPrice(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const fields = (typeof body === 'object' && body !== null ? body : {}) as Record<
      string,
      unknown
    >
    const metal = fields['metal']
    const validFrom = fields['validFrom']
    const cents = fields['priceCents']

    if (typeof metal !== 'string' || !(metals as readonly string[]).includes(metal)) {
      throw new BadRequestException('Das Metall ist Kupfer oder Aluminium.')
    }

    if (!isCalendarDay(validFrom)) {
      throw new BadRequestException('Der Tag muss ein Datum der Form 2026-01-01 sein.')
    }

    const problem = metalPriceProblem(cents)

    if (problem) {
      throw new BadRequestException(problem)
    }

    try {
      return await this.database.forTenant(identity, async (tx) => {
        const supplier = await supplierOf(tx, id)
        const [created] = await tx
          .insert(supplierMetalPrices)
          .values({
            tenantId: identity.tenantId,
            supplierId: supplier.id,
            metal: metal as Metal,
            validFrom,
            priceCents: cents as number,
          })
          .returning()

        return created
      })
    } catch (error) {
      throw isUniqueViolation(error, 'supplier_metal_prices_one_a_day')
        ? new ConflictException(
            'Für diesen Tag gibt es schon einen Preis für dieses Metall. Erst den alten entfernen.',
          )
        : error
    }
  }

  /** Takes a metal price off; a document keeps the unit price it took. */
  @Delete(':id/metal-prices/:priceId')
  @RequiresPermission('purchase.write')
  async removeMetalPrice(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('id') id: string,
    @Param('priceId') priceId: string,
  ) {
    if (!isUuid(priceId)) {
      throw new NotFoundException()
    }

    return this.database.forTenant(identity, async (tx) => {
      const supplier = await supplierOf(tx, id)
      const [removed] = await tx
        .delete(supplierMetalPrices)
        .where(
          and(
            eq(supplierMetalPrices.id, priceId as SupplierMetalPriceId),
            eq(supplierMetalPrices.supplierId, supplier.id),
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

/** The supplier of the path, not deleted, or a 404, the same for one of another business. */
async function supplierOf(tx: TenantTransaction, id: string) {
  if (!isUuid(id)) {
    throw new NotFoundException()
  }

  const [supplier] = await tx
    .select({ id: suppliers.id })
    .from(suppliers)
    .where(and(eq(suppliers.id, id as SupplierId), isNull(suppliers.deletedAt)))

  if (!supplier) {
    throw new NotFoundException()
  }

  return supplier
}
