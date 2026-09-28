import type { SiteAccessId, TenantId } from '@opengewerk/domain'
import { and, eq, inArray } from 'drizzle-orm'

import type { TenantTransaction } from '../database/database.js'
import { secrets } from '../database/schema/index.js'
import type { SecretKey } from './key.js'
import type { StoredSecret } from './store.js'

/**
 * The values of the ways into a site (#286), one sealed row of `secrets` each,
 * under the purpose `site_access` and the id of the access. The id goes into
 * the seal as well: a value copied to another access, business or purpose
 * does not open.
 */

function contextOf(tenantId: TenantId, accessId: SiteAccessId): string {
  return `${tenantId}:site_access:${accessId}`
}

/** Seals a value and keeps it, in place of the one the access had. */
export async function keepAccessValue(
  tx: TenantTransaction,
  key: SecretKey,
  tenantId: TenantId,
  accessId: SiteAccessId,
  value: string,
): Promise<void> {
  const sealed = key.seal(contextOf(tenantId, accessId), value)

  await tx
    .insert(secrets)
    .values({ tenantId, purpose: 'site_access', recordId: accessId, sealed })
    .onConflictDoUpdate({
      target: [secrets.tenantId, secrets.purpose, secrets.recordId],
      set: { sealed, updatedAt: new Date() },
    })
}

/** Reads and opens the value of one access. */
export async function readAccessValue(
  tx: TenantTransaction,
  key: SecretKey,
  tenantId: TenantId,
  accessId: SiteAccessId,
): Promise<StoredSecret> {
  return (await readAccessValues(tx, key, tenantId, [accessId])).get(accessId) ?? { state: 'none' }
}

/** Reads and opens the values of several accesses at once, for the pull. */
export async function readAccessValues(
  tx: TenantTransaction,
  key: SecretKey,
  tenantId: TenantId,
  accessIds: readonly SiteAccessId[],
): Promise<ReadonlyMap<SiteAccessId, StoredSecret>> {
  const found = new Map<SiteAccessId, StoredSecret>()

  if (accessIds.length === 0) {
    return found
  }

  const rows = await tx
    .select({ recordId: secrets.recordId, sealed: secrets.sealed })
    .from(secrets)
    .where(
      and(
        eq(secrets.tenantId, tenantId),
        eq(secrets.purpose, 'site_access'),
        inArray(secrets.recordId, [...accessIds]),
      ),
    )

  for (const row of rows) {
    const accessId = row.recordId as SiteAccessId
    const value = key.unseal(contextOf(tenantId, accessId), row.sealed)

    found.set(accessId, value === null ? { state: 'unreadable' } : { state: 'readable', value })
  }

  return found
}

/** Forgets the value of an access that is deleted. */
export async function forgetAccessValue(
  tx: TenantTransaction,
  tenantId: TenantId,
  accessId: SiteAccessId,
): Promise<void> {
  await tx
    .delete(secrets)
    .where(
      and(
        eq(secrets.tenantId, tenantId),
        eq(secrets.purpose, 'site_access'),
        eq(secrets.recordId, accessId),
      ),
    )
}
