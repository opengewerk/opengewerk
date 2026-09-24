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

export const defaultPatterns: Readonly<Record<NumberRangeKey, string>> = {
  job: 'AU-{year}-{number:4}',
  quote: 'AN-{year}-{number:4}',
  order_confirmation: 'AB-{year}-{number:4}',
  delivery_note: 'LS-{year}-{number:4}',
  report: 'RB-{year}-{number:4}',
  invoice: 'RE-{year}-{number:4}',
}

const placeholder = /\{(year|number)(?::(\d+))?\}/g

/** The longest pattern a business may set. A number sits in a header line, not a paragraph. */
export const patternMaxLength = 40

/** A place for the counter: `{number}`, or `{number:4}` for four digits with leading zeros. */
const counterPlace = /^number(?::(\d+))?$/

/**
 * What is wrong with a pattern a business wants, as a sentence for the
 * screen, or null when nothing is.
 *
 * One function for the form and the route, so that the field says what the
 * server would refuse. A pattern needs exactly one place for the counter:
 * without one every document would get the same number, with two it would be
 * printed twice. The year may stand once. Everything around the placeholders
 * is letters, digits and the separators numbers are written with, because the
 * number travels into e-invoices and file names, where an umlaut or a space is
 * a question somebody else has to answer.
 */
export function patternProblem(pattern: string): string | null {
  if (pattern.trim() === '') {
    return 'Das Muster ist leer.'
  }

  if (pattern.length > patternMaxLength) {
    return `Das Muster ist länger als ${String(patternMaxLength)} Zeichen.`
  }

  // The text around the placeholders first: a brace left open is what went
  // wrong in "RE-{number", and saying the counter is missing would send
  // somebody looking in the wrong place.
  const literal = pattern.replace(/\{[^{}]*\}/g, '')

  if (/[{}]/.test(literal)) {
    return 'Eine geschweifte Klammer ohne Gegenstück. Platzhalter stehen in {}, etwa {year}.'
  }

  if (!/^[A-Za-z0-9._/-]*$/.test(literal)) {
    return 'Zwischen den Platzhaltern stehen nur Buchstaben ohne Umlaute, Ziffern und . _ / -'
  }

  const places = [...pattern.matchAll(/\{([^{}]*)\}/g)].map((found) => found[1] ?? '')
  const unknown = places.find((name) => name !== 'year' && !counterPlace.test(name))

  if (unknown !== undefined) {
    return `Unbekannter Platzhalter {${unknown}}. Möglich sind {year}, {number} und {number:4}.`
  }

  const counters = places.filter((name) => counterPlace.test(name))

  if (counters.length === 0) {
    return 'Es fehlt {number}, die laufende Nummer. Ohne sie bekäme jeder Beleg dieselbe Nummer.'
  }

  if (counters.length > 1) {
    return 'Die laufende Nummer steht zweimal im Muster.'
  }

  if (places.filter((name) => name === 'year').length > 1) {
    return 'Das Jahr steht zweimal im Muster.'
  }

  const width = counterPlace.exec(counters[0] ?? '')?.[1]

  if (width !== undefined && (Number(width) < 1 || Number(width) > 10)) {
    return 'Die laufende Nummer hat 1 bis 10 Stellen, etwa {number:4}.'
  }

  return null
}

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
