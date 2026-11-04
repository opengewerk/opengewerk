import { offerDeclineLimits } from '@opengewerk/domain'
import { primaryId, reference, tenantIsolation, timestamps } from '@opengewerk/platform-server'
import { tenantColumn } from '@opengewerk/platform-server/schema'
import { sql } from 'drizzle-orm'
import { check, date, foreignKey, pgTable, text, unique } from 'drizzle-orm/pg-core'

import { documents } from './documents.js'

/**
 * That the customer turned an offer down (#841): one row per quote or cost
 * estimate the office marked, with the day and a reason it may leave out.
 * Beside the document and not on it, because an issued document is fixed;
 * taking the mark back deletes the row, and the audit log keeps both.
 *
 * No sync columns: the office keeps it at a desk, and it goes to no device.
 */
export const offerDeclines = pgTable(
  'offer_declines',
  {
    id: primaryId<'offer-decline'>(),
    ...tenantColumn,
    documentId: reference<'document'>('document_id').notNull(),
    declinedOn: date('declined_on').notNull(),
    reason: text('reason'),
    ...timestamps,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    unique('offer_declines_tenant_id_key').on(table.tenantId, table.id),
    unique('offer_declines_document_key').on(table.tenantId, table.documentId),
    foreignKey({
      columns: [table.tenantId, table.documentId],
      foreignColumns: [documents.tenantId, documents.id],
      name: 'offer_declines_document_in_tenant',
    }).onDelete('restrict'),
    check(
      'offer_declines_reason_fits',
      sql`char_length(coalesce(${table.reason}, '')) <= ${sql.raw(String(offerDeclineLimits.reason))}`,
    ),
  ],
)
