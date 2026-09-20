import {
  decideMerge,
  inOutboxOrder,
  lineNetCents,
  type Operation,
  type OperationOutcome,
  policyFor,
  type RecordState,
  type SyncValue,
  type TenantId,
  toSyncValue,
} from '@opengewerk/domain'
import { and, asc, eq, getTableColumns, getTableName, gt, is, isNull } from 'drizzle-orm'
import { PgTable, type PgColumn } from 'drizzle-orm/pg-core'

import type { TenantTransaction } from './database.js'
import * as schema from './schema/index.js'
import { syncConflicts, syncOperations } from './schema/index.js'

/**
 * Columns a device never sets, whatever it sends.
 *
 * The first two say where a record belongs and are decided by the identity of
 * the request, never by its body. The rest are kept by a trigger, and a device
 * that wrote its own version number could make any change look like the newest
 * one there is.
 *
 * `deletedAt` is in the list although the server writes it from an operation
 * and not from a trigger. Deleting has its own kind of operation and a rule of
 * its own to pass; a device that sets the column as an ordinary field would
 * walk around that rule, and one that sets it back to null would undelete
 * something nobody restored.
 */
const keptByTheServer = new Set([
  'id',
  'tenantId',
  'createdAt',
  'updatedAt',
  'updatedBy',
  'version',
  'changeSequence',
  'deletedAt',
])

/**
 * The tables a device can talk about, taken from the schema itself.
 *
 * Asked of the schema module rather than kept as a map beside it. A map would
 * be one more place to remember on the next table, and forgetting it would
 * look exactly like an entity nobody wanted to sync.
 */
const tablesByName = new Map<string, PgTable>(
  (Object.values(schema) as unknown[])
    .filter((candidate): candidate is PgTable => is(candidate, PgTable))
    .map((table) => [getTableName(table), table] as const),
)

export function syncTableFor(entity: string): PgTable | null {
  return tablesByName.get(entity) ?? null
}

/** The row as the merge sees it: flat, and in the shape a patch can compare. */
export function toRecordState(row: Record<string, unknown>): RecordState {
  return Object.fromEntries(
    Object.entries(row).map(([field, value]) => [field, toSyncValue(value)]),
  )
}

/**
 * Back into whatever the column wants. A timestamp travels as text and has to
 * be a date again before it goes in; everything else is already what it needs
 * to be.
 */
function forColumn(column: PgColumn, value: SyncValue): unknown {
  if (value === null) {
    return null
  }

  return column.dataType === 'date' ? new Date(String(value)) : value
}

/**
 * The record an operation's record hangs on, when its policy has a `gateFrom`.
 *
 * A document line is the case: whether it may be touched follows from the
 * status of its document, not from anything on the line. The reference is
 * taken from the operation first and from the stored row second, and the order
 * is what makes moving a line between documents safe. A patch that sets
 * `documentId` is asking to hang the line on a different document, so it is
 * that document which has to be a draft, not the one it is leaving.
 *
 * Returns null when there is no parent to find. The merge turns that into
 * `record_missing`, which is what it is: a line whose document is gone belongs
 * to nothing.
 */
async function parentFor(
  tx: TenantTransaction,
  operation: Operation,
  current: RecordState | null,
): Promise<RecordState | null> {
  const inherited = policyFor(operation.entity)?.gateFrom

  if (!inherited) {
    return null
  }

  const patched = operation.patches.find((patch) => patch.field === inherited.reference)
  const reference = patched ? patched.to : (current?.[inherited.reference] ?? null)

  if (typeof reference !== 'string') {
    return null
  }

  const table = syncTableFor(inherited.entity)

  if (!table) {
    throw new Error(
      `The policy of ${operation.entity} names an entity nothing knows: ${inherited.entity}`,
    )
  }

  const id = (getTableColumns(table) as Record<string, PgColumn>)['id']

  if (!id) {
    throw new Error(`The table ${inherited.entity} has no id to find a record by`)
  }

  const found = await tx.select().from(table).where(eq(id, reference))

  return found[0] ? toRecordState(found[0] as Record<string, unknown>) : null
}

/**
 * The line total, put in by the server on the way to the database.
 *
 * Two numbers decide it, and an operation may carry one, both or neither: a
 * device that corrects only the quantity still changes the total. So the
 * figure is worked out from what the operation sets, falling back to what the
 * row already holds, rather than from the patches alone.
 *
 * Nothing happens for any other entity. It is written as a check on the entity
 * rather than as a hook somebody registers, because there is exactly one such
 * field and a mechanism for one case is harder to read than the case.
 */
function withLineTotal(
  entity: string,
  values: Record<string, unknown>,
  current: RecordState | null,
): Record<string, unknown> {
  if (entity !== 'document_lines') {
    return values
  }

  const quantityMilli = Number(values['quantityMilli'] ?? current?.['quantityMilli'] ?? 0)
  const unitPriceCents = Number(values['unitPriceCents'] ?? current?.['unitPriceCents'] ?? 0)

  return { ...values, netCents: lineNetCents({ quantityMilli, unitPriceCents }) }
}

