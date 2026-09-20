import { hash, verify } from '@node-rs/argon2'
import { passkey } from '@better-auth/passkey'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { twoFactor } from 'better-auth/plugins'

import type { Database } from '../database/database.js'
import {
  authAccounts,
  authPasskeys,
  authRateLimits,
  authSessions,
  authTwoFactors,
  authUsers,
  authVerifications,
} from '../database/schema/index.js'

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
 */
export const sessionLifetimes = {
  office: 60 * 60 * 12,
  registeredDevice: 60 * 60 * 24 * 30,
} as const

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
 * The authentication, as ADR 0006 cut it: better-auth's core with sessions,
 * passkeys and TOTP, and nothing else.
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
        passkey: authPasskeys,
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
      expiresIn: sessionLifetimes.office,
      // How much of the remaining life may pass before the expiry is pushed
      // out again. A day means a session in daily use never expires under
      // somebody, and one that is not used does.
      updateAge: 60 * 60 * 24,
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
      },
    },
    advanced: {
      // Cookies are already HttpOnly and SameSite=Lax by default; this is the
      // one that has to be said out loud, because an instance always runs
      // behind TLS and a cookie that would travel without it is a cookie that
      // can be taken off the wire.
      useSecureCookies: true,
      // The proxy in front terminates TLS, so the request that arrives here
      // says http. Without this the secure flag above would be dropped.
      disableCSRFCheck: false,
    },
    plugins: [
      twoFactor({
        issuer: 'OpenGewerk',
      }),
      passkey({
        rpName: 'OpenGewerk',
      }),
    ],
  })
}
