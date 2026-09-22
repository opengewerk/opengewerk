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
  /**
   * Whether the business claims the transition of section 27 (38) sentence 1
   * number 2 UStG: its total turnover of the year before was not above the
   * limit in the rule package, so for a supply of 2027 it may still send an
   * invoice to another business as a PDF. A claim and not a figure, like the
   * small business rule above. The turnover is not something this software
   * knows before the bookkeeping of phase 3, and a statement somebody makes is
   * what the law asks for anyway. Not claimed means required, which is the
   * reading that is never wrong.
   */
  'e_invoice.transition_claimed',
  /**
   * Whether the tax office permitted the business to calculate its VAT on the
   * amounts it received rather than on the amounts it agreed, section 20 UStG.
   * Granted on application, and for a trade business mostly because the total
   * turnover of the year before was not above the limit in the rule package
   * `cash-accounting`. A statement about a decision of the tax office, which
   * this software cannot know; not permitted means the tax is calculated on
   * the agreed amounts, the rule of section 16 (1) sentence 1 UStG.
   *
   * An invoice is not told until 2028, when section 14 (4) sentence 1 number
   * 6a UStG asks it to say so. The bookkeeping of phase 3 reads it for the day
   * the tax arises, which is the difference the setting is really about.
   */
  'cash_accounting.permitted',
  /**
   * Whether a report the customer signs on site goes to that customer by mail
   * right away, with its PDF. A decision of the business and nothing the law
   * asks for: some want the customer to have the paper at once, others send
   * it with the invoice. Read on the day of the signature, so that switching
   * it on sends nothing that was signed before.
   */
  'report.mail_on_signature',
] as const

export type TenantParameterKey = (typeof tenantParameterKeys)[number]

export const tenantParameterUnits: Readonly<Record<TenantParameterKey, RuleUnit>> = {
  'small_business.claimed': 'flag',
  'invoice.payment_term_days': 'days',
  'e_invoice.transition_claimed': 'flag',
  'cash_accounting.permitted': 'flag',
  'report.mail_on_signature': 'flag',
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
