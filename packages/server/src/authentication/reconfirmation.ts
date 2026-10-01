import { createOTP } from '@better-auth/utils/otp'
import type { Database } from '@opengewerk/platform-server'
import type { BetterAuthPlugin } from 'better-auth'
import { APIError, createAuthEndpoint, sessionMiddleware } from 'better-auth/api'
import { symmetricDecrypt } from 'better-auth/crypto'
import { and, eq, gte, isNull, lte, or, sql } from 'drizzle-orm'

import { authAccounts, authSessions, authTwoFactors } from '../database/schema/index.js'

/**
 * How long a confirmation holds, in seconds: long enough to name a passkey
 * and answer the browser's question, short enough that a desk left for lunch
 * does not still carry it.
 */
export const reconfirmationWindow = 10 * 60

/**
 * Wrong codes in a row before the account is held, and for how long. The
 * same budget better-auth's second factor keeps at a sign in (NIST SP
 * 800-63B, 5.2.2), and the same counter: a guess here is a guess there.
 */
const allowedFailures = 10
const lockSeconds = 15 * 60

/** Where the confirmation is asked, below better-auth's mount point. */
export const reconfirmationPath = '/reconfirm'

/** Whether the session confirmed again within the window. */
export async function recentlyReconfirmed(database: Database, sessionId: string): Promise<boolean> {
  const since = new Date(Date.now() - reconfirmationWindow * 1000)
  const [row] = await database.forInstance((tx) =>
    tx
      .select({ id: authSessions.id })
      .from(authSessions)
      .where(and(eq(authSessions.id, sessionId), gte(authSessions.reconfirmedAt, since)))
      .limit(1),
  )

  return row !== undefined
}

/**
 * Takes the confirmation of the session for one passkey, and says whether
 * there was one to take.
 *
 * Asking and spending are one statement: two registrations sent at once on
 * the same session would otherwise both find the confirmation before either
 * spent it, and one password would have added two keys. Spent when the
 * registration arrives and not when it succeeds, so a failed one needs the
 * password again, which is the side to err on.
 */
export async function claimReconfirmation(database: Database, sessionId: string): Promise<boolean> {
  const since = new Date(Date.now() - reconfirmationWindow * 1000)
  const claimed = await database.forInstance((tx) =>
    tx
      .update(authSessions)
      .set({ reconfirmedAt: null })
      .where(and(eq(authSessions.id, sessionId), gte(authSessions.reconfirmedAt, since)))
      .returning({ id: authSessions.id }),
  )

  return claimed.length > 0
}

/**
 * Confirming again, with the password and, where the account has one, the
 * code from the app (#167).
 *
 * Adding a passkey hands out a way into every business of the account, and a
 * session alone is not enough for that: it may be one left open on somebody
 * else's desk, or one taken from a browser. So adding asks first for what
 * only the person knows and has, as the sign in did, and this is where it is
 * asked. What it leaves behind is a moment on the session, which the two
 * routes of the passkey plugin that register one check (`authentication.ts`).
 *
 * A route of better-auth's rather than one of ours, for the two things it
 * brings along: its check of the origin, and its rate limits in the
 * database, keyed to the address. Both are what a route that takes a
 * password must have, and writing them a second time is how one of them
 * would go missing.
 *
 * The password is checked before the code, and a wrong password costs the
 * code nothing: whoever does not know it never reaches the counter of wrong
 * codes, which would otherwise hold the account's real owner out.
 */
export function reconfirmation(database: Database): BetterAuthPlugin {
  return {
    id: 'reconfirmation',
    endpoints: {
      reconfirm: createAuthEndpoint(
        reconfirmationPath,
        { method: 'POST', use: [sessionMiddleware] },
        async (ctx) => {
          const { session, user } = ctx.context.session
          const body = (ctx.body ?? {}) as { password?: unknown; code?: unknown }
          const password = typeof body.password === 'string' ? body.password : ''
          const code = typeof body.code === 'string' ? body.code.replace(/\s/g, '') : ''

          const [credential] = await database.forInstance(
            (tx) =>
              tx
                .select({ hash: authAccounts.password })
                .from(authAccounts)
                .where(
                  and(eq(authAccounts.userId, user.id), eq(authAccounts.providerId, 'credential')),
                )
                .limit(1),
            user.id,
          )

          if (!credential?.hash) {
            throw new APIError('BAD_REQUEST', {
              code: 'NO_PASSWORD',
              message:
                'Für dieses Konto ist kein Passwort gesetzt, mit dem es sich bestätigen ließe.',
            })
          }

          if (
            password === '' ||
            !(await ctx.context.password.verify({ hash: credential.hash, password }))
          ) {
            throw new APIError('UNAUTHORIZED', {
              code: 'INVALID_PASSWORD',
              message: 'Das Passwort stimmt nicht.',
            })
          }

          if (user.twoFactorEnabled === true) {
            if (code === '') {
              // Not a guess, and not counted as one: a screen that did not
              // know of the app yet asks for the code and shows its field.
              throw new APIError('BAD_REQUEST', {
                code: 'CODE_REQUIRED',
                message: 'Für dieses Konto gehört der Code aus der App zur Bestätigung dazu.',
              })
            }

            await checkCode(database, ctx.context.secretConfig, user.id, code)
          }

          await database.forInstance(
            (tx) =>
              tx
                .update(authSessions)
                .set({ reconfirmedAt: new Date() })
                .where(eq(authSessions.id, session.id)),
            user.id,
          )

          return ctx.json({
            reconfirmedUntil: new Date(Date.now() + reconfirmationWindow * 1000).toISOString(),
          })
        },
      ),
    },
  }
}

