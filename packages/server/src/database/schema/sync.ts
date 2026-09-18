import {
  conflictReasons,
  type DeviceId,
  operationOutcomes,
  type OperationId,
  type SyncValue,
} from '@opengewerk/domain'
import {
  bigint,
  index,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'

import { primaryId, timestamps } from './columns.js'
import { tenantIsolation, writtenByTriggerOnly } from './rls.js'
import { tenantColumn } from './tenants.js'

export const operationOutcome = pgEnum('operation_outcome', operationOutcomes)
export const conflictReason = pgEnum('conflict_reason', conflictReasons)

/**
 * The counter that puts a tenant's changes in order.
 *
 * Everything that changes a record passes through this row, which is what
 * makes the numbers come out in the order the transactions commit. A cursor
 * built on timestamps instead would quietly skip a row whose transaction
 * started early and committed late, and a device would never learn about it.
 *
 * Written by the same trigger that stamps the rows, so it carries the same
 * pair of policies as the audit chain: open for the trigger, shut around the
 * application.
 */
export const syncSequences = pgTable(
  'sync_sequences',
  {
    ...tenantColumn,
    nextValue: bigint('next_value', { mode: 'number' }).notNull().default(1),
    ...timestamps,
  },
  (table) => [
    ...writtenByTriggerOnly(table.tenantId),
    primaryKey({ columns: [table.tenantId], name: 'sync_sequences_pk' }),
  ],
)

/**
 * The receipt for every operation the server has seen.
 *
 * The id comes from the device and was minted before there was a network, so
 * it is the same on every retry. A device that lost the connection after the
 * server committed but before the answer arrived sends its queue again, and
 * that is the ordinary case: the second time round every operation is found
 * here and nothing happens twice.
 */
export const syncOperations = pgTable(
  'sync_operations',
  {
    id: uuid('id').primaryKey().$type<OperationId>(),
    ...tenantColumn,
    entity: text('entity').notNull(),
    recordId: uuid('record_id').notNull(),
    outcome: operationOutcome('outcome').notNull(),
    deviceId: text('device_id').notNull().$type<DeviceId>(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    tenantIsolation(table.tenantId),
    index('sync_operations_record_idx').on(table.tenantId, table.entity, table.recordId),
  ],
)

/**
 * A change that could not be applied, waiting for somebody to decide.
 *
 * Three pictures side by side: what the device wanted, what it thought was
 * there, and what actually was. That is what a person needs in order to say
 * which one is right, and it is the whole reason ADR 0005 turned down a merge
 * that resolves everything by itself.
 */
export const syncConflicts = pgTable(
  'sync_conflicts',
  {
    id: primaryId<'sync-conflict'>(),
    ...tenantColumn,
    operationId: uuid('operation_id').notNull().$type<OperationId>(),
    entity: text('entity').notNull(),
    recordId: uuid('record_id').notNull(),
    reason: conflictReason('reason').notNull(),
    fields: text('fields').array().notNull().$type<readonly string[]>(),
    wanted: jsonb('wanted').notNull().$type<Readonly<Record<string, SyncValue>>>(),
    seen: jsonb('seen').notNull().$type<Readonly<Record<string, SyncValue>>>(),
    found: jsonb('found').notNull().$type<Readonly<Record<string, SyncValue>>>(),
    deviceId: text('device_id').notNull().$type<DeviceId>(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    // The list somebody actually opens: what is still open, newest first.
    index('sync_conflicts_open_idx').on(table.tenantId, table.resolvedAt, table.recordedAt),
  ],
)
