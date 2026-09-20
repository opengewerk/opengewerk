import type {
  CustomerKind,
  DocumentKind,
  InstallationKind,
  JobKind,
  JobStatus,
  RecordState,
  RoleKey,
} from '@opengewerk/domain'
import { customerKinds, installationKinds, jobKinds, jobStatuses } from '@opengewerk/domain'

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

export const roleLabel: Readonly<Record<RoleKey, string>> = {
  owner: 'Inhaber',
  office: 'Büro',
  technician: 'Monteur',
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
