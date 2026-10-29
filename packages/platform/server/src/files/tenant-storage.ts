import type { TenantId } from '@opengewerk/platform-domain'
import { eq, sql } from 'drizzle-orm'

import type { Database } from '../database/database.js'
import type { InstanceSettingsCache } from '../instance/settings.js'
import { files } from '../schema.js'

/**
 * What a tenant keeps in the file store and what it may keep (B9 of the
 * security audit).
 *
 * The store is one volume for every tenant on the instance, and the hourly
 * windows of `UploadLimits` bound how fast it fills, not how full. The free
 * space it keeps back for the database, the prints and the backup was the
 * only bound on what is kept, and the first tenant to reach it refused every
 * other one. So whoever runs the instance can give each tenant a budget, in
 * its settings, and a tenant at its budget is refused alone. No budget is
 * set until somebody sets one (Moritz, 29.10.2026): an instance with one
 * tenant notices nothing.
 *
 * What a tenant keeps is the sum of its files, every version of every one,
 * since a file is never deleted. Bytes two tenants share on the volume count
 * for each: each could have them alone.
 */
export interface TenantStorage {
  /** The most one tenant may keep, in bytes, or null for no limit. */
  budget(): number | null
  /** What the tenant keeps now, in bytes. */
  stored(tenantId: TenantId): Promise<number>
}

/** What a tenant keeps in the store, in bytes. `asUser` is whoever asks, for the database. */
export async function storedBytes(
  database: Database,
  tenantId: TenantId,
  asUser?: string,
): Promise<number> {
  const [row] = await database.forTenant(
    { tenantId, ...(asUser === undefined ? {} : { userId: asUser }) },
    (tx) =>
      tx
        .select({ bytes: sql<string>`coalesce(sum(${files.sizeBytes}), 0)` })
        .from(files)
        .where(eq(files.tenantId, tenantId)),
  )

  return Number(row?.bytes ?? 0)
}

/** The budget from the settings of the instance, and what a tenant keeps from its files. */
export function tenantStorage(
  database: Database,
  settings: InstanceSettingsCache | null,
): TenantStorage {
  return {
    budget: () => settings?.current().tenantStorageBytes ?? null,
    stored: (tenantId) => storedBytes(database, tenantId),
  }
}
