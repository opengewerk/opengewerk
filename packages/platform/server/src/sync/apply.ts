import {
  type ConflictReason,
  inOutboxOrder,
  type Operation,
  type OperationId,
  type OperationOutcome,
  type OperationReceipt,
  type RecordState,
  type SyncRules,
  type TenantId,
} from '@opengewerk/platform-domain'
import { and, asc, eq, getTableColumns, getTableName, gt, isNull, type SQL, sql } from 'drizzle-orm'
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core'

import type { TenantTransaction } from '../database/database.js'
import { syncConflicts, syncOperations } from '../database/schema/sync.js'
import { carriesJson, forColumn, inJsonText, toRecordState, travellingRows } from './tables.js'

/**
 * A mistake only the client can make, which refuses the whole transmission
 * with its sentence. Not a conflict: a conflict is two people disagreeing
 * about a value, this is a device sending something its own form would have
 * refused, or reaching for a field that was never its to set.
 */
export class UnknownFieldError extends Error {}

/**
 * The operation a transmission was refused over, with whatever refused it as
 * the cause.
 *
 * The transmission is still refused as a whole: it runs in one transaction,
 * and what went before this operation is rolled back with it. What this adds
 * is the name. Without it a device could only send the same stack again and
 * get the same answer, for ever, and pulled nothing in the meantime. With it,
 * the device can show the one entry and let a person throw it away.
 */
export class OperationRefused extends Error {
  constructor(
    readonly operationId: OperationId,
    cause: unknown,
  ) {
    super(cause instanceof Error ? cause.message : String(cause), { cause })
    this.name = 'OperationRefused'
  }
}

/**
 * How an application answers an operation it will not take, and whose
 * mistake that is.
 *
 * `client` is a mistake only the client can make, because its form asks the
 * same rule before anything is queued: the sentence goes back as a refusal of
 * the whole transmission. `conflict` is about this one operation, two changes
 * that each fit and do not fit together, or a record that is gone: it is kept
 * for a person to decide, and the rest of the transmission lands.
 */
export type SyncRefusal =
  | { readonly kind: 'client'; readonly message: string }
  | {
      readonly kind: 'conflict'
      readonly reason: ConflictReason
      readonly fields: readonly string[]
    }

/** What a check of the application is shown of one operation. */
export interface SyncCheckContext<Sender> {
  readonly tx: TenantTransaction
  readonly tenantId: TenantId
  readonly operation: Operation
  /** The table the operation's entity is kept in. */
  readonly table: PgTable
  /**
   * What the operation writes, field by field, already in the shape of the
   * columns. A check may take a value out or change one, which is what is
   * written then; one that only asks leaves it alone.
   */
  readonly values: Record<string, unknown>
  /** The record as the server holds it, a record marked as deleted included, or null. */
  readonly current: RecordState | null
  /** Whoever sent the transmission, in the words of the application. */
  readonly sender: Sender
}

/**
 * One question an application asks of an operation before the database does,
 * so that what a device can break is a conflict about one operation or a
 * sentence, and not the refusal of a check in the database that takes the
 * whole transmission with it and says nothing anybody can act on.
 */
export type SyncCheck<Sender> = (
  context: SyncCheckContext<Sender>,
) => Promise<SyncRefusal | null> | SyncRefusal | null

/** What an application tells the sync on the server about itself. */
export interface SyncApplication<Sender> {
  /** Its policies, and the decision made from them (`syncRules`). */
  readonly rules: SyncRules
  /** Its tables by name (`syncTables`). */
  readonly tables: ReadonlyMap<string, PgTable>
  /**
   * Its checks, in the order they are asked. The first that refuses decides
   * the answer, so the order is behaviour: an operation that breaks two rules
   * is answered with the first of them.
   */
  readonly checks?: readonly SyncCheck<Sender>[]
  /**
   * The values the server puts in on the way to the database, after every
   * check has passed: a figure it works out, a number it draws. Drawn in the
   * same transaction as the write, so that a transmission refused afterwards
   * takes it back with it.
   */
  readonly complete?: (
    context: SyncCheckContext<Sender>,
  ) => Promise<Record<string, unknown>> | Record<string, unknown>
  /**
   * What follows an operation once it is written, in the same transaction:
   * what the application does beyond the one row, a signature that completes
   * a record and writes what comes of it. Shown the values as they were
   * written. Not asked for an operation that was skipped or kept as a
   * conflict. What it throws refuses the transmission like any other error,
   * and takes back what went before; a refusal it can foresee belongs in a
   * check.
   */
  readonly afterWrite?: (context: SyncCheckContext<Sender>) => Promise<void> | void
}

