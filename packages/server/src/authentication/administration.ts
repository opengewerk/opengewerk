import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'
import {
  type Identity,
  type InvitationId,
  invitationDays,
  type RoleKey,
  roleKeys,
  type TenantId,
} from '@opengewerk/domain'
import { and, count, eq, inArray, isNull, max, ne, sql } from 'drizzle-orm'

import type { Database, TenantTransaction } from '../database/database.js'
import {
  authSessions,
  authUsers,
  invitations,
  memberships,
  tenantSessions,
} from '../database/schema/index.js'
import { mintToken } from './invitation.js'

/**
 * Who works in one business, and everything the office can do about it.
 *
 * All of it is per business and none of it reaches past one, which is the one
 * rule this file is built around. It is worth saying where that rule actually
 * lives, because it is not a `where` clause anybody has to remember.
 *
 * Every question starts inside the business: the memberships, read under the
 * ordinary isolation, are what name the people. Only then, and only for those
 * names, is the instance asked what their accounts are called, because the
 * `auth_` tables are in reach only outside a business (see `rls.ts`). So the
 * second half cannot widen the first: it is handed identifiers that came out
 * of one company's own rows and asks about those and no others. A mistake here
 * returns fewer people than expected, never somebody else's staff.
 *
 * The sessions further down have the same shape. A device list is read from
 * the instance, and what makes it this company's business is that the query
 * names both the person, taken from the membership, and the business the
 * session is working in.
 */

/** One person in this business, as the office sees them. */
export interface StaffEntry {
  readonly userId: string
  readonly name: string
  readonly email: string
  readonly roles: readonly RoleKey[]
  readonly blockedAt: Date | null
  /**
   * When this business last saw them start work. From `tenant_sessions` and
   * not from the account: a sign in that happened at the company next door is
   * not this one's to know about.
   */
  readonly lastSignInAt: Date | null
  readonly twoFactorEnabled: boolean
}

/**
 * One person in this business, as whoever hands out a task sees them: the
 * name and whether they can still be given one. Nothing else, because this
 * list is read by everybody who may read tasks, the technician included, and
 * roles, addresses and sign ins are the owner's to see.
 */
export interface Colleague {
  readonly userId: string
  readonly name: string
  /**
   * False for somebody shut out of this business. Still listed, so that a task
   * handed to them earlier shows their name and not a key; not offered for a
   * new one, which nobody would ever see.
   */
  readonly active: boolean
}

/** One invitation that can still be used, as the office sees it. */
export interface InvitationEntry {
  readonly id: InvitationId
  readonly email: string
  readonly name: string
  readonly roles: readonly RoleKey[]
  readonly expiresAt: Date
  readonly invitedBy: string
}

/** One device somebody is signed in on in this business. */
export interface StaffDevice {
  readonly sessionId: string
  readonly userAgent: string | null
  readonly deviceId: string | null
  readonly longLived: boolean
  readonly signedInAt: Date
  readonly expiresAt: Date
}

/** What an invitation hands back, once. */
export interface IssuedInvitation {
  readonly token: string
  readonly expiresAt: Date
  readonly email: string
}

/**
 * The people of this business by name, for the tasks.
 *
 * The same two reads as the staff list, and for the same reason: the names
 * asked for are the ones that came out of this company's memberships, so the
 * second read cannot reach anybody else's staff.
 */
export async function listColleagues(database: Database, identity: Identity): Promise<Colleague[]> {
  const rows = await database.forTenant(identity, (tx) =>
    tx
      .select({ userId: memberships.userId, blockedAt: memberships.blockedAt })
      .from(memberships)
      .where(eq(memberships.tenantId, identity.tenantId)),
  )

  const accounts = await accountsOf(
    database,
    rows.map((row) => row.userId),
    identity.userId,
  )

  return rows
    .map((row) => ({
      userId: row.userId,
      name: accounts.get(row.userId)?.name ?? 'Unbekanntes Konto',
      active: row.blockedAt === null,
    }))
    .sort((left, right) => left.name.localeCompare(right.name, 'de'))
}

/** Whether a membership row carries the owner role. */
const carriesOwner = sql`${memberships.roles} @> ARRAY['owner']::text[]`

/**
 * The people of this business, with their accounts and their last sign in.
 *
 * Two reads and not a join, because a join is not possible: the memberships
 * are visible only inside the business and the accounts only outside one, by
 * policies that are the opposite of each other on purpose. Walking from the
 * first to the second is the whole isolation, see the note at the top.
 */