/** The key better-auth seals the secrets of the app with, however it was configured. */
type SecretConfig = Parameters<typeof symmetricDecrypt>[0]['key']

const held = () =>
  new APIError('TOO_MANY_REQUESTS', {
    code: 'ACCOUNT_TEMPORARILY_LOCKED',
    message: 'Zu viele falsche Codes hintereinander. Bitte in einer Viertelstunde noch einmal.',
  })

/**
 * The code from the app, against the secret better-auth keeps sealed, with
 * the same period and length its plugin uses and the same counter of wrong
 * codes it keeps for a sign in.
 *
 * Every attempt is counted before the code is looked at, in the statement
 * that asks whether the account is held: guesses sent at once then count one
 * by one, and only the first ten of a run get as far as the code, however
 * many arrive together. A right code takes the count back to nothing, and a
 * hold somebody else's guesses set in the meantime stays and confirms
 * nothing: while the account is held, no code opens it.
 */
async function checkCode(
  database: Database,
  key: SecretConfig,
  userId: string,
  code: string,
): Promise<void> {
  const attempt = await database.forInstance(async (tx) => {
    // A hold that has run out is lifted first, as better-auth does at a sign in.
    await tx
      .update(authTwoFactors)
      .set({ failedVerificationCount: 0, lockedUntil: null })
      .where(and(eq(authTwoFactors.userId, userId), lte(authTwoFactors.lockedUntil, new Date())))

    const [reserved] = await tx
      .update(authTwoFactors)
      .set({
        failedVerificationCount: sql`coalesce(${authTwoFactors.failedVerificationCount}, 0) + 1`,
      })
      .where(and(eq(authTwoFactors.userId, userId), isNull(authTwoFactors.lockedUntil)))
      .returning({
        id: authTwoFactors.id,
        secret: authTwoFactors.secret,
        attempts: authTwoFactors.failedVerificationCount,
      })

    if (reserved) {
      return reserved
    }

    const [factor] = await tx
      .select({ id: authTwoFactors.id })
      .from(authTwoFactors)
      .where(eq(authTwoFactors.userId, userId))
      .limit(1)

    return factor ? 'held' : null
  }, userId)

  if (attempt === null) {
    throw new APIError('BAD_REQUEST', {
      code: 'TOTP_NOT_ENABLED',
      message: 'Für dieses Konto ist keine Authenticator-App eingerichtet.',
    })
  }

  if (attempt === 'held' || (attempt.attempts ?? 0) > allowedFailures) {
    throw held()
  }

  const secret = await symmetricDecrypt({ key, data: attempt.secret })
  const valid =
    /^\d{6}$/.test(code) && (await createOTP(secret, { period: 30, digits: 6 }).verify(code))

  if (!valid) {
    if ((attempt.attempts ?? 0) >= allowedFailures) {
      await database.forInstance(
        (tx) =>
          tx
            .update(authTwoFactors)
            .set({ lockedUntil: new Date(Date.now() + lockSeconds * 1000) })
            .where(eq(authTwoFactors.id, attempt.id)),
        userId,
      )
    }

    throw new APIError('UNAUTHORIZED', {
      code: 'INVALID_CODE',
      message: 'Der Code aus der App stimmt nicht.',
    })
  }

  const cleared = await database.forInstance(
    (tx) =>
      tx
        .update(authTwoFactors)
        .set({ failedVerificationCount: 0 })
        .where(
          and(
            eq(authTwoFactors.id, attempt.id),
            or(isNull(authTwoFactors.lockedUntil), lte(authTwoFactors.lockedUntil, new Date())),
          ),
        )
        .returning({ id: authTwoFactors.id }),
    userId,
  )

  // A guess beside this one set the hold while the code was checked.
  if (cleared.length === 0) {
    throw held()
  }
}
