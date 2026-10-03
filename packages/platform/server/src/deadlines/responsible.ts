import type { DeadlineKind, DeadlineSetting, TenantId } from '@opengewerk/platform-domain'
import { and, asc, eq, isNull } from 'drizzle-orm'

import { leadsItsTenant } from '../authentication/roles.js'
import type { TenantTransaction } from '../database/database.js'
import { memberships } from '../database/schema/memberships.js'

/** What of a deadline decides who answers for it. */
export interface ResponsibleFacts {
  readonly responsibleUserId: string | null
  readonly naturalUserId: string | null
}

/**
 * Whether somebody still works for this tenant and may be given something to
 * do. A blocked member keeps the membership and would pass the key, but a
 * deadline with somebody who can no longer sign in waits with nobody.
 */
async function worksHere(
  tx: TenantTransaction,
  tenantId: TenantId,
  userId: string,
): Promise<boolean> {
  const [member] = await tx
    .select({ blockedAt: memberships.blockedAt })
    .from(memberships)
    .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId)))

  return member !== undefined && member.blockedAt === null
}

/**
 * Whoever leads the tenant, the one longest in it when there are several, and
 * not blocked.
 *
 * Asked of the flag in the row of a role and never of its name, the way the
 * administration counts the last one who leads: a tenant can come to have a
 * second role that leads, and a question asked of a name would miss it.
 */
export async function firstLead(tx: TenantTransaction, tenantId: TenantId): Promise<string | null> {
  const [lead] = await tx
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.tenantId, tenantId), isNull(memberships.blockedAt), leadsItsTenant()))
    .orderBy(asc(memberships.createdAt), asc(memberships.userId))
    .limit(1)

  return lead?.userId ?? null
}

/**
 * Who answers for a deadline, in the order of the settings: the person the
 * deadline has of its own, then the one the tenant named for the kind, then
 * the one the source names when the kind asks for that, and in the end
 * whoever leads. Somebody blocked in the meantime is passed over, so a
 * deadline never waits with a person who cannot sign in.
 *
 * Null only in a tenant without anybody who leads and can sign in, which the
 * administration does not let happen.
 */
export async function responsibleFor(
  tx: TenantTransaction,
  tenantId: TenantId,
  kind: DeadlineKind,
  setting: DeadlineSetting | null,
  deadline: ResponsibleFacts,
): Promise<string | null> {
  const candidates = [
    deadline.responsibleUserId,
    setting?.responsibleUserId ?? null,
    kind.responsible === 'source' ? deadline.naturalUserId : null,
  ]

  for (const candidate of candidates) {
    if (candidate !== null && (await worksHere(tx, tenantId, candidate))) {
      return candidate
    }
  }

  return firstLead(tx, tenantId)
}
