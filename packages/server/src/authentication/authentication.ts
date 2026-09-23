import { hash, verify } from '@node-rs/argon2'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { createAuthMiddleware, getSessionFromCtx } from 'better-auth/api'
import { twoFactor } from 'better-auth/plugins'

import type { Database } from '../database/database.js'
import {
  authAccounts,
  authRateLimits,
  authSessions,
  authTwoFactors,
  authUsers,
  authVerifications,
} from '../database/schema/index.js'
import { renewSession, sessionLifetimes } from './session-lifetime.js'

export { sessionLifetimes } from './session-lifetime.js'

/**
 * The Argon2id parameters.
 *
 * Taken from the OWASP recommendation rather than from the library's default,
 * which is scrypt: ADR 0006 names Argon2id and that is not a detail anybody
 * should have to check later by reading a dependency. 19 MiB and two passes is
 * the configuration OWASP gives for Argon2id, and it is deliberately on the
 * modest side, because an instance is meant to run on a small server next to
 * PostgreSQL and a login that takes a second on a Raspberry Pi is a login
 * people work around.
 */
const argon2Parameters = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const

/**
 * Where better-auth's own routes live. Everything under it is the library's;
 * nothing of ours shares the prefix, and a test says so, because a controller
 * that crept under here would sit outside the guard without anybody meaning it
 * to.
 */
export const authenticationPath = '/api/auth'

export interface AuthenticationOptions {
  readonly database: Database
  /** Signs cookies and encrypts the TOTP secrets. */
  readonly secret: string
  /**
   * The addresses a browser may send an authenticated request from. This is
   * the CSRF defence: better-auth compares the Origin header against this list
   * and refuses anything else, so a form on a stranger's page cannot post to
   * an instance with somebody's cookie attached.
   */
  readonly trustedOrigins: readonly string[]
  /**
   * Whether the rate limits are on. Only a test turns them off, and only the
   * ones that are not about the limits: they share a counter keyed by address,
   * so a test that signs in twenty times would otherwise spend its last
   * eighteen requests measuring the limit instead of what it came for.
   *
   * There is a test that leaves them on and shows that they bite.
   */
  readonly rateLimited?: boolean
}

export type Authentication = ReturnType<typeof createAuthentication>

/**
 * The authentication, as ADR 0006 cut it: better-auth's core with sessions and
 * TOTP, and nothing else. Passkeys are part of the cut as well and switched off
 * until they can be listed and revoked, see the plugins below.
 *
 * What is deliberately absent is as much the decision as what is here. No
 * magic link, because that is the way into the customer portal and it is the
 * one better-auth had an account takeover advisory about in June 2026; it
 * arrives with the portal and with the security review ADR 0006 puts in front
 * of it. No OIDC client, no organisation plugin: a business here is a tenant
 * with row level security under it, not a row in somebody's plugin, and a
 * second notion of membership would be a second answer to the same question.
 */
