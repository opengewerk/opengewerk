import type { DocumentLine, LineKind, LineUnit } from '../model/document-line.js'
import { quantityFactor } from '../model/document-line.js'
import type { TaxTreatment } from '../model/document.js'
import { taxNotes } from '../model/document.js'
import type { IsoDate } from '../model/identifier.js'
import type { RuleSet } from './rule.js'
import { RuleError, withoutNegativeZero } from './rule.js'
import type { TaxedAmount, VatRate } from './tax.js'
import { vatOn } from './tax.js'

/** What a line needs for its own total, and nothing more. */
export interface Priceable {
  readonly quantityMilli: number
  readonly unitPriceCents: number
}

/**
 * Quantity times unit price, in whole cents.
 *
 * Rounded the way `applyRate` rounds, half away from zero, and for the same
 * reason: a credit note mirrors the invoice it corrects instead of drifting a
 * cent away from it. The two roundings have to agree, or a cancellation stops
 * cancelling.
 *
 * This is the one place the figure is worked out. The database holds the same
 * arithmetic in a check constraint, so a row that disagrees cannot be written,
 * and a test compares the two against the same cases.
 */
export function lineNetCents(line: Priceable): number {
  const exact = line.quantityMilli * line.unitPriceCents

  return withoutNegativeZero(Math.sign(exact) * Math.round(Math.abs(exact) / quantityFactor))
}

/** One rate on a document, with everything that falls under it. */
export interface RateTotal extends TaxedAmount {
  readonly rate: VatRate
}

export interface DocumentTotals {
  readonly netCents: number
  readonly taxCents: number
  readonly grossCents: number
  /**
   * One entry per rate that actually occurs, in a fixed order. A document can
   * carry more than one, and the tax has to be shown per rate: an invoice with
   * labour at nineteen and a reduced item at seven owes two figures, not one.
   *
   * Empty when no tax is shown at all, which is not the same as an entry of
   * zero. Section 19 and section 13b mean there is no tax to state, and a line
   * reading "0,00 EUR Umsatzsteuer" says something different and wrong.
   */
  readonly byRate: readonly RateTotal[]
  /** The sentence the document has to carry, or nothing under standard tax. */
  readonly taxNote: string | null
}

/**
 * What a document adds up to, by the rules of its own date.
 *
 * The date is the document date and not today, which is the whole point of the
 * engine: an invoice from 2020 is still an invoice at sixteen percent in 2030.
 * Nothing here reads a clock.
 *
 * The order of operations matters and is the one German invoicing uses: the
 * lines of a rate are added up first, then the tax is worked out once on that
 * sum. Taxing each line and adding the tax afterwards gives a different figure
 * on about one invoice in three, because every line rounds on its own.
 *
 * A title among the lines is left out. Its amount is zero anyway, but it
 * carries the default rate like every line, and counted it would open a tax
 * group of its own: "19 % on 0,00 euros" on a document whose positions are
 * all taxed at another rate. A line without a kind is a position, which is
 * what every line was before titles existed.
 */
export function totalsFor(
  rules: RuleSet,
  lines: readonly (Pick<DocumentLine, 'netCents' | 'vatRate'> & { readonly kind?: LineKind })[],
  document: { readonly documentDate: IsoDate; readonly taxTreatment: TaxTreatment },
): DocumentTotals {
  const positions = lines.filter((line) => line.kind !== 'title')
  const netCents = withoutNegativeZero(positions.reduce((sum, line) => sum + line.netCents, 0))

  if (document.taxTreatment !== 'standard') {
    // No tax, and no entry saying zero. What the document owes instead is the
    // sentence, and that is not decoration: without it the invoice is wrong.
    return {
      netCents,
      taxCents: 0,
      grossCents: netCents,
      byRate: [],
      taxNote: taxNotes[document.taxTreatment],
    }
  }

  const netByRate = new Map<VatRate, number>()

  for (const line of positions) {
    netByRate.set(line.vatRate, (netByRate.get(line.vatRate) ?? 0) + line.netCents)
  }

  const byRate: RateTotal[] = []

  // Sorted, so that two runs over the same document produce the same document.
  // A Map keeps insertion order, which would make the block depend on which
  // line somebody typed first.
  for (const rate of [...netByRate.keys()].sort()) {
    const taxed = vatOn(rules, { netCents: netByRate.get(rate) ?? 0, rate }, document.documentDate)

    byRate.push({ rate, ...taxed })
  }

  const taxCents = withoutNegativeZero(byRate.reduce((sum, entry) => sum + entry.taxCents, 0))

  return {
    netCents,
    taxCents,
    grossCents: withoutNegativeZero(netCents + taxCents),
    byRate,
    taxNote: taxNotes.standard,
  }
}

/**
 * What a document asks to be paid: its totals, less what the progress
 * invoices before it billed. The same figures as the totals for every document
 * that deducts nothing, which is nearly all of them.
 */
export interface BilledAmount {
  readonly netCents: number
  readonly taxCents: number
  readonly grossCents: number
  /** Per rate, in the same fixed order as the totals. */
  readonly byRate: readonly RateTotal[]
}

/** An earlier invoice taken off this one, as far as the arithmetic needs it. */
export interface Deducted {
  readonly number: string
  readonly taxTreatment: TaxTreatment
  readonly billed: BilledAmount
}

