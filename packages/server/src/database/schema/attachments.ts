import { sql } from 'drizzle-orm'
import { bigint, check, foreignKey, index, pgTable, text, unique } from 'drizzle-orm/pg-core'

import { primaryId, reference, syncColumns, timestamps } from './columns.js'
import { customers } from './customers.js'
import { files } from './files.js'
import { installations } from './installations.js'
import { jobs } from './jobs.js'
import { tenantIsolation } from './rls.js'
import { sites } from './sites.js'
import { tenantColumn } from './tenants.js'

/**
 * A file in the business's records and where it hangs (#77): a customer, a
 * site, an installation and a job, any of them and at least one, which the
 * check says. Every place runs over the tenant, like every other reference
 * between two records of a business.
 */
export const attachments = pgTable(
  'attachments',
  {
    id: primaryId<'attachment'>(),
    ...tenantColumn,
    customerId: reference<'customer'>('customer_id'),
    siteId: reference<'site'>('site_id'),
    installationId: reference<'installation'>('installation_id'),
    jobId: reference<'job'>('job_id'),
    title: text('title').notNull(),
    ...timestamps,
    ...syncColumns,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    unique('attachments_tenant_id_key').on(table.tenantId, table.id),
    foreignKey({
      columns: [table.tenantId, table.customerId],
      foreignColumns: [customers.tenantId, customers.id],
      name: 'attachments_customer_in_tenant',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.tenantId, table.siteId],
      foreignColumns: [sites.tenantId, sites.id],
      name: 'attachments_site_in_tenant',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.tenantId, table.installationId],
      foreignColumns: [installations.tenantId, installations.id],
      name: 'attachments_installation_in_tenant',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.tenantId, table.jobId],
      foreignColumns: [jobs.tenantId, jobs.id],
      name: 'attachments_job_in_tenant',
    }).onDelete('restrict'),
    check(
      'attachments_have_a_home',
      sql`num_nonnulls(${table.customerId}, ${table.siteId}, ${table.installationId}, ${table.jobId}) >= 1`,
    ),
    index('attachments_customer_idx').on(table.tenantId, table.customerId),
    index('attachments_site_idx').on(table.tenantId, table.siteId),
    index('attachments_installation_idx').on(table.tenantId, table.installationId),
    index('attachments_job_idx').on(table.tenantId, table.jobId),
  ],
)

/**
 * One version of an attachment, written once and never changed.
 *
 * The file is named by its hash and found by business and hash, both keys
 * over the tenant onto the one row per business and content in `files`. A
 * version can therefore only name bytes its own business has stored: the
 * store is shared by every business of the instance, the row in `files` is
 * what makes a file this business's, and a hash of somebody else's file is a
 * string and not a way in.
 *
 * `created_by` is written by a trigger from the request, like the author of a
 * task, and carries no key for the same reason: it records who acted.
 */
export const attachmentVersions = pgTable(
  'attachment_versions',
  {
    id: primaryId<'attachment-version'>(),
    ...tenantColumn,
    attachmentId: reference<'attachment'>('attachment_id').notNull(),
    sha256: text('sha256').notNull(),
    fileName: text('file_name').notNull(),
    mediaType: text('media_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    previewSha256: text('preview_sha256'),
    createdBy: text('created_by'),
    ...timestamps,
    ...syncColumns,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    unique('attachment_versions_tenant_id_key').on(table.tenantId, table.id),
    foreignKey({
      columns: [table.tenantId, table.attachmentId],
      foreignColumns: [attachments.tenantId, attachments.id],
      name: 'attachment_versions_attachment_in_tenant',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.tenantId, table.sha256],
      foreignColumns: [files.tenantId, files.sha256],
      name: 'attachment_versions_file_in_tenant',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.tenantId, table.previewSha256],
      foreignColumns: [files.tenantId, files.sha256],
      name: 'attachment_versions_preview_in_tenant',
    }).onDelete('restrict'),
    index('attachment_versions_attachment_idx').on(table.tenantId, table.attachmentId),
  ],
)
