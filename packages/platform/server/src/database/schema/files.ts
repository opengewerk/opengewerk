import { sql } from 'drizzle-orm'
import { bigint, check, foreignKey, pgTable, text, unique, uniqueIndex } from 'drizzle-orm/pg-core'

import { primaryId, timestamps } from './columns.js'
import { heldByThePersonAsking, readableByTheOwner, tenantIsolation } from './rls.js'
import { tenantColumn } from './tenants.js'

/**
 * The files a tenant keeps, as far as the database knows them. The bytes lie
 * in the content addressed store (`FileStore`), under their SHA-256.
 *
 * The row is what makes a file belong to somebody. The store is shared by
 * every tenant on the instance and knows nothing about any of them; row level
 * security on this table is what decides whether a hash may be read. Whoever
 * knows the hash of a file of another tenant has a string, not a file.
 *
 * One row per tenant and content, which the unique index says. The same logo
 * uploaded twice is one file, and the second upload finds the first.
 *
 * Inserted and read, never changed and never deleted by the application: the
 * grant stops at INSERT. A file a record points at has to outlive every
 * mistake, and deleting files at the end of a retention period is a procedure
 * of its own that nothing here does yet. The bytes of a file no row names any
 * more the sweep of the store takes out (`sweepFileStore`, #657).
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
    // For the function that runs as the owner of the tables and tells the
    // sweep of the store which of the names it found any tenant still holds
    // (`files_held`, #657). It hands out nothing else.
    readableByTheOwner(),
    unique('files_tenant_id_key').on(table.tenantId, table.id),
    uniqueIndex('files_content').on(table.tenantId, table.sha256),
    // The name in the store is the hash, so a malformed one is a file that
    // can never be found. Lower case only, because the store writes it that
    // way and a comparison is exact.
    check('files_sha256_is_hex', sql`${table.sha256} ~ '^[0-9a-f]{64}$'`),
    check('files_size_not_negative', sql`${table.sizeBytes} >= 0`),
  ],
)

/**
 * Who has stored a file of the tenant: a row for each person who sent its
 * bytes, written with the row of the file (`fileRowFor`), and one for each
 * person a file was made for on the server, a print.
 *
 * What it is for is the question who may name a file in a record of their
 * own (`mayNameFile`). The row of the file is one for the whole tenant, while
 * the records that name files lie in areas, and whoever knew the hash of a
 * file of another area could otherwise hang it on a record of their own and
 * read it there. Having sent the bytes is the proof of having them.
 *
 * Each person sees their own rows and nobody else's (`heldByThePersonAsking`):
 * who sent which file is nothing the rest of the tenant needs to know. Added
 * and never changed or removed, like the file.
 */
export const fileUploads = pgTable(
  'file_uploads',
  {
    id: primaryId<'fileUpload'>(),
    ...tenantColumn,
    sha256: text('sha256').notNull(),
    userId: text('user_id').notNull(),
    ...timestamps,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    heldByThePersonAsking(table.userId),
    uniqueIndex('file_uploads_once').on(table.tenantId, table.sha256, table.userId),
    foreignKey({
      columns: [table.tenantId, table.sha256],
      foreignColumns: [files.tenantId, files.sha256],
      name: 'file_uploads_file_in_tenant',
    }).onDelete('restrict'),
  ],
)
