import { and, eq, isNull, lte, sql } from 'drizzle-orm'

import type { Database } from '../database/database.js'
import { authTwoFactors } from '../schema.js'
import { allowedFailures, held, lockSeconds } from './reconfirmation.js'

/**
 * The count of wrong codes at a sign in, the code from the app and a
 * recovery code, kept here and not by better-auth. better-auth read the hold
 * once, looked at the code and counted afterwards, so guesses sent together
 * all got past the hold the tenth of them set.
 *
 * As in the confirmation (`reconfirmation.ts`), every attempt is counted
 * before its code is looked at, in the statement that asks whether the
 * account is held, and the tenth sets the hold in that same statement: only
 * the first ten of a run get as far as the code, however many arrive
 * together. A right code takes count and hold back to nothing
 * (`clearCodesAtSignIn`), as better-auth did.
 *
 * Nothing happens for an account without the app; better-auth answers that
 * itself.
 */
export async function reserveCodeAtSignIn(database: Database, userId: string): Promise<void> {
  const reserved = await database.forInstance(async (tx) => {
    // A hold that has run out is lifted first.
    await tx
      .update(authTwoFactors)
      .set({ failedVerificationCount: 0, lockedUntil: null })
      .where(and(eq(authTwoFactors.userId, userId), lte(authTwoFactors.lockedUntil, new Date())))

    const count = sql`coalesce(${authTwoFactors.failedVerificationCount}, 0) + 1`
    const [attempt] = await tx
      .update(authTwoFactors)
      .set({
        failedVerificationCount: count,
        lockedUntil: sql`case when ${count} >= ${allowedFailures}
          then now() + make_interval(secs => ${lockSeconds}) end`,
      })
      .where(and(eq(authTwoFactors.userId, userId), isNull(authTwoFactors.lockedUntil)))
      .returning({ attempts: authTwoFactors.failedVerificationCount })

    if (attempt) {
      return attempt.attempts ?? 0
    }

    const [factor] = await tx
      .select({ id: authTwoFactors.id })
      .from(authTwoFactors)
      .where(eq(authTwoFactors.userId, userId))
      .limit(1)

    return factor ? 'held' : null
  }, userId)

  // Past ten only where the confirmation counted beside a sign in.
  if (reserved === 'held' || (reserved !== null && reserved > allowedFailures)) {
    throw held()
  }
}

/** After a right code at a sign in: the count and the hold back to nothing. */
export async function clearCodesAtSignIn(database: Database, userId: string): Promise<void> {
  await database.forInstance(
    (tx) =>
      tx
        .update(authTwoFactors)
        .set({ failedVerificationCount: 0, lockedUntil: null })
        .where(eq(authTwoFactors.userId, userId)),
    userId,
  )
}
