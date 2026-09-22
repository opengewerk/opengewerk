import type { DocumentKind } from './document.js'
import type { PaymentTermContent } from './document-content.js'
import type { IsoDate } from './identifier.js'

/**
 * The payment term of a document: how many days after its date the customer
 * has to pay.
 *
 * A business sets it once, in its settings, and every document takes it from
 * there. A single document can state its own, for the customer who agreed on
 * thirty days or the small job that is paid on the spot, and the documents
 * made out of it carry that along. The setting is a tenant parameter with a
 * period of validity like the others, `invoice.payment_term_days`, so a
 * document reads the one of its own date, and a draft from before a change
 * keeps the term it was written under.
 *
 * The default is what a business gets before it has set anything, and it is
 * the term most trade businesses write: fourteen days.
 */
export const defaultPaymentTermDays = 14

/**
 * The longest term accepted, a year. Not a legal limit, a guard against a
 * typing error: fourteen hundred days where fourteen were meant would print a
 * due date nobody intended.
 */
export const longestPaymentTermDays = 365

/**
 * The kinds that state a payment term.
 *
 * Every kind that asks for money, and the three the work is agreed on: the
 * quote, the estimate and the order confirmation state the term of the invoice
 * still to come, so that the customer accepts it together with the prices.
 * Not the report, which has no prices, not the delivery note, and not the two
 * correcting kinds: a cancellation or a credit note gives back, it asks for
 * nothing.
 */
export const paymentTermKinds = [
  'cost_estimate',
  'quote',
  'order_confirmation',
  'progress_invoice',
  'partial_invoice',
  'final_invoice',
  'recurring_invoice',
] as const satisfies readonly DocumentKind[]

export function statesPaymentTerm(kind: DocumentKind): boolean {
  return (paymentTermKinds as readonly DocumentKind[]).includes(kind)
}

/**
 * The kinds that ask for payment now and so carry the day it is due. A quote
 * states the term, an invoice turns it into a date.
 */
export const dueDateKinds = [
  'progress_invoice',
  'partial_invoice',
  'final_invoice',
  'recurring_invoice',
] as const satisfies readonly DocumentKind[]

export function carriesDueDate(kind: DocumentKind): boolean {
  return (dueDateKinds as readonly DocumentKind[]).includes(kind)
}

/**
 * What is wrong with a payment term somebody entered, as a sentence for the
 * screen, or null when nothing is.
 *
 * One function for the form, the routes and the sync, so that all of them
 * refuse the same values with the same words. Zero is a term: payable at once.
 */
export function paymentTermProblem(days: unknown): string | null {
  if (typeof days !== 'number' || !Number.isInteger(days)) {
    return 'Das Zahlungsziel ist eine ganze Zahl von Tagen.'
  }

  if (days < 0 || days > longestPaymentTermDays) {
    return (
      `Das Zahlungsziel liegt zwischen 0 und ${String(longestPaymentTermDays)} Tagen, ` +
      '0 heißt sofort zahlbar.'
    )
  }

  return null
}

/** "06.10.2026", the way a German reads a date. */
function day(on: IsoDate): string {
  return `${on.slice(8, 10)}.${on.slice(5, 7)}.${on.slice(0, 4)}`
}

/** "14 Tagen", and "einem Tag" for the one case German says differently. */
function inDays(days: number): string {
  return days === 1 ? 'einem Tag' : `${String(days)} Tagen`
}

/**
 * How many days, in the words the office reads next to a document or in the
 * settings: "14 Tage", "1 Tag", and "sofort" for zero.
 */
export function paymentTermLabel(days: number): string {
  if (days === 0) {
    return 'sofort'
  }

  return days === 1 ? '1 Tag' : `${String(days)} Tage`
}

/**
 * The sentence a document prints about its payment term, in German because a
 * customer reads it.
 *
 * An invoice names the day, since it has a date to count from. A quote cannot:
 * the invoice it speaks of has no date yet, so it names the days after it.
 * "Ohne Abzug" says that no discount for early payment is offered, and none
 * is; a discount belongs to the payment terms of the finance module.
 */
export function paymentTermText(term: PaymentTermContent): string {
  if (term.dueOn !== null) {
    return term.days === 0
      ? 'Zahlbar sofort ohne Abzug.'
      : `Zahlbar ohne Abzug bis zum ${day(term.dueOn)}.`
  }

  return term.days === 0
    ? 'Zahlungsbedingungen: zahlbar sofort nach Rechnungsstellung ohne Abzug.'
    : `Zahlungsbedingungen: zahlbar innerhalb von ${inDays(term.days)} nach Rechnungsstellung ` +
        'ohne Abzug.'
}
