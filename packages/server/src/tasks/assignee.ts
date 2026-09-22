import type { ConflictReason, TenantId } from '@opengewerk/domain'
import { and, eq } from 'drizzle-orm'

import type { TenantTransaction } from '../database/database.js'
import { memberships } from '../database/schema/index.js'

/** Why a task may not land with the person it names, in the shape of a sync conflict. */
export interface AssigneeRefusal {
  readonly reason: ConflictReason
  readonly fields: readonly string[]
}

/**
 * Whether a task coming from a device may be handed to the person it names.
 *
 * It may go to somebody who works in this business and is not shut out of it.
 * The key in the database refuses a stranger as well, but it does so inside
 * the transaction and takes the whole transmission with it; refused here, it
 * is a conflict about this one operation and the rest of the queue lands. A
 * person who has been blocked still has a membership and would pass the key,
 * and a task handed to somebody who can no longer sign in is a task nobody
 * does.
 *
 * Asked when a task is created, where the person is required, and whenever an
 * operation hands it to somebody else.
 */
export async function assigneeRefusal(
  tx: TenantTransaction,
  tenantId: TenantId,
  creating: boolean,
  values: Readonly<Record<string, unknown>>,
): Promise<AssigneeRefusal | null> {
  if (!creating && !('assigneeUserId' in values)) {
    return null
  }

  const userId = values['assigneeUserId']

  if (typeof userId !== 'string' || userId.length === 0) {
    return { reason: 'record_missing', fields: ['assigneeUserId'] }
  }

  const [member] = await tx
    .select({ blockedAt: memberships.blockedAt })
    .from(memberships)
    .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId)))

  return member && member.blockedAt === null
    ? null
    : { reason: 'record_missing', fields: ['assigneeUserId'] }
}
