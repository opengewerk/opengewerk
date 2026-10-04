import { ForbiddenException, UnauthorizedException } from '@nestjs/common'
import { hasSecondFactor, type MemberIdentity, type TenantId } from '@opengewerk/platform-domain'
import { and, eq } from 'drizzle-orm'

import type { FoundIdentity, IdentitySource, SignedInUser } from '../api/identity.js'
import type { Database } from '../database/database.js'
import { memberships } from '../schema.js'
import type { AccessRules } from './access.js'
import type { Authentication } from './authentication.js'
import { rolesHeld } from './roles.js'
import { renewSession } from './session-lifetime.js'

/** What a request has to carry for a session to be found in it. */
export interface RequestWithHeaders {
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
 * 3. **What may they do here?** From the membership and the roles of the
 *    tenant it names, read fresh on every request. Not from the session, and
 *    not cached: rights taken away, from the person or from a role, have to
 *    stop working now and not when a session happens to expire. The same
 *    row says whether this person is blocked in this tenant, which is the
 *    same question asked as sharply as it can be.
 *
 * The cost is two short reads per request, and it buys the property that a
 * revocation takes effect immediately. That is the right side to err on for
 * tables that are read far more often than they are written.
 */
export class SessionIdentitySource<Right extends string = string> implements IdentitySource<
  MemberIdentity<Right>
> {
  constructor(
    private readonly authentication: Authentication,
    private readonly database: Database,
    private readonly access: AccessRules<Right>,
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

  async identify(request: unknown): Promise<FoundIdentity<MemberIdentity<Right>> | null> {
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

      // The rows behind the keys the membership names, in the same
      // transaction, so that both are read as they stand at one moment.
      return row && { ...row, held: await rolesHeld(tx, tenantId, row.roles) }
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

    // What the roles add up to, read through the catalogue of the
    // application: a right a row holds and the catalogue does not know gives
    // nothing, and a key without a row is not a role.
    const sum = this.access.catalogue.sumOf(membership.held)

    if (
      sum.secondFactor &&
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
      roles: membership.roles,
      rights: sum.rights,
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
export function toHeaders(raw: RequestWithHeaders['headers']): Headers {
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
