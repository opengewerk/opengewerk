import type { TenantId } from '@opengewerk/domain'
import { and, eq } from 'drizzle-orm'

import type { TenantTransaction } from '../database/database.js'
import { secrets } from '../database/schema/index.js'
import type { SecretKey } from './key.js'

export type SecretPurpose = (typeof secrets.$inferSelect)['purpose']

/** What is known about one secret of one business. */
export type StoredSecret =
  | { readonly state: 'none' }
  /** There is one, and the key of this instance does not open it. */
  | { readonly state: 'unreadable' }
  | { readonly state: 'readable'; readonly value: string }

function contextOf(tenantId: TenantId, purpose: SecretPurpose): string {
  return `${tenantId}:${purpose}`
}

/** Seals a value and keeps it, in place of whatever was there for the same purpose. */
export async function keepSecret(
  tx: TenantTransaction,
  key: SecretKey,
  tenantId: TenantId,
  purpose: SecretPurpose,
  value: string,
): Promise<void> {
  const sealed = key.seal(contextOf(tenantId, purpose), value)

  await tx
    .insert(secrets)
    .values({ tenantId, purpose, sealed })
    .onConflictDoUpdate({
      target: [secrets.tenantId, secrets.purpose],
      set: { sealed, updatedAt: new Date() },
    })
}

/** Reads and opens a secret. Nothing here ever hands out the sealed value itself. */
export async function readSecret(
  tx: TenantTransaction,
  key: SecretKey,
  tenantId: TenantId,
  purpose: SecretPurpose,
): Promise<StoredSecret> {
  const [row] = await tx
    .select({ sealed: secrets.sealed })
    .from(secrets)
    .where(and(eq(secrets.tenantId, tenantId), eq(secrets.purpose, purpose)))

  if (!row) {
    return { state: 'none' }
  }

  const value = key.unseal(contextOf(tenantId, purpose), row.sealed)

  return value === null ? { state: 'unreadable' } : { state: 'readable', value }
}

/** Removes a secret, for a login the business no longer uses. */
export async function forgetSecret(
  tx: TenantTransaction,
  tenantId: TenantId,
  purpose: SecretPurpose,
): Promise<void> {
  await tx.delete(secrets).where(and(eq(secrets.tenantId, tenantId), eq(secrets.purpose, purpose)))
}
