import { type IsoDate, markupOnMetalOf, type Metal, type PricedMetal } from '@opengewerk/domain'
import type { TenantTransaction } from '@opengewerk/platform-server'
import { sql } from 'drizzle-orm'

import { parameterAt } from '../database/parameters.js'

/**
 * The metal surcharge of articles on a day (#462): what the metal of each
 * article's main supplier comes to at that supplier's metal price of the
 * day, the newest from that day or before. A position puts it into its unit
 * price; nothing stores it beside the price.
 */

/** A metal of an article with the price of the day, and the day that price is from. */
export interface MetalOfDay extends PricedMetal {
  /** The day the price applies from, null where there is none by then. */
  readonly priceFrom: IsoDate | null
}

/** An article's metal on a day, at its main supplier. */
export interface ArticleMetalOnDay {
  readonly supplierName: string
  readonly metals: readonly MetalOfDay[]
  /** Whether the markup also comes on the surcharge: the article's word, its supplier's, the business's. */
  readonly markupOnMetal: boolean
}

/**
 * The metal of each of these articles at its main supplier on a day. An
 * article without a main supplier, or whose main supplier names no metal,
 * is not in the answer.
 */
export async function articleMetalsOn(
  tx: TenantTransaction,
  articleIds: readonly (string | null)[],
  day: IsoDate,
): Promise<ReadonlyMap<string, ArticleMetalOnDay>> {
  const wanted = [...new Set(articleIds.filter((id): id is string => id !== null))]

  if (wanted.length === 0) {
    return new Map()
  }

  const rows = await tx.execute(sql`
    select l.article_id, s.name as supplier_name, m.metal, m.base_euros, m.grams_per_thousand,
           p.cents_per_hundred_kg, p.valid_from::text as price_from,
           am.markup_on_metal as article_says, sm.markup_on_metal as supplier_says
      from supplier_articles l
      join suppliers s on s.id = l.supplier_id
      join supplier_article_metals m on m.supplier_article_id = l.id
      left join lateral (
        select q.price_cents as cents_per_hundred_kg, q.valid_from
          from supplier_metal_prices q
         where q.supplier_id = l.supplier_id and q.metal = m.metal and q.valid_from <= ${day}::date
         order by q.valid_from desc
         limit 1
      ) p on true
      left join article_markups am on am.article_id = l.article_id
      left join supplier_markups sm on sm.supplier_id = l.supplier_id
     where l.main
       and l.article_id in (${sql.join(
         wanted.map((id) => sql`${id}::uuid`),
         sql`, `,
       )})
     order by l.article_id, m.metal`)
  const business = (await parameterAt(tx, 'material.markup_on_metal', day))?.value === 1
  const found = new Map<string, ArticleMetalOnDay>()

  for (const row of rows.rows) {
    const articleId = row['article_id'] as string
    const cents = row['cents_per_hundred_kg']
    const metal: MetalOfDay = {
      metal: row['metal'] as Metal,
      baseEuros: Number(row['base_euros']),
      gramsPerThousand: Number(row['grams_per_thousand']),
      centsPerHundredKg: cents === null ? null : Number(cents),
      priceFrom: (row['price_from'] as IsoDate | null) ?? null,
    }
    const held = found.get(articleId)

    found.set(articleId, {
      supplierName: row['supplier_name'] as string,
      metals: [...(held?.metals ?? []), metal],
      markupOnMetal: markupOnMetalOf(
        row['article_says'] as boolean | null,
        row['supplier_says'] as boolean | null,
        business,
      ),
    })
  }

  return found
}

/** The markup a surcharge takes: the selling price's own where the markup comes on the metal, else none. */
export function metalMarkup(metal: ArticleMetalOnDay, sellingMarkup: number | null): number {
  return metal.markupOnMetal ? (sellingMarkup ?? 0) : 0
}
