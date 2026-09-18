import { auditOperations } from '@opengewerk/domain'
import {
  bigint,
  index,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'

import { primaryId, timestamps } from './columns.js'
import { writtenByTriggerOnly } from './rls.js'
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
    // The chain. Its place in the tenant's sequence, the hash of the entry
    // before it, and its own. Writing the log is append only, which stops a
    // change; this notices one that happened anyway, by whatever means.
    sequence: bigint('sequence', { mode: 'number' }).notNull(),
    previousHash: text('previous_hash'),
    hash: text('hash').notNull(),
    // Text, not uuid: user ids come from the authentication library and are
    // not promised to be uuids. Null when the change came from somewhere other
    // than the application.
    userId: text('user_id'),
    reason: text('reason'),
    databaseRole: text('database_role').notNull(),
  },
  (table) => [
    ...writtenByTriggerOnly(table.tenantId),
    // The history of one record, which is the question the log gets asked.
    index('audit_entries_record_idx').on(table.tenantId, table.tableName, table.recordId),
    // And the other one: what happened in this company last week.
    index('audit_entries_time_idx').on(table.tenantId, table.changedAt),
    // The chain is walked in this order, and no number may appear twice: a
    // second entry claiming a taken place is a fork, not a chain.
    unique('audit_entries_sequence').on(table.tenantId, table.sequence),
  ],
)

/**
 * The head of each tenant's chain, and the queue writers pass through.
 *
 * Its row is locked for the rest of the transaction as soon as a change is
 * logged, which is what gives concurrent changes a defined order. The price is
 * that two transactions writing for the same company wait for each other. For
 * a trades business that is nothing; it would be something at ten thousand
 * changes a minute, and then the question would be whether a chain is still
 * the right instrument, not whether the lock can go.
 *
 * The audit trigger deliberately does not sit on this table. It would log its
 * own logging, and each entry would produce the next one forever.
 */
export const auditChains = pgTable(
  'audit_chains',
  {
    // The tenant is the key. There is exactly one chain per tenant, so a
    // separate id would be a column nobody ever looks at.
    ...tenantColumn,
    nextSequence: bigint('next_sequence', { mode: 'number' }).notNull().default(1),
    headHash: text('head_hash'),
    ...timestamps,
  },
  (table) => [
    ...writtenByTriggerOnly(table.tenantId),
    primaryKey({ columns: [table.tenantId], name: 'audit_chains_pk' }),
  ],
)
