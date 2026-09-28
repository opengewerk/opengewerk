import type { VatRate } from '../rules/tax.js'
import type { ArticleId } from './article.js'
import type { DocumentId, DocumentLineId, Synced } from './identifier.js'

/**
 * What a position is counted in.
 *
 * A closed list, because the unit ends up on a printed invoice and in the
 * comparison between a quote and what was delivered. Free text would make both
 * impossible: "Std", "Stunde" and "h" are the same unit to a person and three
 * different ones to a query.
 *
 * `flat_rate` is the one that carries no dimension. A lump sum has a quantity
 * of one and a price, and saying so explicitly keeps it out of the quantity
 * comparison later, where "1 Pauschale" against "1 Stück" would look like a
 * match.
 */
export const lineUnits = [
  'piece',
  'hour',
  'day',
  'metre',
  'square_metre',
  'cubic_metre',
  'kilogram',
  'litre',
  'package',
  'flat_rate',
] as const

export type LineUnit = (typeof lineUnits)[number]

/**
 * The factor a quantity is stored in: thousandths.
 *
 * Whole numbers everywhere, like the cents and the basis points, and for the
 * same reason. Three decimal places is what a trade invoice needs: 2,5 hours,
 * 12,75 metres, 0,125 tonnes. A quantity of 2,5 is stored as 2500.
 */
export const quantityFactor = 1000

/**
 * How many units a unit price is for (#456): one, ten, a hundred or a
 * thousand, as a wholesaler prices cable per 100 metres and cable ties per
 * 100 pieces. Kept with the price instead of dividing it down to one unit,
 * because the cent a price of 3,50 euros per 100 pieces would round to is 14
 * per cent off, and a document of a hundred of them would say 4,00 euros.
 *
 * The four steps of DATANORM's price unit and nothing in between, so that
 * "je 100 Stk." is a figure a person reads without doing sums. In the
 * e-invoice it is the base quantity of the price (BT-149).
 */
export const priceBases = [1, 10, 100, 1000] as const

export type PriceBase = (typeof priceBases)[number]

/** What is wrong with a price unit, or null when nothing is. */
export function priceBaseProblem(value: unknown): string | null {
  return priceBases.some((base) => base === value)
    ? null
    : 'Ein Preis gilt je 1, 10, 100 oder 1000 Einheiten.'
}

/** The price unit a value stands for, one where it names none of the four. */
export function priceBaseOf(value: unknown): PriceBase {
  return priceBases.find((base) => base === value) ?? 1
}

/**
 * What a line is: a position with a quantity and a price, or the title of a
 * section the positions after it belong to.
 *
 * A title is a line of its own and not a separate table, because its place in
 * the list is the whole of its meaning: everything up to the next title
 * belongs to it. Kept in one list, reordering a quote moves titles and
 * positions with the same field, and a title travels to a device and back
 * like any other line.
 *
 * A title carries no amount. Quantity and price are zero and a check in the
 * database holds them there, so a title can never add something to a total
 * that nobody sees as a position.
 */
export const lineKinds = ['item', 'title'] as const

export type LineKind = (typeof lineKinds)[number]

/**
 * One position on a document.
 *
 * `netCents` is stored rather than worked out on reading, and that is a
 * decision about time, not about performance. Quantity times unit price has to
 * be rounded to whole cents, and the rounded figure is what the customer was
 * shown and what the bookkeeping added up. Recomputing it later would mean a
 * change to the rounding rule silently changes an invoice from 2027, which is
 * exactly what the whole engine of dated rules exists to prevent.
 *
 * It cannot drift for it: a check constraint in the database holds it against
 * quantity times price, so the stored figure and the computed one are the same
 * figure by construction and not by discipline.
 */
export interface DocumentLine extends Synced {
  readonly id: DocumentLineId
  readonly documentId: DocumentId
  /** A position, or the title of the section that follows. */
  readonly kind: LineKind
  /** Where it stands on the document, counted from one. */
  readonly position: number
  readonly designation: string
  /** The longer text under the designation, when there is one. */
  readonly description: string | null
  /** The quantity, in thousandths. See `quantityFactor`. */
  readonly quantityMilli: number
  readonly unit: LineUnit
  /** The price of `priceBase` units, in cents. */
  readonly unitPriceCents: number
  /** How many units the price is for, see `priceBases`. One on every line from before #456. */
  readonly priceBase: PriceBase
  /**
   * Which rate applies to this line, not the rate itself. The figure comes
   * from the rule engine with the document's date, so a line written in 2020
   * still carries sixteen percent in 2030.
   */
  readonly vatRate: VatRate
  /** Quantity times unit price, divided by the price unit, rounded. Held by a check constraint. */
  readonly netCents: number
  /**
   * The article the line was taken from (#296), or null when it was typed.
   * Only a pointer: text, unit and price belong to the line from the moment
   * it is taken, and a changed article changes no document. What it is for
   * is the articles of the last 90 days on the devices, and the price an
   * invoice gives a line from a report, which has none.
   */
  readonly articleId: ArticleId | null
}

/**
 * What is wrong with the place of a line, or null when nothing is. Lines are
 * counted from one, which the check `document_lines_position_positive` holds.
 */
export function linePositionProblem(position: unknown): string | null {
  return typeof position === 'number' && Number.isInteger(position) && position >= 1
    ? null
    : 'Positionen zählen ab 1.'
}

/**
 * What is wrong with the amount on a title, or null when nothing is. A title
 * carries neither a quantity nor a price, which the check
 * `document_lines_title_has_no_amount` holds; a position may carry anything.
 * Left out counts as nothing, the way a form for a title sends no amount.
 */
export function titleAmountProblem(line: {
  readonly kind?: unknown
  readonly quantityMilli?: unknown
  readonly unitPriceCents?: unknown
}): string | null {
  if (line.kind !== 'title') {
    return null
  }

  return carriesAmount(line.quantityMilli) || carriesAmount(line.unitPriceCents)
    ? 'Ein Titel trägt weder Menge noch Preis.'
    : null
}

function carriesAmount(value: unknown): boolean {
  return typeof value === 'number' && value !== 0
}
