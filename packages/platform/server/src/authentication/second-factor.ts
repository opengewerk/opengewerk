import { and, eq, isNull, sql } from 'drizzle-orm'

import type { Database } from '../database/database.js'
import {
  authPasskeys,
  authSessions,
  authTwoFactors,
  authUsers,
  memberPasskeys,
  secondFactorChanges,
} from '../schema.js'
import type { SecondFactorChange } from './notices.js'
import { endOtherSessions } from './other-sessions.js'
import { tenantsOf } from './passkeys.js'

/**
 * A second factor guards the second factor (N6 of the security audit).
 *
 * An account with a passkey and no app signs in with the password alone as
 * well, and such a session carries no second factor. From there it could set
 * up the app, confirm with the password alone, add a passkey after that
 * confirmation and delete the passkeys the account has: each a way for
 * whoever has the password to a session that leading roles and the area of
 * the instance accept, past the passkey that was the second factor. So on an
 * account that has a second factor, of either kind, setting one up, deleting a
 * passkey and confirming with the password ask a session that carries it.
 * Decided by Moritz on 29.10.2026.
 *
 * Whoever has lost the only one gets every second factor of the account taken
 * away, by whoever leads the tenant they work in (`resetSecondFactorOf`) or on
 * the command line of the server, and sets up a new one afterwards, as an
 * account that never had one does.
 */

/** The answer to a session without the second factor its account has. */
export const secondFactorSessionRequired =
  'Dieses Konto hat einen zweiten Faktor, und diese Anmeldung kam ohne ihn. Bitte abmelden ' +
  'und wieder anmelden, mit dem Code aus der App oder mit einem Passkey.'

/**
 * Whether the account has a second factor of either kind, the app or a
 * passkey. The key of the account is named with its table: drizzle leaves the
 * table off a column when a query reads one table only, and inside the
 * subquery a bare `id` would be the passkey's own.
 */
const setUp = sql<boolean>`(${authUsers.twoFactorEnabled} is true or exists (
  select 1 from auth_passkeys where auth_passkeys.user_id = auth_users.id))`

/** The reason each change is written into the log with, and which says what it was. */
const reasons: Readonly<Record<SecondFactorChange, string>> = {
  app: 'second-factor.app',
  reset: 'second-factor.reset',
}

/**
 * Whether the session lacks the second factor its account has. A session that
 * is not the account's, or is gone, lacks it as well.
 */
export async function lacksSecondFactor(
  database: Database,
  userId: string,
  sessionId: string,
): Promise<boolean> {
  const [row] = await database.forInstance(
    (tx) =>
      tx
        .select({ carries: authSessions.secondFactor, setUp })
        .from(authSessions)
        .innerJoin(authUsers, eq(authUsers.id, authSessions.userId))
        .where(and(eq(authSessions.id, sessionId), eq(authSessions.userId, userId)))
        .limit(1),
    userId,
  )

  return !row || (row.setUp && !row.carries)
}

/** Whether the account has a second factor of either kind. */
export async function hasSecondFactorSetUp(database: Database, userId: string): Promise<boolean> {
  const [row] = await database.forInstance(
    (tx) => tx.select({ setUp }).from(authUsers).where(eq(authUsers.id, userId)).limit(1),
    userId,
  )

  return row?.setUp === true
}

/**
 * Writes a change of the second factor into every tenant the account works
 * in, blocked or not: one transaction per tenant, as for a new password.
 * `actor` is whoever made it, the account itself where left out. A tenant
 * that fails stops the rest and throws.
 */
export async function recordSecondFactorChange(
  database: Database,
  userId: string,
  change: SecondFactorChange,
  actor: string = userId,
): Promise<void> {
  for (const tenantId of await tenantsOf(database, userId)) {
    await database.forTenant({ tenantId, userId: actor, reason: reasons[change] }, (tx) =>
      tx.insert(secondFactorChanges).values({ tenantId, userId }),
    )
  }
}

/**
 * Takes every second factor of an account away: the app with its recovery
 * codes, and every passkey, which every tenant then holds as removed. The
 * account is signed out on every device. The password stays; the account
 * signs in with it and sets up a new second factor where a role asks for one.
 *
 * The record comes first, in every tenant the account works in, and the
 * change after it: a reset the log does not show is what the log is there to
 * prevent, and one it shows that then failed is simply asked for again.
 *
 * Says whether there was anything to take away. `actor` as above.
 */
export async function removeSecondFactor(
  database: Database,
  userId: string,
  actor: string = userId,
): Promise<boolean> {
  if (!(await hasSecondFactorSetUp(database, userId))) {
    return false
  }

  await recordSecondFactorChange(database, userId, 'reset', actor)

  await database.forInstance(async (tx) => {
    await tx.delete(authTwoFactors).where(eq(authTwoFactors.userId, userId))
    await tx.delete(authPasskeys).where(eq(authPasskeys.userId, userId))
    await tx
      .update(authUsers)
      .set({ twoFactorEnabled: false, updatedAt: new Date() })
      .where(eq(authUsers.id, userId))
  }, actor)

  // No session is kept: every device that was signed in may be the lost one.
  await endOtherSessions(database, userId, '', reasons.reset)

  for (const tenantId of await tenantsOf(database, userId)) {
    await database.forTenant({ tenantId, userId: actor, reason: reasons.reset }, (tx) =>
      tx
        .update(memberPasskeys)
        .set({ removedAt: sql`now()`, updatedAt: sql`now()` })
        .where(
          and(
            eq(memberPasskeys.tenantId, tenantId),
            eq(memberPasskeys.userId, userId),
            isNull(memberPasskeys.removedAt),
          ),
        ),
    )
  }

  return true
}