export async function listStaff(database: Database, identity: Identity): Promise<StaffEntry[]> {
  const inside = await database.forTenant(identity, async (tx) => {
    const rows = await tx
      .select({
        userId: memberships.userId,
        roles: memberships.roles,
        blockedAt: memberships.blockedAt,
      })
      .from(memberships)
      .where(eq(memberships.tenantId, identity.tenantId))

    const seen = await tx
      .select({ userId: tenantSessions.userId, last: max(tenantSessions.startedAt) })
      .from(tenantSessions)
      .where(eq(tenantSessions.tenantId, identity.tenantId))
      .groupBy(tenantSessions.userId)

    return { rows, seen }
  })

  const accounts = await accountsOf(
    database,
    inside.rows.map((row) => row.userId),
    identity.userId,
  )
  const lastSeen = new Map(inside.seen.map((row) => [row.userId, row.last]))

  return inside.rows
    .map((row) => {
      const account = accounts.get(row.userId)

      return {
        userId: row.userId,
        // A missing account would be a broken foreign key, which the database
        // does not allow. Saying so beats crashing, so that a list of twelve
        // people stays readable if it somehow happens anyway.
        name: account?.name ?? 'Unbekanntes Konto',
        email: account?.email ?? '',
        roles: row.roles as readonly RoleKey[],
        blockedAt: row.blockedAt,
        lastSignInAt: lastSeen.get(row.userId) ?? null,
        twoFactorEnabled: account?.twoFactorEnabled === true,
      }
    })
    .sort((left, right) => left.name.localeCompare(right.name, 'de'))
}

/** The invitations of this business that can still be used. */
export async function listInvitations(
  database: Database,
  identity: Identity,
): Promise<InvitationEntry[]> {
  return database.forTenant(identity, async (tx) => {
    const rows = await tx
      .select({
        id: invitations.id,
        email: invitations.email,
        name: invitations.name,
        roles: invitations.roles,
        expiresAt: invitations.expiresAt,
        invitedBy: invitations.invitedBy,
      })
      .from(invitations)
      .where(stillOpen())

    return rows.map((row) => ({ ...row, roles: row.roles as readonly RoleKey[] }))
  })
}

/**
 * Makes a link for somebody who does not work here yet.
 *
 * The token comes back once and is never stored, so this is the only moment it
 * can be shown. The office passes it on by whatever it uses to reach the
 * person. The address of the instance is not put together here: the browser
 * that asked is already looking at that address, and the server would have to
 * be told one.
 *
 * An open invitation for the same address is called back rather than refused.
 * The case is somebody clicking twice, or an office that mislaid the link, and
 * a second link working alongside the first would be a second way in left over
 * from a mistake.
 */
export async function inviteStaff(
  database: Database,
  identity: Identity,
  wanted: { readonly email: string; readonly name: string; readonly roles: readonly RoleKey[] },
): Promise<IssuedInvitation> {
  const email = normalise(wanted.email)
  const name = wanted.name.trim()
  const roles = checkedRoles(wanted.roles)

  if (!email.includes('@')) {
    throw new BadRequestException('Die E-Mail-Adresse sieht nicht wie eine aus.')
  }

  if (name === '') {
    throw new BadRequestException('Der Name fehlt.')
  }

  const already = await listStaff(database, identity)

  if (already.some((person) => person.email === email)) {
    // Said plainly, because this is the office's own staff list and the answer
    // gives away nothing it does not already have on screen.
    throw new ConflictException('Diese Adresse arbeitet schon in diesem Betrieb.')
  }

  const { token, hash } = mintToken()
  const expiresAt = new Date(Date.now() + invitationDays * 24 * 60 * 60 * 1000)

  await database.forTenant(identity, async (tx) => {
    await tx
      .update(invitations)
      .set({ revokedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(invitations.email, email), stillOpen()))

    await tx.insert(invitations).values({
      tenantId: identity.tenantId,
      email,
      name,
      roles,
      tokenHash: hash,
      invitedBy: identity.userId,
      expiresAt,
    })
  })

  return { token, expiresAt, email }
}

/** Calls an invitation back before anybody has used it. */
export async function revokeInvitation(
  database: Database,
  identity: Identity,
  invitationId: string,
): Promise<void> {
  const changed = await database.forTenant(identity, async (tx) => {
    const rows = await tx
      .update(invitations)
      .set({ revokedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(invitations.id, invitationId as InvitationId), stillOpen()))
      .returning({ id: invitations.id })

    return rows.length
  })

  if (changed === 0) {
    // Gone, used, already called back, or belonging to another business. One
    // answer for all four, so that this is not a way of finding out which
    // invitations exist elsewhere.
    throw new NotFoundException('Diese Einladung gibt es nicht mehr.')
  }
}

