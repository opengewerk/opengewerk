import type { TenantId } from '@opengewerk/domain'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { Pool, type PoolClient } from 'pg'

/** What a caller gets inside a tenant transaction. */
export type TenantTransaction = NodePgDatabase

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * The way to the data, and there is no second one.
 *
 * Every query runs inside `forTenant`, which opens a transaction and puts the
 * tenant into `app.tenant_id` before anything else happens. The policies in
 * the database read exactly that setting. Nothing here hands out the pool or a
 * client, so there is no way to run a query beside this path: a forgotten
 * `where` clause returns fewer rows than expected, never rows of a stranger.
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
    tenantId: TenantId,
    work: (tx: TenantTransaction) => Promise<Result>,
  ): Promise<Result> {
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
      await client.query('select set_config($1, $2, true)', ['app.tenant_id', tenantId])

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

  async close(): Promise<void> {
    await this.pool.end()
  }
}