/** The totals of a document that deducts nothing, as the amount it bills. */
export function billedOf(totals: DocumentTotals): BilledAmount {
  return {
    netCents: totals.netCents,
    taxCents: totals.taxCents,
    grossCents: totals.grossCents,
    byRate: totals.byRate,
  }
}

/**
 * What a document bills once the progress invoices before it have been taken
 * off: section 4.2, the total progress less what was billed so far.
 *
 * Taken off as they were printed, net and tax per rate, and never worked out
 * again. That is what makes the chain add up to the cent: every progress
 * invoice bills the difference between its own total and what the ones before
 * it said, so the final invoice ends exactly at the total of the work, however
 * each of them rounded.
 *
 * Section 14 (5) UStG asks for something narrower of a final invoice: the
 * partial amounts received before the work was done, and the tax on them.
 * Billed and received are the same figure as long as every progress invoice
 * was paid in full, and that is the assumption here until payments are
 * matched in phase 3. A progress invoice that is still open, or paid in part,
 * is taken off all the same, and the final invoice then asks for less than is
 * owed. Section 4.2 of the concept names both, billed and paid; which of the
 * two a final invoice deducts before phase 3 is open in #31.
 *
 * A rate is matched by its name and not by its figure. Should the rate change
 * between a progress invoice and the final one, the final invoice taxes the
 * whole work at the rate of its own date and deducts the tax that was stated
 * before, which is how a change of rate is settled. The figure printed for the
 * rate is the document's own.
 *
 * The treatment has to be the same throughout. A progress invoice with tax and
 * a final invoice under section 19 cannot be subtracted from each other without
 * producing a negative tax nobody owes, so that is refused with the number of
 * the invoice that does not fit.
 */
export function billedAfter(
  totals: DocumentTotals,
  deductions: readonly Deducted[],
  taxTreatment: TaxTreatment,
): BilledAmount {
  const odd = deductions.find((deduction) => deduction.taxTreatment !== taxTreatment)

  if (odd) {
    throw new RuleError(
      `Die Abschlagsrechnung ${odd.number} ist anders besteuert als diese Rechnung. Beide ` +
        'gehen nur mit demselben Steuerfall ineinander auf.',
    )
  }

  if (deductions.length === 0) {
    return billedOf(totals)
  }

  const perRate = new Map<VatRate, { basisPoints: number; netCents: number; taxCents: number }>()

  for (const entry of totals.byRate) {
    perRate.set(entry.rate, {
      basisPoints: entry.basisPoints,
      netCents: entry.netCents,
      taxCents: entry.taxCents,
    })
  }

  for (const deduction of deductions) {
    for (const entry of deduction.billed.byRate) {
      const current = perRate.get(entry.rate) ?? {
        basisPoints: entry.basisPoints,
        netCents: 0,
        taxCents: 0,
      }

      perRate.set(entry.rate, {
        basisPoints: current.basisPoints,
        netCents: current.netCents - entry.netCents,
        taxCents: current.taxCents - entry.taxCents,
      })
    }
  }

  const byRate: RateTotal[] = [...perRate.keys()].sort().map((rate) => {
    const entry = perRate.get(rate) ?? { basisPoints: 0, netCents: 0, taxCents: 0 }

    return {
      rate,
      basisPoints: entry.basisPoints,
      netCents: withoutNegativeZero(entry.netCents),
      taxCents: withoutNegativeZero(entry.taxCents),
      grossCents: withoutNegativeZero(entry.netCents + entry.taxCents),
    }
  })

  const netCents = withoutNegativeZero(
    deductions.reduce((rest, deduction) => rest - deduction.billed.netCents, totals.netCents),
  )
  const taxCents = withoutNegativeZero(
    deductions.reduce((rest, deduction) => rest - deduction.billed.taxCents, totals.taxCents),
  )

  return { netCents, taxCents, grossCents: withoutNegativeZero(netCents + taxCents), byRate }
}

/** What the two sides say about how a document should be taxed. */
export interface TaxSituation {
  /** The customer receives construction work under section 13b UStG. */
  readonly customerIsConstructionServiceRecipient: boolean
  /** The business claims section 19 for itself, a tenant parameter. */
  readonly businessClaimsSmallBusiness: boolean
}

/**
 * The treatment a document should carry, given the customer and the business.
 *
 * The order is not a preference, it is the law. Section 19 is a statement
 * about the issuer and applies to everything they invoice; where no tax is
 * owed in the first place there is none to reverse, so section 13b has nothing
 * to shift. A small business invoicing a construction firm still writes the
 * section 19 sentence and not the section 13b one.
 *
 * The answer is a proposal, not a verdict. It is written onto the document
 * when it is created and can be corrected while the document is a draft,
 * because the two flags do not know every case: a repair below the threshold
 * of section 13b is still a repair, and somebody has to be able to say so.
 */
export function treatmentFor(situation: TaxSituation): TaxTreatment {
  if (situation.businessClaimsSmallBusiness) {
    return 'small_business'
  }

  if (situation.customerIsConstructionServiceRecipient) {
    return 'reverse_charge'
  }

  return 'standard'
}

/**
 * The units a quantity comparison may put side by side.
 *
 * Only the same unit compares. It exists as a function rather than an equality
 * so that the one exception has a place to live: a lump sum is never compared,
 * because "1 Pauschale" against "1 Pauschale" says nothing about whether the
 * same work was done.
 */
export function comparableQuantities(delivered: LineUnit, ordered: LineUnit): boolean {
  return delivered === ordered && delivered !== 'flat_rate'
}
