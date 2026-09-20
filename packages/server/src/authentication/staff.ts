import type { RoleKey, TenantId } from '@opengewerk/domain'
import { eq } from 'drizzle-orm'

import type { Database } from '../database/database.js'
import { authUsers, memberships } from '../database/schema/index.js'
import type { Authentication } from './authentication.js'

export interface StaffMember {
  readonly email: string
  readonly name: string
  readonly password: string
  readonly tenantId: TenantId
  readonly roles: readonly RoleKey[]
}

/**
 * Puts a person into a business and gives them a way in.
 *
 * Signing up is switched off (`disableSignUp`), so an account only ever comes
 * into being through here. That is the point: an instance where a stranger can
 * create an account has handed out a foothold before anybody has done anything
 * wrong.
 *
 * Three steps, and all three have to happen or none: the user on the instance,
 * the password against it, the membership in the business. A user without a
 * membership can sign in and reach nothing, which is a confusing half state to
 * leave somebody in; a membership without a user cannot exist, the foreign key
 * sees to that.
 *
 * The password is hashed by better-auth's own configured hasher rather than by
 * a call to argon2 here. One hasher, not two that could drift apart, which is
 * the sort of drift that is only noticed when nobody can sign in.
 */
export async function addStaffMember(
  authentication: Authentication,
  database: Database,
  member: StaffMember,
): Promise<{ userId: string }> {
  const context = await authentication.$context
  const email = member.email.trim().toLowerCase()

  const existing = await database.forInstance(async (tx) => {
    const [row] = await tx
      .select({ id: authUsers.id })
      .from(authUsers)
      .where(eq(authUsers.email, email))
      .limit(1)

    return row
  })

  const userId =
    existing?.id ??
    (
      await context.internalAdapter.createUser(
        { email, name: member.name, emailVerified: false },
        // How this account came about, which better-auth passes on to its own
        // checks. A password account, because that is what is created below.
        { method: 'email-password' },
      )
    ).id

  if (!existing) {
    await context.internalAdapter.createAccount({
      userId,
      // What better-auth calls the account of a password, as opposed to one
      // that came from a provider.
      providerId: 'credential',
      accountId: userId,
      password: await context.password.hash(member.password),
    })
  }

  // Inside the business, so the new membership lands in its audit log. The
  // reason is spelled out rather than taken from a route, because there is no
  // route here: this runs from a command.
  await database.forTenant(
    { tenantId: member.tenantId, userId, reason: 'membership.create' },
    (tx) =>
      tx
        .insert(memberships)
        .values({ tenantId: member.tenantId, userId, roles: member.roles })
        .onConflictDoUpdate({
          target: [memberships.tenantId, memberships.userId],
          set: { roles: member.roles, updatedAt: new Date() },
        }),
  )

  return { userId }
}
