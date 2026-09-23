import {
  contactParentProblem,
  contactParentText,
  type CustomerId,
  decideMerge,
  inOutboxOrder,
  type IsoDate,
  lineNetCents,
  locationFields,
  isSetByServer,
  type Operation,
  type OperationId,
  type OperationOutcome,
  type OperationReceipt,
  paymentTermProblem,
  policyFor,
  type RecordState,
  signaturePathIsValid,
  type SyncValue,
  type TenantId,
  toSyncValue,
} from '@opengewerk/domain'
import { and, asc, eq, getTableColumns, getTableName, gt, is, isNull, type SQL } from 'drizzle-orm'
import { PgTable, type PgColumn } from 'drizzle-orm/pg-core'

import { versionFileRefusal } from '../attachments/versions.js'
import { signatureRefusal } from '../documents/signing.js'
import { consentGiven, correctionRefusal } from '../time/entries.js'
import { proposedTreatment } from '../documents/treatment.js'
import { sectionRefusal, structureProblem } from '../electrical/structure.js'
import { assigneeRefusal } from '../tasks/assignee.js'
import type { TenantTransaction } from './database.js'
import { ruleRefusal } from './record-rules.js'
import { missingReference } from './references.js'
import * as schema from './schema/index.js'
import { syncConflicts, syncOperations } from './schema/index.js'

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

/**
 * The tax treatment of a document made on a device, proposed here as the
 * route proposes it for one made in the office.
 *
 * Only when the device did not choose one. It may, a draft's treatment is
 * writable; what it may not get is the default by accident, which is what a
 * report written in a cellar for a small business used to arrive with.
 */
async function withProposedTreatment(
  tx: TenantTransaction,
  operation: Operation,
  values: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (
    operation.kind !== 'create' ||
    operation.entity !== 'documents' ||
    values['taxTreatment'] !== undefined ||
    typeof values['customerId'] !== 'string' ||
    typeof values['documentDate'] !== 'string'
  ) {
    return values
  }

  return {
    ...values,
    taxTreatment: await proposedTreatment(
      tx,
      values['customerId'] as CustomerId,
      values['documentDate'] as IsoDate,
    ),
  }
}

export class UnknownFieldError extends Error {}

