import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'
import {
  type InvitationId,
  invitationDays,
  type RoleDefinition,
  type TenantId,
  type TenantIdentity,
} from '@opengewerk/platform-domain'
import { and, count, eq, inArray, isNull, max, ne, sql } from 'drizzle-orm'

import type { Database, TenantTransaction } from '../database/database.js'
import { newId } from '../database/identifier.js'
import { authSessions, authUsers, invitations, memberships, tenantSessions } from '../schema.js'
import type { AccessRules } from './access.js'
import { mintToken } from './invitation.js'
import type { InvitationMail, InvitationMailing } from './invitation-mailing.js'
import { leadsItsTenant, rolesOfTenant } from './roles.js'

/**
 * Who works in one tenant, and everything whoever leads it can do about it.
 *
 * All of it is per tenant and none of it reaches past one, which is the one
 * rule this file is built around. It is worth saying where that rule actually
 * lives, because it is not a `where` clause anybody has to remember.
 *
 * Every question starts inside the tenant: the memberships, read under the
 * ordinary isolation, are what name the people. Only then, and only for those
 * names, is the instance asked what their accounts are called, because the
 * `auth_` tables are in reach only outside a tenant (see `rls.ts`). So the
 * second half cannot widen the first: it is handed identifiers that came out
 * of one tenant's own rows and asks about those and no others. A mistake here
 * returns fewer people than expected, never somebody else's staff.
 *
 * The sessions further down have the same shape. A device list is read from
 * the instance, and what makes it this tenant's to see is that the query
 * names both the person, taken from the membership, and the tenant the
 * session is working in.
 *
 * Which roles there are and which of them leads is read from the rows of the
 * tenant (`roles.ts`). What a tenant and the one who leads it are called is
 * the application's to say, in the sentences that name either
 * (`AccessRules`).
 */

/** One person in this tenant, as whoever administers it sees them. */
export interface StaffEntry {
  readonly userId: string
  readonly name: string
  readonly email: string
  readonly roles: readonly string[]
  readonly blockedAt: Date | null
  /**
   * When this tenant last saw them start work. From `tenant_sessions` and
   * not from the account: a sign in that happened at the tenant next door is
   * not this one's to know about.
   */
  readonly lastSignInAt: Date | null
  readonly twoFactorEnabled: boolean
  /** Whether the account has a passkey, which is a second factor too (#167). */
  readonly hasPasskey: boolean
}

/**
 * One person in this tenant, as whoever hands work to somebody sees them: the
 * name and whether they can still be given any. Nothing else, because this
 * list is read by many more people than the administration is, and roles,
 * addresses and sign ins are for whoever administers the tenant to see.
 */
export interface Colleague {
  readonly userId: string
  readonly name: string
  /**
   * False for somebody shut out of this tenant. Still listed, so that work
   * handed to them earlier shows their name and not a key; not offered for
   * new work, which nobody would ever see.
   */
  readonly active: boolean
}

/** One invitation that can still be used, as whoever administers the tenant sees it. */
export interface InvitationEntry {
  readonly id: InvitationId
  readonly email: string
  readonly name: string
  readonly roles: readonly string[]
  readonly expiresAt: Date
  readonly invitedBy: string
  /** The message it went out with, for one sent by mail. */
  readonly mail: InvitationMail | null
}

/** One device somebody is signed in on in this tenant. */
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
  readonly id: InvitationId
  /**
   * The token, once, for whoever invited to pass on. Null for an invitation
   * sent by mail: its token is made when the message goes out and ends up in
   * the message and nowhere else, the screen of whoever invited included.
   */
  readonly token: string | null
  readonly expiresAt: Date
  readonly email: string
}

/**
 * The people of this tenant by name, for whatever an application hands to
 * one of them.
 *
 * The same two reads as the staff list, and for the same reason: the names
 * asked for are the ones that came out of this tenant's memberships, so the
 * second read cannot reach anybody else's staff.
 */
