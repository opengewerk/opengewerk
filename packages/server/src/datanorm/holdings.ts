import type { IsoDate, LineUnit, PriceBase, SupplierId } from '@opengewerk/domain'
import type { TenantTransaction } from '@opengewerk/platform-server'
import { sql } from 'drizzle-orm'

import type { HeldArticle, HeldLink, HeldMarkup, HeldPrice, Holdings } from './plan.js'

/**
 * What the business holds, as far as an import of one supplier needs to know
 * it (#297): its articles, the supplier's links, and the prices in effect on
 * the day the import's prices begin. Read in the transaction that plans, so
 * that the takeover plans against what it is about to write into.
 *
 * All articles and not only the supplier's, since a number is taken by any
 * article and an EAN finds any. For a hundred thousand articles that is a few
 * megabytes, read once.
 */

interface PriceRow {
  readonly id: string
  readonly owner: string
  readonly valid_from: string
  readonly cents: number
  readonly price_base: number
  readonly from_import: boolean
}

function heldPrices(rows: readonly Record<string, unknown>[]): Map<string, HeldPrice> {
  return new Map(
    (rows as unknown as readonly PriceRow[]).map((row) => [
      row.owner,
      {
        id: row.id,
        validFrom: row.valid_from as IsoDate,
        cents: Number(row.cents),
        priceBase: Number(row.price_base) as PriceBase,
        fromImport: row.from_import,
      },
    ]),
  )
}

export async function holdingsOf(
  tx: TenantTransaction,
  supplierId: SupplierId,
  validFrom: IsoDate,
): Promise<Holdings> {
  // Whether an article has a main supplier already (#463): a link added to
  // one that has none becomes the main one, by the trigger of 0099.
  const articleRows = await tx.execute(sql`
    select a.id, a.number, a.designation, a.unit, a.ean, s.id is not null as supplied
      from articles a
      left join supplier_articles s on s.article_id = a.id and s.main
     where a.deleted_at is null
     order by a.created_at, a.id`)

  const articles = new Map<string, HeldArticle>(
    articleRows.rows.map((row) => [
      row['id'] as string,
      {
        id: row['id'] as string,
        number: row['number'] as string,
        designation: row['designation'] as string,
        unit: row['unit'] as LineUnit,
        ean: (row['ean'] as string | null) ?? null,
        supplied: row['supplied'] === true,
      },
    ]),
  )

  // A link without the supplier's number cannot be found by one; the oldest
  // where a number stands twice.
  // The copper of a link stands beside it since #462, with any other metal.
  const linkRows = await tx.execute(sql`
    select s.id, s.article_id, s.supplier_number, s.discount_group, s.main,
           m.base_euros as copper_base_euros, m.grams_per_thousand as copper_grams_per_thousand
      from supplier_articles s
      left join supplier_article_metals m on m.supplier_article_id = s.id and m.metal = 'copper'
     where s.supplier_id = ${supplierId}
       and s.supplier_number is not null
     order by s.created_at desc, s.id desc`)

  const links = new Map<string, HeldLink>(
    linkRows.rows.map((row) => [
      row['supplier_number'] as string,
      {
        id: row['id'] as string,
        articleId: row['article_id'] as string,
        supplierNumber: row['supplier_number'] as string,
        discountGroup: (row['discount_group'] as string | null) ?? null,
        copper:
          row['copper_base_euros'] === null || row['copper_grams_per_thousand'] === null
            ? null
            : {
                baseEuros: Number(row['copper_base_euros']),
                gramsPerThousand: Number(row['copper_grams_per_thousand']),
              },
        main: row['main'] === true,
      },
    ]),
  )

  const listPrices = await tx.execute(sql`
    select distinct on (p.supplier_article_id)
           p.id, p.supplier_article_id as owner, p.valid_from::text as valid_from,
           p.unit_price_cents as cents, p.price_base, p.import_id is not null as from_import
      from list_prices p
      join supplier_articles s on s.id = p.supplier_article_id
     where s.supplier_id = ${supplierId}
       and p.valid_from <= ${validFrom}
     order by p.supplier_article_id, p.valid_from desc`)

  const purchasePrices = await tx.execute(sql`
    select distinct on (p.supplier_article_id)
           p.id, p.supplier_article_id as owner, p.valid_from::text as valid_from,
           p.unit_price_cents as cents, p.price_base, p.import_id is not null as from_import
      from purchase_prices p
      join supplier_articles s on s.id = p.supplier_article_id
     where s.supplier_id = ${supplierId}
       and p.valid_from <= ${validFrom}
     order by p.supplier_article_id, p.valid_from desc`)

  const sellingPrices = await tx.execute(sql`
    select distinct on (p.article_id)
           p.id, p.article_id as owner, p.valid_from::text as valid_from,
           p.unit_price_cents as cents, p.price_base, p.import_id is not null as from_import
      from article_prices p
     where p.deleted_at is null
       and p.valid_from <= ${validFrom}
     order by p.article_id, p.valid_from desc`)

  // What the articles say about their selling prices (#463): only those
  // that are fixed or have a markup of their own have a row.
  const markupRows = await tx.execute(sql`
    select article_id, fixed, basis_points from article_markups`)

  const articleMarkups = new Map<string, HeldMarkup>(
    markupRows.rows.map((row) => [
      row['article_id'] as string,
      {
        fixed: row['fixed'] === true,
        basisPoints: row['basis_points'] === null ? null : Number(row['basis_points']),
      },
    ]),
  )

  return {
    articles,
    links,
    articleMarkups,
    listPrices: heldPrices(listPrices.rows),
    purchasePrices: heldPrices(purchasePrices.rows),
    sellingPrices: heldPrices(sellingPrices.rows),
  }
}
