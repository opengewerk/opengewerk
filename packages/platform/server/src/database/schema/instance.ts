import { sql } from 'drizzle-orm'
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  time,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'

import { auditOperation } from './audit.js'
import { authUsers } from './authentication.js'
import { primaryId, timestamps } from './columns.js'
import { mailSecurity } from './mail-settings.js'
import { outsideAnyTenant, readableByTheOwner, writtenByTriggerOutsideAnyTenant } from './rls.js'

/**
 * What belongs to the instance and to no tenant (#188): who runs it, what
 * holds for every tenant on it, and the log of both.
 *
 * All three are read and written outside any tenant, like the accounts, and
 * for the same reason: an instance can carry several tenants, and none of
 * them decides for the others. None has a `tenant_id`, so the audit trigger of
 * a tenant stays off them; they have a log of their own, `instance_changes`,
 * written by a trigger of its own (the block `instance.sql`).
 */

/**
 * The accounts that run the instance. The account of the first run setup is
 * the first; further ones are named in the area of the instance or on the
 * command line.
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
  // The second one is for a function that runs as the owner of the tables and
  // lists, for whoever runs the instance, only the invitations one of them
  // sent (`tenants_with_leads`, opengewerk-haustechnik#474).
  () => [outsideAnyTenant(), readableByTheOwner()],
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
     * Mail servers in the instance's own network a tenant may send through,
     * by name or address. Anything else in that network is refused, so that no
     * tenant reaches past the instance into the network behind it.
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
    /**
     * The mail server of the instance (opengewerk-haustechnik#81). What goes
     * to an account, the link to a new password and the notice of a new
     * passkey, goes out through it and through the mail server of no tenant:
     * an account belongs to the instance. All of it null while there is none.
     */
    mailServerHost: text('mail_server_host'),
    mailServerPort: integer('mail_server_port'),
    mailServerSecurity: mailSecurity('mail_server_security'),
    mailServerUsername: text('mail_server_username'),
    /** The address the instance writes from. */
    mailServerFrom: text('mail_server_from'),
    /**
     * The password, sealed with the key of the instance. The log of the
     * instance never holds it: its trigger leaves the column out (the block
     * `instance.sql`), and what it records is the moment below.
     */
    mailServerPassword: text('mail_server_password'),
    mailServerPasswordSetAt: timestamp('mail_server_password_set_at', { withTimezone: true }),
    /**
     * The legal texts of the instance (opengewerk-haustechnik#129), as typed
     * on their screen: a short part of Markdown that is read into elements
     * and never into HTML. Null while none is kept, and then no link leads to
     * it. Who changed one and when is in the log of the instance.
     */
    imprint: text('imprint'),
    privacyNotice: text('privacy_notice'),
    /**
     * Part B of the technical and organisational measures and the
     * subprocessors (opengewerk-haustechnik#358), kept by whoever runs the
     * instance and read into the measures of every tenant on it: the values
     * of part B by the key of their field, and the rows of annex 2. Who
     * changed them and when is in the log of the instance.
     */
    measures: jsonb('measures')
      .notNull()
      .default(sql`'{}'::jsonb`),
    subprocessors: jsonb('subprocessors')
      .notNull()
      .default(sql`'[]'::jsonb`),
    ...timestamps,
  },
  (table) => [
    outsideAnyTenant(),
    check('instance_settings_one_row', sql`${table.id} = 1`),
    // A mail server is there whole or not at all: the server with its port,
    // the kind of connection and the address it writes from, or none of it.
    check(
      'instance_settings_mail_server_whole',
      sql`(${table.mailServerHost} is null) = (${table.mailServerPort} is null)
        and (${table.mailServerHost} is null) = (${table.mailServerSecurity} is null)
        and (${table.mailServerHost} is null) = (${table.mailServerFrom} is null)
        and (${table.mailServerHost} is not null or (${table.mailServerUsername} is null and ${table.mailServerPassword} is null))`,
    ),
    // A password goes with a login, and the moment it was set with the password.
    check(
      'instance_settings_mail_server_login',
      sql`(${table.mailServerPassword} is null or ${table.mailServerUsername} is not null)
        and (${table.mailServerPassword} is null) = (${table.mailServerPasswordSetAt} is null)`,
    ),
    check('instance_settings_measures_object', sql`jsonb_typeof(${table.measures}) = 'object'`),
    check(
      'instance_settings_subprocessors_list',
      sql`jsonb_typeof(${table.subprocessors}) = 'array'`,
    ),
    check(
      'instance_settings_mail_server_port',
      sql`${table.mailServerPort} is null or ${table.mailServerPort} between 1 and 65535`,
    ),
  ],
)

/**
 * The log of the instance: one row per field that changed on the operators,
 * the settings and the tenants themselves, written by a trigger as the log of
 * a tenant is. Append only, and without the chain a tenant's log has: what is
 * recorded here is how an instance is run, not the books of anybody.
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
