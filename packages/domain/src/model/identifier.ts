import type { Id } from '@opengewerk/platform-domain'

/**
 * The keys of this application's entities. `Id` and the keys every
 * application shares (tenant, membership, invitation, audit entry, stored
 * file, contact) come from the foundation, as do `IsoDate`, `TenantOwned` and
 * `Synced` (ADR 0010).
 */
export type CustomerId = Id<'customer'>
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
export type DocumentLineId = Id<'document-line'>
export type NumberRangeId = Id<'number-range'>
export type LetterheadId = Id<'letterhead'>
export type DocumentSnapshotId = Id<'document-snapshot'>
export type DocumentFileId = Id<'document-file'>
export type TextSnippetId = Id<'text-snippet'>
export type DocumentSignatureId = Id<'document-signature'>
export type TaskId = Id<'task'>
export type InstructionId = Id<'instruction'>
export type DocumentInstructionChoicesId = Id<'document-instruction-choices'>
export type AttachmentId = Id<'attachment'>
export type AttachmentVersionId = Id<'attachment-version'>
export type TimeEntryId = Id<'time-entry'>
export type LocationConsentId = Id<'location-consent'>
export type JobNoteId = Id<'job-note'>
export type DeadlineId = Id<'deadline'>
export type DeadlineSettingId = Id<'deadline-setting'>
export type PushSubscriptionId = Id<'push-subscription'>
export type PushOptOutId = Id<'push-opt-out'>
export type PushMessageId = Id<'push-message'>
