import type { Id } from '@opengewerk/platform-domain'

/**
 * The keys of this application's entities. `Id` and the keys every
 * application shares (tenant, membership, invitation, audit entry, stored
 * file, contact, the parts of the electrical and PV structure) come from the
 * foundation, as do `IsoDate`, `TenantOwned` and
 * `Synced` (ADR 0010).
 */
export type CustomerId = Id<'customer'>
export type SiteId = Id<'site'>
export type InstallationId = Id<'installation'>
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
export type TimeEntryId = Id<'time-entry'>
export type LocationConsentId = Id<'location-consent'>
export type JobNoteId = Id<'job-note'>
export type AppointmentId = Id<'appointment'>
export type AppointmentPersonId = Id<'appointment-person'>
export type DeadlineId = Id<'deadline'>
export type DeadlineSettingId = Id<'deadline-setting'>
export type PushSubscriptionId = Id<'push-subscription'>
export type PushOptOutId = Id<'push-opt-out'>
export type PushMessageId = Id<'push-message'>