/**
 * The operation a transmission was refused over, with whatever refused it as
 * the cause.
 *
 * The transmission is still refused as a whole: it runs in one transaction,
 * and what went before this operation is rolled back with it. What this adds
 * is the name. Without it a device could only send the same stack again and
 * get the same answer, for ever, and pulled nothing in the meantime (#120).
 * With it, the device can show the one entry and let a person throw it away.
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
  const picked: Record<string, PgColumn> = {}

  for (const field of fields) {
    if (isSetByServer(getTableName(table), field)) {
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
    try {
      receipts.push(await applyOne(tx, tenantId, operation))
    } catch (error) {
      // Whatever stops one operation still stops the transmission. Which one
      // it was travels with it, so that the answer can say.
      throw new OperationRefused(operation.id, error)
    }
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

  if (operation.kind === 'create' && operation.entity === 'document_signatures') {
    // A path that is not one this system draws is a mistake in the client,
    // like a field it may not set, and not a disagreement between two people.
    // The check in the database would refuse it too, with a sentence nobody
    // on site could act on.
    if (typeof values['path'] !== 'string' || !signaturePathIsValid(values['path'])) {
      throw new UnknownFieldError('Die Unterschrift ist kein Pfad, wie OpenGewerk ihn zeichnet.')
    }

    const refusal = await signatureRefusal(tx, values)

    if (refusal) {
      return await record(tx, tenantId, operation, {
        outcome: 'conflict',
        reason: refusal.reason,
        fields: refusal.fields,
        current,
      })
    }
  }

  // A payment term outside what `paymentTermProblem` allows is a mistake in
  // the client, like a signature path it did not draw: the form checks the
  // same function before anything is queued. Refused here with that sentence
  // rather than by the check in the database with one nobody can act on.
  if (
    operation.entity === 'documents' &&
    values['paymentTermDays'] !== undefined &&
    values['paymentTermDays'] !== null
  ) {
    const problem = paymentTermProblem(values['paymentTermDays'])

    if (problem !== null) {
      throw new UnknownFieldError(problem)
    }
  }

  // A task goes to somebody who works here. The key in the database would say
  // so too, for the whole transmission at once; said here, it is a conflict
  // about this one operation.
  if (operation.entity === 'tasks' && operation.kind !== 'delete') {
    const refusal = await assigneeRefusal(tx, tenantId, operation.kind === 'create', values)

    if (refusal) {
      return await record(tx, tenantId, operation, {
        outcome: 'conflict',
        reason: refusal.reason,
        fields: refusal.fields,
        current,
      })
    }
  }

  // A figure of the structure below an installation out of bounds is a
  // mistake in the client, refused with the sentence its form shows. The
  // check in the database says the same, for the whole transmission at once.
  const figures = structureProblem(operation.entity, values, current)

  if (figures !== null) {
    throw new UnknownFieldError(figures)
  }

  // A contact hangs on one customer or on one site, which the check in the
  // database holds as well, judged as it would stand afterwards: what the
  // operation sets, over the row it lands on. The two ways to miss that are
  // not the same kind of mistake. On both, it is one only the client can
  // make: a form makes a contact on the screen of what it belongs to and has
  // no way to name the other as well, so the answer is the sentence of the
  // rule, the way a circuit is refused whose curve does not go with its
  // device. On neither, it is a record without the parent it must have, and
  // that is the question of the references below, which gets their answer.
  const standing = (field: string) => (field in values ? values[field] : current?.[field])
  const parent =
    operation.entity === 'contacts' && operation.kind !== 'delete'
      ? contactParentProblem({ customerId: standing('customerId'), siteId: standing('siteId') })
      : null

  if (parent === 'both') {
    throw new UnknownFieldError(contactParentText.both)
  }

  // The checks on the fields of one record that nothing above asks: the
  // service period of a document, the place and amount of a line, the name
  // and device of a signature. Each as the rule the forms ask as well, and
  // whose mistake a broken one is `ruleRefusal` explains.
  const broken = ruleRefusal(operation, values, current)

  if (broken?.kind === 'client') {
    throw new UnknownFieldError(broken.message)
  }

  if (broken) {
    return await record(tx, tenantId, operation, {
      outcome: 'conflict',
      reason: broken.reason,
      fields: broken.fields,
      current,
    })
  }

  // A time entry corrects somebody's own entry, and each one once (#76). Its
  // place is kept only with the person's consent: without it the server drops
  // the place and keeps the time, which is still the record the law wants.
  if (operation.entity === 'time_entries' && operation.kind === 'create') {
    const refusal = await correctionRefusal(tx, values)

    if (refusal) {
      return await record(tx, tenantId, operation, {
        outcome: 'conflict',
        reason: refusal.reason,
        fields: refusal.fields,
        current,
      })
    }

    if (!(await consentGiven(tx))) {
      for (const field of locationFields) {
        if (field in values) {
          values[field] = null
        }
      }
    }
  }

  // A version of an attachment names its file by business and hash, a key the
  // reference check below does not read. Its own question: is the file there,
  // uploaded ahead of the version, and is the size the one it has.
  if (operation.entity === 'attachment_versions' && operation.kind === 'create') {
    const refusal = await versionFileRefusal(tx, tenantId, values)

    if (refusal?.kind === 'client') {
      throw new UnknownFieldError(refusal.message)
    }

    if (refusal) {
      return await record(tx, tenantId, operation, {
        outcome: 'conflict',
        reason: refusal.reason,
        fields: refusal.fields,
        current,
      })
    }
  }

  // A parent that is gone, or that belongs to another business, is a
  // conflict about this one operation, for every entity: the key over tenant
  // and id would refuse it too, but for the whole transmission, and a deleted
  // parent it would take. A contact that names none at all is missing the
  // one it must have, like any record created without it, and a conflict as
  // well, with both fields; left to the check in the database, it took the
  // whole transmission along. Then the one pairing the keys cannot say alone,
  // the section of a circuit on the circuit's board.
  const missing =
    operation.kind === 'delete'
      ? null
      : await missingReference(tx, table, values, operation.kind === 'create')
  const misplaced = missing
    ? { reason: 'record_missing' as const, fields: [missing.field] }
    : parent === 'none'
      ? { reason: 'record_missing' as const, fields: ['customerId', 'siteId'] }
      : await sectionRefusal(tx, operation, values, current)

  if (misplaced) {
    return await record(tx, tenantId, operation, {
      outcome: 'conflict',
      reason: misplaced.reason,
      fields: misplaced.fields,
      current,
    })
  }

  // A cancellation invoice is made by the server out of the invoice it cancels
  // and nowhere else. The database refuses one written by hand, and it would
  // do so for the whole transmission; refused here first, it is a conflict
  // about this one operation, the way a field the server keeps is refused.
  if (operation.entity === 'documents' && values['kind'] === 'cancellation_invoice') {
    return await record(tx, tenantId, operation, {
      outcome: 'conflict',
      reason: 'set_by_server',
      fields: ['kind'],
      current,
    })
  }

  // The line total is worked out here and not taken from the device. It is
  // reserved in the policy, so a device that sends one is refused outright;
  // this is the other half, the figure the server puts in its place.
  const complete = await withProposedTreatment(
    tx,
    operation,
    withLineTotal(operation.entity, values, current),
  )

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
 *
 * `narrow` keeps rows of an entity away from a device that may not read them
 * all (#76): the working time of the others, for somebody who may only record
 * their own. The cursor is untouched by it; a row left out is simply not sent,
 * and it will not be sent later either.
 */
export async function changesSince(
  tx: TenantTransaction,
  since: number,
  limit = 500,
  narrow: (entity: string) => SQL | undefined = () => undefined,
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
      .where(and(gt(sequence, since), narrow(entity)))
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