export async function listColleagues(
  database: Database,
  identity: TenantIdentity,
): Promise<Colleague[]> {
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

/** The keys of the roles that lead this tenant. */
function leadingKeys(known: readonly RoleDefinition[]): readonly string[] {
  return known.filter((role) => role.leads).map((role) => role.key)
}

/** Whether somebody with these roles leads. */
function leadsWith(roles: readonly string[], leading: readonly string[]): boolean {
  return roles.some((role) => leading.includes(role))
}

/**
 * The people of this tenant, with their accounts and their last sign in.
 *
 * Two reads and not a join, because a join is not possible: the memberships
 * are visible only inside the tenant and the accounts only outside one, by
 * policies that are the opposite of each other on purpose. Walking from the
 * first to the second is the whole isolation, see the note at the top.
 */
export async function listStaff(
  database: Database,
  identity: TenantIdentity,
): Promise<StaffEntry[]> {
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
        roles: row.roles,
        blockedAt: row.blockedAt,
        lastSignInAt: lastSeen.get(row.userId) ?? null,
        twoFactorEnabled: account?.twoFactorEnabled === true,
        hasPasskey: account?.hasPasskey === true,
      }
    })
    .sort((left, right) => left.name.localeCompare(right.name, 'de'))
}

/**
 * The invitations of this tenant that can still be used, each with the
 * message it went out with where the application sends invitations by mail.
 */
export async function listInvitations(
  database: Database,
  identity: TenantIdentity,
  mailing: Pick<InvitationMailing, 'mailsOf'> | null = null,
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

    const mails = mailing
      ? await mailing.mailsOf(
          tx,
          rows.map((row) => row.id),
        )
      : new Map<string, InvitationMail>()

    return rows.map((row) => ({ ...row, mail: mails.get(row.id) ?? null }))
  })
}

/**
 * Makes a link for somebody who does not work here yet.
 *
 * The token comes back once and is never stored, so this is the only moment it
 * can be shown. Whoever invited passes it on by whatever reaches the person.
 * The address of the instance is not put together here: the browser
 * that asked is already looking at that address, and the server would have to
 * be told one.
 *
 * An open invitation for the same address is called back rather than refused.
 * The case is somebody clicking twice, or somebody who mislaid the link, and
 * a second link working alongside the first would be a second way in left over
 * from a mistake.
 *
 * An invitation sent by mail keeps the hash of a token nobody ever sees. The
 * job that sends the message makes the real one at that moment, puts its hash
 * here and its link into the message, so the token exists in the mail and
 * nowhere else: not in the outbox, not in the audit log, not on a screen.
 */
export async function inviteStaff(
  access: Pick<AccessRules, 'sentences'>,
  database: Database,
  identity: TenantIdentity,
  wanted: { readonly email: string; readonly name: string; readonly roles: readonly string[] },
  options: { readonly byMail?: boolean } = {},
): Promise<IssuedInvitation> {
  const email = normalise(wanted.email)
  const name = wanted.name.trim()
  const roles = await database.forTenant(identity, async (tx) =>
    checkedRoles(await rolesOfTenant(tx, identity.tenantId), wanted.roles),
  )

  if (!email.includes('@')) {
    throw new BadRequestException('Die E-Mail-Adresse sieht nicht wie eine aus.')
  }

  if (name === '') {
    throw new BadRequestException('Der Name fehlt.')
  }

  const already = await listStaff(database, identity)

  if (already.some((person) => person.email === email)) {
    // Said plainly, because this is the tenant's own staff list and the answer
    // gives away nothing whoever asked does not already have on screen.
    throw new ConflictException(access.sentences.alreadyWorksHere)
  }

  const { token, hash } = mintToken()
  const expiresAt = new Date(Date.now() + invitationDays * 24 * 60 * 60 * 1000)
  const id = newId<'invitation'>()

  await database.forTenant(identity, async (tx) => {
    await tx
      .update(invitations)
      .set({ revokedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(invitations.email, email), stillOpen()))

    await tx.insert(invitations).values({
      id,
      tenantId: identity.tenantId,
      email,
      name,
      roles,
      tokenHash: hash,
      invitedBy: identity.userId,
      expiresAt,
    })
  })

  return { id, token: options.byMail ? null : token, expiresAt, email }
}

