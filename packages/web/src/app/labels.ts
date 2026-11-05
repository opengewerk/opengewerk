import type {
  CustomerKind,
  DocumentKind,
  DocumentStatus,
  InstallationKind,
  JobKind,
  JobStatus,
  LineKind,
  LineUnit,
  PriceBase,
  RecordState,
  RoleKey,
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
import { oneOf } from '@opengewerk/platform-web/sync'

/**
 * What the words on the screen are.
 *
 * German, because a person reads them, and the keys come from `domain`, so a
 * kind added there is a type error here instead of an empty cell somewhere.
 * That is the whole reason these are maps and not a function with a switch: a
 * switch with a default renders "" for something nobody thought of, and it
 * renders it in production.
 */

// The report of a site prints the same words (#302); the words of the values
// live in the domain since #318, where the answer to a request for access
// prints them as well.
export {
  customerKindLabel,
  documentKindLabel,
  installationKindLabel,
  jobKindLabel,
  jobStatusLabel,
  lineUnitLabel,
  snippetPurposeLabel,
  taskStatusLabel,
  taxTreatmentLabel,
  vatRateLabel,
} from '@opengewerk/domain'

/**
 * The three roles a business starts with, by key, for the one place that has
 * a key and no business to ask: an old value in the log of changes. Everywhere
 * else a role is called what its business calls it, which the server says.
 */
export const roleLabel: Readonly<Record<RoleKey, string>> = {
  owner: 'Inhaber',
  office: 'Büro',
  technician: 'Monteur',
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

const wholeNumbers = new Intl.NumberFormat('de-DE')

/** How many units a price is for, as a choice says it: "100 Stk." (#456). */
export function priceBaseLabel(base: PriceBase, unit: LineUnit): string {
  return `${wholeNumbers.format(base)} ${lineUnitShort[unit]}`
}

/**
 * The words under a unit price that is for more than one unit, "je 100 Stk.",
 * as the printed document writes them; nothing for a price for one unit, which
 * stands alone as it always did.
 */
export function priceBaseText(base: PriceBase, unit: LineUnit): string | null {
  return base > 1 ? `je ${priceBaseLabel(base, unit)}` : null
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
