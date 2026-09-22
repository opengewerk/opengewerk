import { longestSignaturePath } from '@opengewerk/domain'
import { sql } from 'drizzle-orm'
import { check, foreignKey, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'

import { primaryId, reference, syncColumns, timestamps } from './columns.js'
import { documents } from './documents.js'
import { tenantIsolation } from './rls.js'
import { tenantColumn } from './tenants.js'

/**
 * A customer's signature on a document, made on the device on site.
 *
 * It travels like everything else a technician records, through the outbox,
 * and carries the sync columns for it. It is written once: the application may
 * insert and read and nothing else, a trigger refuses a change from any role,
 * and the moment the row lands a second trigger turns its document from
 * `draft` to `signed`, after which the document and its lines change no more.
 *
 * One per document. A second signature would be a second opinion on the same
 * page, and the sync rules refuse it before this index has to.
 */
export const documentSignatures = pgTable(
  'document_signatures',
  {
    id: primaryId<'document-signature'>(),
    ...tenantColumn,
    documentId: reference<'document'>('document_id').notNull(),
    signerName: text('signer_name').notNull(),
    signedAt: timestamp('signed_at', { withTimezone: true }).notNull(),
    deviceInfo: text('device_info'),
    path: text('path').notNull(),
    contentFingerprint: text('content_fingerprint').notNull(),
    ...timestamps,
    ...syncColumns,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    foreignKey({
      columns: [table.tenantId, table.documentId],
      foreignColumns: [documents.tenantId, documents.id],
      name: 'document_signatures_document_in_tenant',
    }).onDelete('restrict'),
    uniqueIndex('document_signatures_document').on(table.documentId),
    check(
      'document_signatures_signer_named',
      sql`length(btrim(${table.signerName})) between 1 and 200`,
    ),
    // The same shape `signaturePathIsValid` checks in `domain`, minus the box:
    // a regular expression cannot compare numbers, the application does that.
    // What it can do is keep anything but moves, lines, digits and commas out.
    check(
      'document_signatures_path_shape',
      sql`${table.path} ~ '^(M[0-9]{1,4},[0-9]{1,4}(L[0-9]{1,4},[0-9]{1,4})*)+$' and length(${table.path}) <= ${sql.raw(String(longestSignaturePath))}`,
    ),
    check(
      'document_signatures_device_info_short',
      sql`${table.deviceInfo} is null or length(${table.deviceInfo}) <= 500`,
    ),
  ],
)
