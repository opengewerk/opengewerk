import { passkey } from '@better-auth/passkey'
import { hash, verify } from '@node-rs/argon2'
import { passkeyNameProblem } from '@opengewerk/domain'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { APIError, createAuthMiddleware, getSessionFromCtx, isAPIError } from 'better-auth/api'
import { twoFactor } from 'better-auth/plugins'
import { eq } from 'drizzle-orm'

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
import type { PasskeyNotice } from '../mail/passkey-notice.js'
import type { PasswordResetMail } from '../mail/password-reset.js'
import { passwordResetLifetime } from '../mail/password-reset.js'
import { markUsed, recordAdded } from './passkeys.js'
import { shortestPassword } from './password.js'
import {
  reconfirmation,
  reconfirmationPath,
  recentlyReconfirmed,
  spendReconfirmation,
} from './reconfirmation.js'
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
  /**
   * Sends the link to a new password (#126), through the mail server of a
   * business the account works in. Left out, as on a closed instance or in
   * the preview, a request for one is answered all the same and nothing is
   * sent.
   */
  readonly passwordResetMail?: PasswordResetMail
  /**
   * Tells an account about a passkey added to it (#167), through the outbox
   * of a business it works in. Left out, as for the link to a new password,
   * nothing is sent.
   */
  readonly passkeyNotice?: PasskeyNotice
}

/** The two routes of the passkey plugin that register one, both behind the confirmation. */
const registering: ReadonlySet<string> = new Set([
  '/passkey/generate-register-options',
  '/passkey/verify-registration',
])

/** Where a sign in with a passkey happens, the one route that makes a passkey session. */
const passkeySignIn = '/passkey/verify-authentication'

/**
 * The relying party a passkey is bound to: the host of the first trusted
 * origin, where the instance is reached. A passkey works on exactly that host
 * and its subdomains, so the origins it is checked against are the trusted
 * ones on it; a second origin on another host could not use it anyway.
 */
function relyingParty(trustedOrigins: readonly string[]): {
  readonly id: string
  readonly origins: string[]
} {
  const hosts = trustedOrigins.map((origin) => ({ origin, host: new URL(origin).hostname }))
  const id = hosts[0]?.host ?? 'localhost'

  return {
    id,
    origins: hosts
      .filter(({ host }) => host === id || host.endsWith(`.${id}`))
      .map(({ origin }) => origin),
  }
}

/** Whether better-auth's answer is a stored passkey, the success of a registration. */
function isStoredPasskey(
  value: unknown,
): value is { readonly id: string; readonly userId: string; readonly name?: string | null } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { id?: unknown }).id === 'string' &&
    typeof (value as { userId?: unknown }).userId === 'string'
  )
}

export type Authentication = ReturnType<typeof createAuthentication>

