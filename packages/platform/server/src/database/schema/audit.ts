import { auditOperations } from '@opengewerk/platform-domain'
import { sql } from 'drizzle-orm'
import {
  bigint,
  check,
  index,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'

import { primaryId, timestamps } from './columns.js'
import { redactedByWhoeverLeads, writtenByTriggerOnly } from './rls.js'
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
 * The trigger, the grants and the append-only rule are not here. drizzle-kit
 * knows none of the three, so they are written by hand: in the migrations of
 * an application, and for a new one in the building blocks under `sql/`
 * (ADR 0010), which a test holds against the database.
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
    // ADR 0013, at the end so that a log that gets them later has them in the
    // same order: the version of the fingerprint, 1 for every entry written
    // before them, and the fingerprint of each value, which stays when the
    // value is blacked out.
    fingerprintVersion: smallint('fingerprint_version').notNull().default(1),
    oldValueDigest: text('old_value_digest'),
    newValueDigest: text('new_value_digest'),
  },
  (table) => [
    ...writtenByTriggerOnly(table.tenantId),
    // The history of one record, which is the question the log gets asked.
    index('audit_entries_record_idx').on(table.tenantId, table.tableName, table.recordId),
    // And the other one: what happened in this tenant last week.
    index('audit_entries_time_idx').on(table.tenantId, table.changedAt),
    // The chain is walked in this order, and no number may appear twice: a
    // second entry claiming a taken place is a fork, not a chain.
    unique('audit_entries_sequence').on(table.tenantId, table.sequence),
  ],
)

/**
 * A value of the log blacked out (ADR 0013): which entry, which side (the
 * value before or after), why and by whom, and for an entry of version 1 the
 * witness of the whole entry, its fingerprint over the fingerprints of its
 * values. Written once, by whoever leads the tenant, and never changed or
 * removed; the triggers that check and apply it are in `sql/audit.sql`, and
 * the audit trigger writes the redaction itself into the log.
 */
export const auditRedactions = pgTable(
  'audit_redactions',
  {
    id: primaryId<'audit-redaction'>(),
    ...tenantColumn,
    // No foreign key, as the entries carry none: the trigger that checks a
    // redaction finds its entry in the tenant, and the log stays a table that
    // nothing else holds on to.
    entryId: uuid('entry_id').notNull(),
    side: text('side').notNull(),
    reason: text('reason').notNull(),
    redactedBy: text('redacted_by').notNull(),
    witness: text('witness'),
    ...timestamps,
  },
  (table) => [
    ...redactedByWhoeverLeads(table.tenantId),
    unique('audit_redactions_once').on(table.entryId, table.side),
    check('audit_redactions_side_known', sql`${table.side} in ('old', 'new')`),
    check(
      'audit_redactions_reason_shaped',
      sql`${table.reason} = btrim(${table.reason}) and char_length(${table.reason}) between 1 and 500`,
    ),
  ],
)

/**
 * The nonce of each value of an entry from version 3 on: 32 random bytes in
 * hex, which the fingerprint of the value is taken over together with the
 * value. Without it the fingerprint says nothing about the value, not even
 * about one that is easy to guess, and blacking out the value takes its nonce
 * with it (ADR 0013, amended on 29.10.2026). Written by the audit trigger
 * alone and read by the check of the chain, which runs as the application:
 * a nonce stands only beside a value the tenant reads in the entry anyway.
 *
 * Kept apart from `audit_entries`, whose columns are frozen: one more column
 * there would change the text every entry is hashed over.
 */
export const auditValueNonces = pgTable(
  'audit_value_nonces',
  {
    // No foreign key, as the redactions carry none, for the same reason.
    entryId: uuid('entry_id').notNull(),
    ...tenantColumn,
    side: text('side').notNull(),
    nonce: text('nonce').notNull(),
  },
  (table) => [
    ...writtenByTriggerOnly(table.tenantId),
    primaryKey({ columns: [table.entryId, table.side], name: 'audit_value_nonces_pk' }),
    check('audit_value_nonces_side_known', sql`${table.side} in ('old', 'new')`),
    check('audit_value_nonces_nonce_shaped', sql`${table.nonce} ~ '^[0-9a-f]{64}$'`),
  ],
)

/**
 * The head of each tenant's chain, and the queue writers pass through.
 *
 * Its row is locked for the rest of the transaction as soon as a change is
 * logged, which is what gives concurrent changes a defined order. The price is
 * that two transactions writing for the same tenant wait for each other. For
 * a tenant of the size these applications are built for that is nothing; it
 * would be something at ten thousand
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
