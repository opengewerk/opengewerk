import { hasSecondFactor, type InstanceAccess } from '@opengewerk/platform-domain'
import { and, eq } from 'drizzle-orm'

import type { Database } from '../database/database.js'
import { authSessions, authUsers, instanceOperators } from '../schema.js'

/**
 * Whether somebody runs the instance, and whether this session carries the
 * second factor its area needs: the app set up, or a sign in with a passkey
 * confirmed on the device (#167), as for a role that leads a tenant.
 *
 * Read fresh on every request, like the roles of a membership, so that taking
 * it away takes effect at once. A file of its own because the guard asks it,
 * and the guard should stand on as little as possible.
 */
export async function operatorAccess(
  database: Database,
  userId: string,
  sessionId: string,
): Promise<InstanceAccess> {
  const [row] = await database.forInstance(
    (tx) =>
      tx
        .select({
          operator: instanceOperators.id,
          twoFactorEnabled: authUsers.twoFactorEnabled,
          signInMethod: authSessions.signInMethod,
        })
        .from(authUsers)
        .leftJoin(instanceOperators, eq(instanceOperators.userId, authUsers.id))
        .leftJoin(
          authSessions,
          and(eq(authSessions.id, sessionId), eq(authSessions.userId, authUsers.id)),
        )
        .where(eq(authUsers.id, userId)),
    userId,
  )

  return {
    operator: Boolean(row?.operator),
    secondFactor: hasSecondFactor({
      twoFactorEnabled: row?.twoFactorEnabled,
      signInMethod: row?.signInMethod,
    }),
  }
}
