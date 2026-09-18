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
