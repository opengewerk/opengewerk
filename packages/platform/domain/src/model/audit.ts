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
   * Where the entry sits in its tenant's chain, counted from one. The chain is
   * per tenant and not per instance, because a tenant can only ever see its
   * own rows: a chain it cannot read is a chain it cannot check.
   */
  readonly sequence: number
  /** The hash of the entry before this one, empty for the first. */
  readonly previousHash: string | null
  /**
   * This entry, hashed together with the one before it. Changing a value,
   * removing an entry or slipping one in breaks the chain from that point on,
   * and the check finds the place.
   */
  readonly hash: string
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

/**
 * The head of one tenant's chain, and the point where writers line up.
 *
 * The tenant is the key: there is exactly one chain per tenant, so a second
 * column to identify the row would only be ceremony. Advancing this row is
 * what puts concurrent changes into a defined order, which a chain needs and
 * an unordered log does not.
 */
export interface AuditChain {
  readonly tenantId: TenantId
  /** The number the next entry will get. */
  readonly nextSequence: number
  readonly headHash: string | null
  readonly createdAt: Date
  readonly updatedAt: Date
}

/** What a walk over a tenant's chain found. */
export interface ChainVerification {
  readonly checked: number
  /** The first entry that does not fit, or null when the chain is sound. */
  readonly brokenAt: number | null
  /** What was wrong there, in German, because a person reads it. */
  readonly problem: string | null
}

// A log as a person reads it: one change per write with its fields, and the
// names a page needs. The log of a tenant and the log of an instance are both
// shown this way, so that a screen draws one of them and has drawn the other.

/** One field of one change, before and after, as the text the log holds. */
export interface AuditFieldChange {
  /** The column as the database spells it. */
  readonly field: string
  readonly before: string | null
  readonly after: string | null
}

/**
 * One write to one record: every field that moved in it, who made it, when,
 * from which device and why. The log groups them by `change_id`, one per row
 * the trigger saw.
 */
export interface AuditChange {
  readonly changeId: string
  /** ISO 8601, as the database wrote it. */
  readonly changedAt: string
  readonly operation: AuditOperation
  readonly table: string
  readonly recordId: string
  readonly userId: string | null
  /**
   * The device the record says it was written from, which the log only notes
   * when it changes: a change that does not move `device_id` came from the
   * device of the change before it. Null for anything written in the office
   * outside the sync, and for tables without the column.
   */
  readonly deviceId: string | null
  readonly reason: string | null
  readonly databaseRole: string
  /** Where the change sits in the chain, so that a break can be put at its change. */
  readonly firstSequence: number
  readonly lastSequence: number
  readonly fields: readonly AuditFieldChange[]
}

/** What a record on a page is called, found in the log itself. */
export interface AuditTitle {
  readonly table: string
  /**
   * The field the name came from, for the screen to write it as that field
   * is written: a person's name for `user_id`, a date for `started_at`. Null
   * for a contact, whose name is two fields.
   */
  readonly field: string | null
  /** The name, number or designation the record last carried, or null. */
  readonly title: string | null
  /** Its `kind` where it has one, for the screen to say what sort of record it is. */
  readonly kind: string | null
}

/** The most changes one page of a log holds. */
export const auditPageSize = 50
