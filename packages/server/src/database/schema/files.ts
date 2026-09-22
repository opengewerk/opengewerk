import { sql } from 'drizzle-orm'
import { bigint, check, pgTable, text, unique, uniqueIndex } from 'drizzle-orm/pg-core'

import { primaryId, timestamps } from './columns.js'
import { tenantIsolation } from './rls.js'
import { tenantColumn } from './tenants.js'

/**
 * The files a business keeps, as far as the database knows them. The bytes
 * lie in the content addressed store from ADR 0007, under their SHA-256.
 *
 * The row is what makes a file belong to somebody. The store is shared by
 * every business on the instance and knows nothing about any of them; row
 * level security on this table is what decides whether a hash may be read.
 * Whoever knows the hash of another company's invoice has a string, not a
 * file.
 *
 * One row per business and content, which the unique index says. The same
 * logo uploaded twice is one file, and the second upload finds the first.
 *
 * Inserted and read, never changed and never deleted by the application: the
 * grant in 0013 stops at INSERT. A file an issued document points at has to
 * outlive every mistake, and deleting files at the end of a retention period
 * is a procedure of its own that nothing here does yet.
 */
export const files = pgTable(
  'files',
  {
    id: primaryId<'file'>(),
    ...tenantColumn,
    sha256: text('sha256').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    mediaType: text('media_type').notNull(),
    ...timestamps,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    unique('files_tenant_id_key').on(table.tenantId, table.id),
    uniqueIndex('files_content').on(table.tenantId, table.sha256),
    // The name in the store is the hash, so a malformed one is a file that
    // can never be found. Lower case only, because the store writes it that
    // way and a comparison is exact.
    check('files_sha256_is_hex', sql`${table.sha256} ~ '^[0-9a-f]{64}$'`),
    check('files_size_not_negative', sql`${table.sizeBytes} >= 0`),
  ],
)
