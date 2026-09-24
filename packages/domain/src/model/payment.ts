import type { DocumentKind } from './document.js'
import type { DocumentId, IsoDate } from './identifier.js'

/**
 * A payment that came in on an invoice (#189): a gross amount and the day it
 * arrived. Recorded by hand in the office until the bank is matched in phase
 * 3, and read by the final invoice, which takes off what came in on each
 * progress invoice before it (section 14 (5) UStG).
 */
export interface Payment {
  readonly id: string
  readonly documentId: DocumentId
  /** Gross, in cents, and always more than nothing: a payment of nothing is no payment. */
  readonly amountCents: number
  readonly receivedOn: IsoDate
}

/**
 * The kinds a payment is recorded on: every invoice that asks for money. Not
 * the two correcting kinds, which give back, and nothing that is no invoice.
 */
export const payableKinds: readonly DocumentKind[] = [
  'progress_invoice',
  'partial_invoice',
  'final_invoice',
  'recurring_invoice',
]

export function receivesPayments(kind: DocumentKind): boolean {
  return payableKinds.includes(kind)
}

const isoDate = /^\d{4}-\d{2}-\d{2}$/

/**
 * What is wrong with a payment as somebody typed it, as a sentence, or null.
 *
 * One function for the form and the route, so the field says what the server
 * would refuse. The amount is whole cents and more than nothing; the day is a
 * real day and not one still to come, since what has not arrived yet cannot
 * be taken off anything. Whether the invoice is still open for that much is
 * the server's question, it needs what the invoice billed.
 */
export function paymentProblem(
  payment: { readonly amountCents: unknown; readonly receivedOn: unknown },
  today: IsoDate,
): string | null {
  const { amountCents, receivedOn } = payment

  if (typeof amountCents !== 'number' || !Number.isInteger(amountCents) || amountCents <= 0) {
    return 'Der Betrag ist ein Betrag in Euro und Cent über null.'
  }

  if (
    typeof receivedOn !== 'string' ||
    !isoDate.test(receivedOn) ||
    Number.isNaN(Date.parse(`${receivedOn}T00:00:00Z`)) ||
    new Date(`${receivedOn}T00:00:00Z`).toISOString().slice(0, 10) !== receivedOn
  ) {
    return 'Der Tag des Eingangs ist kein Datum.'
  }

  if (receivedOn > today) {
    return 'Ein Eingang liegt nicht in der Zukunft.'
  }

  return null
}
