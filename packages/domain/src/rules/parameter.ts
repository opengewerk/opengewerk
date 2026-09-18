import type { Id, IsoDate, TenantId } from '../model/identifier.js'
import type { RuleUnit } from './rule.js'

export type TenantParameterId = Id<'tenant-parameter'>

/**
 * What a business sets for itself, as opposed to what the law sets for
 * everybody.
 *
 * The two are kept strictly apart, and the keys are the seam: a tenant
 * parameter can never carry the name of a rule, so there is no way for a
 * business to quietly move a legal threshold by writing a row. That is what
 * section 1.7 means by "a tenant cannot override rules, only set parameters".
 *
 * They carry a period of validity for the same reason the rules do. A business
 * stops being a small business at the turn of a year, and an invoice from
 * before that turn has to keep being read the way it was written.
 */
export const tenantParameterKeys = [
  /**
   * Whether the business claims the small business rule. Being inside the
   * limits is a fact the figures decide; claiming it is a decision, and only
   * the two together mean no VAT is shown.
   */
  'small_business.claimed',
  /** The payment term the business puts on its invoices, in days. */
  'invoice.payment_term_days',
] as const

export type TenantParameterKey = (typeof tenantParameterKeys)[number]

export const tenantParameterUnits: Readonly<Record<TenantParameterKey, RuleUnit>> = {
  'small_business.claimed': 'flag',
  'invoice.payment_term_days': 'days',
}

/**
 * One setting, for the time it applied.
 *
 * Whole numbers here as well, and a flag is a zero or a one. A column that
 * takes any shape of value is a column nobody can add up, compare or check,
 * and these end up in a tax calculation.
 */
export interface TenantParameter {
  readonly id: TenantParameterId
  readonly tenantId: TenantId
  readonly key: TenantParameterKey
  readonly validFrom: IsoDate
  readonly validUntil: IsoDate | null
  readonly unit: RuleUnit
  readonly value: number
  readonly note: string | null
  readonly createdAt: Date
  readonly updatedAt: Date
}
