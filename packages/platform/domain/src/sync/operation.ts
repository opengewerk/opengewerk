import type { Id } from '../model/identifier.js'

/** One write a device made, waiting in its outbox. */
export type OperationId = Id<'operation'>

/** Which device it came from. Shown next to a conflict, so a person knows. */
export type DeviceId = string

export const operationKinds = ['create', 'update', 'delete'] as const

export type OperationKind = (typeof operationKinds)[number]

/**
 * A value on its way between device and server.
 *
 * Only what survives JSON unchanged. A date travels as its ISO form, which is
 * what `toSyncValue` makes of it, so that both sides compare the same thing:
 * two `Date` objects for the same moment are not equal to each other, and a
 * merge that turns on equality cannot be built on that. A value of JSON or a
 * list travels as its text, for the same reason (`jsonText`).
 */
export type SyncValue = string | number | boolean | null

export function toSyncValue(value: unknown): SyncValue {
  if (value === null || value === undefined) {
    return null
  }

  if (value instanceof Date) {
    return value.toISOString()
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value
  }

  // Anything else has no place in a patch. Saying so here beats comparing two
  // objects by identity somewhere further down and always finding them
  // different. A value of JSON or a list is sent as its text (`jsonText`).
  throw new Error(`Not a value a patch can carry: ${typeof value}`)
}

/**
 * The text a value of JSON or a list travels as, for a column that holds one:
 * JSON without spaces, the keys of every object sorted, whatever the order
 * they were written in. (Keys that are whole numbers come first, in their
 * numeric order: an object of JavaScript keeps them so, and it is the same for
 * every object with those keys.)
 *
 * One text for one value, written the same way on both ends. The server sends
 * such a column in this text, a device keeps it and builds the `from` of its
 * next patch out of it, and a form that writes the field writes it with this
 * function: so that a value nobody touched is the same text again, and a patch
 * for it is not sent at all. PostgreSQL keeps the keys of `jsonb` in an order
 * of its own and a form in the order they were written; the order fixed here
 * is the one both get.
 *
 * The server reads every text a patch brings for such a column and writes it
 * in this form before it compares, so a text written differently is not a
 * change, and one that is no JSON refuses the transmission.
 */
export function jsonText(value: unknown): string {
  const text = JSON.stringify(value, (_key, inner: unknown) =>
    inner !== null && typeof inner === 'object' && !Array.isArray(inner)
      ? Object.fromEntries(
          Object.entries(inner).sort(([left], [right]) =>
            left < right ? -1 : left > right ? 1 : 0,
          ),
        )
      : inner,
  ) as string | undefined

  if (text === undefined) {
    throw new Error(`Not a value of JSON: ${typeof value}`)
  }

  return text
}

export function sameValue(left: unknown, right: unknown): boolean {
  return Object.is(toSyncValue(left), toSyncValue(right))
}

/**
 * One field, with what the device saw in it and what it wants there.
 *
 * `from` is the part that does the work. It lets the server answer the only
 * question that matters for a merge, namely whether anybody else has touched
 * this field in the meantime, without either side keeping a clock on every
 * field. It is the same shape the audit log writes, and that is not a
 * coincidence: a change is a field, a before and an after.
 */
export interface FieldPatch {
  readonly field: string
  readonly from: SyncValue
  readonly to: SyncValue
}

/**
 * A write from a device, as it leaves the outbox.
 *
 * The id is minted on the device, before there is any network, which is what
 * makes the whole thing work offline and what makes a repeat harmless: the
 * server has seen that id or it has not.
 */
export interface Operation {
  readonly id: OperationId
  readonly entity: string
  readonly recordId: string
  readonly kind: OperationKind
  /**
   * The row version the device had in front of it, empty when it is creating
   * the record. Only a shortcut: when it still matches, nothing has happened
   * since and the fields need not be compared one by one.
   */
  readonly baseVersion: number | null
  readonly patches: readonly FieldPatch[]
  /** When the device recorded it, not when it arrived. */
  readonly recordedAt: Date
  readonly deviceId: DeviceId
}

/**
 * The order the outbox hands operations over in.
 *
 * By the moment of recording, and by id where two fall in the same
 * millisecond. The tie breaker is not cosmetic: two operations on the same
 * record in the wrong order turn a correct sequence of edits into a wrong
 * final state, and `Array.prototype.sort` is only stable within one array, not
 * across two transmissions of the same queue.
 */
export function inOutboxOrder(operations: readonly Operation[]): readonly Operation[] {
  return [...operations].sort((left, right) => {
    const byTime = left.recordedAt.getTime() - right.recordedAt.getTime()

    return byTime !== 0 ? byTime : left.id.localeCompare(right.id)
  })
}
