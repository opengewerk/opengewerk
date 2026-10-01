import {
  articleImportStatuses,
  type ImportCharset,
  type ImportedFile,
  type ImportSummary,
} from '@opengewerk/domain'
import {
  primaryId,
  readableByTheOwner,
  reference,
  tenantIsolation,
  timestamps,
} from '@opengewerk/platform-server'
import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  date,
  foreignKey,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

import { suppliers } from './suppliers.js'
import { tenantColumn } from './tenants.js'

export const articleImportStatus = pgEnum('article_import_status', articleImportStatuses)

/**
 * An import of articles and prices from DATANORM (#297): the files of one
 * supplier, what reading them found, the choices of the preview, and whether
 * it was taken over. Kept at the routes of the office, no sync columns.
 *
 * This row is what the change log holds of an import, one record and not one
 * per field of every article (decided on 28.09.2026): who read which files
 * when, and later who took it over with how many articles. The rows an import
 * writes name it in `import_id`, and while it is taken over, and only then,
 * the log and the counter of the sync pass over them (`article_import_writing`
 * in migration 0062). The files stay in the file store and prove every value.
 */
export const articleImports = pgTable(
  'article_imports',
  {
    id: primaryId<'article-import'>(),
    ...tenantColumn,
    supplierId: reference<'supplier'>('supplier_id').notNull(),
    status: articleImportStatus('status').notNull().default('reading'),
    /** The uploaded files, by their hash in the file store. */
    files: jsonb('files').$type<readonly ImportedFile[]>().notNull(),
    /** Null: as the bytes of each file show. */
    charset: text('charset').$type<ImportCharset>(),
    validFrom: date('valid_from').notNull(),
    listAsSelling: boolean('list_as_selling').notNull().default(true),
    summary: jsonb('summary').$type<ImportSummary>(),
    /** Why reading or taking over broke off, in words. */
    problem: text('problem'),
    createdBy: text('created_by'),
    appliedBy: text('applied_by'),
    appliedAt: timestamp('applied_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    // `reserve_sync_sequences` runs as the owner and asks this table whether
    // the transaction takes over an import; without the reading half it would
    // find no row and refuse every takeover (migration 0062).
    readableByTheOwner(),
    unique('article_imports_tenant_id_key').on(table.tenantId, table.id),
    foreignKey({
      columns: [table.tenantId, table.supplierId],
      foreignColumns: [suppliers.tenantId, suppliers.id],
      name: 'article_imports_supplier_in_tenant',
    }),
    // One import at a time reads or is taken over in a business: two would
    // compare against a catalogue the other is changing.
    uniqueIndex('article_imports_one_running')
      .on(table.tenantId)
      .where(sql`${table.status} in ('reading', 'applying')`),
    check(
      'article_imports_charset_known',
      sql`${table.charset} in ('utf-8', 'cp850', 'windows-1252')`,
    ),
  ],
)
