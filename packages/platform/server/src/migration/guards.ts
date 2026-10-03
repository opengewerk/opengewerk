import { applicationRoleName } from '../database/roles.js'

// What a table needs and drizzle-kit does not write: FORCE, the rights of the
// application role, and the two triggers. A migration that creates a table
// has to say all of it, and says it by hand in the trades application. Here
// it is one description per table and the statements that follow from it, so
// that the tables of the foundation are guarded the same way in every
// application, and a table an application adds is one line and not five.
//
// A description forgotten is not a hole: the catalogue tests of the kit ask
// the database, not this list.

/** What the application role may be granted on a table. */
export const tablePrivileges = ['select', 'insert', 'update', 'delete'] as const

export type TablePrivilege = (typeof tablePrivileges)[number]

/** What a table needs beyond its columns and its policies. */
export interface TableGuard {
  readonly table: string
  /**
   * What the application role may do with the whole table. Never more than
   * the table needs: a row nobody may delete is a table without `delete`,
   * and a log is a table with `select` alone.
   */
  readonly grants: readonly TablePrivilege[]
  /**
   * Columns the application role may change on a table it may not update as
   * a whole.
   */
  readonly updatableColumns?: readonly string[]
  /**
   * Whether the audit trigger watches it. A table without a tenant cannot be
   * watched: an entry needs one, and the trigger would fail rather than
   * invent it.
   */
  readonly audited: boolean
  /**
   * Whether its rows travel to devices. Such a table carries the sync columns,
   * and this is the trigger that keeps them true.
   */
  readonly synced: boolean
}

const plainName = /^[a-z_][a-z0-9_]*$/

/**
 * A name as it goes into a statement, quoted.
 *
 * The names come from the code of an application and never from a request.
 * They are held to plain names all the same, as the migration history is: a
 * statement is built from them here rather than handed a parameter.
 */
function quoted(name: string): string {
  if (!plainName.test(name)) {
    throw new Error(`Not a name for a table or a column: ${JSON.stringify(name)}`)
  }

  return `"${name}"`
}

const role = quoted(applicationRoleName)

/**
 * FORCE and the grants: what has to stand before a single row is written.
 *
 * FORCE first. Without it the owner of the table walks past every policy, and
 * an application pointed at the owner by mistake would have a protection that
 * looks like one and is none.
 */
export function protectionStatements(guard: TableGuard): string[] {
  const table = quoted(guard.table)
  const statements = [`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;`]

  if (guard.grants.length > 0) {
    // In the order of the list above, whatever order the description gave.
    const granted = tablePrivileges
      .filter((privilege) => guard.grants.includes(privilege))
      .map((privilege) => privilege.toUpperCase())

    statements.push(`GRANT ${granted.join(', ')} ON ${table} TO ${role};`)
  }

  if (guard.updatableColumns && guard.updatableColumns.length > 0) {
    if (guard.grants.includes('update')) {
      throw new Error(
        `The table ${guard.table} is updatable as a whole, so naming columns says nothing`,
      )
    }

    const columns = guard.updatableColumns.map(quoted).join(', ')

    statements.push(`GRANT UPDATE (${columns}) ON ${table} TO ${role};`)
  }

  return statements
}

/**
 * The triggers. They call functions of the blocks `audit.sql` and `sync.sql`,
 * so in the migration that creates those they come after them.
 */
export function triggerStatements(guard: TableGuard): string[] {
  const table = quoted(guard.table)
  const statements: string[] = []

  if (guard.audited) {
    statements.push(
      `CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON ${table}\n` +
        '\tFOR EACH ROW EXECUTE FUNCTION "record_change"();',
    )
  }

  if (guard.synced) {
    statements.push(
      `CREATE TRIGGER "stamp_sync_columns" BEFORE INSERT OR UPDATE ON ${table}\n` +
        '\tFOR EACH ROW EXECUTE FUNCTION "stamp_sync_columns"();',
    )
  }

  return statements
}

/**
 * Everything a table needs, for a migration that adds one to a database where
 * the functions have long been there.
 */
export function guardStatements(guard: TableGuard): string[] {
  return [...protectionStatements(guard), ...triggerStatements(guard)]
}

