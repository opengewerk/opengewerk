import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Post,
} from '@nestjs/common'
import type { RoleKey, TenantId } from '@opengewerk/domain'
import { and, eq, isNull } from 'drizzle-orm'

import { RequiresSession } from '../api/authorization.js'
import { pick } from '../api/body.js'
import { CurrentUser, type SignedInUser } from '../api/identity.js'
import { Database } from '../database/database.js'
import { isUuid } from '../database/identifier.js'
import { authSessions, memberships, tenants, tenantSessions } from '../database/schema/index.js'
import { sessionLifetimes } from './authentication.js'

/** One of the businesses somebody may work in. */
interface TenantChoice {
  readonly id: TenantId
  readonly name: string
  readonly roles: readonly RoleKey[]
}

/** One signed in device, as the person whose device it is sees it. */
interface DeviceEntry {
  readonly sessionId: string
  readonly userAgent: string | null
  readonly deviceId: string | null
  readonly longLived: boolean
  readonly signedInAt: Date
  readonly expiresAt: Date
  readonly current: boolean
}

/**
 * The few routes that live between signing in and working.
 *
 * All of them carry `@RequiresSession` and none of them a right, because a
 * right comes from a membership and a membership is per business, which is the
 * very thing not yet decided here. Signing in itself is not in this file: that
 * is better-auth's handler, mounted beside the API and outside the guard,
 * because a route that hands out a session cannot ask for one.
 */
@Controller('auth')
export class AuthenticationController {
  constructor(private readonly database: Database) {}

  /**
   * The businesses this person may enter.
   *
   * Read outside any tenant, which is the one place a membership is visible
   * across businesses, and only one's own: the policy compares the row against
   * `app.user_id`. So this cannot be turned into a way of asking who else
   * works where.
   *
   * A business somebody is blocked in is left out rather than shown and
   * refused. Offering it would mean a chooser with an entry that answers 403
   * to every click, and the sentence that explains why belongs to whoever did
   * the blocking, not to a screen that can only guess.
   */
  @Get('tenants')
  @RequiresSession()
  async availableTenants(@CurrentUser() user: SignedInUser): Promise<TenantChoice[]> {
    return this.database.forInstance(async (tx) => {
      const rows = await tx
        .select({
          id: memberships.tenantId,
          name: tenants.name,
          roles: memberships.roles,
        })
        .from(memberships)
        .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
        .where(and(eq(memberships.userId, user.userId), isNull(memberships.blockedAt)))

      return rows.map((row) => ({ ...row, roles: row.roles as readonly RoleKey[] }))
    }, user.userId)
  }

  /**
   * Chooses the business this session works in.
   *
   * Two things happen, and both have to, which is why they are here and not in
   * a client: the session is stamped with the tenant, and the business gets a
   * row saying somebody started working in it. The second is what puts the
   * sign in into that company's audit log, because the log is per tenant and
   * an entry without one has nowhere to go.
   *
   * The membership is checked before either. Writing the tenant first and
   * asking afterwards would leave a session pointing at a company somebody
   * does not belong to, and row level security would then isolate that company
   * perfectly for a stranger.
   */
  @Post('tenant')
  @RequiresSession()
  async chooseTenant(
    @CurrentUser() user: SignedInUser,
    @Body() body: unknown,
  ): Promise<{ tenantId: TenantId }> {
    const values = pick(body, ['tenantId', 'deviceId'] as const)
    const tenantId = typeof values.tenantId === 'string' ? values.tenantId : ''
    const deviceId = typeof values.deviceId === 'string' && values.deviceId ? values.deviceId : null

    if (!isUuid(tenantId)) {
      throw new BadRequestException('tenantId fehlt oder ist keine gültige Kennung.')
    }

    const chosen = tenantId as TenantId

    const allowed = await this.database.forInstance(async (tx) => {
      const [row] = await tx
        .select({ id: memberships.id })
        .from(memberships)
        .where(
          and(
            eq(memberships.tenantId, chosen),
            eq(memberships.userId, user.userId),
            isNull(memberships.blockedAt),
          ),
        )
        .limit(1)

      return row !== undefined
    }, user.userId)

    if (!allowed) {
      // The same answer whether the business does not exist, this person is
      // not in it, or they are blocked in it. Telling the three apart would
      // turn this route into a way of finding out which companies are on an
      // instance. Blocking has to be checked here as well as on every request:
      // a session that had chosen no business yet survives a block, and this
      // is the route it would use to walk into one.
      throw new ForbiddenException('Kein Zugang zu diesem Betrieb.')
    }

    // A registered device gets the long session, the office the short one
    // (ADR 0006). The expiry moves with it, otherwise the flag would say one
    // thing and the cookie another.
    const expiresAt = new Date(
      Date.now() + (deviceId ? sessionLifetimes.registeredDevice : sessionLifetimes.office) * 1000,
    )

    await this.database.forInstance(
      (tx) =>
        tx
          .update(authSessions)
          .set({ activeTenantId: chosen, deviceId, longLived: deviceId !== null, expiresAt })
          .where(eq(authSessions.id, user.sessionId)),
      user.userId,
    )

    // Inside the business now, so this row lands in its audit log with the
    // user on it. The reason the log records comes from the route, as always.
    await this.database.forTenant(
      {
        tenantId: chosen,
        userId: user.userId,
        reason: 'session.start',
        deviceId: deviceId ?? undefined,
      },
      (tx) =>
        tx.insert(tenantSessions).values({
          tenantId: chosen,
          userId: user.userId,
          sessionId: user.sessionId,
          deviceId,
        }),
    )

    return { tenantId: chosen }
  }

