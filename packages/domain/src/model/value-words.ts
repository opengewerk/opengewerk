import {
  cableInstallationMethodLabel,
  distributionBoardKindLabel,
  overcurrentDeviceLabel,
  rcdTypeLabel,
  type TaskStatus,
  tripCharacteristicLabel,
} from '@opengewerk/platform-domain'

import type { VatRate } from '../rules/tax.js'
import { accessRequestStatusLabel, accessSubjectLabel } from './access-request.js'
import { applianceMobilityLabel } from './appliance.js'
import type { CustomerKind } from './customer.js'
import { erasureRequestChannelLabel, erasureRequestStatusLabel } from './customer-erasure.js'
import type { DocumentKind, DocumentStatus, TaxTreatment } from './document.js'
import type { LineUnit } from './document-line.js'
import { installationKindLabel } from './installation.js'
import type { JobKind, JobStatus } from './job.js'
import { metalNames } from './metal.js'
import { processingActivities } from './processing-record.js'
import { prospectSourceLabel, prospectStageLabel } from './prospect.js'
import type { SnippetPurpose } from './text-snippet.js'
import type { TimeEntryKind } from './time-entry.js'

/**
 * What the values the database writes are called, `issued` "Festgeschrieben"
 * and `private` "Privat": for the screens, the change log of the office and
 * the answer to a request for access (#318), which prints them for a person
 * outside the business. Until #318 these maps lived in the web application
 * alone, and the server had no words for a value.
 *
 * German, because a person reads them, and the keys come from the types, so a
 * kind added there is a type error here instead of an empty cell somewhere.
 */

export const customerKindLabel: Readonly<Record<CustomerKind, string>> = {
  private: 'Privat',
  business: 'Gewerbe',
  property_management: 'Hausverwaltung',
  general_contractor: 'Generalunternehmer',
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

export const documentKindLabel: Readonly<Record<DocumentKind, string>> = {
  cost_estimate: 'Kostenvoranschlag',
  quote: 'Angebot',
  order_confirmation: 'Auftragsbestätigung',
  delivery_note: 'Lieferschein',
  time_and_material_report: 'Regiebericht',
  progress_invoice: 'Abschlagsrechnung',
  partial_invoice: 'Teilrechnung',
  // What makes one a Schlussrechnung is in the document, not in its kind (#132).
  final_invoice: 'Rechnung',
  credit_note: 'Gutschrift',
  cancellation_invoice: 'Stornorechnung',
  recurring_invoice: 'Dauerrechnung',
}

/** Where a document stands, as its badge says it. */
export const documentStatusLabel: Readonly<Record<DocumentStatus, string>> = {
  draft: 'Entwurf',
  signed: 'Unterschrieben',
  issued: 'Festgeschrieben',
  cancelled: 'Storniert',
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
  mail: 'E-Mail',
}

export const timeEntryKindLabel: Readonly<Record<TimeEntryKind, string>> = {
  work: 'Arbeit',
  travel: 'Fahrt',
  break: 'Pause',
}

type Words = Readonly<Record<string, string>>

/**
 * The words of the values by table and field, as far as the domain knows
 * them: what the change log of the office shows for a value, and what the
 * answer to a request for access prints. A field without words prints as the
 * database wrote it.
 */
export const valueWords: Readonly<Record<string, Readonly<Record<string, Words>>>> = {
  customers: { kind: customerKindLabel, source: prospectSourceLabel },
  // The leads (#312).
  prospects: { kind: customerKindLabel, source: prospectSourceLabel, stage: prospectStageLabel },
  installations: { kind: installationKindLabel },
  // The register of appliances (#303).
  appliances: { mobility: applianceMobilityLabel },
  jobs: { kind: jobKindLabel, status: jobStatusLabel },
  tasks: { status: taskStatusLabel },
  documents: {
    kind: documentKindLabel,
    status: documentStatusLabel,
    tax_treatment: taxTreatmentLabel,
  },
  document_lines: { unit: lineUnitLabel, vat_rate: vatRateLabel },
  text_snippets: { purpose: snippetPurposeLabel },
  distribution_boards: { kind: distributionBoardKindLabel },
  circuits: {
    overcurrent_device: overcurrentDeviceLabel,
    trip_characteristic: tripCharacteristicLabel,
    rcd_type: rcdTypeLabel,
    cable_installation_method: cableInstallationMethodLabel,
  },
  time_entries: { kind: timeEntryKindLabel },
  // Copper and aluminium by name (#462).
  supplier_article_metals: { metal: metalNames },
  supplier_metal_prices: { metal: metalNames },
  // The deletion concept and the requests for access (#845, #318).
  erasure_requests: { channel: erasureRequestChannelLabel, status: erasureRequestStatusLabel },
  access_requests: {
    subject: accessSubjectLabel,
    channel: erasureRequestChannelLabel,
    status: accessRequestStatusLabel,
  },
  // An activity of the record of the processing by its title (#319).
  processing_record_activities: {
    activity: Object.fromEntries(
      processingActivities.map((activity) => [activity.key, activity.title]),
    ),
  },
}
