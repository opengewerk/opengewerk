import type { DocumentKind } from '../model/document.js'
import type { PaymentTermContent } from '../model/document-content.js'
import type { IsoDate } from '@opengewerk/platform-domain'
import { carriesDueDate, statesPaymentTerm } from '../model/payment-term.js'
import type { BilledAmount } from './invoice.js'
import { applyRate, type RuleSet, withoutNegativeZero } from '@opengewerk/platform-domain'

/**
 * The days of a calendar year when interest is worked out: 366 in a leap year,
 * 365 otherwise.
 *
 * Named rather than written into the formula, so that the one thing this
 * calculation turns on is findable, and so that a test can name it too instead
 * of repeating a literal that nobody would connect to the decision behind it.
 * Until 26.09.2026 it was a single number for every year; why it changed is
 * told at `lateInterestOn`.
 */
export function daysInYear(year: number): number {
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0

  return leap ? 366 : 365
}

/** One year in parts that a day of either length of year divides into evenly. */
const partsPerYear = 365 * 366

/**
 * How much of a year `days` days from `from` make up, in `partsPerYear`.
 *
 * Every day counts against the length of its own calendar year, so a period
 * across a turn of the year is split there. Whole numbers throughout: a day of
 * an ordinary year is 366 parts and a day of a leap year 365, and the one
 * division into money happens at the end. A period of no days is no part.
 */
function yearPartsOf(from: IsoDate, days: number): number {
  let parts = 0
  let day = from
  let left = days

  while (left > 0) {
    const year = Number(day.slice(0, 4))
    const nextYear = `${String(year + 1)}-01-01` as IsoDate
    const untilNextYear =
      (Date.parse(`${nextYear}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86_400_000
    const inThisYear = Math.min(left, untilNextYear)

    parts += inThisYear * (partsPerYear / daysInYear(year))
    left -= inThisYear
    day = nextYear
  }

  return parts
}

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
 * What to say about a payment term longer than section 271a (1) BGB lets
 * stand without more (#149), or null when there is nothing to say.
 *
 * The paragraph protects the creditor, which is the business itself: a
 * business customer who has a term of more than sixty days written into the
 * contract gets it only if it was agreed expressly and is not grossly unfair
 * to the business. A term the business puts on its own document is not
 * forbidden by it, so nothing is refused; the office is told, in the head of
 * the document, that such a term should have been agreed in so many words.
 * Towards a consumer the rule does not apply at all (paragraph 5 number 2),
 * and the stricter limits towards public contracting authorities of
 * paragraph 2 wait for the review in #31.
 *
 * The sixty days come from the rule package and not from here, so that a
 * change in the law is a record and not a release.
 */
export function longPaymentTermNotice(
  rules: RuleSet,
  term: { readonly days: number; readonly on: IsoDate; readonly recipientIsBusiness: boolean },
): string | null {
  if (
    !term.recipientIsBusiness ||
    rules.at('payment.maximum_term_days_business', term.on) === null
  ) {
    return null
  }

  const limit = rules.valueAt('payment.maximum_term_days_business', 'days', term.on)

  if (term.days <= limit) {
    return null
  }

  return (
    `Mehr als ${String(limit)} Tage gegenüber einem Unternehmen: so ein Zahlungsziel sollte ` +
    'ausdrücklich vereinbart sein, damit es trägt (§ 271a Abs. 1 BGB).'
  )
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
 * **Each day counts against the length of its own year**: a day of an
 * ordinary year is a 365th of the annual interest, a day of a leap year a
 * 366th, which is actual/actual in the ISDA sense. Decided by Moritz on
 * 26.09.2026 in issue #31, after a check of the sources that day found that
 * the usual calculations of default interest under section 288 BGB count day
 * by day with 366 days in a leap year; the law itself only says "for the
 * year". From 20.09.2026 the year had 365 days without exception, and before
 * that 360, which nobody had decided at all. It is worth real money: ten
 * thousand euro ninety days late from 1 March 2024, at the rate of early 2024,
 * come to 315.50 euro over 360 days, 311.18 over 365 and 310.33 over the 366
 * days of that leap year. A full calendar year now carries exactly the annual
 * rate and never more, which a flat 365 did not in a leap year. A test pins the
 * figure, because nothing else did: the tests around it only compared two
 * results with each other and would have passed just as happily with any
 * divisor.
 *
 * A period across a turn of the year is split there, each part against its
 * own year. The rate is still the one of the day the invoice fell late, for
 * the whole period; splitting at the half years in which the Bundesbank sets
 * it anew belongs to the dunning work in phase 3 (#328).
 *
 * The method stays in code rather than moving into a data package, and that
 * is not an oversight. A package holds what the law sets and changes on a
 * date: a rate, a threshold, a number of days. The method is not that. It is
 * the convention the days are counted in, it has no period of validity, and
 * giving it one would invite somebody to set it per tenant, which is exactly
 * the sort of thing section 1.7 keeps out of a business's reach.
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
      Math.sign(perYear) *
        Math.round((Math.abs(perYear) * yearPartsOf(on, owed.days)) / partsPerYear),
    ),
    flatFeeCents:
      owed.debtor === 'business' ? rules.valueAt('late_payment.flat_fee', 'cents', on) : 0,
  }
}
