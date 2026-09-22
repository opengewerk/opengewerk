import type { DocumentKind } from '../model/document.js'
import type { PaymentTermContent } from '../model/document-content.js'
import type { IsoDate } from '../model/identifier.js'
import { carriesDueDate, statesPaymentTerm } from '../model/payment-term.js'
import type { BilledAmount } from './invoice.js'
import { applyRate, type RuleSet, withoutNegativeZero } from './rule.js'

/**
 * The days a year is counted as having when interest is worked out.
 *
 * Named rather than written into the formula, so that the one number this
 * calculation turns on is findable, and so that a test can name it too instead
 * of repeating a literal that nobody would connect to the decision behind it.
 */
export const daysInYear = 365

export const debtorKinds = ['business', 'consumer'] as const

export type DebtorKind = (typeof debtorKinds)[number]

/** Adds whole days to an ISO date without dragging a time zone along. */
export function addDays(on: IsoDate, days: number): IsoDate {
  const at = new Date(`${on}T00:00:00Z`)
  at.setUTCDate(at.getUTCDate() + days)

  return at.toISOString().slice(0, 10) as IsoDate
}

/**
 * The payment term a document states, or null when it states none.
 *
 * `days` is the term that applies, found by the caller: the document's own,
 * or the business's setting on the document's date, or the default. A quote
 * states it as days, an invoice as the day payment is due, counted from the
 * document date.
 *
 * An invoice that asks for nothing states no term at all. A final invoice
 * whose progress invoices billed the whole of it comes to zero, and one that
 * comes out below zero is money going back; a due date on either would ask
 * the customer to pay what nobody asks for.
 */
export function paymentTermOf(
  kind: DocumentKind,
  days: number,
  documentDate: IsoDate,
  billed: Pick<BilledAmount, 'grossCents'>,
): PaymentTermContent | null {
  if (!statesPaymentTerm(kind)) {
    return null
  }

  if (!carriesDueDate(kind)) {
    return { days, dueOn: null }
  }

  return billed.grossCents > 0 ? { days, dueOn: addDays(documentDate, days) } : null
}

/**
 * The day from which an unpaid invoice is late, even without a reminder.
 *
 * Counted from the invoice date here, which is the simple case. Section 286
 * paragraph 3 BGB counts from receipt, and towards a consumer only if the
 * invoice said so. Both belong to the dunning work, which is phase 3; what
 * this issue owes is that the number of days is a rule and not a constant in
 * a function somewhere.
 */
export function lateFrom(rules: RuleSet, invoicedOn: IsoDate): IsoDate {
  return addDays(invoicedOn, rules.valueAt('payment.default_after_days', 'days', invoicedOn))
}

export interface LateInterest {
  /** Base rate plus the premium, in basis points. */
  readonly basisPoints: number
  readonly baseRateBasisPoints: number
  readonly premiumBasisPoints: number
  readonly interestCents: number
  /** Only towards a business, and empty where the rules do not give one. */
  readonly flatFeeCents: number
}

/**
 * What a late invoice costs, by the rules of the day it fell late.
 *
 * The base rate is the reason this engine exists at all: the Bundesbank sets
 * it anew every January and July, and each of those is an entry in a data file
 * rather than a release. Where no rate has been entered for a day, nothing is
 * returned but an error, because a made up interest rate on a real invoice is
 * worse than a missing one.
 *
 * **The year is divided into 365 days**, decided by Moritz on 20.09.2026 as
 * part of the expert acceptance in issue #31. It was the one open question
 * there, and it was worth real money: ten thousand euro ninety days late at
 * the rate of early 2024 come to 315.50 euro over 360 days and 311.18 over
 * 365. A test pins that figure, because nothing else did: the tests around it
 * only compared two results with each other and would have passed just as
 * happily with either divisor.
 *
 * It stays in code rather than moving into a data package, and that is not an
 * oversight. A package holds what the law sets and changes on a date: a rate,
 * a threshold, a number of days. The divisor is not that. It is the convention
 * the days are counted in, it has no period of validity, and giving it one
 * would invite somebody to set it per tenant, which is exactly the sort of
 * thing section 1.7 keeps out of a business's reach.
 *
 * A leap year gets no special treatment. Dividing by 366 in one year and 365
 * in the next would make two invoices that straddle a turn of the year
 * incomparable, and act/365 is the convention in ordinary use. If that is ever
 * to change, it is a decision of the same kind as this one and belongs in the
 * same place.
 */
export function lateInterestOn(
  rules: RuleSet,
  owed: { principalCents: number; days: number; debtor: DebtorKind },
  on: IsoDate,
): LateInterest {
  const baseRateBasisPoints = rules.valueAt('base_rate.value', 'basis_points', on)
  const premiumBasisPoints = rules.valueAt(
    `late_payment.premium_${owed.debtor}`,
    'basis_points',
    on,
  )
  const basisPoints = baseRateBasisPoints + premiumBasisPoints

  const perYear = applyRate(owed.principalCents, basisPoints)

  return {
    basisPoints,
    baseRateBasisPoints,
    premiumBasisPoints,
    interestCents: withoutNegativeZero(
      Math.sign(perYear) * Math.round((Math.abs(perYear) * owed.days) / daysInYear),
    ),
    flatFeeCents:
      owed.debtor === 'business' ? rules.valueAt('late_payment.flat_fee', 'cents', on) : 0,
  }
}
