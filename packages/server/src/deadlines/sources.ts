import {
  berlinClock,
  type CustomerId,
  type DeadlineSource,
  type DocumentId,
  type InstallationId,
  type JobId,
  type SiteId,
} from '@opengewerk/domain'
import { type SourceQuery, stockLevels } from '@opengewerk/platform-server'
import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm'

import { documents } from '../database/schema/index.js'

/**
 * What a deadline of this application hangs on beside its source, as its
 * sources say it: the columns this application gives the table of the
 * foundation. The task is not among them; the action that makes it writes it.
 */
export interface DeadlineValues {
  readonly documentId: DocumentId | null
  readonly installationId: InstallationId | null
  readonly customerId: CustomerId | null
  readonly siteId: SiteId | null
  readonly jobId: JobId | null
}

/**
 * The quotes that went out and that nothing has followed: no order
 * confirmation, no invoice, no document at all with the quote as its
 * predecessor. A draft that follows counts as well, because somebody is
 * already on it; if it is thrown away, the quote is open again, and so is its
 * deadline.
 *
 * Counted from the day it was issued, in Berlin, and named by its number.
 */
export const openQuotes: SourceQuery<DeadlineValues> = async (tx) => {
  const rows = await tx
    .select({
      id: documents.id,
      number: documents.number,
      customerId: documents.customerId,
      siteId: documents.siteId,
      jobId: documents.jobId,
      issuedAt: documents.issuedAt,
      issuedBy: documents.issuedBy,
    })
    .from(documents)
    .where(
      and(
        eq(documents.kind, 'quote'),
        eq(documents.status, 'issued'),
        isNull(documents.deletedAt),
        isNotNull(documents.issuedAt),
        sql`not exists (
          select 1 from ${documents} as following
           where following.tenant_id = ${documents.tenantId}
             and following.predecessor_document_id = ${documents.id}
             and following.deleted_at is null
        )`,
      ),
    )

  return rows.flatMap((row) =>
    row.issuedAt === null
      ? []
      : [
          {
            sourceId: row.id,
            sourceLabel: row.number ?? '',
            anchorOn: berlinClock(row.issuedAt).day,
            namedDueOn: null,
            naturalUserId: row.issuedBy,
            values: {
              documentId: row.id,
              installationId: null,
              customerId: row.customerId,
              siteId: row.siteId,
              jobId: row.jobId,
            },
          },
        ],
  )
}

/**
 * The articles below the minimum their store keeps (#298): one source for
 * each place an article has in a store, named by the article and the store,
 * as "Leitungsschutzschalter B16 im Transporter HD-OG 412". Due on the day of
 * the last booking of the article there, or the day the minimum was set where
 * nothing was ever booked; the stock is the sum of the bookings
 * (`stockLevels`). The person it names is who booked last there.
 */
export const storesBelowMinimum: SourceQuery<DeadlineValues> = async (tx) => {
  const { rows } = await tx.execute<{
    id: string
    store_id: string
    article_id: string
    minimum_milli: number
    designation: string
    store_name: string
    since: Date
    booked_by: string | null
  }>(sql`
    select p.id, p.store_id, p.article_id, p.minimum_milli, a.designation, s.name as store_name,
           coalesce((select max(m.created_at) from stock_movements m
                      where m.store_id = p.store_id and m.article_id = p.article_id and m.deleted_at is null),
                    p.updated_at) as since,
           (select m.booked_by from stock_movements m
             where m.store_id = p.store_id and m.article_id = p.article_id and m.deleted_at is null
             order by m.created_at desc, m.id desc limit 1) as booked_by
      from store_articles p
      join stores s on s.id = p.store_id and s.deleted_at is null
      join articles a on a.id = p.article_id and a.deleted_at is null
     where p.deleted_at is null and p.minimum_milli is not null`)

  if (rows.length === 0) {
    return []
  }

  const levels = new Map(
    (await stockLevels(tx)).map((row) => [`${row.storeId}:${row.articleId}`, row.levelMilli]),
  )

  return rows.flatMap((row) => {
    const level = levels.get(`${row.store_id}:${row.article_id}`) ?? 0

    if (level >= Number(row.minimum_milli)) {
      return []
    }

    const day = berlinClock(new Date(row.since)).day

    return [
      {
        sourceId: row.id,
        sourceLabel: `${row.designation} im ${row.store_name}`,
        anchorOn: day,
        namedDueOn: day,
        naturalUserId: row.booked_by,
        values: {
          documentId: null,
          installationId: null,
          customerId: null,
          siteId: null,
          jobId: null,
        },
      },
    ]
  })
}

/** Every source there is, by the name a kind gives it. */
export const deadlineSourceQueries: Readonly<Record<DeadlineSource, SourceQuery<DeadlineValues>>> =
  {
    quote: openQuotes,
    store_minimum: storesBelowMinimum,
  }
