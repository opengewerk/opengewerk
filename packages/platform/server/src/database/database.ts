import type { TenantId } from '@opengewerk/platform-domain'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { Pool, type PoolClient } from 'pg'

import { isUuid } from './identifier.js'

/** What a caller gets inside a tenant transaction. */
export type TenantTransaction = NodePgDatabase

/**
 * Undoes a transaction that failed, and keeps the error that says why it
 * failed: on a connection that is gone the rollback fails too, and its error
 * would take the place of the first. What it returns is the rollback's own
 * error, for `giveBack`, or nothing when the rollback went through.
 */
async function rollBack(client: PoolClient): Promise<Error | undefined> {
  try {
    await client.query('rollback')

    return undefined
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error))
  }
}

/**
 * What a caller gets from `forInstanceAndTenant`: one transaction, and the
 * step that moves it from the instance into a business.
 */
export interface StraddlingTransaction {
  readonly tx: TenantTransaction
  /**
   * Puts the rest of the transaction inside this business, as this person.
   *
   * The user comes along because before this step there is nothing to say: an
   * account is being created, so there is nobody to name yet. From here on
   * every row the transaction writes carries them in the audit log.
   */
  enter(tenantId: TenantId, userId: string): Promise<void>
}

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
  private constructor(
    private readonly pool: Pool,
    private readonly lostWhileOut: (error: Error) => void,
  ) {}

  /**
   * A connection can end while nobody is waiting on it: the database server
   * restarts, or `restore.sh` ends every connection of the application before
   * it puts a backup back. The pool reports that as an event, and an event
   * nobody listens to ends the process, in the middle of whatever else it was
   * answering (opengewerk-haustechnik#31). Nothing needs to be done about it
   * beyond saying so: the pool drops the connection and opens a new one the
   * next time it is asked for one.
   */
  static connect(
    connectionString: string,
    complain: (line: string, error: unknown) => void = console.error,
  ): Database {
    const pool = new Pool({ connectionString })

    pool.on('error', (error) => {
      complain(
        'Eine ruhende Verbindung zur Datenbank ist abgebrochen; die nächste Anfrage öffnet eine neue.',
        error,
      )
    })

    return new Database(pool, (error) => {
      complain(
        'Eine Verbindung zur Datenbank ist mitten in einer Transaktion abgebrochen; ' +
          'die Transaktion wird nicht gespeichert.',
        error,
      )
    })
  }

  /**
   * A client from the pool, listened to while it is out. The pool listens only
   * to the clients it holds, and a client it has handed out would report a lost
   * connection to nobody, which ends the process just the same. A client
   * reports one loss twice, the reason the server gave and then the end of the
   * socket, and is complained about once.
   *
   * `giveBack` returns it, unless the transaction on it could not be undone:
   * such a client may still be inside it, so the pool closes it instead of
   * handing it to the next request.
   */
  private async checkOut(): Promise<{
    client: PoolClient
    giveBack: (broken: Error | undefined) => void
  }> {
    const client = await this.pool.connect()
    let said = false
    const lost = (error: Error) => {
      if (!said) {
        said = true
        this.lostWhileOut(error)
      }
    }

    client.on('error', lost)

    return {
      client,
      giveBack: (broken) => {
        client.off('error', lost)
        client.release(broken)
      },
    }
  }

  /**
   * Runs the work for one tenant. Commits when it returns, rolls back when it
   * throws.
   */
  async forTenant<Result>(
    actor: Actor,
    work: (tx: TenantTransaction) => Promise<Result>,
  ): Promise<Result> {
    return this.inTenant(actor, work, 'begin')
  }

  /**
   * Reads one tenant as it stood at one moment, and writes nothing.
   *
   * In `forTenant` every statement sees what was committed when it began, so
   * two questions asked one after the other can be answered from two states
   * of the tenant, with somebody else's change between them. That is right
   * for nearly everything and wrong for a question whose answer is how two
   * readings fit together: the check of the audit chain counted the entries,
   * then read how many the head says there are, and a change written between
   * the two looked like an entry taken away (opengewerk-haustechnik#31). Here
   * the first statement fixes what all of them see.
   *
   * Read only, because a transaction that holds on to one moment and then
   * writes would be refused whenever somebody else wrote first, and nothing
   * that asks this way has anything to write.
   */
  async readingTenant<Result>(
    actor: Actor,
    work: (tx: TenantTransaction) => Promise<Result>,
  ): Promise<Result> {
    return this.inTenant(actor, work, 'begin isolation level repeatable read read only')
  }

  private async inTenant<Result>(
    actor: Actor,
    work: (tx: TenantTransaction) => Promise<Result>,
    begin: string,
  ): Promise<Result> {
    const { tenantId, userId, reason, deviceId } = actor

    if (!isUuid(tenantId)) {
      // Refused before a connection is even taken. A caller that has no proper
      // tenant at hand has no business talking to the database, and failing
      // here says so plainly instead of returning an empty result that looks
      // like "this tenant has no data yet".
      throw new Error(`Not a tenant id: ${JSON.stringify(tenantId)}`)
    }

    const { client, giveBack } = await this.checkOut()
    let broken: Error | undefined

    try {
      await client.query(begin)
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
      broken = await rollBack(client)
      throw error
    } finally {
      giveBack(broken)
    }
  }

  /**
   * Runs work that belongs to the instance rather than to a business: signing
   * in, the list of companies somebody may enter, the rate limit counters.
   *
   * This is the second way to the data and the only one, and it is worth being
   * plain about why it does not undo what `forTenant` promises. It sets no
   * tenant, so every policy that compares a row against `app.tenant_id`
   * compares it against nothing and matches nothing: inside here, a table that
   * carries a business is empty however it is queried, every one of them.
   * What is in reach is exactly the set of tables whose policy asks
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
    /**
     * What the change is for, for the log of the instance (#188). Signing in
     * and choosing a business are the ordinary case, hence the default.
     */
    reason = 'authentication',
  ): Promise<Result> {
    const { client, giveBack } = await this.checkOut()
    let broken: Error | undefined

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
        [userId ?? '', reason],
      )

      const result = await work(drizzle(client))

      await client.query('commit')

      return result
    } catch (error) {
      broken = await rollBack(client)
      throw error
    } finally {
      giveBack(broken)
    }
  }

  /**
   * The one transaction that begins outside any business and ends inside one.
   *
   * It exists because putting somebody to work in a business touches both of
   * the halves `forInstance` and `forTenant` keep apart: an account, which
   * lives on the instance, and a membership, which lives in the business. The
   * first run setup adds the business itself in the middle. Done in two
   * transactions, a failure between them would leave an account that belongs
   * nowhere, or a business nobody can sign in to, on the one installation that
   * has nobody to repair it.
   *
   * So the tenant is set in the middle rather than at the start, and `enter`
   * is the step that does it. Before it the `auth_` tables are in reach and
   * the business tables are empty; after it the other way round, by the same
   * policies as everywhere else. Nothing here widens what either half can see,
   * it only walks from one to the other once.
   *
   * Read committed is spelled out rather than left to the server's default,
   * because the first run setup depends on it: `create_first_tenant` takes a
   * lock and then asks whether the instance is still empty, and under a
   * stricter level that question would be answered from a snapshot taken
   * before the wait.
   *
   * `userId` is for a transaction whose person is known before it starts, a
   * signed in owner creating a further business (#142): the business then
   * carries its creator in the log of the instance too, not only in its own.
   * The first run setup has nobody yet and leaves it out.
   */
  async forInstanceAndTenant<Result>(
    reason: string,
    work: (straddling: StraddlingTransaction) => Promise<Result>,
    userId?: string,
  ): Promise<Result> {
    const { client, giveBack } = await this.checkOut()
    let broken: Error | undefined

    try {
      await client.query('begin isolation level read committed')
      await client.query(
        `select set_config('app.tenant_id', '', true),
                set_config('app.user_id', $2, true),
                set_config('app.reason', $1, true),
                set_config('app.device_id', '', true)`,
        [reason, userId ?? ''],
      )

      const result = await work({
        tx: drizzle(client),
        enter: async (tenantId: TenantId, userId: string) => {
          if (!isUuid(tenantId)) {
            // The same refusal as in `forTenant`, and for the same reason: a
            // caller without a proper business at hand would otherwise write
            // rows that no policy matches and read an empty result as "this
            // company has no data yet".
            throw new Error(`Not a tenant id: ${JSON.stringify(tenantId)}`)
          }

          await client.query(
            `select set_config('app.tenant_id', $1, true),
                    set_config('app.user_id', $2, true)`,
            [tenantId, userId],
          )
        },
      })

      await client.query('commit')

      return result
    } catch (error) {
      broken = await rollBack(client)
      throw error
    } finally {
      giveBack(broken)
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
