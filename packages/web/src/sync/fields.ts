import type { RecordState, SyncValue } from '@opengewerk/domain'

/**
 * Reading a field off a record that came over the wire.
 *
 * A record is flat and its values are whatever JSON carried, so every read is
 * a question with a wrong answer available. These four make the wrong answer
 * impossible to get by accident: a missing field reads as empty rather than as
 * `undefined` leaking into a template, and a number that arrived as text is
 * still a number here.
 *
 * Not a schema and not a validator. The shape is guaranteed by the server and
 * checked there; this is about the one step between a value and a screen.
 */

export function text(record: RecordState | null | undefined, field: string): string {
  const value = record?.[field]

  return typeof value === 'string' ? value : ''
}

/** Null rather than empty, for the places where "not set" is the point. */
export function maybeText(record: RecordState | null | undefined, field: string): string | null {
  const value = record?.[field]

  return typeof value === 'string' && value.length > 0 ? value : null
}

export function count(record: RecordState | null | undefined, field: string): number {
  const value = record?.[field]

  if (typeof value === 'number') {
    return value
  }

  // A bigint column can arrive as text depending on the driver, and a total
  // that silently reads as zero is worse than one that reads as wrong.
  const parsed = typeof value === 'string' ? Number(value) : Number.NaN

  return Number.isFinite(parsed) ? parsed : 0
}

export function flag(record: RecordState | null | undefined, field: string): boolean {
  return record?.[field] === true
}

/**
 * A value narrowed to one of a known set, falling back to the first.
 *
 * The lists come from `domain`, so a kind added there widens this without
 * anybody touching the screens, and a record carrying something no build knows
 * shows the fallback instead of an empty cell.
 */
export function oneOf<Value extends string>(
  record: RecordState | null | undefined,
  field: string,
  allowed: readonly Value[],
  fallback: Value,
): Value {
  const value = record?.[field]

  return allowed.includes(value as Value) ? (value as Value) : fallback
}

/** The value as the form gave it, for putting back into a patch. */
export function same(left: SyncValue | undefined, right: SyncValue | undefined): boolean {
  return Object.is(left ?? null, right ?? null)
}
