import { and, eq, max } from 'drizzle-orm'

import type { Database } from '../database/database.js'
import { passwordResets } from '../schema.js'
import { tenantsOf } from './passkeys.js'

/**
 * A new password, as the tenants of the account learn of it, and the day an
 * account waits after one (opengewerk-haustechnik#360).
 *
 * The link to a new password goes out through the mail server of the
 * instance, and whoever sets that server up could read it there and choose
 * the password themselves. Setting it up takes a confirmation and is told to
 * every tenant (`mail-server-notice.ts`); what is left is that a reset does not
 * pass unseen. So every one goes into the log of every tenant the account
 * works in, through `password_resets`, whether it came through the link or
 * from the command line of the server.
 *
 * And a reset does not hand out a second factor at once. Whoever chose the
 * password could otherwise set up the app or a passkey of their own straight
 * away, and pass every role that asks for one; a day is the time the person
 * the account belongs to, signed out on every device, and whoever leads one
 * of its tenants, with the reset in the log, have to notice. A second factor
 * the account already has stays and goes on working; only another one waits,
 * and an account that had the app needs it for the sign in anyway.
 */

/** How long after a reset an account sets up no second factor and no passkey, in seconds. */
export const secondFactorWaitAfterReset = 24 * 60 * 60

/** Why a second factor or a passkey is refused so soon after a reset. */
export const waitingAfterReset =
  'Nach dem Zurücksetzen des Passworts lässt sich ein zweiter Faktor oder ein Passkey erst nach ' +
  'einem Tag einrichten. So bleibt Zeit zu bemerken, wenn jemand anderes das Passwort ' +
  'zurückgesetzt hat.'

/**
 * Writes the reset into every tenant the account works in, blocked or not, as
 * the account: one transaction per tenant, as for a passkey. A tenant that
 * fails stops the rest and throws, and the caller says so.
 */
export async function recordPasswordReset(database: Database, userId: string): Promise<void> {
  for (const tenantId of await tenantsOf(database, userId)) {
    await database.forTenant({ tenantId, userId, reason: 'password.reset' }, (tx) =>
      tx.insert(passwordResets).values({ tenantId, userId }),
    )
  }
}

/** The newest reset of the account in any of its tenants, or null where there was none. */
export async function lastPasswordReset(database: Database, userId: string): Promise<Date | null> {
  let newest: Date | null = null

  for (const tenantId of await tenantsOf(database, userId)) {
    const [row] = await database.forTenant({ tenantId, userId }, (tx) =>
      tx
        .select({ at: max(passwordResets.resetAt) })
        .from(passwordResets)
        .where(and(eq(passwordResets.tenantId, tenantId), eq(passwordResets.userId, userId))),
    )

    if (row?.at && (newest === null || row.at > newest)) {
      newest = row.at
    }
  }

  return newest
}

/** Whether the account still waits after a reset before it sets up a second factor. */
export async function waitsAfterReset(
  database: Database,
  userId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const reset = await lastPasswordReset(database, userId)

  return reset !== null && now.getTime() - reset.getTime() < secondFactorWaitAfterReset * 1000
}