/** Calls an invitation back before anybody has used it. */
export async function revokeInvitation(
  database: Database,
  identity: TenantIdentity,
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
    // Gone, used, already called back, or belonging to another tenant. One
    // answer for all four, so that this is not a way of finding out which
    // invitations exist elsewhere.
    throw new NotFoundException('Diese Einladung gibt es nicht mehr.')
  }
}

/**
 * Changes what somebody may do here.
 *
 * The refusal for the last one who leads the tenant is the point of the
 * function. A tenant that has taken the leading role off the last person who
 * held it has locked itself out of its own user administration, and the way
 * back is a psql prompt on a server most tenants have nobody for.
 */
export async function changeRoles(
  access: Pick<AccessRules, 'sentences'>,
  database: Database,
  identity: TenantIdentity,
  userId: string,
  wanted: readonly string[],
): Promise<readonly string[]> {
  return database.forTenant(identity, async (tx) => {
    const known = await rolesOfTenant(tx, identity.tenantId)
    const roles = checkedRoles(known, wanted)
    const leading = leadingKeys(known)
    const current = await membershipOf(access, tx, identity.tenantId, userId)

    if (leadsWith(current.roles, leading) && !leadsWith(roles, leading)) {
      await refuseIfLastLead(access, tx, identity.tenantId, userId)
    }

    await tx
      .update(memberships)
      .set({ roles, updatedAt: new Date() })
      .where(and(eq(memberships.tenantId, identity.tenantId), eq(memberships.userId, userId)))

    return roles
  })
}

/**
 * Shuts somebody out of this tenant, or lets them back in.
 *
 * Blocking does two things beyond the column, and the second is what makes it
 * take effect now instead of whenever a session happens to run out: every
 * session of this person that is working in this tenant is deleted, and
 * every stretch of work the tenant had open for them is closed. The first is
 * what they notice; without the second the log would go on saying they are
 * still at work, and would say it forever, because the row it points at is
 * gone.
 *
 * Sessions of the same person in another tenant are not touched. That is the
 * same rule as everywhere else here, and it is why the delete names the
 * tenant as well as the person.
 */
