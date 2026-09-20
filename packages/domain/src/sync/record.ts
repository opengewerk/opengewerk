import type { Id, TenantId } from '../model/identifier.js'
import type { ConflictReason } from './merge.js'
import type { DeviceId, OperationId, SyncValue } from './operation.js'

export type SyncConflictId = Id<'sync-conflict'>

/** What became of an operation the server received. */
export const operationOutcomes = ['applied', 'conflict', 'skipped'] as const

export type OperationOutcome = (typeof operationOutcomes)[number]

/**
 * The receipt for one operation.
 *
 * It exists for one reason: so that the same transmission arriving twice does
 * not produce a second record. A device that loses the connection after the
 * server committed but before the answer arrived will send its queue again,
 * and that is the normal case, not the exception.
 */
export interface SyncOperation {
  readonly id: OperationId
  readonly tenantId: TenantId
  readonly entity: string
  readonly recordId: string
  readonly outcome: OperationOutcome
  readonly deviceId: DeviceId
  readonly receivedAt: Date
}

/**
 * What the server answers for one operation of a transmission.
 *
 * The receipt of the whole exchange, and it lives here rather than in the
 * server because both ends read it: the server writes one per operation, the
 * device decides from it what may leave its outbox. Two declarations of the
 * same wire shape would agree until the day one of them gains a field.
 *
 * `reason` is a `ConflictReason` when the outcome is a conflict, and the
 * reason for a skip otherwise. It stays a string on purpose: a device that has
 * not been updated in a while must not fail to empty its outbox because the
 * server has learned a word it does not know yet.
 */
export interface OperationReceipt {
  readonly operationId: OperationId
  readonly outcome: OperationOutcome
  readonly reason: string | null
  readonly fields: readonly string[]
}

/**
 * A change that could not be applied, kept for a person to decide.
 *
 * This is what ADR 0005 rejected CRDTs for. A merge that resolves everything
 * by itself resolves the cases it gets wrong just as quietly as the ones it
 * gets right, and nobody finds out. Here both versions stay side by side until
 * somebody says which one is the truth.
 */
export interface SyncConflict {
  readonly id: SyncConflictId
  readonly tenantId: TenantId
  readonly operationId: OperationId
  readonly entity: string
  readonly recordId: string
  readonly reason: ConflictReason
  /** The fields it hangs on, empty when the whole record is the reason. */
  readonly fields: readonly string[]
  /** What the device wanted there. */
  readonly wanted: Readonly<Record<string, SyncValue>>
  /** What it thought was there, and what actually was. */
  readonly seen: Readonly<Record<string, SyncValue>>
  readonly found: Readonly<Record<string, SyncValue>>
  readonly deviceId: DeviceId
  /** When the device recorded the change, not when the server heard about it. */
  readonly recordedAt: Date
  readonly resolvedAt: Date | null
  readonly createdAt: Date
  readonly updatedAt: Date
}

/**
 * The counter that puts a tenant's changes in order, one row per tenant.
 *
 * Server bookkeeping, like the audit chain, and for the same reason: a cursor
 * only works if the numbers come out in the order the transactions commit, and
 * that follows from everybody having to pass this row.
 */
export interface SyncSequence {
  readonly tenantId: TenantId
  readonly nextValue: number
  readonly createdAt: Date
  readonly updatedAt: Date
}
