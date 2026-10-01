import {
  outsideAnyTenant,
  primaryId,
  timestamps,
  writtenByTriggerOutsideAnyTenant,
} from '@opengewerk/platform-server'
import { sql } from 'drizzle-orm'
import { check, index, pgTable, smallint, text, time, timestamp, uuid } from 'drizzle-orm/pg-core'

import { auditOperation } from './audit.js'
import { authUsers } from './authentication.js'

/**
 * What belongs to the instance and to no business (#188): who runs it, what
 * holds for every business on it, and the log of both.
 *
 * All three are read and written outside any business, like the accounts, and
 * for the same reason: an instance can carry several businesses, and none of
 * them decides for the others. None has a `tenant_id`, so the audit trigger of
 * a business stays off them; they have a log of their own, `instance_changes`,
 * written by a trigger of its own (migration 0051).
 */

/**
 * The accounts that run the instance. The account of the first run setup is
 * the first; on an instance set up before this table, the migration finds it
 * in the log of the first business (0051), and `appoint-operator` names one
 * on the command line where it finds none.
 */
export const instanceOperators = pgTable(
  'instance_operators',
  {
    id: primaryId<'instance-operator'>(),
    userId: text('user_id')
      .notNull()
      .unique()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    ...timestamps,
  },
  () => [outsideAnyTenant()],
)

/**
 * The settings of the instance, one row. Everything here moved in from the
 * `.env`, where only what is needed before there is a screen belongs.
 */
export const instanceSettings = pgTable(
  'instance_settings',
  {
    id: smallint('id').primaryKey().default(1),
    /**
     * Mail servers in the instance's own network a business may send through,
     * by name or address. Anything else in that network is refused, so that no
     * business reaches past the instance into the network behind it.
     */
    mailInternalHosts: text('mail_internal_hosts')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** When the nightly backup runs, in the time zone of the server. */
    backupTime: time('backup_time').notNull().default('02:30'),
    /**
     * When `MAIL_INTERNAL_HOSTS` was taken over from the `.env`, so that it is
     * taken over once and an update switches nothing off. Null while that has
     * not happened.
     */
    importedFromEnvironmentAt: timestamp('imported_from_environment_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [outsideAnyTenant(), check('instance_settings_one_row', sql`${table.id} = 1`)],
)

/**
 * The log of the instance: one row per field that changed on the operators,
 * the settings and the businesses themselves, written by a trigger as the log
 * of a business is. Append only, and without the chain a business's log has:
 * what is recorded here is how an instance is run, not the books of anybody.
 */
export const instanceChanges = pgTable(
  'instance_changes',
  {
    id: primaryId<'instance-change'>(),
    changeId: uuid('change_id').notNull(),
    tableName: text('table_name').notNull(),
    // Text: the settings row is numbered, everything else has a uuid.
    recordId: text('record_id').notNull(),
    operation: auditOperation('operation').notNull(),
    field: text('field').notNull(),
    oldValue: text('old_value'),
    newValue: text('new_value'),
    changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
    userId: text('user_id'),
    reason: text('reason'),
    databaseRole: text('database_role').notNull(),
  },
  (table) => [
    ...writtenByTriggerOutsideAnyTenant(),
    index('instance_changes_time_idx').on(table.changedAt),
  ],
)
