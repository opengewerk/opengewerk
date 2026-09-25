import { foreignKey, index, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

import { primaryId, reference, syncColumns, timestamps } from './columns.js'
import { jobs } from './jobs.js'
import { tenantIsolation } from './rls.js'
import { tenantColumn } from './tenants.js'

/**
 * The notes from the site about a job (#220), one per row: what happened,
 * who wrote it and when.
 *
 * Written once and never changed. The grant stops at INSERT (migration 0045),
 * so a note that turns out wrong is followed by another one rather than
 * rewritten. `created_by` is written by a trigger from the request, like the
 * author of a task, and carries no key: it records who wrote the note, and a
 * record of that must not be something a later change to an account takes
 * away. `written_at` is the device's, the moment the note was written, which
 * can be hours before the device had a network again.
 */
export const jobNotes = pgTable(
  'job_notes',
  {
    id: primaryId<'job-note'>(),
    ...tenantColumn,
    jobId: reference<'job'>('job_id').notNull(),
    text: text('text').notNull(),
    writtenAt: timestamp('written_at', { withTimezone: true }).notNull(),
    createdBy: text('created_by'),
    ...timestamps,
    ...syncColumns,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    foreignKey({
      columns: [table.tenantId, table.jobId],
      foreignColumns: [jobs.tenantId, jobs.id],
      name: 'job_notes_job_in_tenant',
    }).onDelete('restrict'),
    index('job_notes_job_idx').on(table.tenantId, table.jobId, table.writtenAt),
  ],
)
