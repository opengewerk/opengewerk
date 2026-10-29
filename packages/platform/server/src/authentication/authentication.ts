import { passkey } from '@better-auth/passkey'
import { hash, verify } from '@node-rs/argon2'
import { passkeyNameProblem } from '@opengewerk/platform-domain'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { APIError, createAuthMiddleware, getSessionFromCtx, isAPIError } from 'better-auth/api'
import { twoFactor } from 'better-auth/plugins'
import { and, eq, exists, ne } from 'drizzle-orm'

import { clientAddressHeader } from '../api/client-address.js'
import type { ServerApplication } from '../configuration.js'
import type { Database } from '../database/database.js'
import {
  authAccounts,
  authPasskeys,
  authRateLimits,
  authSessions,
  authTwoFactors,
  authUsers,
  authVerifications,
} from '../schema.js'
import type { AccessRules } from './access.js'
import {
  type PasskeyNotice,
  type PasswordResetMail,
  passwordResetLifetime,
  type RecoveryCodesNotice,
} from './notices.js'
import { markUsed, recordAdded, recordWithdrawn } from './passkeys.js'
import { shortestPassword } from './password.js'
import { recordPasswordReset, waitingAfterReset, waitsAfterReset } from './password-resets.js'
import {
  claimReconfirmation,
  reconfirmation,
  reconfirmationPath,
  recentlyReconfirmed,
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
  /**
   * The application, for its name: what an authenticator app lists the account
   * under, and what a device names when it asks about a passkey.
   */
  readonly application: Pick<ServerApplication, 'name'>
  /** The words of the application, for the one sentence here that names its tenants. */
  readonly access: Pick<AccessRules, 'sentences'>
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
   * Sends the link to a new password (#126), see `notices.ts`. Left out, as
   * on a closed instance or in a preview, a request for one is answered all
   * the same and nothing is sent.
   */
  readonly passwordResetMail?: PasswordResetMail
  /**
   * Tells an account about a passkey added to it (#167). Left out, as for
   * the link to a new password, nothing is sent.
   */
  readonly passkeyNotice?: PasskeyNotice
  /**
   * Tells an account about a new set of recovery codes
   * (opengewerk-haustechnik#360). Left out, nothing is sent.
   */
  readonly recoveryCodesNotice?: RecoveryCodesNotice
}

/**
 * Where a new set of recovery codes is made, which ends the old one
 * (opengewerk-haustechnik#360). Ten new codes are ten ways past the second
 * factor, so the route asks what a sign in asks, the password and the code
 * from the app, and not the password alone, as better-auth does by itself.
 */
const renewingRecoveryCodes = '/two-factor/generate-backup-codes'

/** The two routes of the passkey plugin that register one, both behind the confirmation. */
const registering: ReadonlySet<string> = new Set([
  '/passkey/generate-register-options',
  '/passkey/verify-registration',
])

/**
 * Where a second factor of any kind is set up: the app, and a passkey by both
 * routes that register one. Each waits a day after a reset of the password
 * (`password-resets.ts`).
 */
const settingUpASecondFactor: ReadonlySet<string> = new Set([
  '/two-factor/enable',
  ...registering,
  renewingRecoveryCodes,
])

/**
 * The routes of better-auth that are switched off, see `disabledPaths` in
 * `createAuthentication`. Exported for the test that holds every route still
 * reachable against a list.
 */
export const disabledPaths: readonly string[] = [
  '/passkey/list-user-passkeys',
  '/passkey/update-passkey',
  '/passkey/delete-passkey',
  '/list-sessions',
  '/update-user',
  '/update-session',
  '/change-email',
  '/delete-user',
  '/delete-user/callback',
  '/verify-email',
  '/send-verification-email',
  '/two-factor/get-totp-uri',
  '/two-factor/disable',
  '/verify-password',
  '/revoke-session',
  '/revoke-sessions',
  '/revoke-other-sessions',
  '/sign-up/email',
  '/sign-in/social',
  '/link-social',
  '/unlink-account',
  '/list-accounts',
  '/account-info',
  '/get-access-token',
  '/refresh-token',
  '/two-factor/send-otp',
  '/two-factor/verify-otp',
  // The two routes with a part of the path as a value. better-auth cannot
  // switch them off by name; `authenticationHandler` answers them in front of
  // it, since `routes` leaves out every path here. The link to a new password
  // goes to the page of the application with the token, which sends it in the
  // body of `/reset-password`, and there is no sign in through another
  // provider to come back from. Reachable, every value made up for them was a
  // row of the rate limits.
  '/reset-password/:token',
  '/callback/:id',
]

/** Where a sign in with a passkey happens, the one route that makes a passkey session. */
const passkeySignIn = '/passkey/verify-authentication'

/**
 * The routes at which better-auth writes a session after a second factor
 * (opengewerk-haustechnik#360): the code from the app and a recovery code
 * after the password, and a passkey (#167). The first is also where the code
 * that sets the app up is confirmed, and the session the app was set up in is
 * written there anew. The codes better-auth could send by mail are not set up
 * here.
 */
const confirmingSecondFactor: ReadonlySet<string> = new Set([
  '/two-factor/verify-totp',
  '/two-factor/verify-backup-code',
  passkeySignIn,
])

/**
 * Where better-auth puts a new session in the place of the one the request
 * came with: a new password, which ends every other session of the account.
 * The new one keeps the second factor of the old.
 */
const replacingSession = '/change-password'

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

/** A session as better-auth finds it behind a cookie, with the columns of ours. */
export interface FoundSession {
  readonly session: {
    readonly id: string
    readonly expiresAt: Date
    /** The tenant the session works in, once one is chosen. */
    readonly activeTenantId?: string | null | undefined
    /** The device, where the session was registered as one. */
    readonly deviceId?: string | null | undefined
    readonly longLived?: boolean | null | undefined
    /** With what the session was signed in, the password or a passkey. */
    readonly signInMethod?: string | null | undefined
    /** Whether the session carries a second factor (opengewerk-haustechnik#360). */
    readonly secondFactor?: boolean | null | undefined
  }
  readonly user: {
    readonly id: string
  }
}

/**
 * What the rest of a server asks of the authentication.
 *
 * better-auth's own object carries every route of every plugin in its type,
 * down to the types of the libraries those are built on, and no declaration
 * file of this package could name it. This is the part that is used, written
 * out: the handler its routes are mounted with, the two questions asked of it
 * from our side, and the hasher.
 *
 * It also keeps an application from reaching into better-auth past what is
 * here. Whatever else is needed of it gets a line here first.
 */
export interface Authentication {
  /** better-auth's own routes, for `toNodeHandler`, in front of the body parser. */
  readonly handler: (request: Request) => Promise<Response>
  /**
   * The paths of the routes that are switched on, under the path of the
   * authentication. A request for any other is answered before better-auth
   * sees it (`authenticationHandler`).
   */
  readonly routes: readonly RegExp[]
  readonly api: {
    /** The session a request carries, or null. */
    getSession(context: { readonly headers: Headers }): Promise<FoundSession | null>
    /** The recovery codes an account has left. Throws for one without a second factor. */
    viewBackupCodes(context: {
      readonly body: { readonly userId: string }
    }): Promise<{ readonly backupCodes: readonly string[] }>
  }
  /**
   * What better-auth hands out once it has read its own configuration: the
   * hasher every password goes through, so that there is one and not two that
   * could drift apart.
   */
  readonly $context: Promise<{
    readonly password: { hash(password: string): Promise<string> }
  }>
}

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
 * of it. No OIDC client, no organisation plugin: a tenant here has row level
 * security under it and is not a row in somebody's plugin, and a second notion
 * of membership would be a second answer to the same question.
 *
 * The application names itself and brings its words (ADR 0010); nothing else
 * about it is known here.
 */
export function createAuthentication({
  application,
  access,
  database,
  secret,
  trustedOrigins,
  rateLimited = true,
  passwordResetMail,
  passkeyNotice,
  recoveryCodesNotice,
}: AuthenticationOptions): Authentication {
  const party = relyingParty(trustedOrigins)

  const authentication = betterAuth({
    appName: application.name,
    secret,
    // Where the instance is reached: the first trusted origin, the address the
    // QR labels print as well (#551). Without it better-auth warned at every
    // start and took the address from each request, behind the web server in
    // front of it the inner one. Nothing that signs in depends on it here: the
    // cookies are named by `useSecureCookies`, a passkey by its relying party
    // below, and a request from any other trusted origin is let in by the list
    // as before.
    ...(trustedOrigins[0] ? { baseURL: trustedOrigins[0] } : {}),
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
      // Nobody signs themselves up. A tenant adds its staff, and an instance
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
      // Into the log of every tenant of the account, once the new password is
      // set (opengewerk-haustechnik#360). Whoever runs the instance sets up the
      // mail server the link went out through; whoever leads a tenant sees here
      // that a link was used, when and for whom, and never the link. Awaited:
      // should it fail, the route answers with an error rather than with a
      // reset the log does not know of.
      onPasswordReset: async ({ user }) => {
        await recordPasswordReset(database, user.id)
      },
    },
    session: {
      // The cookie lives as long as the longest session, and the row decides
      // (#124). better-auth writes this lifetime into the cookie, and a
      // shorter one there would log a device out while its row still has
      // weeks: the short lifetime did exactly that to every device after
      // twelve hours. A new row starts as an ordinary session, see
      // `databaseHooks`, and `chooseTenant` makes it a device's.
      expiresIn: sessionLifetimes.registeredDevice,
      // Renewing is ours, `renewSession`: better-auth renews every session to
      // the one lifetime above, which would turn an ordinary session into a
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
       * detail: it is what keeps the chosen tenant out of anything a client
       * sends. Left writable, a request could put a tenant in the body of an
       * ordinary session update and be inside another tenant a moment later,
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
        // Whether the session carries a second factor (opengewerk-haustechnik#360),
        // set below when the row is written and asked on every request of a
        // role that needs one. Like the column before it, a client writing it
        // would be a way past the second factor. Without a default here: the
        // hook below sets it on every new row, and the column has one.
        secondFactor: { type: 'boolean', required: false, input: false },
      },
    },
    databaseHooks: {
      session: {
        create: {
          // Every session starts short. Only a device registered in
          // `chooseTenant` gets the long lifetime, and a session that has not
          // chosen a tenant yet is not one.
          //
          // And every session says how it began (#167). Only the route that
          // signs in with a passkey makes a passkey session; every other way
          // to a session goes through the password, the code included where
          // one is set up.
          //
          // And whether it carries a second factor (opengewerk-haustechnik#360):
          // when it is written after one was confirmed, or in the place of a
          // session that had one. Never from the account: a session that began
          // with the password alone stays without, also once the account has
          // the app.
          before: async (session, context) => {
            const path = context?.path ?? ''
            const replaced = path === replacingSession ? context?.context.session : null

            return {
              data: {
                ...session,
                expiresAt: new Date(Date.now() + sessionLifetimes.ordinary * 1000),
                signInMethod: path === passkeySignIn ? 'passkey' : 'password',
                secondFactor:
                  confirmingSecondFactor.has(path) || replaced?.session.secondFactor === true,
              },
            }
          },
          // A session with a second factor on an account that has the app ends
          // the sessions of the account without one (opengewerk-haustechnik#360).
          // Setting the app up is the moment this matters: whoever had only the
          // password, and a session from it, is out, and the gate of a device
          // signed in that way shows the sign in again rather than a setup that
          // is done. A passkey session stays, it carries a second factor of its
          // own.
          after: async (session) => {
            if (session.secondFactor === true) {
              await endSessionsWithoutSecondFactor(database, session.userId, session.id)
            }
          },
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
       *
       * Setting up the app and adding a passkey both wait a day after a reset
       * of the password, which this hook asks first.
       */
      before: createAuthMiddleware(async (ctx) => {
        if (!settingUpASecondFactor.has(ctx.path)) {
          return
        }

        const found = await getSessionFromCtx(ctx)

        if (!found) {
          // The plugin answers this itself, with a 401.
          return
        }

        // A day after a reset of the password, before anything else is asked
        // (opengewerk-haustechnik#360): whoever chose the new password does not
        // give the account a second factor of their own at once.
        if (await waitsAfterReset(database, found.user.id)) {
          throw new APIError('FORBIDDEN', {
            code: 'PASSWORD_RECENTLY_RESET',
            message: waitingAfterReset,
          })
        }

        if (ctx.path === renewingRecoveryCodes) {
          // The password better-auth asks for in the body is checked after
          // this; the confirmation is the code as well, and it is spent here,
          // so a wrong password needs both again.
          if (!(await claimReconfirmation(database, found.session.id))) {
            throw new APIError('FORBIDDEN', {
              code: 'RECONFIRMATION_REQUIRED',
              message:
                'Neue Wiederherstellungscodes gibt es erst nach der Bestätigung mit dem ' +
                'Passwort und dem Code aus der App.',
            })
          }

          return
        }

        if (!registering.has(ctx.path)) {
          return
        }

        const unconfirmed = () =>
          new APIError('FORBIDDEN', {
            code: 'RECONFIRMATION_REQUIRED',
            message:
              'Vor dem Anlegen eines Passkeys bitte mit dem Passwort bestätigen, und wo ' +
              'eingerichtet mit dem Code aus der App.',
          })

        if (ctx.path !== '/passkey/verify-registration') {
          if (!(await recentlyReconfirmed(database, found.session.id))) {
            throw unconfirmed()
          }

          return
        }

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

        // Last, so that a mistyped name does not cost the confirmation.
        if (!(await claimReconfirmation(database, found.session.id))) {
          throw unconfirmed()
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

        if (ctx.path === renewingRecoveryCodes) {
          await afterRenewal(ctx.context.returned, await getSessionFromCtx(ctx))

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
    // log of every tenant of the account (`passkeys.controller.ts`); and
    // the list of sessions, which answered with the token of every session of
    // the account and asked only for a young session, since `freshAge` is 0
    // not even that. The devices of an account are `/auth/devices`.
    //
    // The changes to an account that are ours as well
    // (opengewerk-haustechnik#360): its name and address only through
    // `PATCH /auth/account`, after a confirmation and into the log of every
    // tenant (`own-account.ts`), and an account is never removed by its own
    // session. `/update-user` renamed an account with a session alone and told
    // nobody; the others are closed today by a setting or a field nobody may
    // send, and named here so that it stays so. The secret of the app and
    // switching it off are not used by the interface: the first would hand
    // a copy of the app to whoever has a session and the password, the second
    // would leave the password alone as the way in. And what nothing here
    // uses: a check of the password that answers yes or no to every session,
    // the end of sessions by their token, the sign up nobody may do, the
    // accounts of other providers and the codes by mail, none set up.
    disabledPaths: [...disabledPaths],
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
      // The same, for the second switch: left unsaid, better-auth turns its
      // check of the origin off whenever it believes it runs in a test, and
      // no test here ever met the check an instance runs with (#551).
      disableOriginCheck: false,
      // The address of a client as this instance determines it, written by
      // `nameTheClient` in front of the handler, and not better-auth's own
      // reading of `X-Forwarded-For` (opengewerk-haustechnik#360). An IPv6
      // address counts by its /64, as every limit per address here does
      // (`limitKey`); better-auth keeps it so in the session as well. Where
      // the address is not known, the header says `unknown`, which is no
      // address, and better-auth counts every such request in one counter,
      // `no-trusted-ip`, under the same limits as one address. That a stranger
      // can then lock the sign in for everybody is the smaller harm, next to
      // guessing without any limit, and the right setting of the proxy ends
      // both; `nameTheClient` says so in the log.
      ipAddress: {
        ipAddressHeaders: [clientAddressHeader],
        ipv6Subnet: 64,
      },
    },
    plugins: [
      twoFactor({
        issuer: application.name,
        // Ten wrong codes in a row hold the account for a quarter of an hour,
        // from whichever address they come (opengewerk-haustechnik#360). The
        // plugin does that by itself; written out so that nobody turns it off
        // by accident, because it is the one limit of the sign in that counts
        // per account and not per address. The confirmation again counts on
        // the same column with the same numbers (`reconfirmation.ts`).
        accountLockout: { enabled: true, maxFailedAttempts: 10, durationSeconds: 15 * 60 },
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
        rpName: application.name,
        origin: party.origins,
        authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
        registration: {
          afterVerification: ({ verification }) => {
            if (verification.registrationInfo?.userVerified !== true) {
              throw new APIError('BAD_REQUEST', {
                code: 'USER_VERIFICATION_REQUIRED',
                message:
                  'Ohne Bestätigung am Gerät, mit Fingerabdruck, Gesicht oder PIN, legt ' +
                  `${application.name} keinen Passkey an.`,
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
   * Once a new set of recovery codes is kept, the account is told by mail,
   * without waiting for it: see `RecoveryCodesNotice`.
   */
  async function afterRenewal(
    returned: unknown,
    found: Awaited<ReturnType<typeof getSessionFromCtx>>,
  ): Promise<void> {
    if (!found || !recoveryCodesNotice || isAPIError(returned)) {
      return
    }

    const owner = { id: found.user.id, email: found.user.email, name: found.user.name }

    void recoveryCodesNotice(owner).catch((error: unknown) => {
      console.error('Die Nachricht über neue Wiederherstellungscodes ging nicht hinaus.', error)
    })
  }

  /**
   * What happens once a passkey is stored: it goes into the log of every
   * tenant of the account, and the account is told by mail.
   *
   * Both before the registration answers. The mail is a row in the outbox of
   * a tenant, which the job sends and tries again; written after the answer,
   * a process stopped in between would leave a key nobody was told of.
   *
   * A passkey that cannot be put into the log, or told of, does not stay. A key
   * nobody can see come is the very thing the log is there to prevent, so it
   * is taken back, what some tenants already wrote down is closed as
   * removed, and the registration answers with an error.
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
      await passkeyNotice?.(
        { id: found.user.id, email: found.user.email, name: found.user.name },
        stored,
      )
    } catch (error) {
      console.error('Ein neuer Passkey ließ sich nicht festhalten oder melden.', error)
      await database.forInstance((tx) =>
        tx.delete(authPasskeys).where(eq(authPasskeys.id, stored.id)),
      )
      await recordWithdrawn(database, returned.userId, stored.id).catch((closing: unknown) => {
        console.error(
          'Ein zurückgenommener Passkey ließ sich nicht als gelöscht festhalten.',
          closing,
        )
      })

      throw new APIError('INTERNAL_SERVER_ERROR', {
        code: 'PASSKEY_NOT_RECORDED',
        message: access.sentences.passkeyNotRecorded,
      })
    }
  }

  return Object.assign(authentication, { routes: routesOf(authentication.api) })
}

/**
 * Each path better-auth answers on, as a pattern: a part like `:token` stands
 * for one part of the path, whatever it is. The routes that are switched off
 * are left out.
 */
function routesOf(api: object): RegExp[] {
  return Object.values(api as Record<string, { readonly path?: unknown }>)
    .map((endpoint) => endpoint.path)
    .filter((path): path is string => typeof path === 'string' && !disabledPaths.includes(path))
    .map(
      (path) =>
        new RegExp(
          `^${path
            .split('/')
            .map((part) =>
              part.startsWith(':') ? '[^/]+' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
            )
            .join('/')}$`,
        ),
    )
}

/**
 * Ends every session of an account that carries no second factor, apart from
 * the one named, once the account has the app (opengewerk-haustechnik#360).
 * As a new password ends the other sessions: the rows go, and with them the
 * cookies they stood behind.
 */
async function endSessionsWithoutSecondFactor(
  database: Database,
  userId: string,
  keep: string,
): Promise<void> {
  await database.forInstance(
    (tx) =>
      tx.delete(authSessions).where(
        and(
          eq(authSessions.userId, userId),
          ne(authSessions.id, keep),
          eq(authSessions.secondFactor, false),
          exists(
            tx
              .select({ id: authUsers.id })
              .from(authUsers)
              .where(and(eq(authUsers.id, userId), eq(authUsers.twoFactorEnabled, true))),
          ),
        ),
      ),
    userId,
  )
}
