import type { TenantId } from '@opengewerk/platform-domain'
import { and, eq, inArray, isNull, ne } from 'drizzle-orm'

import type { Database } from '../database/database.js'
import { authSessions, tenantSessions } from '../schema.js'

/**
 * Ends every session of an account apart from the one named, as a new
 * password does, and closes what each of them had open in a tenant, as
 * cutting off one device does.
 *
 * For the moments the account gives up a factor: a passkey deleted, the
 * recovery codes renewed. A session is given its second factor when it is
 * written and does not say which passkey or which code gave it, so one
 * opened with the factor that is gone would otherwise keep that second
 * factor for as long as it is used, and every role that asks for one with
 * it.
 *
 * The rows go first, so that the sessions stop whatever happens next; the
 * stretches of work are closed after, tenant by tenant.
 */
export async function endOtherSessions(
  database: Database,
  userId: string,
  keep: string,
  reason: string,
): Promise<void> {
  const ended = await database.forInstance(
    (tx) =>
      tx
        .delete(authSessions)
        .where(and(eq(authSessions.userId, userId), ne(authSessions.id, keep)))
        .returning({ id: authSessions.id, tenantId: authSessions.activeTenantId }),
    userId,
  )

  const byTenant = new Map<TenantId, string[]>()

  for (const { id, tenantId } of ended) {
    if (tenantId) {
      byTenant.set(tenantId, [...(byTenant.get(tenantId) ?? []), id])
    }
  }

  for (const [tenantId, sessionIds] of byTenant) {
    await database.forTenant({ tenantId, userId, reason }, (tx) =>
      tx
        .update(tenantSessions)
        .set({ endedAt: new Date() })
        .where(
          and(
            eq(tenantSessions.tenantId, tenantId),
            eq(tenantSessions.userId, userId),
            inArray(tenantSessions.sessionId, sessionIds),
            isNull(tenantSessions.endedAt),
          ),
        ),
    )
  }
}
