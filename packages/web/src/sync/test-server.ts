import type { Operation, OperationReceipt, RecordState } from '@opengewerk/domain'

import type { DirectWriter } from './client.js'
import type { PullResult, SyncTransport } from './transport.js'

type Row = Record<string, unknown>

/**
 * A stand in for the server, for the screen tests that write through the
 * outbox: it keeps what it is sent, hands it back on the next pull, and can be
 * taken off the network.
 *
 * It applies every operation as the real one does when nothing stands in the
 * way, a record created with what it carries and changed field by field, and
 * it does nothing the real one decides on its own. A test that needs a
 * refusal or a trigger builds that into its own stand in.
 */
export class TestServer implements SyncTransport, DirectWriter {
  readonly sent: Operation[][] = []
  offline = false
  private readonly tables = new Map<string, Map<string, Row>>()
  private changed = new Map<string, Set<string>>()
  private cursor = 1

  put(entity: string, row: Row): void {
    const table = this.tables.get(entity) ?? new Map<string, Row>()
    const id = String(row['id'])

    table.set(id, { version: 1, deletedAt: null, ...row })
    this.tables.set(entity, table)
    this.changed.set(entity, (this.changed.get(entity) ?? new Set()).add(id))
  }

  row(entity: string, id: string): Row | undefined {
    return this.tables.get(entity)?.get(id)
  }

  all(entity: string): Row[] {
    return [...(this.tables.get(entity)?.values() ?? [])]
  }

  /** Everything sent, in the order it was sent. */
  operations(): Operation[] {
    return this.sent.flat()
  }

  private apply(operation: Operation): void {
    const id = operation.recordId
    const current = this.row(operation.entity, id) ?? { id, deletedAt: null, version: 0 }
    const values = Object.fromEntries(operation.patches.map((patch) => [patch.field, patch.to]))

    this.put(operation.entity, {
      ...current,
      ...values,
      version: Number(current['version'] ?? 0) + 1,
      deletedAt: operation.kind === 'delete' ? '2026-09-22T08:00:00.000Z' : current['deletedAt'],
    })
  }

  push(_deviceId: string, operations: readonly Operation[]) {
    if (this.offline) {
      return Promise.reject(new TypeError('Failed to fetch'))
    }

    this.sent.push([...operations])

    for (const operation of operations) {
      this.apply(operation)
    }

    return Promise.resolve(
      operations.map((operation): OperationReceipt => ({
        operationId: operation.id,
        outcome: 'applied',
        reason: null,
        fields: [],
      })),
    )
  }

  pull(): Promise<PullResult> {
    if (this.offline) {
      return Promise.reject(new TypeError('Failed to fetch'))
    }

    const changes = [...this.changed].map(([entity, ids]) => ({
      entity,
      rows: [...ids].map((id) => this.row(entity, id) as RecordState),
    }))

    this.changed = new Map()
    this.cursor += 1

    return Promise.resolve({ changes, cursor: this.cursor, hasMore: false })
  }

  conflicts() {
    return this.offline ? Promise.reject(new TypeError('Failed to fetch')) : Promise.resolve([])
  }

  resolve() {
    return Promise.resolve()
  }

  patch() {
    return Promise.reject(new TypeError('Failed to fetch'))
  }

  remove() {
    return Promise.reject(new TypeError('Failed to fetch'))
  }
}