export interface ChangedRows {
  readonly entity: string
  readonly rows: readonly Record<string, unknown>[]
}

/** What has changed since a cursor, and where to ask from next. */
export interface Changes {
  readonly changes: readonly ChangedRows[]
  readonly cursor: number
  readonly hasMore: boolean
}

/** The sync on the server, bound to one application. */
export interface ServerSync<Sender> {
  /** The table of an entity, or null for a name nothing in the schema has. */
  tableFor(entity: string): PgTable | null
  /**
   * Takes what a device has queued up and decides what becomes of it.
   *
   * In recorded order, and one at a time, because two operations on the same
   * record only make sense in the order they happened. The decision itself is
   * not made here but by the rules, so that a device can work out the same
   * answer before it sends anything and show a conflict rather than discover
   * one.
   *
   * Everything runs inside the caller's transaction. Either the whole
   * transmission lands or none of it does, which is what makes sending it again
   * safe.
   */
  applyOperations(
    tx: TenantTransaction,
    tenantId: TenantId,
    operations: readonly Operation[],
    sender: Sender,
  ): Promise<readonly OperationReceipt[]>
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
   * The limit is per entity, so the cursor cannot be the highest sequence
   * seen. One entity with more waiting than fits would then hand the device a
   * cursor taken from another one, and everything between the two numbers
   * would be outside the window on the next pull: gone, without an error and
   * without a hint, and hitting exactly the device that was away for a long
   * time. So the cursor stops at the lowest entity that ran into its limit,
   * and `hasMore` says to come back. Rows above that number arrive a second
   * time, which costs a little and is the right way round: sending a row twice
   * is nothing, losing one is forever.
   *
   * `narrow` keeps rows of an entity away from a device that may not hold
   * them all. The cursor is untouched by it; a row left out is simply not
   * sent, and it will not be sent later either.
   */
  changesSince(
    tx: TenantTransaction,
    since: number,
    limit?: number,
    narrow?: (entity: string) => SQL | undefined,
  ): Promise<Changes>
}

/**
 * The sync on the server for one application (ADR 0010): applying an
 * operation, recording what became of it, and the pull by change sequence.
 *
 * The mechanism is the foundation's and the same for every application. What
 * an application adds is in `SyncApplication`: its rules, its tables, the
 * questions it asks of an operation before the database does, and the values
 * the server puts in. Nothing here knows an entity by name.
 */
