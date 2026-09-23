import type { IsoDate } from '../model/identifier.js'
import { applyRate, type RuleSet } from './rule.js'

/**
 * The rates a line can be taxed at, by name. The figure behind each comes
 * from the package `vat` on the day of the document.
 *
 * `zero` is the rate of section 12 (3) UStG since 1 January 2023: 0 percent
 * on solar modules, the components essential for running the installation
 * and the storage for its power, delivered to the operator of an installation
 * on or near homes and buildings used for the common good, and on installing
 * them (#127). Whether a line meets that is the business's to judge, like
 * whether a line takes the reduced rate; the form names the conditions.
 */
export const vatRates = ['standard', 'reduced', 'zero'] as const

export type VatRate = (typeof vatRates)[number]

export interface TaxedAmount {
  /** In basis points, so that 19 percent is 1900 and nothing is ever 0.19. */
  readonly basisPoints: number
  readonly netCents: number
  readonly taxCents: number
  readonly grossCents: number
}

/**
 * The tax on an amount, by the rules of a given day.
 *
 * The day is the argument the whole engine turns on. A document from 2027 is
 * still judged by the rates of 2027 in 2030, because the calculation never
 * asks what today is; it only ever answers the question it was given.
 */
export function vatOn(
  rules: RuleSet,
  amount: { netCents: number; rate: VatRate },
  on: IsoDate,
): TaxedAmount {
  const basisPoints = rules.valueAt(`vat.${amount.rate}`, 'basis_points', on)
  const taxCents = applyRate(amount.netCents, basisPoints)

  return {
    basisPoints,
    netCents: amount.netCents,
    taxCents,
    grossCents: amount.netCents + taxCents,
  }
}

export interface Turnover {
  readonly previousYearCents: number
  readonly currentYearCents: number
}

export interface SmallBusinessCheck {
  readonly withinLimits: boolean
  readonly previousYearLimitCents: number
  readonly currentYearLimitCents: number
}

/**
 * Whether a business is inside the limits of section 19 UStG on a given day.
 *
 * Inside the limits, not "is a small business": the status also depends on
 * whether the business claimed it, which is a tenant parameter and not a rule.
 * Keeping the two apart is what stops a tenant from quietly moving a legal
 * threshold, which is the point section 1.7 makes about rules and parameters.
 *
 * What this does not decide is the 2025 change in the other direction: since
 * then the status ends the moment the limit is passed during the year, rather
 * than at the turn of it. That is a question about documents and their dates,
 * and it belongs to the invoicing work in phase 1.
 */
export function withinSmallBusinessLimits(
  rules: RuleSet,
  turnover: Turnover,
  on: IsoDate,
): SmallBusinessCheck {
  const previousYearLimitCents = rules.valueAt('small_business.previous_year_limit', 'cents', on)
  const currentYearLimitCents = rules.valueAt('small_business.current_year_limit', 'cents', on)

  return {
    withinLimits:
      turnover.previousYearCents <= previousYearLimitCents &&
      turnover.currentYearCents <= currentYearLimitCents,
    previousYearLimitCents,
    currentYearLimitCents,
  }
}
