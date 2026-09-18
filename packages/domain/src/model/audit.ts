import type { AuditEntryId, TenantId } from './identifier.js'

/** What happened to the record. */
export const auditOperations = ['insert', 'update', 'delete'] as const

export type AuditOperation = (typeof auditOperations)[number]

/**
 * One field of one record, before and after. Leading decision 4 asks for a
 * change log at field level, and this is that level: not "the customer was
 * edited" but "the VAT id went from this to that, on that day, by that
 * person".
 *
 * One change to a record produces one entry per field that actually differs,
 * and all of them share a `changeId`. That is how the log answers both
 * questions an audit asks: what happened to this field over time, and what
 * else moved in the same breath.
 *
 * There is no `updatedAt` here and no `TenantOwned`, on purpose. An entry is
 * written once and never touched again, so a column saying when it last
 * changed would be a standing lie.
 */
export interface AuditEntry {
  readonly id: AuditEntryId
  readonly tenantId: TenantId
  /** The fields of one change to one record carry the same value here. */
  readonly changeId: string
  readonly tableName: string
  /**
   * The record the change happened to. Deliberately not a foreign key: the
   * history of a deleted record has to outlive it, and a key pointing at
   * fifteen different tables cannot be declared anyway.
   */
  readonly recordId: string
  readonly operation: AuditOperation
  /** The column name as the database spells it, so it can be matched back. */
  readonly field: string
  readonly oldValue: string | null
  readonly newValue: string | null
  readonly changedAt: Date
  /**
   * Who did it, empty when the change did not come through the application.
   * A migration or somebody at a psql prompt lands in the log all the same,
   * and the missing name is the finding, not a gap.
   */
  readonly userId: string | null
  /** Why. The application fills in the action, a person can say more. */
  readonly reason: string | null
  /**
   * The database role the connection used. It is what is left to go on when
   * there is no user: `opengewerk_app` means the change came through the
   * application, anything else means somebody was at the database directly.
   */
  readonly databaseRole: string
}
