import type { DeadlineKind, DeadlineSetting, TenantId } from '@opengewerk/domain'
import type { TenantTransaction } from '@opengewerk/platform-server'
import { and, asc, eq, isNull, sql } from 'drizzle-orm'

import { memberships } from '../database/schema/index.js'

/** What of a deadline decides who answers for it. */
export interface ResponsibleFacts {
  readonly responsibleUserId: string | null
  readonly naturalUserId: string | null
}

/**
 * Whether somebody still works in this business and may be given something
 * to do. A blocked member keeps the membership and would pass the key, but a
 * task for somebody who can no longer sign in is a task nobody does.
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

/** The owner who has been in the business longest and is not blocked. */
export async function firstOwner(
  tx: TenantTransaction,
  tenantId: TenantId,
): Promise<string | null> {
  const [owner] = await tx
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(
      and(
        eq(memberships.tenantId, tenantId),
        isNull(memberships.blockedAt),
        sql`'owner' = any(${memberships.roles})`,
      ),
    )
    .orderBy(asc(memberships.createdAt), asc(memberships.userId))
    .limit(1)

  return owner?.userId ?? null
}

/**
 * Who answers for a deadline, in the order of the settings screen: the person
 * the deadline has of its own, then the one the business named for the kind,
 * then the one the source names when the kind asks for that, and in the end
 * the owner. Somebody blocked in the meantime is passed over, so a deadline
 * never waits with a person who cannot sign in.
 *
 * Null only in a business without an owner who can sign in, which the
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

  return firstOwner(tx, tenantId)
}
