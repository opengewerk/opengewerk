import type {
  ArticleId,
  ArticleImportId,
  ArticlePriceId,
  IsoDate,
  ListPriceId,
  PurchasePriceId,
  SupplierArticleId,
  SupplierId,
  TenantId,
} from '@opengewerk/domain'
import { inArray, sql } from 'drizzle-orm'

import type { TenantTransaction } from '../database/database.js'
import {
  articlePrices,
  articles,
  listPrices,
  purchasePrices,
  supplierArticles,
} from '../database/schema/index.js'
import type { ImportPlan } from './plan.js'

/**
 * Writes a plan (#297), inside the transaction that names the import in
 * `app.article_import` and whose import is applying: the log and the stamp of
 * the sync pass over these rows then (migration 0062), and what they would
 * have written is written here.
 *
 * The five columns of the stamp go in with each synced row, the number as a
 * placeholder below zero. The real numbers come at the very end, as one run
 * of the counter, because the counter row stays locked from the first number
 * a transaction takes until it commits, and every exchange of a device in the
 * business waits for it. Taken at the end, they wait for the renumbering and
 * not for the whole takeover.
 */

export interface Takeover {
  readonly tenantId: TenantId
  readonly importId: ArticleImportId
  readonly supplierId: SupplierId
  readonly userId: string
  readonly validFrom: IsoDate
  /** Told after each batch how many rows are written, and how many there are. */
  readonly progress?: (done: number, total: number) => void
}

/** Rows per statement, far below the 65,535 parameters of one statement. */
const batchSize = 1000

function batches<Row>(rows: readonly Row[]): (readonly Row[])[] {
  const cut: (readonly Row[])[] = []

  for (let start = 0; start < rows.length; start += batchSize) {
    cut.push(rows.slice(start, start + batchSize))
  }

  return cut
}

/** How many rows a plan writes, for the progress of the takeover. */
export function rowsOf(plan: ImportPlan): number {
  return (
    plan.removedLinks.length +
    plan.articles.length +
    plan.links.length +
    plan.discountGroups.length +
    plan.listPrices.length +
    plan.purchasePrices.length +
    plan.sellingPrices.length
  )
}

export async function takeOver(
  tx: TenantTransaction,
  plan: ImportPlan,
  takeover: Takeover,
): Promise<void> {
  const { tenantId, importId, supplierId, userId, validFrom } = takeover
  const total = rowsOf(plan)
  let done = 0
  let placeholders = 0

  const advance = (rows: number) => {
    done += rows
    takeover.progress?.(done, total)
  }

  /** A number below zero for each synced row, which the run of the counter replaces. */
  const placeholder = () => {
    placeholders += 1

    return -placeholders
  }

  const now = new Date()
  const stamp = () => ({
    version: 1,
    updatedAt: now,
    updatedBy: userId,
    deviceId: null,
    changeSequence: placeholder(),
  })

  // The links the files delete first; their prices go with them over the keys.
  for (const ids of batches(plan.removedLinks)) {
    await tx
      .delete(supplierArticles)
      .where(
        inArray(supplierArticles.id, ids as readonly SupplierArticleId[] as SupplierArticleId[]),
      )
    advance(ids.length)
  }

  for (const rows of batches(plan.articles)) {
    await tx.insert(articles).values(
      rows.map((article) => ({
        id: article.id as ArticleId,
        tenantId,
        number: article.number,
        designation: article.designation,
        description: article.description,
        ean: article.ean,
        unit: article.unit,
        groupOfGoods: article.groupOfGoods,
        importId,
        ...stamp(),
      })),
    )
    advance(rows.length)
  }

  for (const rows of batches(plan.links)) {
    await tx.insert(supplierArticles).values(
      rows.map((link) => ({
        id: link.id as SupplierArticleId,
        tenantId,
        articleId: link.articleId as ArticleId,
        supplierId,
        supplierNumber: link.supplierNumber,
        discountGroup: link.discountGroup,
        importId,
      })),
    )
    advance(rows.length)
  }

  for (const rows of batches(plan.discountGroups)) {
    const changes = sql.join(
      rows.map((row) => sql`(${row.linkId}::uuid, ${row.discountGroup})`),
      sql`, `,
    )

    await tx.execute(sql`
      update supplier_articles as s
         set discount_group = u.discount_group, import_id = ${importId}, updated_at = now()
        from (values ${changes}) as u(id, discount_group)
       where s.id = u.id`)
    advance(rows.length)
  }

  // A list or purchase price of the same day gives way: removed, as those
  // two tables never change a price, and written anew.
  for (const rows of batches(plan.listPrices)) {
    const replaced = rows.flatMap((price) => (price.replaces === null ? [] : [price.replaces]))

    if (replaced.length > 0) {
      await tx.delete(listPrices).where(inArray(listPrices.id, replaced as ListPriceId[]))
    }

    await tx.insert(listPrices).values(
      rows.map((price) => ({
        tenantId,
        supplierArticleId: price.ownerId as SupplierArticleId,
        validFrom,
        unitPriceCents: price.cents,
        priceBase: price.priceBase,
        importId,
      })),
    )
    advance(rows.length)
  }

  for (const rows of batches(plan.purchasePrices)) {
    const replaced = rows.flatMap((price) => (price.replaces === null ? [] : [price.replaces]))

    if (replaced.length > 0) {
      await tx
        .delete(purchasePrices)
        .where(inArray(purchasePrices.id, replaced as PurchasePriceId[]))
    }

    await tx.insert(purchasePrices).values(
      rows.map((price) => ({
        tenantId,
        supplierArticleId: price.ownerId as SupplierArticleId,
        validFrom,
        unitPriceCents: price.cents,
        priceBase: price.priceBase,
        importId,
      })),
    )
    advance(rows.length)
  }

  // A selling price is never removed, only marked, so that a document of
  // that day still finds what it was priced at. Marked like the stamp would.
  for (const rows of batches(plan.sellingPrices)) {
    const replaced = rows.flatMap((price) => (price.replaces === null ? [] : [price.replaces]))

    if (replaced.length > 0) {
      const marks = sql.join(
        replaced.map((id) => sql`(${id as ArticlePriceId}::uuid, ${placeholder()}::bigint)`),
        sql`, `,
      )

      await tx.execute(sql`
        update article_prices as p
           set deleted_at = now(), version = p.version + 1, updated_at = now(),
               updated_by = ${userId}, device_id = null, change_sequence = u.placeholder
          from (values ${marks}) as u(id, placeholder)
         where p.id = u.id`)
    }

    await tx.insert(articlePrices).values(
      rows.map((price) => ({
        tenantId,
        articleId: price.ownerId as ArticleId,
        validFrom,
        unitPriceCents: price.cents,
        priceBase: price.priceBase,
        importId,
        ...stamp(),
      })),
    )
    advance(rows.length)
  }

  if (placeholders === 0) {
    return
  }

  // The run of numbers, and from here to the commit the counter row is held.
  const reserved = await tx.execute(sql`select reserve_sync_sequences(${placeholders}) as first`)
  const first = Number(reserved.rows[0]?.['first'])

  for (const table of ['articles', 'article_prices']) {
    await tx.execute(sql`
      update ${sql.identifier(table)}
         set change_sequence = ${first - 1} - change_sequence
       where tenant_id = ${tenantId} and change_sequence < 0`)
  }
}