export function createAuthentication({
  database,
  secret,
  trustedOrigins,
  rateLimited = true,
}: AuthenticationOptions) {
  return betterAuth({
    appName: 'OpenGewerk',
    secret,
    trustedOrigins: [...trustedOrigins],
    database: drizzleAdapter(database.authenticationHandle(), {
      provider: 'pg',
      // The library looks a table up by its own name for the model; these are
      // ours. Written out rather than left to a convention, because a rename on
      // either side would otherwise fail at the first sign in and not here.
      schema: {
        user: authUsers,
        session: authSessions,
        account: authAccounts,
        verification: authVerifications,
        twoFactor: authTwoFactors,
        rateLimit: authRateLimits,
      },
    }),
    emailAndPassword: {
      enabled: true,
      // Nobody signs themselves up. A business adds its staff, and an instance
      // that let a stranger create an account would hand out a foothold on the
      // login rate limits at the very least.
      disableSignUp: true,
      password: {
        hash: (password) => hash(password, argon2Parameters),
        verify: ({ hash: stored, password }) => verify(stored, password),
      },
    },
    session: {
      // The cookie lives as long as the longest session, and the row decides
      // (#124). better-auth writes this lifetime into the cookie, and a
      // shorter one there would log a device out while its row still has
      // weeks: the office lifetime did exactly that to every device after
      // twelve hours. A new row starts as an office session, see
      // `databaseHooks`, and `chooseTenant` makes it a device's.
      expiresIn: sessionLifetimes.registeredDevice,
      // Renewing is ours, `renewSession`: better-auth renews every session to
      // the one lifetime above, which would turn an office session into a
      // month.
      disableSessionRefresh: true,
      /**
       * The three columns a session of ours has beyond better-auth's.
       *
       * Every one of them is `input: false`, and on the first that is not a
       * detail: it is what keeps the chosen business out of anything a client
       * sends. Left writable, a request could put a tenant in the body of an
       * ordinary session update and be inside another company a moment later,
       * which is precisely the attack the guard's oldest test describes. They
       * are set by this server, in `chooseTenant`, after it has checked that
       * there is a membership.
       */
      additionalFields: {
        activeTenantId: { type: 'string', required: false, input: false },
        deviceId: { type: 'string', required: false, input: false },
        longLived: { type: 'boolean', required: false, input: false, defaultValue: false },
      },
    },
    databaseHooks: {
      session: {
        create: {
          // Every session starts short. Only a device registered in
          // `chooseTenant` gets the long lifetime, and a session that has not
          // chosen a business yet is not one.
          before: async (session) => ({
            data: {
              ...session,
              expiresAt: new Date(Date.now() + sessionLifetimes.office * 1000),
            },
          }),
        },
      },
    },
    hooks: {
      /**
       * Renews a session whenever the interface asks after it, and the cookie
       * with it. The interface asks at every start and whenever it comes back
       * into view, so a device that is used keeps a cookie a month ahead of
       * its last use; the requests in between renew only the row
       * (`SessionIdentitySource`).
       */
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== '/get-session') {
          return
        }

        const found = await getSessionFromCtx(ctx)

        if (!found) {
          return
        }

        await renewSession(database, found.session, found.user.id)
        await ctx.setSignedCookie(
          ctx.context.authCookies.sessionToken.name,
          found.session.token,
          ctx.context.secret,
          {
            ...ctx.context.authCookies.sessionToken.attributes,
            maxAge: sessionLifetimes.registeredDevice,
          },
        )
      }),
    },
    rateLimit: {
      enabled: rateLimited,
      // In the database, not in memory. A limit held in one process forgets
      // everything on a restart, and a restart is free to anybody who can make
      // the container fall over.
      storage: 'database',
      window: 60,
      max: 60,
      customRules: {
        // The ones worth guessing at. Everything else lives under the general
        // limit above.
        '/sign-in/email': { window: 60, max: 5 },
        '/two-factor/verify-totp': { window: 60, max: 5 },
        // A recovery code is a second factor as much as a code from the app,
        // and ten of them are ten chances instead of one (#125).
        '/two-factor/verify-backup-code': { window: 60, max: 5 },
      },
    },
    advanced: {
      // Cookies are already HttpOnly and SameSite=Lax by default; this is the
      // one that has to be said out loud, because an instance always runs
      // behind TLS and a cookie that would travel without it is a cookie that
      // can be taken off the wire.
      useSecureCookies: true,
      // better-auth's own check of the origin on its routes, written out so
      // that nobody turns it off by accident. The routes of ours have theirs
      // in `SameOriginGuard`, against the same list.
      disableCSRFCheck: false,
    },
    plugins: [
      twoFactor({
        issuer: 'OpenGewerk',
      }),
      // No passkeys for now (GHSA-jghx-6wmh-mpcj). With the plugin on, any
      // session could register one without confirming anything, signing in
      // with it skipped the second factor, and nobody could see or revoke the
      // passkeys an account had. They come back with a screen that lists and
      // revokes them, a confirmation before registering one and an answer to
      // whether a passkey counts as the second factor (ADR 0006).
    ],
  })
}
