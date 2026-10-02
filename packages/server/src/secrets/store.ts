import type { TenantId } from '@opengewerk/domain'
import {
  type SecretKey,
  secretStore,
  type StoredSecret,
  type TenantTransaction,
} from '@opengewerk/platform-server'

import { secrets } from '../database/schema/index.js'

/**
 * The sealed credentials of the businesses of this application. How they are
 * sealed, kept and opened is the foundation's (`secretStore`, ADR 0010); this
 * binds it to the table with the purposes of this application, and is the one
 * place outside the schema that names the table.
 */
export const secretsOfBusinesses = secretStore(secrets)

export type SecretPurpose = (typeof secrets.$inferSelect)['purpose']

/** Seals a value and keeps it, in place of whatever a business had for the same purpose. */
export async function keepSecret(
  tx: TenantTransaction,
  key: SecretKey,
  tenantId: TenantId,
  purpose: SecretPurpose,
  value: string,
): Promise<void> {
  await secretsOfBusinesses.keep(tx, key, { tenantId, purpose }, value)
}

/** Reads and opens the one secret a business has of a purpose. */
export function readSecret(
  tx: TenantTransaction,
  key: SecretKey,
  tenantId: TenantId,
  purpose: SecretPurpose,
): Promise<StoredSecret> {
  return secretsOfBusinesses.read(tx, key, { tenantId, purpose })
}

/** Removes a secret, for a login the business no longer uses. */
export async function forgetSecret(
  tx: TenantTransaction,
  tenantId: TenantId,
  purpose: SecretPurpose,
): Promise<void> {
  await secretsOfBusinesses.forget(tx, { tenantId, purpose })
}
