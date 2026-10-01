import { ForbiddenException, UnauthorizedException } from '@nestjs/common'
import { hasSecondFactor, type TenantId, type TenantIdentity } from '@opengewerk/platform-domain'
import { and, eq } from 'drizzle-orm'

import type { FoundIdentity, IdentitySource, SignedInUser } from '../api/identity.js'
import type { Database } from '../database/database.js'
import { memberships } from '../schema.js'
import type { AccessRules } from './access.js'
import type { Authentication } from './authentication.js'
import { renewSession } from './session-lifetime.js'

/**
 * Somebody at work in a tenant, with the roles their membership gives them
 * there. What the roles allow is the application's to say; this is what the
 * session and the membership say about a request.
 */
export interface MemberIdentity<Role extends string = string> extends TenantIdentity {
  readonly roles: readonly Role[]
}

/** What a request has to carry for a session to be found in it. */
interface RequestWithHeaders {
  readonly headers?: Record<string, string | string[] | undefined>
}

/**
 * Turns the cookie on a request into the identity the guard works with.
 *
 * Three questions, in this order, and the order is the point.
 *
 * 1. **Who is this?** better-auth answers it from the session cookie. No
 *    answer means no identity, and the guard turns that into 401.
 * 2. **Which tenant?** From the session row, never from the request. There
 *    is a test older than this file that puts a tenant in a body and expects
 *    to be ignored; reading it from anywhere a client can reach would be the
 *    one mistake nothing downstream could catch, because row level security
 *    would then faithfully isolate the wrong tenant.
 * 3. **What may they do here?** From the membership, read fresh on every
 *    request. Not from the session, and not cached: rights taken away have
 *    to stop working now and not when a session happens to expire.
 *    The same row says whether this person is blocked in this tenant, which
 *    is the same question asked as sharply as it can be.
 *
 * The cost is one query per request, and it buys the property that a
 * revocation takes effect immediately. That is the right side to err on for a
 * table that is read far more often than it is written.
 */
export class SessionIdentitySource<Role extends string = string> implements IdentitySource<
  MemberIdentity<Role>
> {
  constructor(
    private readonly authentication: Authentication,
    private readonly database: Database,
    private readonly access: AccessRules<Role>,
  ) {}

  async authenticate(request: unknown): Promise<SignedInUser | null> {
    const found = await this.session(request)

    return found ? { userId: found.user.id, sessionId: found.session.id } : null
  }

  /**
   * The session on a request, renewed when it is due. Only the row: the
   * cookie is renewed when the interface asks after the session, which it
   * does at every start and whenever it comes back into view, and until then
   * it lives a month anyway (`session-lifetime.ts`).
   */
  private async session(request: unknown) {
    const headers = toHeaders((request as RequestWithHeaders).headers)
    const found = await this.authentication.api.getSession({ headers })

    if (found) {
      await renewSession(this.database, found.session, found.user.id)
    }

    return found
  }

  async identify(request: unknown): Promise<FoundIdentity<MemberIdentity<Role>> | null> {
    const found = await this.session(request)

    if (!found) {
      // No session at all. Null rather than an exception, because this is the
      // ordinary case of somebody who has not signed in, and the guard has the
      // message for it.
      return null
    }

    const tenantId = found.session.activeTenantId as TenantId | null | undefined

    if (!tenantId) {
      // Signed in, but no tenant chosen yet. Still a 401, because there is
      // no identity to work with, and a message of its own because the way out
      // is different: not "sign in" but "pick a tenant".
      throw new UnauthorizedException(this.access.sentences.noTenantChosen)
    }

    const membership = await this.database.forTenant({ tenantId }, async (tx) => {
      const [row] = await tx
        .select({ roles: memberships.roles, blockedAt: memberships.blockedAt })
        .from(memberships)
        .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, found.user.id)))
        .limit(1)

      return row
    })

    if (!membership) {
      // The session names a tenant this person is no longer part of. The
      // session itself is still good, so this is a 403 and not a 401: signing
      // in again would change nothing.
      throw new ForbiddenException(this.access.sentences.noAccessToTenant)
    }

    if (membership.blockedAt) {
      // Blocking already deletes the sessions that were working in this
      // tenant, so in practice nobody arrives here. It is checked anyway,
      // because "the sessions were all found" is a promise the delete makes
      // and this one is a property of the row: a session created in the moment
      // between the two, or one that somehow survived, still gets nowhere.
      // Read fresh on every request like the roles next to it, for the same
      // reason.
      throw new ForbiddenException(this.access.sentences.blockedInTenant)
    }

    // Whatever the column holds was written through the rules of this
    // application, which is what the cast says.
    const roles = membership.roles as readonly Role[]

    if (
      this.access.requiresSecondFactor(roles) &&
      !hasSecondFactor({
        twoFactorEnabled: found.user.twoFactorEnabled,
        signInMethod: found.session.signInMethod,
      })
    ) {
      // ADR 0006 hangs this on the role and not on a setting, so it is checked
      // here rather than at sign in: somebody given such a role an hour ago is
      // stopped at the next request, without anybody having to remember to
      // re-check them.
      //
      // Asked of the session and not only of the account (#167): a session
      // that began with a passkey confirmed on the device carries the second
      // factor itself, one that began with the password alone does not.
      throw new ForbiddenException(
        'Für diese Rolle ist ein zweiter Faktor Pflicht. Bitte eine Authenticator-App ' +
          'einrichten oder mit einem Passkey anmelden.',
      )
    }

    const deviceId = (found.session as { deviceId?: string | null }).deviceId

    return {
      userId: found.user.id,
      tenantId,
      roles,
      sessionId: found.session.id,
      ...(deviceId ? { deviceId } : {}),
    }
  }
}

/**
 * Express hands headers over as a plain object and better-auth wants the web
 * `Headers`. An array value happens when a header arrives more than once, and
 * joining with a comma is what the HTTP specification says such a header
 * means.
 */
function toHeaders(raw: RequestWithHeaders['headers']): Headers {
  const headers = new Headers()

  for (const [name, value] of Object.entries(raw ?? {})) {
    if (typeof value === 'string') {
      headers.set(name, value)
    } else if (Array.isArray(value)) {
      headers.set(name, value.join(', '))
    }
  }

  return headers
}