/**
 * The authentication, as ADR 0006 cut it: better-auth's core with sessions,
 * TOTP and passkeys, and nothing else. Passkeys were switched off from
 * 23.09.2026 until they could be listed and revoked (GHSA-jghx-6wmh-mpcj);
 * they came back with #167 and #248, see the plugins below.
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
  passwordResetMail,
  passkeyNotice,
}: AuthenticationOptions) {
  const party = relyingParty(trustedOrigins)

  const authentication = betterAuth({
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
      // The same twelve as everywhere a password is chosen; better-auth's own
      // floor is eight, and it applies to changing and resetting one (#126).
      minPasswordLength: shortestPassword,
      // A new password through a link in a mail (#126). The link works for an
      // hour and once, and afterwards every session of the account is over:
      // whoever had the old password is out.
      resetPasswordTokenExpiresIn: passwordResetLifetime,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, token }) => {
        // Not awaited, see `passwordResetMails`: an address with an account
        // would answer as slowly as a mail server, one without at once.
        void passwordResetMail?.({ id: user.id, email: user.email, name: user.name }, token).catch(
          (error: unknown) => {
            console.error('Die Mail zum Zurücksetzen des Passworts ging nicht hinaus.', error)
          },
        )
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
      // better-auth's "fresh session", a session younger than a day, is not
      // asked anywhere. It guarded the registration of a passkey, where the
      // confirmation with the password now stands (`reconfirmation.ts`), and
      // better-auth's list of sessions, which is switched off below. A
      // session's age is a poor stand-in for who is at the keyboard: a
      // device of ours keeps its session for a month.
      freshAge: 0,
      /**
       * The four columns a session of ours has beyond better-auth's.
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
        // With what the session was signed in (#167), set below when the row
        // is written. Read back on every request, where a passkey session
        // counts as a second factor, so a client must never be able to write
        // it: that would be a way past the second factor.
        signInMethod: { type: 'string', required: false, input: false, defaultValue: 'password' },
      },
    },
    databaseHooks: {
      session: {
        create: {
          // Every session starts short. Only a device registered in
          // `chooseTenant` gets the long lifetime, and a session that has not
          // chosen a business yet is not one.
          //
          // And every session says how it began (#167). Only the route that
          // signs in with a passkey makes a passkey session; every other way
          // to a session goes through the password, the code included where
          // one is set up.
          before: async (session, context) => ({
            data: {
              ...session,
              expiresAt: new Date(Date.now() + sessionLifetimes.office * 1000),
              signInMethod: context?.path === passkeySignIn ? 'passkey' : 'password',
            },
          }),
        },
      },
    },
    hooks: {
      /**
       * Adding a passkey only after confirming again (#167).
       *
       * Both routes that register one ask for a confirmation with the
       * password within the last minutes, on this very session. Without it a
       * session left open on a desk, or one lifted from a browser, could give
       * itself a key of its own, which is what GHSA-jghx-6wmh-mpcj was about.
       * The registration itself also has to name the passkey and may not ask
       * for a session of its own: the plugin could make one, and a session
       * that begins with a registration is a sign in nobody confirmed.
       */
      before: createAuthMiddleware(async (ctx) => {
        if (!registering.has(ctx.path)) {
          return
        }

        const found = await getSessionFromCtx(ctx)

        if (!found) {
          // The plugin answers this itself, with a 401.
          return
        }

        if (!(await recentlyReconfirmed(database, found.session.id))) {
          throw new APIError('FORBIDDEN', {
            code: 'RECONFIRMATION_REQUIRED',
            message:
              'Vor dem Anlegen eines Passkeys bitte mit dem Passwort bestätigen, und wo ' +
              'eingerichtet mit dem Code aus der App.',
          })
        }

        if (ctx.path === '/passkey/verify-registration') {
          const body = (ctx.body ?? {}) as { name?: unknown; createSession?: unknown }

          if (body.createSession !== undefined && body.createSession !== false) {
            throw new APIError('BAD_REQUEST', {
              code: 'PASSKEY_WITHOUT_SESSION',
              message: 'Ein neuer Passkey meldet nicht an, er kommt zu dieser Sitzung dazu.',
            })
          }

          const problem = passkeyNameProblem(typeof body.name === 'string' ? body.name : '')

          if (problem) {
            throw new APIError('BAD_REQUEST', { code: 'PASSKEY_NAME_INVALID', message: problem })
          }
        }
      }),
      /**
       * Renews a session whenever the interface asks after it, and the cookie
       * with it. The interface asks at every start and whenever it comes back
       * into view, so a device that is used keeps a cookie a month ahead of
       * its last use; the requests in between renew only the row
       * (`SessionIdentitySource`).
       */
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path === '/passkey/verify-registration') {
          await afterRegistration(ctx.context.returned, await getSessionFromCtx(ctx))

          return
        }

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
        // A link to a new password is a mail to somebody's inbox, and a form
        // that sends them without limit is a way to fill it (#126).
        '/request-password-reset': { window: 60 * 60, max: 5 },
        '/reset-password': { window: 60, max: 5 },
        '/change-password': { window: 60, max: 5 },
        // The confirmation takes the password and the code like a sign in,
        // and gets the limit of one (#167).
        [reconfirmationPath]: { window: 60, max: 5 },
        '/passkey/verify-registration': { window: 60, max: 5 },
        '/passkey/verify-authentication': { window: 60, max: 10 },
      },
    },
    // Routes of better-auth that are not used here, off so that nothing can
    // reach them. The plugin's own list, rename and delete of passkeys, which
    // are routes of ours instead because a change to a passkey belongs in the
    // log of every business of the account (`passkeys.controller.ts`); and
    // the list of sessions, which answered with the token of every session of
    // the account and asked only for a young session, since `freshAge` is 0
    // not even that. The devices of an account are `/auth/devices`.
    disabledPaths: [
      '/passkey/list-user-passkeys',
      '/passkey/update-passkey',
      '/passkey/delete-passkey',
      '/list-sessions',
    ],
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
      /**
       * Passkeys (#167, #248), back since they can be listed, renamed and
       * deleted under "Konto" and added only after confirming again (see the
       * hooks above). Two things are asked of every one of them, at
       * registration and at every sign in: that it is resident, so that it
       * signs in without typing an address, and that the person confirmed on
       * the device, with a fingerprint, a face or a PIN. Only then is a sign
       * in with it a second factor, which is what Moritz decided on
       * 24.09.2026 (#190).
       *
       * The plugin asks the browser for that confirmation but takes an answer
       * without it; `requireUserVerification` is false in its code. So the
       * two checks after the plugin's own are ours, and they refuse.
       */
      passkey({
        rpID: party.id,
        rpName: 'OpenGewerk',
        origin: party.origins,
        authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
        registration: {
          afterVerification: ({ verification }) => {
            if (verification.registrationInfo?.userVerified !== true) {
              throw new APIError('BAD_REQUEST', {
                code: 'USER_VERIFICATION_REQUIRED',
                message:
                  'Ohne Bestätigung am Gerät, mit Fingerabdruck, Gesicht oder PIN, legt ' +
                  'OpenGewerk keinen Passkey an.',
              })
            }

            return Promise.resolve()
          },
        },
        authentication: {
          afterVerification: async ({ verification }) => {
            if (!verification.authenticationInfo.userVerified) {
              throw new APIError('UNAUTHORIZED', {
                code: 'USER_VERIFICATION_REQUIRED',
                message:
                  'Ein Passkey meldet nur mit Bestätigung am Gerät an, mit Fingerabdruck, ' +
                  'Gesicht oder PIN.',
              })
            }

            await markUsed(database, verification.authenticationInfo.credentialID)
          },
        },
      }),
      reconfirmation(database),
    ],
  })

  /**
   * What happens once a passkey is stored: it goes into the log of every
   * business of the account, the confirmation is spent, and the account is
   * told by mail.
   *
   * A passkey that cannot be put into the log does not stay. A key nobody
   * can see come is the very thing the log is there to prevent, so it is
   * taken back and the registration answers with an error.
   */
  async function afterRegistration(
    returned: unknown,
    found: Awaited<ReturnType<typeof getSessionFromCtx>>,
  ): Promise<void> {
    if (!found || isAPIError(returned) || !isStoredPasskey(returned)) {
      return
    }

    const stored = { id: returned.id, name: returned.name ?? 'Passkey' }

    try {
      await recordAdded(database, returned.userId, stored)
    } catch (error) {
      console.error('Ein neuer Passkey ließ sich nicht im Protokoll festhalten.', error)
      await database.forInstance((tx) =>
        tx.delete(authPasskeys).where(eq(authPasskeys.id, stored.id)),
      )

      throw new APIError('INTERNAL_SERVER_ERROR', {
        code: 'PASSKEY_NOT_RECORDED',
        message:
          'Der Passkey ließ sich nicht im Protokoll der Betriebe festhalten und ist deshalb ' +
          'nicht angelegt. Bitte noch einmal versuchen.',
      })
    }

    await spendReconfirmation(database, found.session.id)

    void passkeyNotice?.(
      { id: found.user.id, email: found.user.email, name: found.user.name },
      stored,
    ).catch((error: unknown) => {
      console.error('Die Mail zu einem neuen Passkey ließ sich nicht schreiben.', error)
    })
  }

  return authentication
}