export async function setBlocked(
  access: Pick<AccessRules, 'sentences'>,
  database: Database,
  identity: TenantIdentity,
  userId: string,
  blocked: boolean,
): Promise<void> {
  await database.forTenant(identity, async (tx) => {
    const leading = leadingKeys(await rolesOfTenant(tx, identity.tenantId))
    const current = await membershipOf(access, tx, identity.tenantId, userId)

    if (blocked && leadsWith(current.roles, leading)) {
      await refuseIfLastLead(access, tx, identity.tenantId, userId)
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
 * The devices somebody is signed in on in this tenant.
 *
 * Only the sessions that are working here. A session of the same person in
 * another tenant is not this one's to see, and a session that has not picked
 * a tenant yet belongs to the instance rather than to anybody.
 */
export async function devicesOf(
  access: Pick<AccessRules, 'sentences'>,
  database: Database,
  identity: TenantIdentity,
  userId: string,
): Promise<StaffDevice[]> {
  await database.forTenant(identity, (tx) => membershipOf(access, tx, identity.tenantId, userId))

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
 * Cuts one of somebody else's devices off, for the phone that was stolen.
 *
 * The person whose phone it is can already do this themselves from another
 * device. The case worth building for is the one where the phone was the other
 * device.
 */
export async function revokeDeviceOf(
  access: Pick<AccessRules, 'sentences'>,
  database: Database,
  identity: TenantIdentity,
  userId: string,
  sessionId: string,
): Promise<void> {
  await database.forTenant(identity, (tx) => membershipOf(access, tx, identity.tenantId, userId))

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
    throw new NotFoundException(access.sentences.noSuchSessionHere)
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
 * The accounts behind identifiers that came out of one tenant.
 *
 * Read outside any tenant, which is the only place the `auth_` tables exist
 * at all. What keeps it from being a way of reading the whole instance is the
 * list it is handed: made from the memberships of one tenant, a line above
 * every call. What an application tells people with uses it the same way, for
 * the address of a person one of its records names, which a key on that
 * record ties to a membership here.
 */
export async function accountsOf(
  database: Database,
  userIds: readonly string[],
  asUser: string,
): Promise<
  Map<
    string,
    { name: string; email: string; twoFactorEnabled: boolean | null; hasPasskey: boolean }
  >
> {
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
          hasPasskey: sql<boolean>`exists (
            select 1 from auth_passkeys where auth_passkeys.user_id = ${authUsers.id})`,
        })
        .from(authUsers)
        .where(inArray(authUsers.id, [...userIds])),
    asUser,
  )

  return new Map(rows.map((row) => [row.id, row]))
}

/** An invitation nobody has used, called back or let run out. The job that mails one asks the same. */
export function stillOpen() {
  return and(
    isNull(invitations.redeemedAt),
    isNull(invitations.revokedAt),
    sql`${invitations.expiresAt} > now()`,
  )
}

/** The membership this operation is about, or a plain refusal. */
async function membershipOf(
  access: Pick<AccessRules, 'sentences'>,
  tx: TenantTransaction,
  tenantId: TenantId,
  userId: string,
): Promise<{ roles: readonly string[]; blockedAt: Date | null }> {
  const [row] = await tx
    .select({ roles: memberships.roles, blockedAt: memberships.blockedAt })
    .from(memberships)
    .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId)))
    .limit(1)

  if (!row) {
    // Not in this tenant, or not on the instance at all. One answer for
    // both: telling them apart would turn this into a way of asking who has an
    // account here.
    throw new NotFoundException(access.sentences.notAMember)
  }

  return { roles: row.roles, blockedAt: row.blockedAt }
}

/**
 * Refuses when this person is the last one in a role that leads who can
 * still get in.
 *
 * Whoever is blocked does not count, and that is the part easiest to leave
 * out: a tenant with two people who lead it, one of them blocked, has one,
 * and letting that one go would leave it with none.
 *
 * Asked of the flag of the role and not of a right. Leading is what cannot
 * be taken out of a tenant, and a right is something a role can lose.
 *
 * The row this is asked about is usually the asking person's own. That is not
 * an oversight, it is where the case lives. Whoever leads administers who
 * works in the tenant, and where nobody else may, somebody working on another
 * person's row is by definition not working on the last one: there are two of
 * them, the one asking and the one being changed. The way a tenant really
 * locks itself out is the one who leads it deciding they do not need the role
 * any more, and an earlier draft of this file refused every operation on
 * one's own row and thereby made the only case that matters unreachable.
 * Working on one's own row is allowed and this is the fence.
 */
async function refuseIfLastLead(
  access: Pick<AccessRules, 'sentences'>,
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
        leadsItsTenant(),
      ),
    )

  if ((row?.others ?? 0) === 0) {
    throw new ConflictException(access.sentences.lastLead)
  }
}

/**
 * The roles a route was given, or a refusal naming the ones this tenant has.
 *
 * Held against the rows of the tenant and not against a list in the code: a
 * role is what the tenant has a row for, and a key without one would be a
 * membership that names nothing.
 */
function checkedRoles(
  known: readonly RoleDefinition[],
  wanted: readonly string[],
): readonly string[] {
  const keys = known.map((role) => role.key)
  const unknown = wanted.filter((role) => !keys.includes(role))

  if (unknown.length > 0) {
    throw new BadRequestException(
      `Unbekannte Rollen: ${unknown.join(', ')}. Es gibt ${keys.join(', ')}.`,
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
