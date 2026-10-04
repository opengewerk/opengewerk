import type { AuditChainReport, ChainVerification, TenantId } from '@opengewerk/platform-domain'
import { sql } from 'drizzle-orm'

import type { Database, TenantTransaction } from '../database/database.js'

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

/**
 * The check of the chain as a person reads it: the walk of the database
 * function, and on top what it cannot see, entries missing at the end. The
 * head of the chain says how many entries were written; fewer found means the
 * newest ones were taken away.
 *
 * The walk and the head are read as the tenant stood at one moment. A tenant
 * is at work while its chain is checked, and read one after the other in a
 * plain transaction, an entry written between the two was one the head
 * counted and the walk had not seen: the check reported a tampered log to a
 * tenant whose log was whole.
 */
export async function checkAuditChain(
  database: Database,
  identity: { readonly tenantId: TenantId; readonly userId: string },
  now: Date = new Date(),
): Promise<AuditChainReport> {
  return database.readingTenant(identity, async (tx) => {
    const verification = await verifyAuditChain(tx, identity.tenantId)
    let { brokenAt, problem } = verification

    if (brokenAt === null) {
      const head = await tx.execute(sql`
        select next_sequence, head_hash,
               (select hash from audit_entries
                 where tenant_id = ${identity.tenantId}::uuid
                 order by sequence desc limit 1) as last_hash
          from audit_chains
         where tenant_id = ${identity.tenantId}::uuid`)
      const row = head.rows[0] as
        | { next_sequence: string | number; head_hash: string | null; last_hash: string | null }
        | undefined

      if (row) {
        const written = Number(row.next_sequence) - 1

        if (written > verification.checked) {
          brokenAt = verification.checked + 1
          problem =
            written - verification.checked === 1
              ? 'Der letzte Eintrag fehlt.'
              : `Die letzten ${String(written - verification.checked)} Einträge fehlen.`
        } else if (row.head_hash !== row.last_hash) {
          brokenAt = verification.checked
          problem = 'Der letzte Eintrag passt nicht zum Stand der Kette.'
        }
      }
    }

    let brokenAtTime: string | null = null

    if (brokenAt !== null) {
      const at = await tx.execute(sql`
        select changed_at from audit_entries
         where tenant_id = ${identity.tenantId}::uuid and sequence >= ${brokenAt}
         order by sequence limit 1`)
      const found = (at.rows[0] as { changed_at: string } | undefined)?.changed_at

      brokenAtTime = found ? new Date(found).toISOString() : null
    }

    return {
      checked: verification.checked,
      brokenAt,
      problem,
      brokenAtTime,
      checkedAt: now.toISOString(),
    }
  })
}
