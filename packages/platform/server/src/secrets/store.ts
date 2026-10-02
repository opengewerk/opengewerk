import type { TenantId } from '@opengewerk/platform-domain'
import { and, eq, inArray, isNull } from 'drizzle-orm'

import type { TenantTransaction } from '../database/database.js'
import type { SecretsTable } from '../database/schema/secrets.js'
import type { SecretKey } from './key.js'

/** What is known about one secret of one tenant. */
export type StoredSecret =
  | { readonly state: 'none' }
  /** There is one, and the key of this instance does not open it. */
  | { readonly state: 'unreadable' }
  | { readonly state: 'readable'; readonly value: string }

/**
 * Which secret is meant: the one a tenant has of a purpose, or the one of a
 * record, for a purpose with one secret per record.
 */
export interface SecretPlace<Purpose extends string = string> {
  readonly tenantId: TenantId
  readonly purpose: Purpose
  readonly recordId?: string
}

/**
 * What goes into the seal beside the value. Not stored with it, and named
 * again to open it: a sealed value copied to another tenant, another purpose
 * or another record opens nowhere.
 */
function contextOf(place: SecretPlace): string {
  const { tenantId, purpose, recordId } = place

  return recordId === undefined ? `${tenantId}:${purpose}` : `${tenantId}:${purpose}:${recordId}`
}

/** The sealed credentials of the tenants of one application, kept and opened. */
export interface SecretStore<Purpose extends string> {
  /** Seals a value and keeps it, in place of whatever was there for the same place. */
  keep(
    tx: TenantTransaction,
    key: SecretKey,
    place: SecretPlace<Purpose>,
    value: string,
  ): Promise<void>
  /** Reads and opens a secret. Nothing here ever hands out the sealed value itself. */
  read(tx: TenantTransaction, key: SecretKey, place: SecretPlace<Purpose>): Promise<StoredSecret>
  /**
   * Reads and opens the secrets of several records at once. A record that has
   * none is not in the answer.
   */
  readOf(
    tx: TenantTransaction,
    key: SecretKey,
    place: Pick<SecretPlace<Purpose>, 'tenantId' | 'purpose'>,
    recordIds: readonly string[],
  ): Promise<ReadonlyMap<string, StoredSecret>>
  /** Removes a secret, for something the tenant no longer uses. */
  forget(tx: TenantTransaction, place: SecretPlace<Purpose>): Promise<void>
}

/**
 * The store over the table an application made with `secretsSchema`.
 *
 * The one place the table is read and written. A route that read it itself
 * could hand the sealed value to a browser, and a job that wrote it itself
 * could store a value without the seal; `secretsTouchedOutside` of the kit
 * names either before it happens.
 */
export function secretStore<const Purpose extends string>(
  table: SecretsTable<Purpose>,
): SecretStore<Purpose> {
  // The statements are the same whatever the purposes are called. Written
  // once against the table with any purpose, which is what the database sees
  // as well: an enum, and a value of it.
  const secrets = table as unknown as SecretsTable

  const at = (place: SecretPlace) =>
    and(
      eq(secrets.tenantId, place.tenantId),
      eq(secrets.purpose, place.purpose),
      place.recordId === undefined
        ? isNull(secrets.recordId)
        : eq(secrets.recordId, place.recordId),
    )

  return {
    async keep(tx, key, place, value) {
      const sealed = key.seal(contextOf(place), value)

      await tx
        .insert(secrets)
        .values({
          tenantId: place.tenantId,
          purpose: place.purpose,
          recordId: place.recordId ?? null,
          sealed,
        })
        .onConflictDoUpdate({
          target: [secrets.tenantId, secrets.purpose, secrets.recordId],
          set: { sealed, updatedAt: new Date() },
        })
    },

    async read(tx, key, place) {
      const [row] = await tx.select({ sealed: secrets.sealed }).from(secrets).where(at(place))

      if (!row) {
        return { state: 'none' }
      }

      const value = key.unseal(contextOf(place), row.sealed)

      return value === null ? { state: 'unreadable' } : { state: 'readable', value }
    },

    async readOf(tx, key, place, recordIds) {
      const found = new Map<string, StoredSecret>()

      if (recordIds.length === 0) {
        return found
      }

      const rows = await tx
        .select({ recordId: secrets.recordId, sealed: secrets.sealed })
        .from(secrets)
        .where(
          and(
            eq(secrets.tenantId, place.tenantId),
            eq(secrets.purpose, place.purpose),
            inArray(secrets.recordId, [...recordIds]),
          ),
        )

      for (const row of rows) {
        if (row.recordId === null) {
          continue
        }

        const value = key.unseal(contextOf({ ...place, recordId: row.recordId }), row.sealed)

        found.set(
          row.recordId,
          value === null ? { state: 'unreadable' } : { state: 'readable', value },
        )
      }

      return found
    },

    async forget(tx, place) {
      await tx.delete(secrets).where(at(place))
    },
  }
}