/**
 * Changes what somebody may do here.
 *
 * The refusal for the last owner is the point of the function. A business that
 * has taken the owner role off its own last owner has locked itself out of its
 * own user administration, and the way back is a psql prompt on a server most
 * businesses have nobody for.
 */
export async function changeRoles(
  database: Database,
  identity: Identity,
  userId: string,
  wanted: readonly RoleKey[],
): Promise<readonly RoleKey[]> {
  const roles = checkedRoles(wanted)

  return database.forTenant(identity, async (tx) => {
    const current = await membershipOf(tx, identity.tenantId, userId)

    if (current.roles.includes('owner') && !roles.includes('owner')) {
      await refuseIfLastOwner(tx, identity.tenantId, userId)
    }

    await tx
      .update(memberships)
      .set({ roles, updatedAt: new Date() })
      .where(and(eq(memberships.tenantId, identity.tenantId), eq(memberships.userId, userId)))

    return roles
  })
}

/**
 * Shuts somebody out of this business, or lets them back in.
 *
 * Blocking does two things beyond the column, and the second is what makes it
 * take effect now instead of whenever a session happens to run out: every
 * session of this person that is working in this business is deleted, and
 * every stretch of work the business had open for them is closed. The first is
 * what they notice; without the second the log would go on saying they are
 * still at work, and would say it forever, because the row it points at is
 * gone.
 *
 * Sessions of the same person in another business are not touched. That is the
 * same rule as everywhere else here, and it is why the delete names the
 * business as well as the person.
 */
export async function setBlocked(
  database: Database,
  identity: Identity,
  userId: string,
  blocked: boolean,
): Promise<void> {
  await database.forTenant(identity, async (tx) => {
    const current = await membershipOf(tx, identity.tenantId, userId)

    if (blocked && current.roles.includes('owner')) {
      await refuseIfLastOwner(tx, identity.tenantId, userId)
    }

    await tx
      .update(memberships)
      .set({ blockedAt: blocked ? new Date() : null, updatedAt: new Date() })
      .where(and(eq(memberships.tenantId, identity.tenantId), eq(memberships.userId, userId)))

    if (blocked) {
      await tx
        .update(tenantSessions)
        .set({ endedAt: new Date() })
        .where(
          and(
            eq(tenantSessions.tenantId, identity.tenantId),
            eq(tenantSessions.userId, userId),
            isNull(tenantSessions.endedAt),
          ),
        )
    }
  })

  if (blocked) {
    await database.forInstance(
      (tx) =>
        tx
          .delete(authSessions)
          .where(
            and(
              eq(authSessions.userId, userId),
              eq(authSessions.activeTenantId, identity.tenantId),
            ),
          ),
      identity.userId,
    )
  }
}

/**
 * The devices somebody is signed in on in this business.
 *
 * Only the sessions that are working here. A session of the same person in
 * another company is none of this office's business, and a session that has
 * not picked a company yet belongs to the instance rather than to anybody.
 */
export async function devicesOf(
  database: Database,
  identity: Identity,
  userId: string,
): Promise<StaffDevice[]> {
  await database.forTenant(identity, (tx) => membershipOf(tx, identity.tenantId, userId))

  return database.forInstance(
    (tx) =>
      tx
        .select({
          sessionId: authSessions.id,
          userAgent: authSessions.userAgent,
          deviceId: authSessions.deviceId,
          longLived: authSessions.longLived,
          signedInAt: authSessions.createdAt,
          expiresAt: authSessions.expiresAt,
        })
        .from(authSessions)
        .where(
          and(eq(authSessions.userId, userId), eq(authSessions.activeTenantId, identity.tenantId)),
        ),
    identity.userId,
  )
}

/**
 * Cuts one of somebody else's devices off, for the phone in the van that was
 * broken into.
 *
 * The person whose phone it is can already do this themselves from another
 * device. The case worth building for is the one where the phone was the other
 * device.
 */
export async function revokeDeviceOf(
  database: Database,
  identity: Identity,
  userId: string,
  sessionId: string,
): Promise<void> {
  await database.forTenant(identity, (tx) => membershipOf(tx, identity.tenantId, userId))

  const removed = await database.forInstance(async (tx) => {
    const rows = await tx
      .delete(authSessions)
      .where(
        and(
          eq(authSessions.id, sessionId),
          eq(authSessions.userId, userId),
          eq(authSessions.activeTenantId, identity.tenantId),
        ),
      )
      .returning({ id: authSessions.id })

    return rows.length
  }, identity.userId)

  if (removed === 0) {
    throw new NotFoundException('Diese Sitzung gibt es in diesem Betrieb nicht.')
  }

  await database.forTenant(identity, (tx) =>
    tx
      .update(tenantSessions)
      .set({ endedAt: new Date() })
      .where(
        and(
          eq(tenantSessions.tenantId, identity.tenantId),
          eq(tenantSessions.sessionId, sessionId),
          isNull(tenantSessions.endedAt),
        ),
      ),
  )
}

