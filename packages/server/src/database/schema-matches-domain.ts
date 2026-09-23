import type {
  Attachment,
  AttachmentVersion,
  AuditChain,
  AuditEntry,
  BoardSection,
  Circuit,
  Contact,
  Customer,
  DistributionBoard,
  Document,
  DocumentFile,
  DocumentInstructionChoices,
  DocumentLine,
  DocumentSignature,
  DocumentSnapshot,
  Equipment,
  Installation,
  Instruction,
  Inverter,
  Job,
  Letterhead,
  Membership,
  NumberRange,
  PvModule,
  PvString,
  Site,
  StoredFile,
  SyncConflict,
  SyncOperation,
  SyncSequence,
  Task,
  Tenant,
  TenantParameter,
  TenantSession,
  TextSnippet,
  TimeEntry,
  LocationConsent,
} from '@opengewerk/domain'

import type {
  attachments,
  attachmentVersions,
  auditChains,
  auditEntries,
  boardSections,
  circuits,
  contacts,
  customers,
  distributionBoards,
  documentFiles,
  documentInstructionChoices,
  documentLines,
  documents,
  documentSignatures,
  documentSnapshots,
  equipment,
  files,
  installations,
  instructions,
  inverters,
  jobs,
  letterheads,
  memberships,
  numberRanges,
  pvModules,
  pvStrings,
  sites,
  syncConflicts,
  syncOperations,
  syncSequences,
  tasks,
  tenantParameters,
  tenants,
  tenantSessions,
  textSnippets,
  timeEntries,
  locationConsents,
} from './schema/index.js'

/**
 * The model in `domain` is what the data means; the tables here are only where
 * it is kept. This file makes the compiler say so. Each line demands that a
 * row and its model are the same shape in both directions, so a column added
 * on one side and forgotten on the other does not compile.
 *
 * Without this the two drift apart quietly: the schema grows a column, nobody
 * touches the model, and months later the browser and the server disagree
 * about what a customer is.
 */
type Exact<Row, Model> = [Row] extends [Model] ? ([Model] extends [Row] ? true : false) : false

type Assert<Matches extends true> = Matches

export type TenantMatches = Assert<Exact<typeof tenants.$inferSelect, Tenant>>
export type TenantParameterMatches = Assert<
  Exact<typeof tenantParameters.$inferSelect, TenantParameter>
>
export type CustomerMatches = Assert<Exact<typeof customers.$inferSelect, Customer>>
export type ContactMatches = Assert<Exact<typeof contacts.$inferSelect, Contact>>
export type AttachmentMatches = Assert<Exact<typeof attachments.$inferSelect, Attachment>>
export type AttachmentVersionMatches = Assert<
  Exact<typeof attachmentVersions.$inferSelect, AttachmentVersion>
>
export type SiteMatches = Assert<Exact<typeof sites.$inferSelect, Site>>
export type InstallationMatches = Assert<Exact<typeof installations.$inferSelect, Installation>>
export type DistributionBoardMatches = Assert<
  Exact<typeof distributionBoards.$inferSelect, DistributionBoard>
>
export type BoardSectionMatches = Assert<Exact<typeof boardSections.$inferSelect, BoardSection>>
export type CircuitMatches = Assert<Exact<typeof circuits.$inferSelect, Circuit>>
export type EquipmentMatches = Assert<Exact<typeof equipment.$inferSelect, Equipment>>
export type InverterMatches = Assert<Exact<typeof inverters.$inferSelect, Inverter>>
export type PvStringMatches = Assert<Exact<typeof pvStrings.$inferSelect, PvString>>
export type PvModuleMatches = Assert<Exact<typeof pvModules.$inferSelect, PvModule>>
export type JobMatches = Assert<Exact<typeof jobs.$inferSelect, Job>>
export type DocumentMatches = Assert<Exact<typeof documents.$inferSelect, Document>>
export type DocumentLineMatches = Assert<Exact<typeof documentLines.$inferSelect, DocumentLine>>
export type DocumentSnapshotMatches = Assert<
  Exact<typeof documentSnapshots.$inferSelect, DocumentSnapshot>
>
export type DocumentFileMatches = Assert<Exact<typeof documentFiles.$inferSelect, DocumentFile>>
export type StoredFileMatches = Assert<Exact<typeof files.$inferSelect, StoredFile>>
export type LetterheadMatches = Assert<Exact<typeof letterheads.$inferSelect, Letterhead>>
export type TextSnippetMatches = Assert<Exact<typeof textSnippets.$inferSelect, TextSnippet>>
export type TimeEntryMatches = Assert<Exact<typeof timeEntries.$inferSelect, TimeEntry>>
export type LocationConsentMatches = Assert<
  Exact<typeof locationConsents.$inferSelect, LocationConsent>
>
export type InstructionMatches = Assert<Exact<typeof instructions.$inferSelect, Instruction>>
export type DocumentInstructionChoicesMatches = Assert<
  Exact<typeof documentInstructionChoices.$inferSelect, DocumentInstructionChoices>
>
export type DocumentSignatureMatches = Assert<
  Exact<typeof documentSignatures.$inferSelect, DocumentSignature>
>
export type TaskMatches = Assert<Exact<typeof tasks.$inferSelect, Task>>
export type NumberRangeMatches = Assert<Exact<typeof numberRanges.$inferSelect, NumberRange>>
export type AuditEntryMatches = Assert<Exact<typeof auditEntries.$inferSelect, AuditEntry>>
export type AuditChainMatches = Assert<Exact<typeof auditChains.$inferSelect, AuditChain>>
export type SyncSequenceMatches = Assert<Exact<typeof syncSequences.$inferSelect, SyncSequence>>
export type SyncOperationMatches = Assert<Exact<typeof syncOperations.$inferSelect, SyncOperation>>
export type SyncConflictMatches = Assert<Exact<typeof syncConflicts.$inferSelect, SyncConflict>>
export type MembershipMatches = Assert<Exact<typeof memberships.$inferSelect, Membership>>
export type TenantSessionMatches = Assert<Exact<typeof tenantSessions.$inferSelect, TenantSession>>

// The `auth_*` tables are not on this list, and that is the one deliberate gap
// in it. Their shape is better-auth's, not ours: the library decides what a
// session row carries, and a model in `domain` mirroring it would claim an
// authority over those columns that we do not have. The two columns we did add
// to a session, the chosen tenant and the device, are the ones this server
// reads, and `SessionContext` in `authentication/session.ts` is where they are
// given a shape. What a business may see of a sign in is `TenantSession`, and
// that one is on the list.