const everything: readonly TablePrivilege[] = tablePrivileges
/** A record that is marked and never removed, like most of what a tenant keeps. */
const noDelete: readonly TablePrivilege[] = ['select', 'insert', 'update']

/**
 * The tables of the foundation, each with what it needs.
 *
 * The rights are the ones the trades application arrived at over sixty
 * migrations, and each has its reason:
 *
 * - `tenants`: read, and the name alone changed. Creating one belongs to the
 *   first run and to whoever runs the instance, never to a request.
 * - The accounts: better-auth writes them, and removes a session, a pending
 *   verification or a passkey when it ends. An account itself is never
 *   deleted: its name would come off everything the person ever wrote.
 * - Memberships, the stretches of work, the passkeys as a tenant sees them
 *   and the invitations: never deleted. Who was let in, by whom and what
 *   became of it is part of the record; a person is blocked, an invitation
 *   called back, and both are changes the log keeps.
 * - The roles of a tenant: read, and written when a tenant comes into being.
 *   Nothing changes or removes one yet, so nothing may; the day a tenant
 *   keeps roles of its own, that route brings the right to change with it.
 * - The files of a tenant: read and inserted. The bytes behind a row never
 *   change, so neither does the row, and a file a record points at outlives
 *   every mistake; ending one at the end of a retention period is a
 *   procedure of its own.
 * - The mail server of a tenant: all four. It is set up, changed and removed
 *   again, and the log sees each of them; the password is not in it.
 * - What a tenant sets for a kind of deadline: written and changed, never
 *   removed; a setting put back to the kind's own values is a row of nulls,
 *   and the log keeps what it was before.
 * - When the deadline engine last went through a tenant: written and changed
 *   after every pass, never removed, and kept out of the log, which it would
 *   fill once a minute.
 * - The audit tables and the counter of the sync layer: read only. Their one
 *   writer is a trigger that runs as its definer.
 * - The receipts of the sync layer are written once; a conflict is written
 *   and later marked resolved.
 * - What belongs to the instance: an operator is named and taken away again,
 *   and never changed. The one row of settings is changed and neither added
 *   to nor removed. The log of the instance is read; its one writer is a
 *   trigger that runs as its definer. None of the three has a tenant, so the
 *   audit trigger of a tenant stays off them, and the block `instance.sql`
 *   brings the trigger that watches them instead.
 *
 * None of them travels to a device, so none carries the sync columns.
 *
 * These are the tables that are the same in every application. The ones an
 * application makes with a list of its own are described one by one further
 * down, and an application names the ones it has.
 */
export const foundationGuards: readonly TableGuard[] = [
  {
    table: 'tenants',
    grants: ['select'],
    updatableColumns: ['name', 'updated_at'],
    audited: true,
    synced: false,
  },
  { table: 'auth_users', grants: noDelete, audited: false, synced: false },
  { table: 'auth_sessions', grants: everything, audited: false, synced: false },
  { table: 'auth_accounts', grants: everything, audited: false, synced: false },
  { table: 'auth_verifications', grants: everything, audited: false, synced: false },
  { table: 'auth_two_factors', grants: everything, audited: false, synced: false },
  { table: 'auth_passkeys', grants: everything, audited: false, synced: false },
  { table: 'auth_rate_limits', grants: everything, audited: false, synced: false },
  { table: 'memberships', grants: noDelete, audited: true, synced: false },
  { table: 'tenant_sessions', grants: noDelete, audited: true, synced: false },
  { table: 'member_passkeys', grants: noDelete, audited: true, synced: false },
  { table: 'invitations', grants: noDelete, audited: true, synced: false },
  { table: 'tenant_roles', grants: ['select', 'insert'], audited: true, synced: false },
  { table: 'files', grants: ['select', 'insert'], audited: true, synced: false },
  { table: 'mail_settings', grants: everything, audited: true, synced: false },
  { table: 'deadline_settings', grants: noDelete, audited: true, synced: false },
  { table: 'deadline_runs', grants: noDelete, audited: false, synced: false },
  { table: 'audit_chains', grants: ['select'], audited: false, synced: false },
  { table: 'audit_entries', grants: ['select'], audited: false, synced: false },
  { table: 'sync_sequences', grants: ['select'], audited: false, synced: false },
  { table: 'sync_operations', grants: ['select', 'insert'], audited: false, synced: false },
  { table: 'sync_conflicts', grants: noDelete, audited: false, synced: false },
  {
    table: 'instance_operators',
    grants: ['select', 'insert', 'delete'],
    audited: false,
    synced: false,
  },
  { table: 'instance_settings', grants: ['select', 'update'], audited: false, synced: false },
  { table: 'instance_changes', grants: ['select'], audited: false, synced: false },
]

