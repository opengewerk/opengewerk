import { sql } from 'drizzle-orm'
import { check, date, foreignKey, index, integer, pgTable, timestamp } from 'drizzle-orm/pg-core'

import { primaryId, reference } from './columns.js'
import { documents } from './documents.js'
import { tenantIsolation } from './rls.js'
import { tenantColumn } from './tenants.js'

/**
 * A payment that came in on an invoice (#189), as the office records it.
 *
 * The first piece of the open items of phase 3, and built to be one: a gross
 * amount and the day it arrived, against the invoice it pays. What it is used
 * for now is the final invoice, which takes off what came in on each progress
 * invoice before it, section 14 (5) UStG, and not what they billed. When the
 * bank is matched in phase 3, the matching writes rows here as well.
 *
 * On the server only, like the documents' snapshots: a payment is recorded in
 * the office with a connection, and nothing on site reads it. Removed rather
 * than marked, because nothing is synced; the audit log keeps what was there.
 * A final invoice that took a payment off has it in its frozen state, so
 * removing the row afterwards changes no issued document.
 */
export const payments = pgTable(
  'payments',
  {
    id: primaryId<'payment'>(),
    ...tenantColumn,
    documentId: reference<'document'>('document_id').notNull(),
    amountCents: integer('amount_cents').notNull(),
    receivedOn: date('received_on').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    tenantIsolation(table.tenantId),
    foreignKey({
      columns: [table.tenantId, table.documentId],
      foreignColumns: [documents.tenantId, documents.id],
      name: 'payments_document_in_tenant',
    }).onDelete('restrict'),
    check('payments_amount_positive', sql`${table.amountCents} > 0`),
    index('payments_document_idx').on(table.tenantId, table.documentId),
  ],
)