export function serverSync<Sender>(application: SyncApplication<Sender>): ServerSync<Sender> {
  const { rules, tables } = application
  const checks = application.checks ?? []

  const tableFor = (entity: string): PgTable | null => tables.get(entity) ?? null

  /**
   * The record an operation's record hangs on, when its policy has a
   * `gateFrom`.
   *
   * A line is the case: whether it may be touched follows from the state of
   * what it belongs to, not from anything on the line. The reference is taken
   * from the operation first and from the stored row second, and the order is
   * what makes moving a line between parents safe. A patch that sets the
   * reference is asking to hang the line on a different parent, so it is that
   * parent which has to be in the open state, not the one it is leaving.
   *
   * Returns null when there is no parent to find. The merge turns that into
   * `record_missing`, which is what it is: a line whose parent is gone belongs
   * to nothing.
   */
  async function parentFor(
    tx: TenantTransaction,
    operation: Operation,
    current: RecordState | null,
  ): Promise<RecordState | null> {
    const inherited = rules.policyFor(operation.entity)?.gateFrom

    if (!inherited) {
      return null
    }

    const patched = operation.patches.find((patch) => patch.field === inherited.reference)
    const reference = patched ? patched.to : (current?.[inherited.reference] ?? null)

    if (typeof reference !== 'string') {
      return null
    }

    const table = tableFor(inherited.entity)

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

    return found[0] ? toRecordState(table, found[0] as Record<string, unknown>) : null
  }

  /**
   * The columns an operation may write, refusing the ones it may not.
   *
   * The second guard against a reserved field, after the merge. Not redundant:
   * the merge decides, this one writes, and a path that reaches the write
   * without passing the decision would otherwise put the value in. The fields
   * the server reserves are exactly the ones where that must not happen
   * quietly, so the cheaper of the two checks sits where it cannot be skipped.
   */
  function columnsFor(table: PgTable, fields: readonly string[]): Record<string, PgColumn> {
    const columns = getTableColumns(table) as Record<string, PgColumn>
    const picked: Record<string, PgColumn> = {}

    for (const field of fields) {
      if (rules.isSetByServer(getTableName(table), field)) {
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

  /**
   * The operation with what it brings for a column of JSON or a list in the
   * text `jsonText` writes, `from` as well as `to`, so that the merge compares
   * values and not how a device wrote them (`inJsonText`).
   *
   * A text that is no such value is a mistake only the client can make: the
   * text it patches comes from the server or from `jsonText`.
   */
  function withJsonText(table: PgTable, operation: Operation): Operation {
    const columns = getTableColumns(table) as Record<string, PgColumn>

    return {
      ...operation,
      patches: operation.patches.map((patch) => {
        const column = columns[patch.field]

        if (!column || !carriesJson(column)) {
          return patch
        }

        const from = inJsonText(column, patch.from)
        const to = inJsonText(column, patch.to)

        if (from === undefined || to === undefined) {
          throw new UnknownFieldError(`Dieses Feld nimmt nur JSON als Text: ${patch.field}`)
        }

        return { ...patch, from, to }
      }),
    }
  }

  async function applyOne(
    tx: TenantTransaction,
    tenantId: TenantId,
    sent: Operation,
    sender: Sender,
  ): Promise<OperationReceipt> {
    // One at a time for one operation, until the transaction ends. The
    // question below was asked without it: a device that sent its queue again
    // while the first transmission was still being applied found no receipt,
    // applied the operation a second time and failed on the receipt of the
    // first, and the whole transmission was refused over an operation that
    // had been taken (opengewerk-haustechnik#31). Now the second waits here,
    // asks once the first is through and is told what became of it.
    //
    // The lock is on the id, in a key space of its own beside the named locks
    // of the foundation. Two transmissions take their locks in the same
    // order, the one their operations were recorded in, so they do not wait
    // for each other in a circle.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext('opengewerk.sync_operation'), hashtext(${sent.id}::text))`,
    )

    const seen = await tx
      .select({ outcome: syncOperations.outcome })
      .from(syncOperations)
      .where(eq(syncOperations.id, sent.id))

    const already = seen[0]

    if (already) {
      // The receipt is the whole answer to "the same transmission twice". A
      // device that lost the connection after the server committed sends its
      // queue again, and that is the ordinary case, not the exception.
      return {
        operationId: sent.id,
        outcome: already.outcome,
        reason: 'already_seen',
        fields: [],
      }
    }

    const table = tableFor(sent.entity)

    if (!table) {
      return await record(tx, tenantId, sent, {
        outcome: 'conflict',
        reason: 'unknown_entity',
        fields: [],
      })
    }

    const columns = getTableColumns(table) as Record<string, PgColumn>
    const id = columns['id']

    if (!id) {
      throw new Error(`The table ${sent.entity} has no id to find a record by`)
    }

    const operation = withJsonText(table, sent)

    // Without a condition on `deletedAt`, unlike a route, and that is the
    // point: a deleted row has to be found here. It is what turns a repeated
    // create into a `skip` instead of a primary key collision, and what lets
    // the merge tell "never existed" apart from "deleted since". The merge
    // refuses the deleted row itself; leaving it out of the query would hide
    // it.
    const found = await tx.select().from(table).where(eq(id, operation.recordId))
    const current = found[0] ? toRecordState(table, found[0] as Record<string, unknown>) : null
    const decision = rules.decideMerge(operation, current, await parentFor(tx, operation, current))

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

    const context: SyncCheckContext<Sender> = {
      tx,
      tenantId,
      operation,
      table,
      values,
      current,
      sender,
    }

    for (const check of checks) {
      const refusal = await check(context)

      if (refusal === null) {
        continue
      }

      if (refusal.kind === 'client') {
        throw new UnknownFieldError(refusal.message)
      }

      return await record(tx, tenantId, operation, {
        outcome: 'conflict',
        reason: refusal.reason,
        fields: refusal.fields,
        current,
      })
    }

    const complete = application.complete ? await application.complete(context) : values

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

    if (application.afterWrite) {
      await application.afterWrite({ ...context, values: complete })
    }

    return await record(tx, tenantId, operation, { outcome: 'applied', reason: null, fields: [] })
  }

  return {
    tableFor,

    async applyOperations(tx, tenantId, operations, sender) {
      const receipts: OperationReceipt[] = []

      for (const operation of inOutboxOrder(operations)) {
        try {
          receipts.push(await applyOne(tx, tenantId, operation, sender))
        } catch (error) {
          // Whatever stops one operation still stops the transmission. Which
          // one it was travels with it, so that the answer can say.
          throw new OperationRefused(operation.id, error)
        }
      }

      return receipts
    },

    async changesSince(tx, since, limit = 500, narrow = () => undefined) {
      const changes: ChangedRows[] = []
      let highest = since
      let stoppedAt: number | null = null

      for (const [entity, table] of tables) {
        const columns = getTableColumns(table) as Record<string, PgColumn>
        const sequence = columns['changeSequence']

        if (!sequence) {
          continue
        }

        const rows = await tx
          .select()
          .from(table)
          .where(and(gt(sequence, since), narrow(entity)))
          .orderBy(asc(sequence))
          .limit(limit)

        if (rows.length === 0) {
          continue
        }

        changes.push({ entity, rows: travellingRows(table, rows as Record<string, unknown>[]) })

        let last = since

        for (const row of rows) {
          const at = (row as Record<string, unknown>)['changeSequence']
          last = Math.max(last, Number(at))
        }

        highest = Math.max(highest, last)

        if (rows.length === limit) {
          // Full to the limit, so there may well be more behind it. What
          // follows `last` is still waiting, and the cursor must not move
          // past it.
          stoppedAt = stoppedAt === null ? last : Math.min(stoppedAt, last)
        }
      }

      return { changes, cursor: stoppedAt ?? highest, hasMore: stoppedAt !== null }
    },
  }
}

/**
 * What became of one operation, written down: the receipt that makes a
 * second transmission harmless, and for a conflict the three pictures a person
 * needs to decide it.
 */
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

/** A conflict as the table keeps it. */
export type SyncConflictRow = typeof syncConflicts.$inferSelect

/**
 * The conflicts one device still has to decide, oldest first.
 *
 * Only that device's, never the tenant's. A conflict carries the values the
 * device wanted to write, the ones it had seen and the ones the server found,
 * and the person who decides it is the one whose change it was (ADR 0005).
 * Listing them for everybody with the right to sync handed out values of
 * records a device is no longer given since it holds only its part of the
 * tenant, and let anyone mark somebody else's conflict decided
 * (GHSA-4jfj-cxqw-qgpj, opengewerk-haustechnik#31).
 */
export async function openConflicts(
  tx: TenantTransaction,
  deviceId: string,
): Promise<SyncConflictRow[]> {
  return await tx
    .select()
    .from(syncConflicts)
    .where(and(isNull(syncConflicts.resolvedAt), eq(syncConflicts.deviceId, deviceId as never)))
    .orderBy(asc(syncConflicts.recordedAt))
}

/**
 * Marks a conflict of this device as decided. What the decision was is a
 * change like any other and comes through the ordinary routes; this only says
 * that nobody has to look at it again. A conflict of another device is not
 * found, as if it did not exist.
 */
export async function closeConflict(
  tx: TenantTransaction,
  id: string,
  deviceId: string,
): Promise<boolean> {
  const closed = await tx
    .update(syncConflicts)
    .set({ resolvedAt: new Date() })
    .where(
      and(
        eq(syncConflicts.id, id as never),
        eq(syncConflicts.deviceId, deviceId as never),
        isNull(syncConflicts.resolvedAt),
      ),
    )
    .returning({ id: syncConflicts.id })

  return closed.length > 0
}