/**
 * The tables of the foundation an application made with a list of its own:
 * the sealed credentials with its purposes, its settings, its sequences of
 * numbers, the outbox of its mail, its push, and what else is a function in the schema
 * of the foundation rather than a table. They are the foundation's in every
 * column and every rule, and only the application can say which values their
 * enums hold. The outbox is the one an application may add columns to, for
 * the records its messages are about; it names them to the comparison as its
 * own, and describes the outbox here without them.
 *
 * An application describes them once, next to its schema. Its first migration
 * is completed with the guards (`completeInitialMigration`), and the kit of
 * its tests builds and compares the foundation with both.
 */
export interface MadeByTheApplication {
  /** The tables and enums, as the schema of the application exports them. */
  readonly schema: Readonly<Record<string, unknown>>
  /** What each of those tables needs, from the descriptions below. */
  readonly guards: readonly TableGuard[]
}

/**
 * The sealed credentials (`secretsSchema`). Kept, replaced and forgotten by
 * the store, and the one table of a tenant the audit log does not watch: the
 * log is written once and never touched again, and a sealed value in it would
 * be there for good.
 */
export const secretsGuard: TableGuard = {
  table: 'secrets',
  grants: everything,
  audited: false,
  synced: false,
}

/**
 * The settings of a tenant with the day they apply from
 * (`tenantParametersSchema`). Never deleted: a period that has ended is what
 * says how something written during it is to be read.
 */
export const tenantParametersGuard: TableGuard = {
  table: 'tenant_parameters',
  grants: noDelete,
  audited: true,
  synced: false,
}

/**
 * The counters of the numbers that run without holes (`numberRangesSchema`).
 * Never deleted: a sequence that is gone begins again at one, and hands out a
 * second time what a record already carries. Watched by the log, which is
 * where the pattern a number was once built from can still be read.
 */
export const numberRangesGuard: TableGuard = {
  table: 'number_ranges',
  grants: noDelete,
  audited: true,
  synced: false,
}

/**
 * The outbox of the mail (`mailOutboxSchema`). Written by whatever caused a
 * message and changed by the job that sends it, never deleted: a message that
 * went out is the record of what a tenant told somebody, and one that did not
 * stays with the reason. Watched by the log, like every record of a tenant.
 */
export const mailOutboxGuard: TableGuard = {
  table: 'mail_outbox',
  grants: noDelete,
  audited: true,
  synced: false,
}

/**
 * The deadlines of an application (`deadlinesSchema`). Written by the engine,
 * which follows the sources, and changed by a person in what a person decides;
 * never removed, because a deadline that dropped out comes back when its
 * source asks again. Watched by the log, like every record of a tenant.
 */
export const deadlinesGuard: TableGuard = {
  table: 'deadlines',
  grants: noDelete,
  audited: true,
  synced: false,
}

/**
 * The devices that take push messages (`pushSchema`). Written by a device
 * that subscribes, removed by the person or when the browser or the session
 * is gone. Watched by the log, like every record of a tenant.
 */
export const pushSubscriptionsGuard: TableGuard = {
  table: 'push_subscriptions',
  grants: everything,
  audited: true,
  synced: false,
}

/**
 * The occasions a person switched off (`pushSchema`). A row while it is off,
 * none once it is on again, so a row is written and removed and never changed.
 */
export const pushOptOutsGuard: TableGuard = {
  table: 'push_opt_outs',
  grants: ['select', 'insert', 'delete'],
  audited: true,
  synced: false,
}

/**
 * The outbox of push (`pushSchema`). A message goes with its device: a
 * subscription the browser dropped takes its messages with it.
 */
export const pushOutboxGuard: TableGuard = {
  table: 'push_outbox',
  grants: everything,
  audited: true,
  synced: false,
}
