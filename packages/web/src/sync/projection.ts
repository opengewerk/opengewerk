import type { Operation, RecordState } from '@opengewerk/domain'
import { inOutboxOrder } from '@opengewerk/domain'

/** The key a record has in the outbox index. */
export function recordKey(entity: string, id: string): string {
  return `${entity}::${id}`
}

/**
 * What the device shows: the last word from the server with everything still
 * in the outbox laid over it.
 *
 * The two are kept apart on purpose. The obvious alternative is to write a
 * change straight into the local copy and queue it as well, and it falls over
 * on the one case the whole layer exists for. When the server refuses an
 * operation, nothing about that record changes there, so the next delta brings
 * nothing down and the local copy keeps the value the server rejected. The
 * screen then shows a number that exists nowhere else, forever, and no
 * synchronisation will ever correct it.
 *
 * Laying the outbox over the server state instead makes the repair free:
 * dropping the operation removes its effect, and what is left is what the
 * server actually holds.
 */
export function project(
  /** What the server last said, or null when it has never heard of this one. */
  server: RecordState | null,
  pending: readonly Operation[],
  /** Minted on the device, so a record that has never been sent still has one. */
  recordId: string,
): RecordState | null {
  let current = server

  for (const operation of inOutboxOrder(pending)) {
    if (operation.kind === 'delete') {
      current = null
      continue
    }

    const values = Object.fromEntries(operation.patches.map((patch) => [patch.field, patch.to]))

    // A create carries every field it means to set, so there is nothing to
    // start from. An update carries only what changed, and dropping the rest
    // would turn every edit into a record with three fields.
    //
    // The id is put in here rather than sent: it is one of the columns the
    // server keeps, so a patch naming it is refused outright. It travels as
    // the operation's `recordId` instead, which is where this one comes from.
    current =
      operation.kind === 'create' ? { ...values, id: recordId } : { ...(current ?? {}), ...values }
  }

  return current
}

/**
 * Groups an outbox by the record each operation belongs to.
 *
 * Built once per change rather than searched per row. A list of four hundred
 * circuits would otherwise walk the whole outbox four hundred times, and it
 * would do it inside a render.
 */
export function byRecord(operations: readonly Operation[]): ReadonlyMap<string, Operation[]> {
  const grouped = new Map<string, Operation[]>()

  for (const operation of operations) {
    const key = recordKey(operation.entity, operation.recordId)
    const list = grouped.get(key)

    if (list) {
      list.push(operation)
    } else {
      grouped.set(key, [operation])
    }
  }

  return grouped
}
