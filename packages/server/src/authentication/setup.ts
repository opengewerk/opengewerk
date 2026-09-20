import type { RoleKey, TenantId } from '@opengewerk/domain'
import { sql } from 'drizzle-orm'

import type { Database, StraddlingTransaction } from '../database/database.js'
import type { Authentication } from './authentication.js'
import { createAccount, grantMembership } from './staff.js'

/**
 * The first run of an instance: a business, the person who owns it, and the
 * membership between the two.
 *
 * This is the way in that a fresh installation has and did not have before.
 * Until #62 an instance started, migrated, answered its health check and
 * showed a sign in screen nobody could get past: the business had to be
 * inserted at a psql prompt, the account came from a command, and an owner was
 * then stopped at the next request for want of a second factor they had no
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
 * The roles the first account gets.
 *
 * The owner and nothing else, because the owner is the only role that can hand
 * out the others. ADR 0006 hangs the second factor on this role, so the first
 * thing the new account meets is the screen that sets one up; that is the
 * point of doing it here rather than leaving it to a command.
 */
const firstRoles: readonly RoleKey[] = ['owner']

/**
 * Whether this instance has never been used: no business and no account.
 *
 * Asked of the database rather than kept as a flag anywhere. A flag in the
 * environment is something an operator can set back, and the next visitor
 * would then create a second owner on a running installation. This cannot be
 * set back except by emptying the instance, which is the state it describes.
 *
 * The question goes through `instance_is_empty`, which runs as the owner of
 * the tables, because the application cannot answer it: outside any business
 * it sees the companies of its own memberships, and during a first run there
 * is no membership and nobody signed in, so it would find an empty table on an
 * instance full of companies.
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
 * The business comes first, and that order is not a preference. The refusal
 * for a second run is `create_first_tenant` asking whether the instance is
 * empty, and it asks from inside this transaction, where a row written a
 * moment ago is already visible. With the account created first, every first
 * run would refuse itself.
 *
 * After it, the account, still outside any business because that is where the
 * `auth_` tables are in reach, then the step into the new business and the
 * membership. `create_first_tenant` asks under a lock rather than after a
 * look, so two people opening the setup screen at the same moment end up with
 * one business between them and not two.
 *
 * What lands in the audit log is the business and the membership, both in that
 * business's own log with `instance.setup` as the reason. The membership
 * carries the new owner; the business does not, because at the moment it came
 * into being there was nobody on the instance to name, and inventing one would
 * be the first line of the log being untrue.
 *
 * The account itself is not in the log and cannot be: the log is per business
 * and an account belongs to the instance, which is the same reason the `auth_`
 * tables carry no audit trigger (ADR 0006). What a business sees of an account
 * is the membership, and that is there.
 */
export async function setUpInstance(
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
        throw new Error('create_first_tenant returned no business.')
      }

      const tenantId = created as TenantId
      const { userId } = await createAccount(context, tx, firstRun)

      await enter(tenantId, userId)
      await grantMembership(tx, { tenantId, userId, roles: firstRoles })

      return { tenantId, userId }
    },
  )
}
