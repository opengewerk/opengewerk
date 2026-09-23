import type {
  CustomerKind,
  DocumentKind,
  DocumentStatus,
  InstallationKind,
  JobKind,
  JobStatus,
  LineKind,
  LineUnit,
  RecordState,
  RoleKey,
  SnippetPurpose,
  TaskStatus,
  TaxTreatment,
  VatRate,
} from '@opengewerk/domain'
import {
  customerKinds,
  documentKinds,
  documentStatuses,
  installationKinds,
  jobKinds,
  jobStatuses,
  lineKinds,
  lineUnits,
  taskStatuses,
  taxTreatments,
  vatRates,
} from '@opengewerk/domain'

import { oneOf } from '../sync/fields.js'

/**
 * What the words on the screen are.
 *
 * German, because a person reads them, and the keys come from `domain`, so a
 * kind added there is a type error here instead of an empty cell somewhere.
 * That is the whole reason these are maps and not a function with a switch: a
 * switch with a default renders "" for something nobody thought of, and it
 * renders it in production.
 */

export const customerKindLabel: Readonly<Record<CustomerKind, string>> = {
  private: 'Privat',
  business: 'Gewerblich',
  property_management: 'Hausverwaltung',
  general_contractor: 'Generalunternehmer',
}

export const installationKindLabel: Readonly<Record<InstallationKind, string>> = {
  pv_system: 'PV-Anlage',
  battery: 'Speicher',
  meter: 'Zähler',
  meter_cabinet: 'Zählerschrank',
  wallbox: 'Wallbox',
  heating: 'Heizung',
  other: 'Sonstige',
}

export const jobKindLabel: Readonly<Record<JobKind, string>> = {
  project: 'Projekt',
  service: 'Serviceeinsatz',
}

export const jobStatusLabel: Readonly<Record<JobStatus, string>> = {
  draft: 'Entwurf',
  active: 'Laufend',
  completed: 'Abgeschlossen',
  cancelled: 'Abgebrochen',
}

export const taskStatusLabel: Readonly<Record<TaskStatus, string>> = {
  open: 'Offen',
  done: 'Erledigt',
}

export const roleLabel: Readonly<Record<RoleKey, string>> = {
  owner: 'Inhaber',
  office: 'Büro',
  technician: 'Monteur',
}

/**
 * Several roles in one line, for a table cell and for a sentence.
 *
 * A comma and not a slash: somebody with two roles has both, and a slash reads
 * like a choice between them.
 */
export function rolesInWords(roles: readonly RoleKey[]): string {
  return roles.map((role) => roleLabel[role]).join(', ')
}

export const documentKindLabel: Readonly<Record<DocumentKind, string>> = {
  cost_estimate: 'Kostenvoranschlag',
  quote: 'Angebot',
  order_confirmation: 'Auftragsbestätigung',
  delivery_note: 'Lieferschein',
  time_and_material_report: 'Regiebericht',
  progress_invoice: 'Abschlagsrechnung',
  partial_invoice: 'Teilrechnung',
  final_invoice: 'Schlussrechnung',
  credit_note: 'Gutschrift',
  cancellation_invoice: 'Stornorechnung',
  recurring_invoice: 'Dauerrechnung',
}

/**
 * How a document is taxed, in the words the office uses. The two exceptions
 * name their paragraph, because choosing one is a statement about the law.
 */
export const taxTreatmentLabel: Readonly<Record<TaxTreatment, string>> = {
  standard: 'Mit Umsatzsteuer',
  small_business: 'Kleinunternehmer, § 19 UStG',
  reverse_charge: 'Steuerschuld beim Empfänger, § 13b UStG',
}

/** The unit in a choice list, written out. */
export const lineUnitLabel: Readonly<Record<LineUnit, string>> = {
  piece: 'Stück',
  hour: 'Stunden',
  day: 'Tage',
  metre: 'Meter',
  square_metre: 'Quadratmeter',
  cubic_metre: 'Kubikmeter',
  kilogram: 'Kilogramm',
  litre: 'Liter',
  package: 'Pakete',
  flat_rate: 'Pauschal',
}

/**
 * The unit beside a quantity, short, because the column is. The same short
 * forms the printed document uses, so the screen and the paper agree.
 */
export const lineUnitShort: Readonly<Record<LineUnit, string>> = {
  piece: 'Stk.',
  hour: 'Std.',
  day: 'Tag',
  metre: 'm',
  square_metre: 'm²',
  cubic_metre: 'm³',
  kilogram: 'kg',
  litre: 'l',
  package: 'Pkg.',
  flat_rate: 'psch.',
}

/**
 * The rate by name and not by figure. The figure depends on the date of the
 * document, and the totals below the lines show it for that date.
 */
export const vatRateLabel: Readonly<Record<VatRate, string>> = {
  standard: 'Regelsatz',
  reduced: 'Ermäßigt',
  zero: 'Nullsatz, Photovoltaik',
}

export const snippetPurposeLabel: Readonly<Record<SnippetPurpose, string>> = {
  line: 'Position',
  intro: 'Text über den Positionen',
  closing: 'Text unter den Positionen',
}

/**
 * The colour a job's state carries in a list.
 *
 * Never colour alone: every place that uses this writes the word beside it.
 * Colour is the one distinction a colour blind reader does not get, and a row
 * that only differs in hue says nothing to them.
 */
export const jobStatusTone: Readonly<Record<JobStatus, string>> = {
  draft: 'text-ink-muted',
  active: 'text-copper-text',
  completed: 'text-ink',
  cancelled: 'text-conflict',
}

/**
 * The kind or state a record carries, narrowed to something with a label.
 *
 * Four one line functions rather than the same `oneOf` call in nine screens.
 * The fallback is the one a new record gets by default, so a row from a newer
 * server that carries a kind this build has never heard of reads as the
 * ordinary case instead of as an empty cell.
 */
export function customerKindOf(record: RecordState | null | undefined): CustomerKind {
  return oneOf(record, 'kind', customerKinds, 'private')
}

export function installationKindOf(record: RecordState | null | undefined): InstallationKind {
  return oneOf(record, 'kind', installationKinds, 'other')
}

export function jobKindOf(record: RecordState | null | undefined): JobKind {
  return oneOf(record, 'kind', jobKinds, 'service')
}

export function jobStatusOf(record: RecordState | null | undefined): JobStatus {
  return oneOf(record, 'status', jobStatuses, 'draft')
}

export function taskStatusOf(record: RecordState | null | undefined): TaskStatus {
  return oneOf(record, 'status', taskStatuses, 'open')
}

export function documentKindOf(record: RecordState | null | undefined): DocumentKind {
  return oneOf(record, 'kind', documentKinds, 'quote')
}

export function documentStatusOf(record: RecordState | null | undefined): DocumentStatus {
  return oneOf(record, 'status', documentStatuses, 'draft')
}

export function taxTreatmentOf(record: RecordState | null | undefined): TaxTreatment {
  return oneOf(record, 'taxTreatment', taxTreatments, 'standard')
}

export function lineKindOf(record: RecordState | null | undefined): LineKind {
  return oneOf(record, 'kind', lineKinds, 'item')
}

export function lineUnitOf(record: RecordState | null | undefined): LineUnit {
  return oneOf(record, 'unit', lineUnits, 'piece')
}

export function vatRateOf(record: RecordState | null | undefined): VatRate {
  return oneOf(record, 'vatRate', vatRates, 'standard')
}