/**
 * The accounts behind identifiers that came out of one business.
 *
 * Read outside any business, which is the only place the `auth_` tables exist
 * at all. What keeps it from being a way of reading the whole instance is the
 * list it is handed: made from the memberships of one company, a line above
 * every call.
 */
async function accountsOf(
  database: Database,
  userIds: readonly string[],
  asUser: string,
): Promise<Map<string, { name: string; email: string; twoFactorEnabled: boolean | null }>> {
  if (userIds.length === 0) {
    // drizzle turns an empty `in ()` into a condition that is never true, which
    // is right, but asking at all would be a transaction for nothing.
    return new Map()
  }

  const rows = await database.forInstance(
    (tx) =>
      tx
        .select({
          id: authUsers.id,
          name: authUsers.name,
          email: authUsers.email,
          twoFactorEnabled: authUsers.twoFactorEnabled,
        })
        .from(authUsers)
        .where(inArray(authUsers.id, [...userIds])),
    asUser,
  )

  return new Map(rows.map((row) => [row.id, row]))
}

/** An invitation nobody has used, called back or let run out. */
function stillOpen() {
  return and(
    isNull(invitations.redeemedAt),
    isNull(invitations.revokedAt),
    sql`${invitations.expiresAt} > now()`,
  )
}

/** The membership this operation is about, or a plain refusal. */
async function membershipOf(
  tx: TenantTransaction,
  tenantId: TenantId,
  userId: string,
): Promise<{ roles: readonly RoleKey[]; blockedAt: Date | null }> {
  const [row] = await tx
    .select({ roles: memberships.roles, blockedAt: memberships.blockedAt })
    .from(memberships)
    .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId)))
    .limit(1)

  if (!row) {
    // Not in this business, or not on the instance at all. One answer for
    // both: telling them apart would turn this into a way of asking who has an
    // account here.
    throw new NotFoundException('Dieses Konto arbeitet nicht in diesem Betrieb.')
  }

  return { roles: row.roles as readonly RoleKey[], blockedAt: row.blockedAt }
}

/**
 * Refuses when this person is the last owner who can still get in.
 *
 * Blocked owners do not count, and that is the part easiest to leave out: a
 * business with two owners, one of them blocked, has one owner, and letting
 * that one go would leave it with none.
 *
 * The row this is asked about is usually the asking owner's own. That is not
 * an oversight, it is where the case lives. Only an owner has
 * `membership.write`, so an owner working on somebody else's row is by
 * definition not working on the last one: there are two of them, the one
 * asking and the one being changed. The way a business really locks itself out
 * is an owner who decides they do not need the role any more, and an earlier
 * draft of this file refused every operation on one's own row and thereby made
 * the only case that matters unreachable. Working on one's own row is allowed
 * and this is the fence.
 */
async function refuseIfLastOwner(
  tx: TenantTransaction,
  tenantId: TenantId,
  userId: string,
): Promise<void> {
  const [row] = await tx
    .select({ others: count() })
    .from(memberships)
    .where(
      and(
        eq(memberships.tenantId, tenantId),
        ne(memberships.userId, userId),
        isNull(memberships.blockedAt),
        carriesOwner,
      ),
    )

  if ((row?.others ?? 0) === 0) {
    throw new ConflictException(
      'Das ist der letzte Inhaber dieses Betriebs. Erst einen zweiten Inhaber einsetzen, ' +
        'sonst kann niemand mehr Zugänge verwalten.',
    )
  }
}

/** The roles a route was given, or a refusal naming the ones that exist. */
function checkedRoles(wanted: readonly RoleKey[]): readonly RoleKey[] {
  const unknown = wanted.filter((role) => !roleKeys.includes(role))

  if (unknown.length > 0) {
    throw new BadRequestException(
      `Unbekannte Rollen: ${unknown.join(', ')}. Es gibt ${roleKeys.join(', ')}.`,
    )
  }

  if (wanted.length === 0) {
    throw new BadRequestException(
      'Ohne Rolle kann sich jemand anmelden und nichts tun. Mindestens eine Rolle angeben.',
    )
  }

  // A duplicate would land in the column as written and make two identical
  // memberships look different in the log.
  return [...new Set(wanted)]
}

/** One spelling of an address, so that two spellings are not two people. */
export function normalise(email: string): string {
  return email.trim().toLowerCase()
}
