import { deadlinesSchema, reference } from '@opengewerk/platform-server'
import { foreignKey, index } from 'drizzle-orm/pg-core'

import { customers } from './customers.js'
import { documents } from './documents.js'
import { installations } from './installations.js'
import { jobs } from './jobs.js'
import { sites } from './sites.js'
import { tasks } from './tasks.js'

/** What a deadline of this application hangs on, beside its source. */
const deadlineColumns = {
  documentId: reference<'document'>('document_id'),
  installationId: reference<'installation'>('installation_id'),
  customerId: reference<'customer'>('customer_id'),
  siteId: reference<'site'>('site_id'),
  jobId: reference<'job'>('job_id'),
  taskId: reference<'task'>('task_id'),
}

/** The columns this application gives its deadlines, for the engine of the foundation. */
export type ApplicationDeadlineColumns = typeof deadlineColumns

/**
 * The deadlines of a business (#283), one per kind and source: the table of
 * the foundation (ADR 0010, opengewerk-haustechnik#24) with the columns this
 * application keeps for what a deadline hangs on.
 *
 * The source is the record the deadline follows. The columns beside it hold
 * the same record and what it hangs on, the document, the installation, the
 * customer, the site and the job, each under a key over the tenant (#113), so
 * that a deadline cannot point into another business and the list can ask for
 * a customer. The task is the one its reminder made, so that a deadline is
 * done once somebody did the task.
 *
 * What a business sets for a kind of deadline, and when the deadlines of a
 * business were last gone through, are tables of the foundation itself
 * (`deadline_settings`, `deadline_runs`).
 */
export const { deadlineStatus, deadlines } = deadlinesSchema({
  columns: deadlineColumns,
  constraints: (table) => [
    foreignKey({
      columns: [table.tenantId, table.documentId],
      foreignColumns: [documents.tenantId, documents.id],
      name: 'deadlines_document_in_tenant',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.tenantId, table.installationId],
      foreignColumns: [installations.tenantId, installations.id],
      name: 'deadlines_installation_in_tenant',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.tenantId, table.customerId],
      foreignColumns: [customers.tenantId, customers.id],
      name: 'deadlines_customer_in_tenant',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.tenantId, table.siteId],
      foreignColumns: [sites.tenantId, sites.id],
      name: 'deadlines_site_in_tenant',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.tenantId, table.jobId],
      foreignColumns: [jobs.tenantId, jobs.id],
      name: 'deadlines_job_in_tenant',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.tenantId, table.taskId],
      foreignColumns: [tasks.tenantId, tasks.id],
      name: 'deadlines_task_in_tenant',
    }).onDelete('restrict'),
    index('deadlines_customer_idx').on(table.tenantId, table.customerId),
    index('deadlines_document_idx').on(table.tenantId, table.documentId),
    index('deadlines_task_idx').on(table.tenantId, table.taskId),
  ],
})
