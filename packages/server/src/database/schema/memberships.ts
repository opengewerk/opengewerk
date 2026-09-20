import type { RoleKey } from '@opengewerk/domain'
import { pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core'

import { authUsers } from './authentication.js'
import { primaryId, timestamps } from './columns.js'
import { membershipVisibility, tenantIsolation } from './rls.js'
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
