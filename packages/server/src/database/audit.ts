import type { ChainVerification, TenantId } from '@opengewerk/domain'
import { sql } from 'drizzle-orm'

import type { TenantTransaction } from './database.js'

/**
 * Walks a tenant's chain and says whether it still fits together.
 *
 * The work happens in the database, deliberately. Recomputing the hashes here
 * would mean a second definition of what exactly is hashed, in a second
 * language, and the two would drift apart on the first column anybody adds.
 * There is one definition, `audit_fingerprint`, and both the writing trigger
 * and this check go through it.
 *
 * What a break means: somebody reached past the application and past the
 * trigger that keeps the log append only, which takes the rights of a
 * superuser. What a sound chain means is narrower than it looks. An attacker
 * with those rights can rewrite every entry from the changed one onwards and
 * the chain will fit again. The chain makes a small correction impossible to
 * hide and a large one expensive; it becomes a real proof only against a hash
 * kept somewhere else, in a backup for instance, because that one pins
 * everything written before it.
 */
export async function verifyAuditChain(
  tx: TenantTransaction,
  tenantId: TenantId,
): Promise<ChainVerification> {
  const result = await tx.execute(sql`select * from verify_audit_chain(${tenantId}::uuid)`)
  const row = result.rows[0] as
    | { checked: string | number; broken_at: string | number | null; problem: string | null }
    | undefined

  if (!row) {
    throw new Error(`The chain check returned nothing for tenant ${tenantId}`)
  }

  // A bigint arrives as a string, because it does not always fit into a
  // JavaScript number. These two do, a count of entries and a position in it.
  return {
    checked: Number(row.checked),
    brokenAt: row.broken_at === null ? null : Number(row.broken_at),
    problem: row.problem,
  }
}
