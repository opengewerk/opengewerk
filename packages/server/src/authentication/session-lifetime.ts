import { eq } from 'drizzle-orm'

import type { Database } from '../database/database.js'
import { authSessions } from '../database/schema/index.js'

/**
 * How long a session lives.
 *
 * Two lengths, because ADR 0006 describes two places of work. In the office a
 * screen is left unlocked and a short session is the cheap protection; on a
 * roof or in a basement a sign in that expires means a technician stands in
 * front of a login form with no network, which is the one moment the whole
 * offline layer exists to avoid.
 *
 * The long one is not unlimited. A device that has not been seen for a month
 * is a device that may have been lost a month ago.
 *
 * Both run from the last time the session was used, not from the sign in:
 * `renewSession` moves them on. A session in daily use does not expire under
 * somebody, and one that lies around does.
 */
export const sessionLifetimes = {
  office: 60 * 60 * 12,
  registeredDevice: 60 * 60 * 24 * 30,
} as const

/**
 * How long after its last renewal a session in use is renewed again. An hour
 * in the office, a day on a device: often enough that the lifetime counts from
 * the last use near enough, rarely enough that a busy session does not write
 * its row on every request.
 */
const renewalAfter = {
  office: 60 * 60,
  registeredDevice: 60 * 60 * 24,
} as const

/** What `renewSession` reads off a session row. */
export interface RenewableSession {
  readonly id: string
  readonly expiresAt: Date | string
  readonly longLived?: boolean | null
}

/**
 * Moves the expiry of a session in use to a full lifetime from now, when its
 * last renewal is long enough ago; says whether it did.
 *
 * Ours and not better-auth's (#124). better-auth knows one lifetime and renews
 * every session to it, so a registered device would come back from its first
 * renewal as an office session, and with the office lifetime as its only one
 * the cookie of every device ran out after twelve hours. The cookie now always
 * lives as long as the longest session (`expiresIn` in `authentication.ts`),
 * and the row is what decides: a session whose row has expired is refused and
 * its cookie deleted, however long the cookie would still have lived.
 *
 * An expired session is never renewed. Asking after it is the refusal's job.
 */
export async function renewSession(
  database: Database,
  session: RenewableSession,
  userId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const kind = session.longLived ? 'registeredDevice' : 'office'
  const expiresAt = new Date(session.expiresAt).getTime()
  const renewedAt = expiresAt - sessionLifetimes[kind] * 1000

  if (expiresAt <= now.getTime() || now.getTime() - renewedAt < renewalAfter[kind] * 1000) {
    return false
  }

  await database.forInstance(
    (tx) =>
      tx
        .update(authSessions)
        .set({
          expiresAt: new Date(now.getTime() + sessionLifetimes[kind] * 1000),
          updatedAt: now,
        })
        .where(eq(authSessions.id, session.id)),
    userId,
  )

  return true
}
