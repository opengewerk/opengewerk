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
 * merge that turns on equality cannot be built on that.
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
  // different.
  throw new Error(`Not a value a patch can carry: ${typeof value}`)
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
