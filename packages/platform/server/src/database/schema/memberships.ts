import { sql } from 'drizzle-orm'
import { check, foreignKey, index, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core'

import { authUsers, signInMethod } from './authentication.js'
import { primaryId, timestamps } from './columns.js'
import { membershipVisibility, readableByTheOwner, tenantIsolation } from './rls.js'
import { tenantColumn } from './tenants.js'

/**
 * What somebody is in one tenant.
 *
 * This is the join between a user of the instance and a tenant, and it is
 * where the roles live. Not on the user, because the same person can hold one
 * role with one tenant and a lesser one with another; not on the session,
 * because a session outlives a change of rights and would go on claiming one
 * that was taken away an hour ago.
 *
 * It carries a tenant, so it is an ordinary table in every respect: the audit
 * trigger watches it, and that is how ADR 0006 gets its "audit log for a
 * change of rights" without a line of code written for the purpose. Granting
 * somebody a role shows up in the log of that tenant, field by field, with the
 * right the route declared as the reason.
 */
export const memberships = pgTable(
  'memberships',
  {
    id: primaryId<'membership'>(),
    ...tenantColumn,
    userId: text('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'restrict' }),
    /**
     * The roles, as an array of their keys rather than a table of its own. A
     * row per role would be the tidier shape on paper and a second place to
     * look with nothing extra in it.
     *
     * Plain strings here. Which keys there are is the application's list
     * (ADR 0010), and it reads them back through that list: a key the
     * database holds and the application no longer knows must come out as
     * "no such role" and not as a right.
     */
    roles: text('roles').array().notNull().$type<readonly string[]>(),
    /**
     * When this person was shut out of this tenant, null while they work in
     * it.
     *
     * Here and not on the account, because a tenant may shut somebody out of
     * itself and may not shut them out of the tenant next door on the same
     * instance. The same reason the roles are here.
     *
     * A timestamp rather than a flag: "since when" is the question somebody
     * asks three months later, and the audit log answers it only for as long
     * as nobody has blocked and unblocked twice.
     */
    blockedAt: timestamp('blocked_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    unique('memberships_one_per_user').on(table.tenantId, table.userId),
    ...membershipVisibility(table.tenantId, table.userId),
    // For a function that runs as the owner of the tables and counts the
    // people of every tenant for whoever runs the instance (#188). It hands
    // out nothing else.
    readableByTheOwner(),
  ],
)

/**
 * One stretch of somebody working in one tenant.
 *
 * The reason this exists rather than a column on the session: the audit log is
 * per tenant and its `tenant_id` cannot be null, so an event without a
 * tenant has nowhere to go. Signing in to the instance is such an event, and
 * choosing a tenant is the moment it stops being one. This row is written
 * then, the trigger puts it in that tenant's log, and closing it on sign out
 * is a change to the same row and lands there too.
 *
 * What that buys: a tenant can see who worked in it and when, and cannot see
 * where else those people work. Both halves of that are the point.
 */
export const tenantSessions = pgTable(
  'tenant_sessions',
  {
    id: primaryId<'tenant-session'>(),
    ...tenantColumn,
    userId: text('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'restrict' }),
    /**
     * The instance session. Not a foreign key with a cascade: a session row is
     * deleted when it expires or is revoked, and taking the record of the work
     * with it would empty the very log this table exists to fill.
     */
    sessionId: text('session_id').notNull(),
    deviceId: text('device_id'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    /** Set on signing out or on the device being revoked. */
    endedAt: timestamp('ended_at', { withTimezone: true }),
    /**
     * With what the session was signed in, taken from it when the tenant is
     * chosen (#167). This is where a sign in with a passkey shows in the log
     * of the tenant.
     */
    signInMethod: signInMethod('sign_in_method').notNull().default('password'),
    ...timestamps,
  },
  (table) => [tenantIsolation(table.tenantId)],
)

/**
 * The passkeys of somebody who works in this tenant, as the tenant sees
 * them (#167, #248).
 *
 * A passkey belongs to the account and lives in `auth_passkeys`, on the
 * instance, where no audit trigger can reach it. But it opens this tenant
 * as much as the password does, so the owner should see it come and go. This
 * table is how: a row per passkey and tenant the account works in, written
 * when the passkey is added, renamed along with it and marked when it is
 * deleted. The audit trigger watches it like every other table, which puts
 * all three into the log of every tenant the person works in, without a
 * line of the log written by hand. The same way `tenant_sessions` brings a
 * sign in into the log.
 *
 * Never deleted: a passkey that is gone keeps its row with `removed_at` set,
 * so that "which keys did this person ever have" has an answer. A tenant
 * the person joins later learns of a passkey from its next change on.
 */
export const memberPasskeys = pgTable(
  'member_passkeys',
  {
    id: primaryId<'member-passkey'>(),
    ...tenantColumn,
    userId: text('user_id').notNull(),
    /** The row in `auth_passkeys`. Not a foreign key: that row is deleted with the passkey, this one stays. */
    passkeyId: text('passkey_id').notNull(),
    name: text('name').notNull(),
    removedAt: timestamp('removed_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    foreignKey({
      columns: [table.tenantId, table.userId],
      foreignColumns: [memberships.tenantId, memberships.userId],
      name: 'member_passkeys_person_works_here',
    }).onDelete('cascade'),
    unique('member_passkeys_once').on(table.tenantId, table.passkeyId),
  ],
)

/**
 * A correction of somebody's name or address by whoever administers this
 * tenant.
 *
 * The name and the address belong to the account and live in `auth_users`, on
 * the instance, where no audit trigger can reach them. A correction made from
 * inside a tenant is the tenant's doing all the same, and its log should say
 * who changed what into what. This table is how: one row per correction,
 * written with it, and the audit trigger puts it into the log like a row of
 * any other table. The same way `member_passkeys` brings a passkey there.
 *
 * Each pair is set where that half was corrected and null where it stayed, so
 * that a row says what changed and nothing beside it. Written once and never
 * changed or removed: it is a record of something that happened.
 *
 * What somebody changes about their own account is not here. That is theirs
 * and no tenant's doing.
 */
export const accountCorrections = pgTable(
  'account_corrections',
  {
    id: primaryId<'account-correction'>(),
    ...tenantColumn,
    userId: text('user_id').notNull(),
    nameBefore: text('name_before'),
    nameAfter: text('name_after'),
    emailBefore: text('email_before'),
    emailAfter: text('email_after'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    tenantIsolation(table.tenantId),
    foreignKey({
      columns: [table.tenantId, table.userId],
      foreignColumns: [memberships.tenantId, memberships.userId],
      name: 'account_corrections_person_works_here',
    }).onDelete('cascade'),
    check(
      'account_corrections_name_in_a_pair',
      sql`(${table.nameBefore} is null) = (${table.nameAfter} is null)`,
    ),
    check(
      'account_corrections_email_in_a_pair',
      sql`(${table.emailBefore} is null) = (${table.emailAfter} is null)`,
    ),
    check(
      'account_corrections_names_a_change',
      sql`${table.nameAfter} is not null or ${table.emailAfter} is not null`,
    ),
  ],
)

/**
 * An offer of a way into this tenant, handed over as a link.
 *
 * A tenant bound table like any other, so the audit trigger watches it: who
 * was invited, by whom, when it was used. That is where the record of a new
 * way in comes from, without a line written for the purpose, exactly as the
 * change of rights comes from `memberships`.
 *
 * It carries the hash of the token and never the token. A backup of this table
 * is then a list of who was invited rather than a ring of keys, and the link
 * can be shown exactly once, at the moment it is made, which is what makes it
 * a one time link rather than a password with a longer name.
 *
 * Two policies. The ordinary isolation is what the office works through. The
 * second one is for the function that redeems a link: it runs as the owner of
 * the tables, the caller has no session and therefore no tenant, and without
 * a policy the owner can pass it would find no row on an instance full of
 * invitations. See `readableByTheOwner`, and `0012` for why the writing half
 * of the redemption does not need the same thing.
 */
export const invitations = pgTable(
  'invitations',
  {
    id: primaryId<'invitation'>(),
    ...tenantColumn,
    email: text('email').notNull(),
    name: text('name').notNull(),
    roles: text('roles').array().notNull().$type<readonly string[]>(),
    /** Hex SHA-256 of the token in the link. Unique, so a lookup is one index hit. */
    tokenHash: text('token_hash').notNull(),
    invitedBy: text('invited_by')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'restrict' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    /**
     * Set the moment it is used, which is the only moment it can be used. The
     * redemption updates this row with `redeemed_at is null` in its where
     * clause and counts what it changed, so two people opening the same link
     * at the same time leave one membership between them and not two.
     */
    redeemedAt: timestamp('redeemed_at', { withTimezone: true }),
    /**
     * Set when the office calls the offer back before anybody used it.
     *
     * A third state next to used and expired, and worth its own column rather
     * than a clever reuse of the expiry: an invitation that was withdrawn and
     * one that simply ran out are different things, and the log should be able
     * to say which happened. Withdrawing marks the row instead of removing it,
     * for the same reason a blocked person keeps their membership.
     */
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    unique('invitations_token').on(table.tokenHash),
    index('invitations_open_idx').on(table.tenantId, table.redeemedAt),
    tenantIsolation(table.tenantId),
    unique('invitations_tenant_id_key').on(table.tenantId, table.id),
    readableByTheOwner(),
  ],
)
