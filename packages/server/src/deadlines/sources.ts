import {
  berlinClock,
  type CustomerId,
  type DeadlineSource,
  type DocumentId,
  type InstallationId,
  type JobId,
  type SiteId,
} from '@opengewerk/domain'
import type { SourceQuery } from '@opengewerk/platform-server'
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

/** Every source there is, by the name a kind gives it. */
export const deadlineSourceQueries: Readonly<Record<DeadlineSource, SourceQuery<DeadlineValues>>> =
  {
    quote: openQuotes,
  }
