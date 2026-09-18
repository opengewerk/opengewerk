import { auditOperations } from '@opengewerk/domain'
import { index, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

import { primaryId } from './columns.js'
import { tenantReadOnly, writtenByTrigger } from './rls.js'
import { tenantColumn } from './tenants.js'

export const auditOperation = pgEnum('audit_operation', auditOperations)

/**
 * The change log, one row per field that actually changed.
 *
 * Nothing in the application writes here. A trigger on every other table does,
 * which is the only way the log can claim to be complete: a line written by
 * hand at each place that changes something is a line somebody forgets at the
 * sixteenth place, and nobody notices, because a missing entry looks exactly
 * like a change that never happened.
 *
 * The trigger, the grants and the append-only rule live in the migration.
 * drizzle-kit knows none of the three, so this table is one of the places
 * where the file next to the schema is the real source.
 */
export const auditEntries = pgTable(
  'audit_entries',
  {
    id: primaryId<'audit-entry'>(),
    ...tenantColumn,
    changeId: uuid('change_id').notNull(),
    tableName: text('table_name').notNull(),
    // No foreign key, and that is the point: the history of a record has to
    // survive the record. A key here would either block a delete or take the
    // history down with it, and both are the opposite of a log.
    recordId: uuid('record_id').notNull(),
    operation: auditOperation('operation').notNull(),
    field: text('field').notNull(),
    oldValue: text('old_value'),
    newValue: text('new_value'),
    changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
    // Text, not uuid: user ids come from the authentication library and are
    // not promised to be uuids. Null when the change came from somewhere other
    // than the application.
    userId: text('user_id'),
    reason: text('reason'),
    databaseRole: text('database_role').notNull(),
  },
  (table) => [
    tenantReadOnly(table.tenantId),
    writtenByTrigger(),
    // The history of one record, which is the question the log gets asked.
    index('audit_entries_record_idx').on(table.tenantId, table.tableName, table.recordId),
    // And the other one: what happened in this company last week.
    index('audit_entries_time_idx').on(table.tenantId, table.changedAt),
  ],
)
