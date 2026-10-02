import type { DocumentKind } from './document.js'
import type { TenantOwned } from '@opengewerk/platform-domain'
import type { NumberRangeId } from './identifier.js'

/**
 * Which counter a document draws from. Not one per document kind: every kind
 * of invoice shares a single sequence, because section 14 UStG asks for one
 * number per invoice, assigned once and running without gaps. A cancellation
 * is an invoice too and belongs in the same sequence; putting it in its own
 * would leave a hole in the one that matters.
 *
 * Quotes and estimates share a sequence for the opposite reason: nothing legal
 * hangs on them, and a business that sends both does not want two counters.
 *
 * Jobs have one of their own (#145), although a job is no document: it is the
 * number the office, the site and the customer on the phone name a job by.
 * Nothing legal hangs on it either, and it is drawn the same way all the same,
 * inside the transaction that creates the job, so that it has no holes.
 */
export const numberRangeKeys = [
  'job',
  'quote',
  'order_confirmation',
  'delivery_note',
  'report',
  'invoice',
] as const

export type NumberRangeKey = (typeof numberRangeKeys)[number]

const rangeOfKind: Readonly<Record<DocumentKind, NumberRangeKey>> = {
  cost_estimate: 'quote',
  quote: 'quote',
  order_confirmation: 'order_confirmation',
  delivery_note: 'delivery_note',
  time_and_material_report: 'report',
  progress_invoice: 'invoice',
  partial_invoice: 'invoice',
  final_invoice: 'invoice',
  credit_note: 'invoice',
  cancellation_invoice: 'invoice',
  recurring_invoice: 'invoice',
}

export function numberRangeOf(kind: DocumentKind): NumberRangeKey {
  return rangeOfKind[kind]
}

export interface NumberRange extends TenantOwned {
  readonly id: NumberRangeId
  readonly key: NumberRangeKey
  /** For example `RE-{year}-{number:4}`. */
  readonly pattern: string
  /** The value the next document will get. Starts at 1. */
  readonly nextValue: number
}

/**
 * The pattern each sequence starts with, until a business sets its own. How a
 * pattern is written, what is wrong with one and what a counter becomes in it
 * is the foundation's (`patternProblem` and `numberFromPattern`, ADR 0010).
 */
export const defaultPatterns: Readonly<Record<NumberRangeKey, string>> = {
  job: 'AU-{year}-{number:4}',
  quote: 'AN-{year}-{number:4}',
  order_confirmation: 'AB-{year}-{number:4}',
  delivery_note: 'LS-{year}-{number:4}',
  report: 'RB-{year}-{number:4}',
  invoice: 'RE-{year}-{number:4}',
}
