import { createHash } from 'node:crypto'

import { type SQL, sql } from 'drizzle-orm'

/**
 * A short fingerprint of a set of ids, for the value the answer of a pull
 * names for an entity it narrowed (ADR 0010).
 *
 * The same set gives the same value in whatever order it comes, so that a
 * device that asks twice finds the value it kept and keeps its rows; a set
 * with one id more or less gives another, and the device drops what it holds
 * of that entity and asks from the start. Sixteen hex digits of a SHA-256:
 * not a secret and not a proof, only a value that changes when the set does.
 */
export function fingerprintOf(ids: readonly string[]): string {
  return createHash('sha256')
    .update([...ids].sort().join(','))
    .digest('hex')
    .slice(0, 16)
}

/** A list of ids as one parameter of a condition, an empty one included. */
export function idArray(ids: readonly string[]): SQL {
  return sql`array[${sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  )}]::uuid[]`
}
