import { Injectable } from '@nestjs/common'
import {
  type ArticleId,
  type ArticlePriceId,
  followedPrices,
  type IsoDate,
  markupOf,
  type PriceBase,
  type SupplierId,
  type TenantId,
} from '@opengewerk/domain'
import { Database, everyTenant, newId, type TenantTransaction } from '@opengewerk/platform-server'
import { eq, inArray, sql } from 'drizzle-orm'

import { parameterAt } from '../database/parameters.js'
import { articlePriceOrigins, articlePrices, sellingPriceRuns } from '../database/schema/index.js'
import { todayInGermany } from '../today.js'

/**
 * The selling prices of articles that follow their purchase price (#463),
 * worked out anew when something they follow changes: a markup, the main
 * supplier, a purchase price entered by hand.
 */

/** Articles per transaction when a supplier or the whole business is worked out anew. */
const piece = 500

const reason = 'article.prices.follow'

const listOf = (ids: readonly string[]) =>
  sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  )

/**
 * Works the selling prices of these articles out anew from a day on, in the
 * caller's transaction: each that follows its main supplier's purchase price,
 * with the markup that applies to it. A fixed price and an article without a
 * main supplier stay as they are. Returns how many new prices there are.
 */
export async function followPurchasePrices(
  tx: TenantTransaction,
  tenantId: TenantId,
  articleIds: readonly string[],
  from: IsoDate,
): Promise<number> {
  if (articleIds.length === 0) {
    return 0
  }

  const following = await tx.execute(sql`
    select a.id as article_id, l.id as link_id, m.fixed, m.basis_points as own,
           s.basis_points as supplier
      from articles a
      join supplier_articles l on l.article_id = a.id and l.main
      left join article_markups m on m.article_id = a.id
      left join supplier_markups s on s.supplier_id = l.supplier_id
     where a.deleted_at is null and a.id in (${listOf(articleIds)})`)

  if (following.rows.length === 0) {
    return 0
  }

  const links = following.rows.map((row) => row['link_id'] as string)
  const articles = following.rows.map((row) => row['article_id'] as string)
  const business = (await parameterAt(tx, 'material.markup_basis_points', from))?.value ?? null

  const purchaseRows = await tx.execute(sql`
    select supplier_article_id as link, valid_from::text as valid_from,
           unit_price_cents as cents, price_base
      from purchase_prices where supplier_article_id in (${listOf(links)})`)
  const sellingRows = await tx.execute(sql`
    select id, article_id, valid_from::text as valid_from, unit_price_cents as cents, price_base
      from article_prices where deleted_at is null and article_id in (${listOf(articles)})`)

  const dated = (row: Record<string, unknown>) => ({
    validFrom: row['valid_from'] as IsoDate,
    cents: Number(row['cents']),
    priceBase: Number(row['price_base']) as PriceBase,
  })
  const removed: string[] = []
  const added: (typeof articlePrices.$inferInsert)[] = []
  const origins: (typeof articlePriceOrigins.$inferInsert)[] = []

  for (const row of following.rows) {
    const articleId = row['article_id'] as string
    const linkId = row['link_id'] as string
    const markup = markupOf(
      row['fixed'] === null
        ? null
        : {
            fixed: row['fixed'] === true,
            basisPoints: row['own'] === null ? null : Number(row['own']),
          },
      row['supplier'] === null ? null : Number(row['supplier']),
      business,
    )
    const change = followedPrices(
      from,
      purchaseRows.rows.filter((price) => price['link'] === linkId).map(dated),
      sellingRows.rows
        .filter((price) => price['article_id'] === articleId)
        .map((price) => ({ id: price['id'] as string, ...dated(price) })),
      markup,
    )

    removed.push(...change.removed)

    for (const price of change.added) {
      const id = newId<'article-price'>()

      added.push({
        id,
        tenantId,
        articleId: articleId as ArticleId,
        validFrom: price.validFrom,
        unitPriceCents: price.cents,
        priceBase: price.priceBase,
      })
      origins.push({
        tenantId,
        articlePriceId: id,
        purchaseCents: price.purchaseCents,
        basisPoints: price.basisPoints,
      })
    }
  }

  // Marked first, so that a new price can take the day of one that gives way.
  if (removed.length > 0) {
    await tx
      .update(articlePrices)
      .set({ deletedAt: new Date() })
      .where(inArray(articlePrices.id, removed as ArticlePriceId[]))
  }

  if (added.length > 0) {
    await tx.insert(articlePrices).values(added)
    await tx.insert(articlePriceOrigins).values(origins)
  }

  return added.length
}

/** Who changed a markup, in whose business, and whose articles it touches. */
export interface PriceRunRequest {
  readonly tenantId: TenantId
  readonly userId: string
  /** The supplier whose articles follow its markup; null for the whole business. */
  readonly supplierId: SupplierId | null
  readonly from: IsoDate
}

