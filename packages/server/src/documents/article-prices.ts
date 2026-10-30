import {
  type IsoDate,
  lineNetCents,
  type LineUnit,
  metalSurchargeCents,
  priceCentsMax,
  type PriceBase,
} from '@opengewerk/domain'
import type { TenantTransaction } from '@opengewerk/platform-server'
import { and, desc, eq, inArray, isNull, lte } from 'drizzle-orm'

import { articlePriceOrigins, articlePrices, articles } from '../database/schema/index.js'
import { articleMetalsOn, metalMarkup } from '../pricing/metal-surcharges.js'

/**
 * A selling price as a line takes it: the price, how many units it is for
 * (#456), and the unit of the article, which the price is a price of.
 */
export interface PriceOfDay {
  readonly unitPriceCents: number
  readonly priceBase: PriceBase
  readonly unit: LineUnit
}

/**
 * The price a line takes on a day for each of these articles (#296): the
 * newest selling price from that day or before, and in it the metal
 * surcharge of the day (#462), after the metal price of the main supplier,
 * marked up with the markup the selling price came from where the markup
 * comes on the metal. An article without a selling price, or one marked as
 * deleted, whose prices went with it, is not in the answer.
 */
export async function articlePricesOn(
  tx: TenantTransaction,
  articleIds: readonly (string | null)[],
  day: IsoDate,
): Promise<ReadonlyMap<string, PriceOfDay>> {
  const wanted = [...new Set(articleIds.filter((id): id is string => id !== null))]

  if (wanted.length === 0) {
    return new Map()
  }

  const rows = await tx
    .select({
      articleId: articlePrices.articleId,
      unitPriceCents: articlePrices.unitPriceCents,
      priceBase: articlePrices.priceBase,
      unit: articles.unit,
      basisPoints: articlePriceOrigins.basisPoints,
    })
    .from(articlePrices)
    .innerJoin(articles, eq(articles.id, articlePrices.articleId))
    .leftJoin(articlePriceOrigins, eq(articlePriceOrigins.articlePriceId, articlePrices.id))
    .where(
      and(
        inArray(
          articlePrices.articleId,
          wanted as (typeof articlePrices.$inferSelect)['articleId'][],
        ),
        isNull(articlePrices.deletedAt),
        lte(articlePrices.validFrom, day),
      ),
    )
    .orderBy(desc(articlePrices.validFrom))
  const prices = new Map<string, PriceOfDay>()
  const metals = await articleMetalsOn(tx, wanted, day)

  for (const row of rows) {
    if (!prices.has(row.articleId)) {
      const metal = metals.get(row.articleId)
      const surcharge =
        metal === undefined
          ? 0
          : metalSurchargeCents(metal.metals, row.priceBase, metalMarkup(metal, row.basisPoints))

      prices.set(row.articleId, {
        unitPriceCents: Math.min(row.unitPriceCents + surcharge, priceCentsMax),
        priceBase: row.priceBase,
        unit: row.unit,
      })
    }
  }

  return prices
}

/**
 * A line of a report as an invoice takes it (#296): a report carries no
 * prices, so a position taken from an article gets the article's selling price
 * of the invoice's date, as it would in the office when somebody took the
 * article into it. A title, a line typed by hand, a line whose article has
 * no price that day and a line no longer counted in the article's unit keep
 * what they have.
 */
export function pricedFromArticle<
  Line extends {
    readonly kind: string
    readonly articleId: string | null
    readonly quantityMilli: number
    readonly unit: string
    readonly unitPriceCents: number
    readonly priceBase: number
    readonly netCents: number
  },
>(line: Line, prices: ReadonlyMap<string, PriceOfDay>): Line {
  if (line.kind !== 'item' || line.articleId === null) {
    return line
  }

  const price = prices.get(line.articleId)

  // A price per metre says nothing about a line counted in pieces: once
  // somebody changed the unit, the office prices the line by hand.
  if (price === undefined || price.unit !== line.unit) {
    return line
  }

  // The price with the units it is for (#456): 300 cable ties from a report
  // at 3,50 euros per 100 are 10,50 euros on the invoice.
  return {
    ...line,
    unitPriceCents: price.unitPriceCents,
    priceBase: price.priceBase,
    netCents: lineNetCents({
      quantityMilli: line.quantityMilli,
      unitPriceCents: price.unitPriceCents,
      priceBase: price.priceBase,
    }),
  }
}
