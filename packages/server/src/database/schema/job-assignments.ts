import { sql } from 'drizzle-orm'
import { foreignKey, index, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core'

import { primaryId, reference, syncColumns, timestamps } from './columns.js'
import { jobs } from './jobs.js'
import { memberships } from './memberships.js'
import { tenantIsolation } from './rls.js'
import { tenantColumn } from './tenants.js'

/**
 * A person on a job (#140), assigned in the office.
 *
 * What the device of a person without `job.read.all` holds follows from these
 * rows: the jobs they are on, with what hangs on them. Set at the route, which
 * asks whether the person works in the business and is not shut out; the key
 * onto the memberships holds the first half for every other way in. Removed
 * by marking the row deleted, so that every device learns it; the partial
 * index keeps one row that counts per job and person.
 */
export const jobAssignments = pgTable(
  'job_assignments',
  {
    id: primaryId<'job-assignment'>(),
    ...tenantColumn,
    jobId: reference<'job'>('job_id').notNull(),
    userId: text('user_id').notNull(),
    ...timestamps,
    ...syncColumns,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    foreignKey({
      columns: [table.tenantId, table.jobId],
      foreignColumns: [jobs.tenantId, jobs.id],
      name: 'job_assignments_job_in_tenant',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.tenantId, table.userId],
      foreignColumns: [memberships.tenantId, memberships.userId],
      name: 'job_assignments_person_works_here',
    }).onDelete('restrict'),
    uniqueIndex('job_assignments_once')
      .on(table.tenantId, table.jobId, table.userId)
      .where(sql`${table.deletedAt} is null`),
    index('job_assignments_person_idx').on(table.tenantId, table.userId),
  ],
)