  /**
   * The devices this session's owner is signed in on, so that a phone left in
   * a van can be cut off from a desk.
   */
  @Get('devices')
  @RequiresSession()
  async devices(@CurrentUser() user: SignedInUser): Promise<DeviceEntry[]> {
    return this.database.forInstance(async (tx) => {
      const rows = await tx
        .select({
          sessionId: authSessions.id,
          userAgent: authSessions.userAgent,
          deviceId: authSessions.deviceId,
          longLived: authSessions.longLived,
          signedInAt: authSessions.createdAt,
          expiresAt: authSessions.expiresAt,
        })
        .from(authSessions)
        .where(eq(authSessions.userId, user.userId))

      return rows.map((row) => ({ ...row, current: row.sessionId === user.sessionId }))
    }, user.userId)
  }

  /**
   * Cuts one device off.
   *
   * The session row goes, and every stretch of work it had open in any
   * business is closed. The second part is why this is not simply a delete:
   * a tenant session left open would tell a company somebody is still working
   * in it, and would do so forever, because the row it pointed at is gone.
   */
  @Delete('devices/:sessionId')
  @RequiresSession()
  async revokeDevice(
    @CurrentUser() user: SignedInUser,
    @Param('sessionId') sessionId: string,
  ): Promise<{ revoked: string }> {
    const owned = await this.database.forInstance(async (tx) => {
      const [row] = await tx
        .select({ activeTenantId: authSessions.activeTenantId })
        .from(authSessions)
        .where(and(eq(authSessions.id, sessionId), eq(authSessions.userId, user.userId)))
        .limit(1)

      return row
    }, user.userId)

    if (!owned) {
      // Somebody else's session, or none. One answer for both, so that this
      // cannot be used to find out which session identifiers exist.
      throw new ForbiddenException('Diese Sitzung gehört nicht zu diesem Konto.')
    }

    if (owned.activeTenantId) {
      await this.closeTenantSessions(owned.activeTenantId, user.userId, sessionId, 'session.revoke')
    }

    await this.database.forInstance(
      (tx) => tx.delete(authSessions).where(eq(authSessions.id, sessionId)),
      user.userId,
    )

    return { revoked: sessionId }
  }

  /**
   * Signs out, and closes the stretch of work in the business first.
   *
   * better-auth has a sign out of its own and it is not enough on its own: it
   * knows nothing about tenant sessions, so it would take the session away and
   * leave the company's log saying somebody is still at work. This route does
   * both and is the one a client calls.
   */
  @Post('sign-out')
  @RequiresSession()
  async signOut(@CurrentUser() user: SignedInUser): Promise<{ signedOut: true }> {
    const current = await this.database.forInstance(async (tx) => {
      const [row] = await tx
        .select({ activeTenantId: authSessions.activeTenantId })
        .from(authSessions)
        .where(eq(authSessions.id, user.sessionId))
        .limit(1)

      return row
    }, user.userId)

    if (current?.activeTenantId) {
      await this.closeTenantSessions(
        current.activeTenantId,
        user.userId,
        user.sessionId,
        'session.end',
      )
    }

    await this.database.forInstance(
      (tx) => tx.delete(authSessions).where(eq(authSessions.id, user.sessionId)),
      user.userId,
    )

    return { signedOut: true }
  }

  /**
   * Closes whatever this session had open in that business. An update and not
   * a delete, because the row is the company's record that somebody worked in
   * it, and the change itself is what the audit log picks up.
   */
  private async closeTenantSessions(
    tenantId: TenantId,
    userId: string,
    sessionId: string,
    reason: string,
  ): Promise<void> {
    await this.database.forTenant({ tenantId, userId, reason }, (tx) =>
      tx
        .update(tenantSessions)
        .set({ endedAt: new Date() })
        .where(
          and(
            eq(tenantSessions.sessionId, sessionId),
            eq(tenantSessions.userId, userId),
            isNull(tenantSessions.endedAt),
          ),
        ),
    )
  }
}
