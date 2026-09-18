import type {
  AuditEntry,
  BoardSection,
  Circuit,
  Contact,
  Customer,
  DistributionBoard,
  Document,
  Equipment,
  Installation,
  Inverter,
  Job,
  NumberRange,
  PvModule,
  PvString,
  Site,
  Tenant,
} from '@opengewerk/domain'

import type {
  auditEntries,
  boardSections,
  circuits,
  contacts,
  customers,
  distributionBoards,
  documents,
  equipment,
  installations,
  inverters,
  jobs,
  numberRanges,
  pvModules,
  pvStrings,
  sites,
  tenants,
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
export type CustomerMatches = Assert<Exact<typeof customers.$inferSelect, Customer>>
export type ContactMatches = Assert<Exact<typeof contacts.$inferSelect, Contact>>
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
export type NumberRangeMatches = Assert<Exact<typeof numberRanges.$inferSelect, NumberRange>>
export type AuditEntryMatches = Assert<Exact<typeof auditEntries.$inferSelect, AuditEntry>>
