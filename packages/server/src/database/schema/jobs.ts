import { jobKinds, jobStatuses } from '@opengewerk/domain'
import { foreignKey, index, pgEnum, pgTable, text, unique } from 'drizzle-orm/pg-core'

import { primaryId, reference, syncColumns, timestamps } from './columns.js'
import { tenantIsolation } from './rls.js'
import { tenantColumn } from './tenants.js'
import { customers } from './customers.js'
import { installations } from './installations.js'
import { sites } from './sites.js'

export const jobKind = pgEnum('job_kind', jobKinds)
export const jobStatus = pgEnum('job_status', jobStatuses)

/**
 * A project or a service call. The parent reference is what splits a large
 * site into sub jobs, one per trade or section.
 */
export const jobs = pgTable(
  'jobs',
  {
    id: primaryId<'job'>(),
    ...tenantColumn,
    customerId: reference<'customer'>('customer_id').notNull(),
    siteId: reference<'site'>('site_id'),
    installationId: reference<'installation'>('installation_id'),
    parentJobId: reference<'job'>('parent_job_id'),
    kind: jobKind('kind').notNull(),
    status: jobStatus('status').notNull().default('draft'),
    number: text('number'),
    designation: text('designation').notNull(),
    description: text('description'),
    ...timestamps,
    ...syncColumns,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    unique('jobs_tenant_id_key').on(table.tenantId, table.id),
    foreignKey({
      columns: [table.tenantId, table.customerId],
      foreignColumns: [customers.tenantId, customers.id],
      name: 'jobs_customer_in_tenant',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.tenantId, table.siteId],
      foreignColumns: [sites.tenantId, sites.id],
      name: 'jobs_site_in_tenant',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.tenantId, table.installationId],
      foreignColumns: [installations.tenantId, installations.id],
      name: 'jobs_installation_in_tenant',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.tenantId, table.parentJobId],
      foreignColumns: [table.tenantId, table.id],
      name: 'jobs_parent_in_tenant',
    }).onDelete('restrict'),
    index('jobs_customer_idx').on(table.tenantId, table.customerId),
    index('jobs_site_idx').on(table.tenantId, table.siteId),
    index('jobs_parent_idx').on(table.parentJobId),
  ],
)
