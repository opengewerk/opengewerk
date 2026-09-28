import { type IsoDate, lineNetCents } from '@opengewerk/domain'
import { and, desc, inArray, isNull, lte } from 'drizzle-orm'

import type { TenantTransaction } from '../database/database.js'
import { articlePrices } from '../database/schema/index.js'

/**
 * The selling price on a day of each of these articles (#296), the newest
 * price from that day or before. An article without one, or one marked as
 * deleted, whose prices went with it, is not in the answer.
 */
export async function articlePricesOn(
  tx: TenantTransaction,
  articleIds: readonly (string | null)[],
  day: IsoDate,
): Promise<ReadonlyMap<string, number>> {
  const wanted = [...new Set(articleIds.filter((id): id is string => id !== null))]

  if (wanted.length === 0) {
    return new Map()
  }

  const rows = await tx
    .select({
      articleId: articlePrices.articleId,
      unitPriceCents: articlePrices.unitPriceCents,
    })
    .from(articlePrices)
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
  const prices = new Map<string, number>()

  for (const row of rows) {
    if (!prices.has(row.articleId)) {
      prices.set(row.articleId, row.unitPriceCents)
    }
  }

  return prices
}

/**
 * A line of a report as an invoice takes it (#296): a report carries no
 * prices, so a position taken from an article gets the article's selling price
 * of the invoice's date, as it would in the office when somebody took the
 * article into it. A title, a line typed by hand and a line whose article has
 * no price that day keep what they have.
 */
export function pricedFromArticle<
  Line extends {
    readonly kind: string
    readonly articleId: string | null
    readonly quantityMilli: number
    readonly unitPriceCents: number
    readonly priceBase: number
    readonly netCents: number
  },
>(line: Line, prices: ReadonlyMap<string, number>): Line {
  if (line.kind !== 'item' || line.articleId === null) {
    return line
  }

  const unitPriceCents = prices.get(line.articleId)

  if (unitPriceCents === undefined) {
    return line
  }

  // A selling price of an article is for one unit until the articles carry
  // a price unit of their own (#456).
  return {
    ...line,
    unitPriceCents,
    priceBase: 1,
    netCents: lineNetCents({ quantityMilli: line.quantityMilli, unitPriceCents, priceBase: 1 }),
  }
}
