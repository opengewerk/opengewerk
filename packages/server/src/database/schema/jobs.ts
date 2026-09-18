import { jobKinds, jobStatuses } from '@opengewerk/domain'
import { type AnyPgColumn, index, pgEnum, pgTable, text } from 'drizzle-orm/pg-core'

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
    customerId: reference<'customer'>('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'restrict' }),
    siteId: reference<'site'>('site_id').references(() => sites.id, { onDelete: 'restrict' }),
    installationId: reference<'installation'>('installation_id').references(
      () => installations.id,
      { onDelete: 'restrict' },
    ),
    parentJobId: reference<'job'>('parent_job_id').references((): AnyPgColumn => jobs.id, {
      onDelete: 'restrict',
    }),
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
    index('jobs_customer_idx').on(table.tenantId, table.customerId),
    index('jobs_site_idx').on(table.tenantId, table.siteId),
    index('jobs_parent_idx').on(table.parentJobId),
  ],
)
