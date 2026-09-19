import type { IsoDate } from '../model/identifier.js'
import { applyRate, type RuleSet } from './rule.js'

export const debtorKinds = ['business', 'consumer'] as const

export type DebtorKind = (typeof debtorKinds)[number]

/** Adds whole days to an ISO date without dragging a time zone along. */
export function addDays(on: IsoDate, days: number): IsoDate {
  const at = new Date(`${on}T00:00:00Z`)
  at.setUTCDate(at.getUTCDate() + days)

  return at.toISOString().slice(0, 10) as IsoDate
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
 * The one number here that carries no source is the 360 the year is divided
 * into. Every rate beside it comes out of a package and names its paragraph;
 * this divisor is an assumption about how days are counted, it sits in code
 * rather than in data, and it is worth real money: ten thousand euro ninety
 * days late come to 263.00 euro over 360 days and 259.40 euro over 365. It is
 * written down as an open question in the check of 19.09.2026 on issue #31
 * rather than quietly settled here.
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
    interestCents: Math.sign(perYear) * Math.round((Math.abs(perYear) * owed.days) / 360),
    flatFeeCents:
      owed.debtor === 'business' ? rules.valueAt('late_payment.flat_fee', 'cents', on) : 0,
  }
}
