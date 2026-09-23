import {
  defaultPatterns,
  type DocumentKind,
  formatDocumentNumber,
  type NumberRangeKey,
  numberRangeKeys,
  numberRangeOf,
  patternProblem,
  type TenantId,
} from '@opengewerk/domain'
import { and, eq, sql } from 'drizzle-orm'

import { yearInGermany } from '../today.js'
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
    year: yearInGermany(issuedAt),
  })
}

/** One sequence as the settings show it. */
export interface NumberRangeView {
  readonly key: NumberRangeKey
  readonly pattern: string
  /** The counter the next document gets. */
  readonly nextValue: number
  /** What the next document would be called, issued now. */
  readonly next: string
}

function viewOf(key: NumberRangeKey, pattern: string, nextValue: number, now: Date) {
  return {
    key,
    pattern,
    nextValue,
    next: formatDocumentNumber(pattern, { counter: nextValue, year: yearInGermany(now) }),
  }
}

/**
 * Every sequence of a business, the ones nothing has drawn from yet included:
 * a range is created on first use, and until then its pattern is the default.
 */
export async function numberRangesOf(
  tx: TenantTransaction,
  tenantId: TenantId,
  now: Date = new Date(),
): Promise<NumberRangeView[]> {
  const rows = await tx.select().from(numberRanges).where(eq(numberRanges.tenantId, tenantId))
  const byKey = new Map(rows.map((row) => [row.key, row]))

  return numberRangeKeys.map((key) => {
    const row = byKey.get(key)

    return viewOf(key, row?.pattern ?? defaultPatterns[key], row?.nextValue ?? 1, now)
  })
}

/** A change to a sequence that is not made, with the sentence saying why. */
export class NumberRangeRefused extends Error {}

/**
 * Changes the pattern of a sequence, and moves its counter on when asked.
 *
 * The new pattern applies from the next document; numbers already handed out
 * stay what they are, and the audit log keeps the old pattern. The counter
 * only ever moves forward. A business that comes from another program
 * continues its sequence by setting the next number, and a number lower than
 * the next one would hand out again what a document already carries.
 *
 * The row is locked for the change, like it is for issuing. A document issued
 * at the same moment waits, or the change does, and neither sees half of the
 * other.
 */
export async function changeNumberRange(
  tx: TenantTransaction,
  tenantId: TenantId,
  key: NumberRangeKey,
  wanted: { readonly pattern: string; readonly nextValue?: number },
  now: Date = new Date(),
): Promise<NumberRangeView> {
  const problem = patternProblem(wanted.pattern)

  if (problem !== null) {
    throw new NumberRangeRefused(problem)
  }

  await tx
    .insert(numberRanges)
    .values({ tenantId, key, pattern: defaultPatterns[key] })
    .onConflictDoNothing()

  const [current] = await tx
    .select()
    .from(numberRanges)
    .where(and(eq(numberRanges.tenantId, tenantId), eq(numberRanges.key, key)))
    .for('update')

  if (!current) {
    throw new Error(`No number range for ${key}`)
  }

  const nextValue = wanted.nextValue ?? current.nextValue

  if (!Number.isInteger(nextValue) || nextValue < 1 || nextValue > 999_999_999) {
    throw new NumberRangeRefused('Die nächste Nummer ist eine ganze Zahl ab 1.')
  }

  if (nextValue < current.nextValue) {
    throw new NumberRangeRefused(
      `Die nächste Nummer kann nur steigen. Bis ${String(current.nextValue - 1)} ist schon ` +
        'vergeben, darunter käme eine Nummer ein zweites Mal vor.',
    )
  }

  const [row] = await tx
    .update(numberRanges)
    .set({ pattern: wanted.pattern, nextValue, updatedAt: new Date() })
    .where(and(eq(numberRanges.tenantId, tenantId), eq(numberRanges.key, key)))
    .returning()

  if (!row) {
    throw new Error(`No number range for ${key}`)
  }

  return viewOf(key, row.pattern, row.nextValue, now)
}
