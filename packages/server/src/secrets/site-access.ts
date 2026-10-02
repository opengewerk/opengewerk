import type { SiteAccessId, TenantId } from '@opengewerk/domain'
import type { SecretKey, StoredSecret, TenantTransaction } from '@opengewerk/platform-server'

import { secretsOfBusinesses } from './store.js'

/**
 * The values of the ways into a site (#286), one sealed row of `secrets` each,
 * under the purpose `site_access` and the id of the access. The id goes into
 * the seal as well: a value copied to another access, business or purpose
 * does not open.
 */

function placeOf(tenantId: TenantId, accessId: SiteAccessId) {
  return { tenantId, purpose: 'site_access', recordId: accessId } as const
}

/** Seals a value and keeps it, in place of the one the access had. */
export async function keepAccessValue(
  tx: TenantTransaction,
  key: SecretKey,
  tenantId: TenantId,
  accessId: SiteAccessId,
  value: string,
): Promise<void> {
  await secretsOfBusinesses.keep(tx, key, placeOf(tenantId, accessId), value)
}

/** Reads and opens the value of one access. */
export function readAccessValue(
  tx: TenantTransaction,
  key: SecretKey,
  tenantId: TenantId,
  accessId: SiteAccessId,
): Promise<StoredSecret> {
  return secretsOfBusinesses.read(tx, key, placeOf(tenantId, accessId))
}

/** Reads and opens the values of several accesses at once, for the pull. */
export async function readAccessValues(
  tx: TenantTransaction,
  key: SecretKey,
  tenantId: TenantId,
  accessIds: readonly SiteAccessId[],
): Promise<ReadonlyMap<SiteAccessId, StoredSecret>> {
  const found = await secretsOfBusinesses.readOf(
    tx,
    key,
    { tenantId, purpose: 'site_access' },
    accessIds,
  )

  // The same map, read by the ids it was asked with.
  return found as ReadonlyMap<SiteAccessId, StoredSecret>
}

/** Forgets the value of an access that is deleted. */
export async function forgetAccessValue(
  tx: TenantTransaction,
  tenantId: TenantId,
  accessId: SiteAccessId,
): Promise<void> {
  await secretsOfBusinesses.forget(tx, placeOf(tenantId, accessId))
}