export class UnknownFieldError extends Error {}

/**
 * The columns an operation may write, refusing the ones it may not.
 *
 * The second guard against a reserved field, after `decideMerge`. Not
 * redundant: the merge decides, this one writes, and a path that reaches the
 * write without passing the decision would otherwise put the value in. The
 * fields the server reserves are exactly the ones where that must not happen
 * quietly, so the cheaper of the two checks sits where it cannot be skipped.
 */
function columnsFor(table: PgTable, fields: readonly string[]): Record<string, PgColumn> {
  const columns = getTableColumns(table) as Record<string, PgColumn>
  const reserved = policyFor(getTableName(table))?.reserved ?? []
  const picked: Record<string, PgColumn> = {}

  for (const field of fields) {
    if (keptByTheServer.has(field) || reserved.includes(field)) {
      // Not a conflict, a mistake in the client. A conflict is two people
      // disagreeing about a value; this is a device reaching for something
      // that was never its to set.
      throw new UnknownFieldError(`Dieses Feld setzt der Server: ${field}`)
    }

    const column = columns[field]

    if (!column) {
      throw new UnknownFieldError(`Unbekanntes Feld: ${field}`)
    }

    picked[field] = column
  }

  return picked
}

export interface OperationReceipt {
  readonly operationId: string
  readonly outcome: OperationOutcome
  readonly reason: string | null
  readonly fields: readonly string[]
}

/**
 * Takes what a device has queued up and decides what becomes of it.
 *
 * In recorded order, and one at a time, because two operations on the same
 * record only make sense in the order they happened. The decision itself is
 * not made here but in `domain`, so that a device can work out the same answer
 * before it sends anything and show a conflict rather than discover one.
 *
 * Everything runs inside the caller's transaction. Either the whole
 * transmission lands or none of it does, which is what makes sending it again
 * safe.
 */
export async function applyOperations(
  tx: TenantTransaction,
  tenantId: TenantId,
  operations: readonly Operation[],
): Promise<readonly OperationReceipt[]> {
  const receipts: OperationReceipt[] = []

  for (const operation of inOutboxOrder(operations)) {
    receipts.push(await applyOne(tx, tenantId, operation))
  }

  return receipts
}

async function applyOne(
  tx: TenantTransaction,
  tenantId: TenantId,
  operation: Operation,
): Promise<OperationReceipt> {
  const seen = await tx
    .select({ outcome: syncOperations.outcome })
    .from(syncOperations)
    .where(eq(syncOperations.id, operation.id))

  const already = seen[0]

  if (already) {
    // The receipt is the whole answer to "the same transmission twice". A
    // device that lost the connection after the server committed sends its
    // queue again, and that is the ordinary case, not the exception.
    return {
      operationId: operation.id,
      outcome: already.outcome,
      reason: 'already_seen',
      fields: [],
    }
  }

  const table = syncTableFor(operation.entity)

  if (!table) {
    return await record(tx, tenantId, operation, {
      outcome: 'conflict',
      reason: 'unknown_entity',
      fields: [],
    })
  }

  const columns = getTableColumns(table) as Record<string, PgColumn>
  const id = columns['id']

  if (!id) {
    throw new Error(`The table ${operation.entity} has no id to find a record by`)
  }

  // Without `isNull(deletedAt)`, unlike every controller, and that is the
  // point: a deleted row has to be found here. It is what turns a repeated
  // create into a `skip` instead of a primary key collision, and what lets the
  // merge tell "never existed" apart from "deleted since". The merge refuses
  // the deleted row itself; leaving it out of the query would hide it.
  const found = await tx.select().from(table).where(eq(id, operation.recordId))
  const current = found[0] ? toRecordState(found[0] as Record<string, unknown>) : null
  const decision = decideMerge(operation, current, await parentFor(tx, operation, current))

  if (decision.outcome === 'skip') {
    return await record(tx, tenantId, operation, {
      outcome: 'skipped',
      reason: decision.reason,
      fields: [],
    })
  }

  if (decision.outcome === 'conflict') {
    return await record(tx, tenantId, operation, {
      outcome: 'conflict',
      reason: decision.reason,
      fields: decision.fields,
      current,
    })
  }

  const patched = columnsFor(
    table,
    operation.patches.map((patch) => patch.field),
  )
  const values: Record<string, unknown> = {}

  for (const patch of operation.patches) {
    const column = patched[patch.field]
    if (column) {
      values[patch.field] = forColumn(column, patch.to)
    }
  }

  // The line total is worked out here and not taken from the device. It is
  // reserved in the policy, so a device that sends one is refused outright;
  // this is the other half, the figure the server puts in its place.
  const complete = withLineTotal(operation.entity, values, current)

  if (operation.kind === 'create') {
    await tx.insert(table).values({ ...complete, id: operation.recordId, tenantId } as never)
  } else if (operation.kind === 'delete') {
    // Marked, not removed. A row that is gone is a row a device that was
    // offline never hears about again.
    await tx
      .update(table)
      .set({ deletedAt: new Date() } as never)
      .where(eq(id, operation.recordId))
  } else {
    await tx
      .update(table)
      .set(complete as never)
      .where(eq(id, operation.recordId))
  }

  return await record(tx, tenantId, operation, { outcome: 'applied', reason: null, fields: [] })
}

