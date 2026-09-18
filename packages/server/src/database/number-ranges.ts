import {
  defaultPatterns,
  type DocumentKind,
  formatDocumentNumber,
  numberRangeOf,
  type TenantId,
} from '@opengewerk/domain'
import { and, eq, sql } from 'drizzle-orm'

import type { TenantTransaction } from './database.js'
import { numberRanges } from './schema/index.js'

/**
 * Hands out the next number for a kind of document, inside the transaction
 * that issues it.
 *
 * The counter sits in a row, not in a sequence, and the `update` takes a lock
 * on that row until the transaction ends. Two requests arriving together are
 * therefore served one after the other, and a request that fails afterwards
 * takes its number back with it, because the same rollback undoes both. That
 * is what keeps the sequence free of holes, and it is exactly what a sequence
 * cannot do: a sequence hands out its value outside the transaction and keeps
 * it when the transaction rolls back.
 *
 * The year comes from the moment of issuing, not from the document date. The
 * numbers then run in the order the documents were issued, which is the order
 * a tax audit walks them in.
 */
export async function assignDocumentNumber(
  tx: TenantTransaction,
  tenantId: TenantId,
  kind: DocumentKind,
  issuedAt: Date,
): Promise<string> {
  const key = numberRangeOf(kind)

  // The range is created on first use. Doing it when a tenant is created would
  // mean every new range needs a migration over existing tenants.
  await tx
    .insert(numberRanges)
    .values({ tenantId, key, pattern: defaultPatterns[key] })
    .onConflictDoNothing()

  const [range] = await tx
    .update(numberRanges)
    .set({ nextValue: sql`${numberRanges.nextValue} + 1`, updatedAt: new Date() })
    .where(and(eq(numberRanges.tenantId, tenantId), eq(numberRanges.key, key)))
    .returning()

  if (!range) {
    throw new Error(`No number range for ${key}`)
  }

  // `returning` gives the new value, so the one just handed out is one less.
  return formatDocumentNumber(range.pattern, {
    counter: range.nextValue - 1,
    year: issuedAt.getFullYear(),
  })
}
