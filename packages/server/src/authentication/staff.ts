import type { RoleKey, TenantId } from '@opengewerk/domain'
import { eq } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'

import type { Database, StraddlingTransaction, TenantTransaction } from '../database/database.js'
import { authAccounts, authUsers, memberships } from '../database/schema/index.js'
import type { Authentication } from './authentication.js'

/** What better-auth hands out once it has read its own configuration. */
export type AuthenticationContext = Awaited<Authentication['$context']>

export interface StaffMember {
  readonly email: string
  readonly name: string
  readonly password: string
  readonly tenantId: TenantId
  readonly roles: readonly RoleKey[]
}

/**
 * An account on the instance, with a password against it.
 *
 * Runs outside any business, which is where the `auth_` tables are in reach at
 * all, and returns an existing account unchanged: the same person can be the
 * owner of one company and the bookkeeper of another, and a second account for
 * the second company would be a second password to forget.
 *
 * The rows are written here rather than through better-auth's own adapter, and
 * that is the one thing worth saying out loud. The adapter works on a handle
 * of its own and cannot be put inside a transaction somebody else opened, so
 * going through it would mean the account, the business and the membership are
 * three commits with two gaps between them. What it does for our configuration
 * is an insert and nothing else: there are no database hooks, and signing up
 * is switched off, so no validation runs either.
 *
 * The password is hashed by better-auth's configured hasher, which is the part
 * that must not be reimplemented. One hasher, not two that could drift apart,
 * and a drift there is only noticed when nobody can sign in.
 */
export async function createAccount(
  context: AuthenticationContext,
  tx: TenantTransaction,
  person: { readonly email: string; readonly name: string; readonly password: string },
): Promise<{ readonly userId: string; readonly created: boolean }> {
  const email = person.email.trim().toLowerCase()

  const [existing] = await tx
    .select({ id: authUsers.id })
    .from(authUsers)
    .where(eq(authUsers.email, email))
    .limit(1)

  if (existing) {
    return { userId: existing.id, created: false }
  }

  // better-auth mints its own ids for the rows it writes and they are not
  // UUIDv7. These are ours, so they are, which costs nothing and keeps the
  // table sorted by when people joined.
  const userId = uuidv7()

  await tx.insert(authUsers).values({ id: userId, email, name: person.name })
  await tx.insert(authAccounts).values({
    id: uuidv7(),
    userId,
    // What better-auth calls the account of a password, as opposed to one that
    // came from a provider.
    providerId: 'credential',
    accountId: userId,
    password: await context.password.hash(person.password),
  })

  return { userId, created: true }
}

/**
 * What somebody may do in one business.
 *
 * Runs inside that business, so the insert lands in its audit log with the
 * user and the reason the caller set. That is where ADR 0006 gets its "a
 * change of rights is in the log" from, without a line written for the
 * purpose.
 */
export async function grantMembership(
  tx: TenantTransaction,
  grant: {
    readonly tenantId: TenantId
    readonly userId: string
    readonly roles: readonly RoleKey[]
  },
): Promise<void> {
  await tx
    .insert(memberships)
    .values({ tenantId: grant.tenantId, userId: grant.userId, roles: grant.roles })
    .onConflictDoUpdate({
      target: [memberships.tenantId, memberships.userId],
      set: { roles: grant.roles, updatedAt: new Date() },
    })
}

/**
 * Puts a person into a business and gives them a way in.
 *
 * Signing up is switched off (`disableSignUp`), so an account only ever comes
 * into being through here or through the first run setup, which uses the same
 * two steps inside its own transaction. That is the point: an instance where a
 * stranger can create an account has handed out a foothold before anybody has
 * done anything wrong.
 *
 * Both steps happen or neither. A user without a membership can sign in and
 * reach nothing, which is a confusing half state to leave somebody in; a
 * membership without a user cannot exist, the foreign key sees to that. One
 * transaction is what makes the first half true as well, and it is the reason
 * this walks from the instance into the business rather than opening two.
 *
 * `created` says whether the account came into being here or was already on
 * the instance. It matters to the caller: an account that was already there
 * keeps the password it had, so a command that printed the password it brought
 * along would be naming one that does not work.
 */
export async function addStaffMember(
  authentication: Authentication,
  database: Database,
  member: StaffMember,
): Promise<{ userId: string; created: boolean }> {
  const context = await authentication.$context

  return database.forInstanceAndTenant(
    'membership.create',
    async ({ tx, enter }: StraddlingTransaction) => {
      const { userId, created } = await createAccount(context, tx, member)

      await enter(member.tenantId, userId)
      await grantMembership(tx, { tenantId: member.tenantId, userId, roles: member.roles })

      return { userId, created }
    },
  )
}