/**
 * Works the selling prices out anew after the markup of the business or of a
 * supplier changed, for as many articles as that is: the whole catalogue of a
 * wholesaler is hundreds of thousands. In pieces, each in a transaction of its
 * own, so that no device waits for the business's counter of the sync longer
 * than a piece takes; one business at a time in this process.
 *
 * What is still to do stands in `selling_price_runs`, written in the
 * transaction that changed the markup, so that a restart takes it up again.
 */
@Injectable()
export class SellingPrices {
  private readonly running = new Map<TenantId, Promise<void>>()
  private readonly again = new Set<TenantId>()

  constructor(private readonly database: Database) {}

  /** Today in Germany; a test moves it by replacing this. */
  today: () => IsoDate = () => todayInGermany()

  /**
   * Notes the run in the caller's transaction, widened by one that waits
   * already: to the whole business where the two name different suppliers,
   * and from the earlier day. Started with `start` once that commits.
   */
  async request(tx: TenantTransaction, run: PriceRunRequest): Promise<void> {
    const [held] = await tx.select().from(sellingPriceRuns)
    const values = {
      tenantId: run.tenantId,
      supplierId: held === undefined || held.supplierId === run.supplierId ? run.supplierId : null,
      fromDay: held === undefined || run.from < held.fromDay ? run.from : (held.fromDay as IsoDate),
      requestedBy: run.userId,
    }

    // A new row and not a changed one: a run that is working sees by its id
    // that it has to start over.
    if (held !== undefined) {
      await tx.delete(sellingPriceRuns).where(eq(sellingPriceRuns.id, held.id))
    }

    await tx.insert(sellingPriceRuns).values(values)
  }

  /** Works through the run of a business; one that runs already starts over after it. */
  start(tenantId: TenantId): void {
    if (this.running.has(tenantId)) {
      this.again.add(tenantId)

      return
    }

    const running = this.work(tenantId)
      .catch((error: unknown) => {
        console.error('Die Verkaufspreise ließen sich nicht neu rechnen.', error)
      })
      .finally(() => {
        this.running.delete(tenantId)

        if (this.again.delete(tenantId)) {
          this.start(tenantId)
        }
      })

    this.running.set(tenantId, running)
  }

  /** Whether the business has selling prices still to be worked out. */
  async pending(tenantId: TenantId): Promise<boolean> {
    const [held] = await this.database.forTenant({ tenantId, reason }, (tx) =>
      tx.select({ id: sellingPriceRuns.id }).from(sellingPriceRuns),
    )

    return held !== undefined
  }

  /** Waits for every run, for the tests and for a shutdown. */
  async settled(): Promise<void> {
    while (this.running.size > 0) {
      await Promise.allSettled([...this.running.values()])
    }
  }

  /** Takes up the runs a restart cut off. */
  async resume(): Promise<void> {
    for (const tenantId of await everyTenant(this.database)) {
      if (await this.pending(tenantId)) {
        this.start(tenantId)
      }
    }
  }

  private async work(tenantId: TenantId): Promise<void> {
    for (;;) {
      const [run] = await this.database.forTenant({ tenantId, reason }, (tx) =>
        tx.select().from(sellingPriceRuns),
      )

      if (run === undefined) {
        return
      }

      const actor = { tenantId, userId: run.requestedBy, reason }
      // Never backwards, also not for a run a restart took up days later.
      const today = this.today()
      const from = run.fromDay < today ? today : (run.fromDay as IsoDate)
      let after = '00000000-0000-0000-0000-000000000000'

      for (;;) {
        const ids = await this.database.forTenant(actor, async (tx) => {
          const found = await tx.execute(sql`
            select a.id
              from articles a
              join supplier_articles l on l.article_id = a.id and l.main
              left join article_markups m on m.article_id = a.id
             where a.deleted_at is null and (m.id is null or not m.fixed)
               and a.id > ${after}::uuid
               ${run.supplierId === null ? sql`` : sql`and l.supplier_id = ${run.supplierId}`}
             order by a.id
             limit ${piece}`)
          const inPiece = found.rows.map((row) => row['id'] as string)

          await followPurchasePrices(tx, tenantId, inPiece, from)

          return inPiece
        })

        if (ids.length < piece) {
          break
        }

        after = ids.at(-1) ?? after
      }

      // Done, unless a further change replaced the run meanwhile.
      const done = await this.database.forTenant(actor, (tx) =>
        tx
          .delete(sellingPriceRuns)
          .where(eq(sellingPriceRuns.id, run.id))
          .returning({ id: sellingPriceRuns.id }),
      )

      if (done.length > 0) {
        return
      }
    }
  }
}
