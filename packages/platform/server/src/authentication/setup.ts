import type { TenantId } from '@opengewerk/platform-domain'
import { sql } from 'drizzle-orm'

import type { Database, StraddlingTransaction } from '../database/database.js'
import { instanceOperators } from '../schema.js'
import type { AccessRules } from './access.js'
import type { Authentication } from './authentication.js'
import { firstRoleOf, writeRoles } from './roles.js'
import { createAccount, grantMembership } from './staff.js'

/**
 * The first run of an instance: a tenant with the roles it starts with, the
 * person who leads it, and the membership between the two.
 *
 * This is the way in that a fresh installation has and did not have before.
 * Until #62 an instance started, migrated, answered its health check and
 * showed a sign in screen nobody could get past: the tenant had to be
 * inserted at a psql prompt, the account came from a command, and its leader
 * was then stopped at the next request for want of a second factor they had no
 * screen to set up. Two of those three steps were not meant to be done by
 * hand, and the third was a dead end.
 */
export interface FirstRun {
  readonly company: string
  readonly name: string
  readonly email: string
  readonly password: string
}

/** What the first run leaves behind. */
export interface FirstRunResult {
  readonly tenantId: TenantId
  readonly userId: string
}

/**
 * Whether this instance has never been used: no tenant and no account.
 *
 * Asked of the database rather than kept as a flag anywhere. A flag in the
 * environment is something an operator can set back, and the next visitor
 * would then set up a running installation a second time. This cannot be
 * set back except by emptying the instance, which is the state it describes.
 *
 * The question goes through `instance_is_empty`, which runs as the owner of
 * the tables, because the application cannot answer it: outside any tenant
 * it sees the tenants of its own memberships, and during a first run there
 * is no membership and nobody signed in, so it would find an empty table on an
 * instance full of tenants.
 */
export async function instanceIsEmpty(database: Database): Promise<boolean> {
  return database.forInstance(async (tx) => {
    const result = await tx.execute(sql`select instance_is_empty() as empty`)
    const row = result.rows[0] as { empty: boolean } | undefined

    return row?.empty === true
  })
}

/**
 * Sets an empty instance up, in one transaction.
 *
 * The tenant comes first, and that order is not a preference. The refusal
 * for a second run is `create_first_tenant` asking whether the instance is
 * empty, and it asks from inside this transaction, where a row written a
 * moment ago is already visible. With the account created first, every first
 * run would refuse itself.
 *
 * After it, the account, still outside any tenant because that is where the
 * `auth_` tables are in reach, then the step into the new tenant and the
 * membership. `create_first_tenant` asks under a lock rather than after a
 * look, so two people opening the setup screen at the same moment end up with
 * one tenant between them and not two.
 *
 * What lands in the audit log is the tenant and the membership, both in that
 * tenant's own log with `instance.setup` as the reason. The membership
 * carries the new account; the tenant does not, because at the moment it came
 * into being there was nobody on the instance to name, and inventing one would
 * be the first line of the log being untrue.
 *
 * The account itself is not in the log and cannot be: the log is per tenant
 * and an account belongs to the instance, which is the same reason the `auth_`
 * tables carry no audit trigger (ADR 0006). What a tenant sees of an account
 * is the membership, and that is there.
 */
export async function setUpInstance(
  access: Pick<AccessRules, 'shippedRoles'>,
  authentication: Authentication,
  database: Database,
  firstRun: FirstRun,
): Promise<FirstRunResult> {
  const context = await authentication.$context

  return database.forInstanceAndTenant(
    'instance.setup',
    async ({ tx, enter }: StraddlingTransaction) => {
      const result = await tx.execute(
        sql`select create_first_tenant(${firstRun.company}) as tenant_id`,
      )
      const created = (result.rows[0] as { tenant_id: string } | undefined)?.tenant_id

      if (!created) {
        // The function either returns an id or raises. Reaching here would
        // mean it was replaced by something that does neither, and carrying on
        // would write a membership pointing at nothing.
        throw new Error('create_first_tenant returned no tenant.')
      }

      const tenantId = created as TenantId
      const { userId } = await createAccount(context, tx, firstRun)

      // Whoever sets an instance up also runs it (#188). Still outside any
      // tenant, where that table is in reach, and before the step in, so that
      // it is there together with the account or not at all.
      await tx.insert(instanceOperators).values({ userId })

      // Inside the new tenant: the roles it starts with, as rows of its own,
      // and then the role that leads and nothing else, because it is the role
      // that hands out the others. That it brings the second factor with it
      // is the point of doing this here rather than leaving it to a command:
      // the first thing the new account meets is the screen that sets one up.
      await enter(tenantId, userId)
      await writeRoles(tx, tenantId, access.shippedRoles)
      await grantMembership(tx, { tenantId, userId, roles: [firstRoleOf(access).key] })

      return { tenantId, userId }
    },
  )
}
