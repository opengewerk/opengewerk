import type {
  CustomerId,
  DeadlineSource,
  DocumentId,
  InstallationId,
  IsoDate,
  JobId,
  SiteId,
} from '@opengewerk/domain'
import type { TenantTransaction } from '@opengewerk/platform-server'
import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm'

import { documents } from '../database/schema/index.js'
import { berlinClock } from '../notifications/notify.js'

/**
 * A deadline as its source asks for it right now: what the engine compares
 * with the deadline it keeps, to write it, move it or let it drop.
 */
export interface ExpectedDeadline {
  readonly sourceId: string
  readonly sourceLabel: string
  readonly documentId: DocumentId | null
  readonly installationId: InstallationId | null
  readonly customerId: CustomerId | null
  readonly siteId: SiteId | null
  readonly jobId: JobId | null
  /** The day of the source the due day is counted from. */
  readonly anchorOn: IsoDate
  /** The due day, where the source names it; null where the interval of the kind counts. */
  readonly namedDueOn: IsoDate | null
  /** The person the source names, for a kind whose responsible is `source`. */
  readonly naturalUserId: string | null
}

/** The question one source asks the data of a business. */
export type SourceQuery = (tx: TenantTransaction) => Promise<readonly ExpectedDeadline[]>

/**
 * The quotes that went out and that nothing has followed: no order
 * confirmation, no invoice, no document at all with the quote as its
 * predecessor. A draft that follows counts as well, because somebody is
 * already on it; if it is thrown away, the quote is open again, and so is its
 * deadline.
 *
 * Counted from the day it was issued, in Berlin, and named by its number.
 */
export async function openQuotes(tx: TenantTransaction): Promise<readonly ExpectedDeadline[]> {
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
            documentId: row.id,
            installationId: null,
            customerId: row.customerId,
            siteId: row.siteId,
            jobId: row.jobId,
            anchorOn: berlinClock(row.issuedAt).day,
            namedDueOn: null,
            naturalUserId: row.issuedBy,
          },
        ],
  )
}

/** Every source there is, by the name a kind gives it. */
export const deadlineSourceQueries: Readonly<Record<DeadlineSource, SourceQuery>> = {
  quote: openQuotes,
}
