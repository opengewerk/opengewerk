import { sql } from 'drizzle-orm'
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

import { primaryId, reference, syncColumns, timestamps } from './columns.js'
import { documents } from './documents.js'
import { tenantIsolation } from './rls.js'
import { tenantColumn } from './tenants.js'

/**
 * Which reports a collective invoice was made out of (#135), one row each, in
 * the order the invoice lists them.
 *
 * The one place where links of the chain run together, section 1.4: an
 * invoice over every report of a job, one for each day of work, and each of
 * those reports has that invoice as its one successor. `predecessor_document_id`
 * names one document and stays empty on such an invoice; its sources are here.
 *
 * Made by the route that makes the invoice and by nothing else. A device reads
 * the rows to know which reports are still open and where the chain of one
 * that is not goes on, and writes none. When the invoice is cancelled or its
 * draft deleted, a trigger stamps `released_at`, and from then on the row
 * stays as a record of what was and no longer counts, as a cancelled
 * successor no longer counts in `continuesChain`. The partial index holds that
 * a report is in at most one invoice that counts.
 */
export const documentSources = pgTable(
  'document_sources',
  {
    id: primaryId<'document-source'>(),
    ...tenantColumn,
    documentId: reference<'document'>('document_id').notNull(),
    sourceDocumentId: reference<'document'>('source_document_id').notNull(),
    position: integer('position').notNull(),
    releasedAt: timestamp('released_at', { withTimezone: true }),
    ...timestamps,
    ...syncColumns,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    foreignKey({
      columns: [table.tenantId, table.documentId],
      foreignColumns: [documents.tenantId, documents.id],
      name: 'document_sources_document_in_tenant',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.tenantId, table.sourceDocumentId],
      foreignColumns: [documents.tenantId, documents.id],
      name: 'document_sources_source_in_tenant',
    }).onDelete('restrict'),
    check('document_sources_not_itself', sql`${table.documentId} <> ${table.sourceDocumentId}`),
    uniqueIndex('document_sources_one_invoice')
      .on(table.tenantId, table.sourceDocumentId)
      .where(sql`${table.releasedAt} is null`),
    index('document_sources_document_idx').on(table.tenantId, table.documentId),
  ],
)
