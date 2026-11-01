import type { Copper, IsoDate, LineUnit, Metal, PriceBase, SupplierId } from '@opengewerk/domain'
import type { TenantTransaction } from '@opengewerk/platform-server'
import { type SQL, sql } from 'drizzle-orm'

import type { HeldArticle, HeldLink, HeldMarkup, HeldPrice, Holdings } from './plan.js'

/**
 * What the business holds, as far as an import of one supplier needs to know
 * it (#297): its articles, the supplier's links, and the prices in effect on
 * the day the import's prices begin. Read in the transaction that plans, so
 * that the takeover plans against what it is about to write into.
 *
 * All articles and not only the supplier's, since a number is taken by any
 * article and an EAN finds any; where the files bring no article, only what
 * hangs off the links they name (`holdingsOf`).
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

/**
 * What the business holds that a plan compares with. `numbers` narrows it to
 * the links under those numbers of the supplier, their articles and their
 * prices (#297), for files with prices and deletions only (`numbersOnly`):
 * the price changes of a month need a few thousand links, and the whole
 * catalogue of a wholesaler took seconds to load and its memory twice, here
 * and in the thread that plans.
 */
export async function holdingsOf(
  tx: TenantTransaction,
  supplierId: SupplierId,
  validFrom: IsoDate,
  numbers: readonly string[] | null = null,
): Promise<Holdings> {
  // One parameter, whatever the count: a price file of a whole catalogue
  // names 700,000 numbers, ten times what a statement takes as parameters.
  const named = numbers === null ? null : sql`${sql.param([...numbers])}::text[]`
  const ofLinks = named === null ? sql`` : sql`and s.supplier_number = any(${named})`
  const ofArticles = (column: SQL) =>
    named === null
      ? sql``
      : sql`and ${column} in (select article_id from supplier_articles
              where supplier_id = ${supplierId} and supplier_number = any(${named}))`

  // Whether an article has a main supplier already (#463): a link added to
  // one that has none becomes the main one, by the trigger of 0099.
  const articleRows = await tx.execute(sql`
    select a.id, a.number, a.designation, a.unit, a.ean, s.id is not null as supplied
      from articles a
      left join supplier_articles s on s.article_id = a.id and s.main
     where a.deleted_at is null ${ofArticles(sql`a.id`)}
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
  // The metals of a link stand beside it since #462, each in a row of its
  // own; gathered once per link, so that a link with four metals is one row.
  const linkRows = await tx.execute(sql`
    select s.id, s.article_id, s.supplier_number, s.discount_group, s.main, m.metals
      from supplier_articles s
      left join (
        select supplier_article_id,
               json_agg(json_build_array(metal, base_euros, grams_per_thousand)) as metals
          from supplier_article_metals
         group by supplier_article_id
      ) m on m.supplier_article_id = s.id
     where s.supplier_id = ${supplierId}
       and s.supplier_number is not null ${ofLinks}
     order by s.created_at desc, s.id desc`)

  const links = new Map<string, HeldLink>(
    linkRows.rows.map((row) => [
      row['supplier_number'] as string,
      {
        id: row['id'] as string,
        articleId: row['article_id'] as string,
        supplierNumber: row['supplier_number'] as string,
        discountGroup: (row['discount_group'] as string | null) ?? null,
        metals: new Map<Metal, Copper>(
          ((row['metals'] as [Metal, number, number][] | null) ?? []).map(
            ([metal, baseEuros, gramsPerThousand]) => [
              metal,
              { baseEuros: Number(baseEuros), gramsPerThousand: Number(gramsPerThousand) },
            ],
          ),
        ),
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
       and p.valid_from <= ${validFrom} ${ofLinks}
     order by p.supplier_article_id, p.valid_from desc`)

  const purchasePrices = await tx.execute(sql`
    select distinct on (p.supplier_article_id)
           p.id, p.supplier_article_id as owner, p.valid_from::text as valid_from,
           p.unit_price_cents as cents, p.price_base, p.import_id is not null as from_import
      from purchase_prices p
      join supplier_articles s on s.id = p.supplier_article_id
     where s.supplier_id = ${supplierId}
       and p.valid_from <= ${validFrom} ${ofLinks}
     order by p.supplier_article_id, p.valid_from desc`)

  const sellingPrices = await tx.execute(sql`
    select distinct on (p.article_id)
           p.id, p.article_id as owner, p.valid_from::text as valid_from,
           p.unit_price_cents as cents, p.price_base, p.import_id is not null as from_import
      from article_prices p
     where p.deleted_at is null
       and p.valid_from <= ${validFrom} ${ofArticles(sql`p.article_id`)}
     order by p.article_id, p.valid_from desc`)

  // What the articles say about their selling prices (#463): only those
  // that are fixed or have a markup of their own have a row.
  const markupRows = await tx.execute(sql`
    select article_id, fixed, basis_points from article_markups
     where true ${ofArticles(sql`article_id`)}`)

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
