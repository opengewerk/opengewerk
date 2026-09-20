import type { TenantId } from '@opengewerk/domain'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { Pool, type PoolClient } from 'pg'

/** What a caller gets inside a tenant transaction. */
export type TenantTransaction = NodePgDatabase

/**
 * Who is changing something, and why. The tenant is the part that decides
 * which rows are in reach; the other two end up in the audit log, on every
 * row the transaction touches, without anybody writing a line for it.
 *
 * Both are optional because there are callers without either: a setup routine
 * or a test has no user, and saying so honestly is better than inventing one.
 * The log then records the database role instead, which is enough to tell "the
 * application did this" from "somebody was at the database".
 *
 * `Identity` from the HTTP layer fits this shape as it is, which is the point:
 * passing the identity through is less work than not passing it.
 */
export interface Actor {
  readonly tenantId: TenantId
  readonly userId?: string
  /** What the change is for. The HTTP layer fills in the action it runs. */
  readonly reason?: string
  /**
   * Which device the change came from. Empty for anything that happened in
   * the office; a sync run fills it in from the operation, so that a record
   * says which phone was in a basement when it was written.
   */
  readonly deviceId?: string
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * The way to the data, and there is no second one.
 *
 * Every query about a business runs inside `forTenant`, which opens a
 * transaction and puts the tenant into `app.tenant_id` before anything else
 * happens. The policies in the database read exactly that setting. Nothing
 * here hands out the pool or a client, so there is no way to run such a query
 * beside this path: a forgotten `where` clause returns fewer rows than
 * expected, never rows of a stranger.
 *
 * Since 0009 there is a second path, `forInstance`, and it takes nothing away
 * from the first. It sets no tenant, and a policy that compares a row against
 * a tenant that was never set matches nothing, so the tables with a business
 * in them are simply empty inside it. What it reaches is the half of the
 * schema whose policy asks for the opposite: the accounts, which belong to the
 * instance and to no company. Signing in happens there, before anybody knows
 * which company is meant.
 *
 * The setting is local to the transaction. When the client goes back to the
 * pool it carries nothing with it, which is the part that matters most: a
 * connection that kept the last tenant would hand its rows to the next request
 * that happens to get it.
 */
export class Database {
  private constructor(private readonly pool: Pool) {}

  static connect(connectionString: string): Database {
    return new Database(new Pool({ connectionString }))
  }

  /**
   * Runs the work for one tenant. Commits when it returns, rolls back when it
   * throws.
   */
  async forTenant<Result>(
    actor: Actor,
    work: (tx: TenantTransaction) => Promise<Result>,
  ): Promise<Result> {
    const { tenantId, userId, reason, deviceId } = actor

    if (!uuidPattern.test(tenantId)) {
      // Refused before a connection is even taken. A caller that has no proper
      // tenant at hand has no business talking to the database, and failing
      // here says so plainly instead of returning an empty result that looks
      // like "this tenant has no data yet".
      throw new Error(`Not a tenant id: ${JSON.stringify(tenantId)}`)
    }

    const client: PoolClient = await this.pool.connect()

    try {
      await client.query('begin')
      // set_config with `is_local` true is SET LOCAL, and unlike SET LOCAL it
      // takes a parameter, so the value never gets pasted into the statement.
      //
      // The tenant is read by the policies, the other two by the trigger that
      // writes the audit log. All three in one statement, because three round
      // trips on every transaction would be three too many. An empty string
      // stands for "not given"; the trigger turns it back into nothing.
      await client.query(
        `select set_config('app.tenant_id', $1, true),
                set_config('app.user_id', $2, true),
                set_config('app.reason', $3, true),
                set_config('app.device_id', $4, true)`,
        [tenantId, userId ?? '', reason ?? '', deviceId ?? ''],
      )

      const result = await work(drizzle(client))

      await client.query('commit')

      return result
    } catch (error) {
      await client.query('rollback')
      throw error
    } finally {
      client.release()
    }
  }

  /**
   * Runs work that belongs to the instance rather than to a business: signing
   * in, the list of companies somebody may enter, the rate limit counters.
   *
   * This is the second way to the data and the only one, and it is worth being
   * plain about why it does not undo what `forTenant` promises. It sets no
   * tenant, so every policy that compares a row against `app.tenant_id`
   * compares it against nothing and matches nothing: inside here, `customers`
   * is empty however it is queried, and so is every other table that carries a
   * business. What is in reach is exactly the set of tables whose policy asks
   * for the opposite, the `auth_` ones, plus the caller's own memberships.
   *
   * So the two halves are disjoint by the same mechanism that keeps two
   * companies apart, not by a new promise somebody has to keep. There is a
   * test that puts a row on each side and looks from both.
   *
   * The user is passed for the same reason the tenant is passed to
   * `forTenant`: a policy reads it. Before somebody is identified there is
   * none, which is the honest state during a sign in, and the membership
   * policy then matches nothing.
   */
  async forInstance<Result>(
    work: (tx: TenantTransaction) => Promise<Result>,
    userId?: string,
  ): Promise<Result> {
    const client: PoolClient = await this.pool.connect()

    try {
      await client.query('begin')
      // The tenant is set to the empty string rather than left alone. A
      // connection comes back from the pool with nothing on it, so the two are
      // the same today; writing it down keeps them the same if that ever
      // changes.
      await client.query(
        `select set_config('app.tenant_id', '', true),
                set_config('app.user_id', $1, true),
                set_config('app.reason', $2, true)`,
        [userId ?? '', 'authentication'],
      )

      const result = await work(drizzle(client))

      await client.query('commit')

      return result
    } catch (error) {
      await client.query('rollback')
      throw error
    } finally {
      client.release()
    }
  }

  /**
   * The handle better-auth's adapter works through, and the one place that
   * gets a drizzle instance over the pool rather than over one transaction.
   *
   * The library decides for itself when to query and cannot be wrapped in a
   * transaction that somebody else opened. It does not need to be: a client
   * fresh from the pool carries no tenant, because `SET LOCAL` is undone at
   * commit, so every query made through here lands in the same state
   * `forInstance` sets up on purpose. The `auth_` tables are in reach, the
   * tables with a business in them are empty, and that holds by the policies
   * rather than by the library behaving itself.
   *
   * Nothing else may use this. It is named after its one caller for that
   * reason.
   */
  authenticationHandle(): TenantTransaction {
    return drizzle(this.pool)
  }

  /**
   * Whether the database answers at all. For the health check.
   *
   * `select 1` reads no table, so there is nothing for a policy to let
   * through. Handing out the pool or a client would be a hole, which is why
   * this returns a boolean and not a connection.
   */
  async isReachable(): Promise<boolean> {
    try {
      await this.pool.query('select 1')

      return true
    } catch {
      return false
    }
  }

  async close(): Promise<void> {
    await this.pool.end()
  }
}
