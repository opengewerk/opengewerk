import type { TenantId } from '@opengewerk/domain'
import { sql } from 'drizzle-orm'

import type { Database } from './database.js'

/**
 * The businesses on this instance.
 *
 * The jobs that run in the background work for all of them and act for no
 * person, so they have no membership to find them through. `every_tenant()` is
 * the one question they may ask outside a business, and it answers with
 * identifiers only; every read after that goes through `forTenant` like any
 * other.
 */
export async function everyTenant(database: Database): Promise<readonly TenantId[]> {
  const result = await database.forInstance((tx) => tx.execute(sql`select every_tenant() as id`))

  return result.rows.map((row) => row['id'] as TenantId)
}
