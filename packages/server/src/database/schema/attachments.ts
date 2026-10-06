import { attachmentsSchema, reference } from '@opengewerk/platform-server'
import { sql } from 'drizzle-orm'
import { check, foreignKey, index } from 'drizzle-orm/pg-core'

import { customers } from './customers.js'
import { installations } from './installations.js'
import { jobs } from './jobs.js'
import { sites } from './sites.js'

/** What a file of this application hangs on: a customer, a site, an installation and a job. */
const attachmentHomes = {
  customerId: reference<'customer'>('customer_id'),
  siteId: reference<'site'>('site_id'),
  installationId: reference<'installation'>('installation_id'),
  jobId: reference<'job'>('job_id'),
}

/** The columns this application gives its files. */
export type AttachmentHomeColumns = typeof attachmentHomes

/**
 * A file in the business's records and where it hangs (#77): a customer, a
 * site, an installation and a job, any of them and at least one, which the
 * check says. Every place runs over the tenant, like every other reference
 * between two records of a business.
 *
 * The two tables are the foundation's (`attachmentsSchema`,
 * opengewerk-haustechnik#97): what a file is called, its versions with the
 * keys onto the stored bytes, the sync columns and the separation of the
 * businesses. Kept here are the four places with their keys over the
 * business, the check and the indexes.
 *
 * One version of an attachment is written once and never changed. It names
 * its file by hash and finds it by business and hash, so a version can only
 * name bytes its own business has stored; `created_by` is written by a
 * trigger from the request, like the author of a task.
 */
export const { attachments, attachmentVersions } = attachmentsSchema({
  columns: attachmentHomes,
  constraints: (table) => [
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
})
