import type { DocumentKind } from './document.js'
import type { NumberRangeId, TenantOwned } from './identifier.js'

/**
 * Which counter a document draws from. Not one per document kind: every kind
 * of invoice shares a single sequence, because section 14 UStG asks for one
 * number per invoice, assigned once and running without gaps. A cancellation
 * is an invoice too and belongs in the same sequence; putting it in its own
 * would leave a hole in the one that matters.
 *
 * Quotes and estimates share a sequence for the opposite reason: nothing legal
 * hangs on them, and a business that sends both does not want two counters.
 */
export const numberRangeKeys = [
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

export const defaultPatterns: Readonly<Record<NumberRangeKey, string>> = {
  quote: 'AN-{year}-{number:4}',
  order_confirmation: 'AB-{year}-{number:4}',
  delivery_note: 'LS-{year}-{number:4}',
  report: 'RB-{year}-{number:4}',
  invoice: 'RE-{year}-{number:4}',
}

const placeholder = /\{(year|number)(?::(\d+))?\}/g

export class InvalidPatternError extends Error {}

/**
 * Builds the number from a pattern and a counter. The client shows what the
 * next document will be called, the server hands out the counter and builds
 * the same string from it. One function for both, so a preview cannot differ
 * from what ends up on the invoice: it is the same code, not the same idea
 * written twice.
 *
 * The counter is not part of the preview's promise. Somebody else may issue a
 * document first, and then the number moves on. What must hold is that a
 * counter always produces the same text.
 */
export function formatDocumentNumber(
  pattern: string,
  values: { readonly counter: number; readonly year: number },
): string {
  if (!pattern.includes('{number')) {
    throw new InvalidPatternError(`Pattern without a number: ${pattern}`)
  }

  if (!Number.isInteger(values.counter) || values.counter < 1) {
    throw new InvalidPatternError(`Counter is not a positive whole number: ${values.counter}`)
  }

  return pattern.replace(placeholder, (_match, name: string, width: string | undefined) => {
    if (name === 'year') {
      return String(values.year)
    }

    const digits = width === undefined ? 1 : Number.parseInt(width, 10)

    return String(values.counter).padStart(digits, '0')
  })
}
