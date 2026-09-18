declare const idBrand: unique symbol

/**
 * A UUIDv7 key. The brand exists so that a site id cannot be passed where a
 * customer id belongs: both are strings, and the compiler has no other way to
 * tell them apart. Values are created as UUIDv7 (ADR 0003) so that a client
 * without a network connection can mint one without asking the server.
 */
export type Id<Entity extends string> = string & { readonly [idBrand]: Entity }

/** A date without a time of day, as ISO 8601: `2026-09-18`. */
export type IsoDate = string

export type TenantId = Id<'tenant'>
export type CustomerId = Id<'customer'>
export type ContactId = Id<'contact'>
export type SiteId = Id<'site'>
export type InstallationId = Id<'installation'>
export type DistributionBoardId = Id<'distribution-board'>
export type BoardSectionId = Id<'board-section'>
export type CircuitId = Id<'circuit'>
export type EquipmentId = Id<'equipment'>
export type InverterId = Id<'inverter'>
export type PvStringId = Id<'pv-string'>
export type PvModuleId = Id<'pv-module'>
export type JobId = Id<'job'>
export type DocumentId = Id<'document'>
export type NumberRangeId = Id<'number-range'>
export type AuditEntryId = Id<'audit-entry'>

/**
 * Every record carries the tenant it belongs to and when it was written. The
 * tenant column is the anchor for row level security, which arrives with its
 * own issue; the column itself belongs to the model, not to that mechanism.
 */
export interface TenantOwned {
  readonly id: string
  readonly tenantId: TenantId
  readonly createdAt: Date
  readonly updatedAt: Date
}

/**
 * A record that travels to devices and back, and therefore has to survive
 * being changed in two places at once.
 *
 * Not every record does. A number range is a counter that never leaves the
 * server, and giving it a `deletedAt` would say something untrue about it. The
 * entities that do sync are the ones a technician has in front of them in a
 * basement, and they are listed once, in the sync policies.
 */
export interface Synced extends TenantOwned {
  /** Counts up on every change. A shortcut for "has anything happened here". */
  readonly version: number
  /** Who wrote it last. On the row, because a device has no audit log. */
  readonly updatedBy: string | null
  readonly deviceId: string | null
  /**
   * Set instead of removing the row. A record that is gone is a record a
   * device that was offline never hears about, because a delta pull delivers
   * rows that changed and a deleted row is not one.
   */
  readonly deletedAt: Date | null
  /**
   * Where this change sits in the tenant's stream of changes. The cursor a
   * device asks for more with, and it counts in commit order, which is what
   * keeps a late commit from slipping past a cursor that has moved on.
   */
  readonly changeSequence: number
}
