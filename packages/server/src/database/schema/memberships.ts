import type { RoleKey } from '@opengewerk/domain'
import { index, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core'

import { authUsers } from './authentication.js'
import { primaryId, timestamps } from './columns.js'
import { membershipVisibility, readableByTheOwner, tenantIsolation } from './rls.js'
import { tenantColumn } from './tenants.js'

/**
 * What somebody is in one business.
 *
 * This is the join between a user of the instance and a tenant, and it is
 * where the roles live. Not on the user, because the same person can be the
 * owner of one company and only the office of another; not on the session,
 * because a session outlives a change of rights and would go on claiming one
 * that was taken away an hour ago.
 *
 * It carries a tenant, so it is an ordinary table in every respect: the audit
 * trigger watches it, and that is how ADR 0006 gets its "audit log for a
 * change of rights" without a line of code written for the purpose. Granting
 * somebody the owner role shows up in that company's log, field by field, with
 * the right the route declared as the reason.
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
     * The roles, as an array rather than a table of its own. A row per role
     * would be the tidier shape on paper and a worse one here: the roles are a
     * fixed list in `domain` today (ADR 0006 keeps them out of the database
     * until a trade package registers rights of its own), so a join table would
     * be a second place to look with nothing extra in it.
     */
    roles: text('roles').array().notNull().$type<readonly RoleKey[]>(),
    /**
     * When this person was shut out of this business, null while they work in
     * it.
     *
     * Here and not on the account, because a business may shut somebody out of
     * itself and may not shut them out of the company next door on the same
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
  ],
)

/**
 * One stretch of somebody working in one business.
 *
 * The reason this exists rather than a column on the session: the audit log is
 * per tenant and its `tenant_id` cannot be null, so an event without a
 * business has nowhere to go. Signing in to the instance is such an event, and
 * choosing a business is the moment it stops being one. This row is written
 * then, the trigger puts it in that tenant's log, and closing it on sign out
 * is a change to the same row and lands there too.
 *
 * What that buys: a company can see who worked in it and when, and cannot see
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
    ...timestamps,
  },
  (table) => [tenantIsolation(table.tenantId)],
)

/**
 * An offer of a way into this business, handed over as a link.
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
 * the tables, the caller has no session and therefore no business, and without
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
    roles: text('roles').array().notNull().$type<readonly RoleKey[]>(),
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
