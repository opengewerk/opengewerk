import { documentFilePurposes, type StoredDocumentContent } from '@opengewerk/domain'
import { jsonb, pgEnum, pgTable, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'

import { primaryId, reference } from './columns.js'
import { documents } from './documents.js'
import { files } from './files.js'
import { tenantIsolation } from './rls.js'
import { tenantColumn } from './tenants.js'

export const documentFilePurpose = pgEnum('document_file_purpose', documentFilePurposes)

const createdAt = timestamp('created_at', { withTimezone: true }).notNull().defaultNow()

/**
 * What a document said on the day it was issued, written in the same
 * transaction that hands out its number.
 *
 * The reason is in `DocumentContent`: a document draws on the customer and
 * the letterhead, both of which change afterwards, and printed a year later
 * from the live rows it would show an address the customer did not have when
 * the invoice went out. This row is what gets printed instead, every time.
 *
 * Written once. The application may insert and read, and since the grant is
 * only half of it, a trigger refuses a change or a deletion from any role at
 * all. An update would never be legitimate here, not even a correction: that
 * is what a cancellation is for.
 */
export const documentSnapshots = pgTable(
  'document_snapshots',
  {
    id: primaryId<'document-snapshot'>(),
    ...tenantColumn,
    documentId: reference<'document'>('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'restrict' }),
    // Any shape a snapshot was ever written in. `currentContent` reads an older
    // one in the shape of today; the row itself is never rewritten.
    content: jsonb('content').$type<StoredDocumentContent>().notNull(),
    createdAt,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    // One per document. A second issuing is refused long before this, by the
    // status; the index is the lock behind the lock.
    uniqueIndex('document_snapshots_document').on(table.documentId),
  ],
)

/**
 * The files an issued document is made of, one per purpose.
 *
 * Written by the first request for the PDF, not at issuing. That keeps the
 * renderer out of the one transaction that must not fail for an operational
 * reason: a business whose renderer is down can still issue an invoice, and
 * the PDF follows as soon as the service is back. Which bytes it will contain
 * is fixed either way, because they come from the snapshot above.
 *
 * Insert and read only, like the snapshot, and with the same trigger. The
 * unique index is what makes two simultaneous first requests harmless: one
 * of them writes the row, the other finds it and returns the same file.
 */
export const documentFiles = pgTable(
  'document_files',
  {
    id: primaryId<'document-file'>(),
    ...tenantColumn,
    documentId: reference<'document'>('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'restrict' }),
    purpose: documentFilePurpose('purpose').notNull(),
    fileId: reference<'file'>('file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'restrict' }),
    createdAt,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    uniqueIndex('document_files_purpose').on(table.documentId, table.purpose),
  ],
)
