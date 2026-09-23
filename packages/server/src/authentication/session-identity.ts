import { ForbiddenException, UnauthorizedException } from '@nestjs/common'
import {
  type Identity,
  requiresSecondFactor,
  type RoleKey,
  type TenantId,
} from '@opengewerk/domain'
import { and, eq } from 'drizzle-orm'

import type { IdentitySource, SignedInUser } from '../api/identity.js'
import type { Database } from '../database/database.js'
import { memberships } from '../database/schema/index.js'
import type { Authentication } from './authentication.js'

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
 * 2. **Which business?** From the session row, never from the request. There
 *    is a test older than this file that puts a tenant in a body and expects
 *    to be ignored; reading it from anywhere a client can reach would be the
 *    one mistake nothing downstream could catch, because row level security
 *    would then faithfully isolate the wrong company.
 * 3. **What may they do here?** From the membership, read fresh on every
 *    request. Not from the session, and not cached: rights taken away in the
 *    office have to stop working now and not when a session happens to expire.
 *    The same row says whether this person is blocked in this business, which
 *    is the same question asked as sharply as it can be.
 *
 * The cost is one query per request, and it buys the property that a
 * revocation takes effect immediately. That is the right side to err on for a
 * table that is read far more often than it is written.
 */
export class SessionIdentitySource implements IdentitySource {
  constructor(
    private readonly authentication: Authentication,
    private readonly database: Database,
  ) {}

  async authenticate(request: unknown): Promise<SignedInUser | null> {
    const found = await this.session(request)

    return found ? { userId: found.user.id, sessionId: found.session.id } : null
  }

  private async session(request: unknown) {
    const headers = toHeaders((request as RequestWithHeaders).headers)

    return this.authentication.api.getSession({ headers })
  }

  async identify(request: unknown): Promise<Identity | null> {
    const found = await this.session(request)

    if (!found) {
      // No session at all. Null rather than an exception, because this is the
      // ordinary case of somebody who has not signed in, and the guard has the
      // message for it.
      return null
    }

    const tenantId = found.session.activeTenantId as TenantId | null | undefined

    if (!tenantId) {
      // Signed in, but no business chosen yet. Still a 401, because there is
      // no identity to work with, and a message of its own because the way out
      // is different: not "sign in" but "pick a company".
      throw new UnauthorizedException(
        'Es ist noch kein Betrieb gewählt. Bitte zuerst einen Betrieb auswählen.',
      )
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
      // The session names a business this person is no longer part of. The
      // session itself is still good, so this is a 403 and not a 401: signing
      // in again would change nothing.
      throw new ForbiddenException('Kein Zugang zu diesem Betrieb.')
    }

    if (membership.blockedAt) {
      // Blocking already deletes the sessions that were working in this
      // business, so in practice nobody arrives here. It is checked anyway,
      // because "the sessions were all found" is a promise the delete makes
      // and this one is a property of the row: a session created in the moment
      // between the two, or one that somehow survived, still gets nowhere.
      // Read fresh on every request like the roles next to it, for the same
      // reason.
      throw new ForbiddenException(
        'Dieser Zugang ist im Betrieb gesperrt. Der Inhaber kann ihn wieder freigeben.',
      )
    }

    const roles = membership.roles as readonly RoleKey[]

    if (requiresSecondFactor(roles) && !found.user.twoFactorEnabled) {
      // ADR 0006 hangs this on the role and not on a setting, so it is checked
      // here rather than at sign in: somebody made an owner an hour ago is
      // stopped at the next request, without anybody having to remember to
      // re-check them.
      throw new ForbiddenException(
        'Für diese Rolle ist ein zweiter Faktor Pflicht. Bitte zuerst eine ' +
          'Authenticator-App einrichten.',
      )
    }

    return { userId: found.user.id, tenantId, roles }
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