async function record(
  tx: TenantTransaction,
  tenantId: TenantId,
  operation: Operation,
  result: {
    outcome: OperationOutcome
    reason: string | null
    fields: readonly string[]
    current?: RecordState | null
  },
): Promise<OperationReceipt> {
  if (result.outcome === 'conflict') {
    const interesting =
      result.fields.length > 0 ? result.fields : operation.patches.map((p) => p.field)

    await tx.insert(syncConflicts).values({
      tenantId,
      operationId: operation.id,
      entity: operation.entity,
      recordId: operation.recordId,
      reason: result.reason as never,
      fields: result.fields,
      wanted: Object.fromEntries(operation.patches.map((patch) => [patch.field, patch.to])),
      seen: Object.fromEntries(operation.patches.map((patch) => [patch.field, patch.from])),
      // Only the fields in question. The rest of the record is on the device
      // already, and a conflict list that repeats it buries the three values
      // somebody actually has to look at.
      found: Object.fromEntries(
        interesting.map((field) => [field, result.current?.[field] ?? null]),
      ),
      deviceId: operation.deviceId,
      recordedAt: operation.recordedAt,
    })
  }

  await tx.insert(syncOperations).values({
    id: operation.id,
    tenantId,
    entity: operation.entity,
    recordId: operation.recordId,
    outcome: result.outcome,
    deviceId: operation.deviceId,
  })

  return {
    operationId: operation.id,
    outcome: result.outcome,
    reason: result.reason,
    fields: result.fields,
  }
}

export interface ChangedRows {
  readonly entity: string
  readonly rows: readonly Record<string, unknown>[]
}

/**
 * What has happened since the device last asked.
 *
 * Rows that were marked as deleted come along, which is the entire reason for
 * marking them: a row that had simply been removed would not be among the
 * changes, and a device that was offline would keep it forever.
 *
 * The cursor is the change sequence, which counts in the order transactions
 * commit. A cursor on timestamps would skip a row whose transaction started
 * before the last pull and committed after it.
 *
 * The limit is per entity, so the cursor cannot be the highest sequence seen.
 * One entity with more waiting than fits would then hand the device a cursor
 * taken from another one, and everything between the two numbers would be
 * outside the window on the next pull: gone, without an error and without a
 * hint, and hitting exactly the device that was away for a long time. So the
 * cursor stops at the lowest entity that ran into its limit, and `hasMore`
 * says to come back. Rows above that number arrive a second time, which costs
 * a little and is the right way round: sending a row twice is nothing, losing
 * one is forever.
 */
export async function changesSince(
  tx: TenantTransaction,
  since: number,
  limit = 500,
): Promise<{ changes: readonly ChangedRows[]; cursor: number; hasMore: boolean }> {
  const changes: ChangedRows[] = []
  let highest = since
  let stoppedAt: number | null = null

  for (const [entity, table] of tablesByName) {
    const columns = getTableColumns(table) as Record<string, PgColumn>
    const sequence = columns['changeSequence']

    if (!sequence) {
      continue
    }

    const rows = await tx
      .select()
      .from(table)
      .where(gt(sequence, since))
      .orderBy(asc(sequence))
      .limit(limit)

    if (rows.length === 0) {
      continue
    }

    changes.push({ entity, rows: rows as Record<string, unknown>[] })

    let last = since

    for (const row of rows) {
      const at = (row as Record<string, unknown>)['changeSequence']
      last = Math.max(last, Number(at))
    }

    highest = Math.max(highest, last)

    if (rows.length === limit) {
      // Full to the limit, so there may well be more behind it. What follows
      // `last` is still waiting, and the cursor must not move past it.
      stoppedAt = stoppedAt === null ? last : Math.min(stoppedAt, last)
    }
  }

  return { changes, cursor: stoppedAt ?? highest, hasMore: stoppedAt !== null }
}

/** The conflicts somebody still has to decide, oldest first. */
export function openConflicts(tx: TenantTransaction) {
  return tx
    .select()
    .from(syncConflicts)
    .where(isNull(syncConflicts.resolvedAt))
    .orderBy(asc(syncConflicts.recordedAt))
}

export async function closeConflict(tx: TenantTransaction, id: string): Promise<boolean> {
  const closed = await tx
    .update(syncConflicts)
    .set({ resolvedAt: new Date() })
    .where(and(eq(syncConflicts.id, id as never), isNull(syncConflicts.resolvedAt)))
    .returning({ id: syncConflicts.id })

  return closed.length > 0
}
