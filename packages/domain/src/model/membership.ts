import type { RoleKey } from './authorization.js'
import type { MembershipId, TenantId, TenantSessionId } from './identifier.js'

/**
 * What a person is in one business. A user belongs to the instance, a
 * membership belongs to a tenant, and the roles hang on the membership rather
 * than on the user: the same owner can run two companies and be the
 * bookkeeper in one of them.
 *
 * This is the row `Identity.roles` is filled from, once per request. It is not
 * read from the session, because a session outlives a change of rights and
 * would then say something that stopped being true.
 */
export interface Membership {
  readonly id: MembershipId
  readonly tenantId: TenantId
  /** The user of the instance. Not a branded id: it is better-auth's key. */
  readonly userId: string
  readonly roles: readonly RoleKey[]
  readonly createdAt: Date
  readonly updatedAt: Date
}

/**
 * One stretch of somebody working in one business.
 *
 * A session belongs to the instance and knows nothing of tenants; this row is
 * the part of it a single business may see, and it exists because the audit
 * log is per tenant. Every entry in it carries a `tenant_id` that cannot be
 * null, so an event without a tenant has nowhere to go, and a sign in before
 * a business is chosen is exactly that. The moment a business is chosen there
 * is a tenant, this row is written, and the trigger that watches every table
 * puts it in that tenant's log. Signing out closes the row, which is a change
 * to it and lands in the log the same way.
 *
 * So the log answers "who worked in my company and when" and cannot answer
 * "where else does this person work", which is the right pair of answers.
 */
export interface TenantSession {
  readonly id: TenantSessionId
  readonly tenantId: TenantId
  readonly userId: string
  /** The instance session this stretch belongs to. */
  readonly sessionId: string
  /**
   * The device, when the sign in came from a registered one. The same value
   * the sync layer stamps on a record, so a change made on the roof and the
   * session it was made in can be put side by side.
   */
  readonly deviceId: string | null
  readonly startedAt: Date
  /** Set when the session ends, by signing out or by being revoked. */
  readonly endedAt: Date | null
  readonly createdAt: Date
  readonly updatedAt: Date
}

/**
 * The roles that may not work without a second factor.
 *
 * ADR 0006 puts it on the role and not on a setting, and that is the point: a
 * switch somebody can turn off is not a requirement. Bookkeeping is named
 * there too and is missing here because the role itself does not exist yet; it
 * joins this list on the day it does, not later.
 */
export const secondFactorRoles: readonly RoleKey[] = ['owner']

/** Whether this set of roles may only work with a second factor in place. */
export function requiresSecondFactor(roles: readonly RoleKey[]): boolean {
  return roles.some((role) => secondFactorRoles.includes(role))
}
