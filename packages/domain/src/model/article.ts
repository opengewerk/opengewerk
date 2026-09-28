import { lineUnits, type LineUnit } from './document-line.js'
import type { Id, IsoDate, Synced, TenantOwned } from './identifier.js'
import type { SupplierId } from './supplier.js'

export type ArticleId = Id<'article'>
export type ArticlePriceId = Id<'article-price'>
export type SupplierArticleId = Id<'supplier-article'>
export type PurchasePriceId = Id<'purchase-price'>

/**
 * An article of the business (#296): what it is called, what it is counted
 * in, and, in `ArticlePrice`, from which day which selling price applies.
 *
 * A position that takes an article over copies its text, its unit and the
 * price of the day of its document, and from then on the text belongs to the
 * position, as with the text snippets: a changed article changes no document
 * that used it.
 *
 * A catalogue can hold a hundred thousand articles once DATANORM arrives
 * (#297), and those do not belong on every telephone (section 1.6). So the
 * office reads the articles at their routes, page by page, and a device holds
 * the frequent ones and those used lately (decided on 27.09.2026).
 */
export interface Article extends Synced {
  readonly id: ArticleId
  /** The business's own number, once per business. */
  readonly number: string
  readonly designation: string
  /** Becomes the description of a position that takes the article over. */
  readonly description: string | null
  /** An EAN-13 or EAN-8 with a correct check digit, see `eanProblem`. */
  readonly ean: string | null
  readonly unit: LineUnit
  /** Free text such as "Kabel und Leitungen"; the list filters by it. */
  readonly groupOfGoods: string | null
  /** Held by every device, with or without a network. */
  readonly frequent: boolean
}

/** A selling price from a day on. The price of a day is the latest that began by then. */
export interface ArticlePrice extends Synced {
  readonly id: ArticlePriceId
  readonly articleId: ArticleId
  readonly validFrom: IsoDate
  readonly unitPriceCents: number
}

/**
 * That a supplier sells an article, under the supplier's own number. Once per
 * pair. Kept at the routes of the office and never on a device, like the
 * purchase prices hanging on it: not `Synced`, and removed rather than marked,
 * since no device has to hear of it.
 */
export interface SupplierArticle extends TenantOwned {
  readonly id: SupplierArticleId
  readonly articleId: ArticleId
  readonly supplierId: SupplierId
  /** The supplier's number for the article, as its catalogue writes it. */
  readonly supplierNumber: string | null
}

/**
 * A purchase price from a day on, at one supplier. Only the owner and the
 * office read one (decided on 27.09.2026): what the business pays is none of
 * a customer's business, and a technician works with what the business sells.
 */
export interface PurchasePrice extends TenantOwned {
  readonly id: PurchasePriceId
  readonly supplierArticleId: SupplierArticleId
  readonly validFrom: IsoDate
  readonly unitPriceCents: number
}

/**
 * How long an article that is not marked as frequent stays on the devices
 * after a document or a report last used it (decided on 27.09.2026, section
 * 4.5): long enough for a season of the same work, short enough that a
 * catalogue does not end up on a telephone.
 */
export const recentlyUsedDays = 90

/** The longest each text of an article may be, as the forms and the routes hold it. */
export const articleLimits = {
  number: 40,
  designation: 200,
  groupOfGoods: 80,
  supplierNumber: 40,
} as const

/** The most a price may be, in cents: 999.999,99 euros for one unit. */
export const priceCentsMax = 99_999_999

/** What is wrong with an EAN, as a sentence, or null when nothing is. */
export function eanProblem(value: string): string | null {
  if (!/^(\d{8}|\d{13})$/.test(value)) {
    return 'Eine EAN hat 13 oder 8 Ziffern.'
  }

  const digits = [...value].map(Number)
  const check = digits.pop()
  // From the right, the digits before the check digit weigh 3, 1, 3, and so
  // on, which is the same rule for 13 digits as for 8.
  const sum = digits
    .reverse()
    .reduce((total, digit, index) => total + digit * (index % 2 === 0 ? 3 : 1), 0)

  return (10 - (sum % 10)) % 10 === check ? null : 'Die Prüfziffer der EAN stimmt nicht.'
}

/**
 * What is wrong with the fields of an article, by field, as the form shows it
 * and the routes refuse it. Only the fields present are judged, so that a
 * change of one field is not refused for another nobody touched.
 */
export function articleProblems(
  article: Readonly<Record<string, unknown>>,
): Readonly<Record<string, string>> {
  const problems: Record<string, string> = {}

  const required = (field: 'number' | 'designation', missing: string) => {
    if (!(field in article)) {
      return
    }

    const value = article[field]

    if (typeof value !== 'string' || value.trim() === '') {
      problems[field] = missing
    } else if (value.trim().length > articleLimits[field]) {
      problems[field] = `Höchstens ${String(articleLimits[field])} Zeichen.`
    }
  }

  required('number', 'Ein Artikel braucht eine Nummer.')
  required('designation', 'Ein Artikel braucht eine Bezeichnung.')

  const ean = article['ean']

  if (typeof ean === 'string' && ean.trim() !== '') {
    const problem = eanProblem(ean.trim())

    if (problem) {
      problems['ean'] = problem
    }
  }

  if ('unit' in article && !lineUnits.some((unit) => unit === article['unit'])) {
    problems['unit'] = 'Diese Einheit gibt es nicht.'
  }

  const group = article['groupOfGoods']

  if (typeof group === 'string' && group.trim().length > articleLimits.groupOfGoods) {
    problems['groupOfGoods'] = `Höchstens ${String(articleLimits.groupOfGoods)} Zeichen.`
  }

  if ('frequent' in article && typeof article['frequent'] !== 'boolean') {
    problems['frequent'] = 'Häufig ist ja oder nein.'
  }

  return problems
}

/** What is wrong with the supplier's number for an article, or null. */
export function supplierNumberProblem(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > articleLimits.supplierNumber
    ? `Eine Artikelnummer des Lieferanten hat höchstens ${String(articleLimits.supplierNumber)} Zeichen.`
    : null
}

/**
 * What is wrong with a price from a day on, by field, or nothing: a whole
 * number of cents from nothing to `priceCentsMax`, and a day of the calendar.
 */
export function priceProblems(price: {
  readonly unitPriceCents?: unknown
  readonly validFrom?: unknown
}): Readonly<Record<string, string>> {
  const problems: Record<string, string> = {}
  const cents = price.unitPriceCents

  if (typeof cents !== 'number' || !Number.isInteger(cents) || cents < 0 || cents > priceCentsMax) {
    problems['unitPriceCents'] = 'Ein Preis liegt zwischen 0 und 999.999,99 €, auf den Cent genau.'
  }

  if (!isCalendarDay(price.validFrom)) {
    problems['validFrom'] = 'Ein Preis gilt ab einem Tag des Kalenders.'
  }

  return problems
}

/** Whether a value is a day as ISO 8601 writes it, and one the calendar has. */
export function isCalendarDay(value: unknown): value is IsoDate {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false
  }

  const [year, month, day] = value.split('-').map(Number) as [number, number, number]
  const date = new Date(Date.UTC(year, month - 1, day))

  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  )
}

/** The price that applies on a day: the latest that began on or before it, or null. */
export function priceOn<Price extends { readonly validFrom: IsoDate }>(
  prices: readonly Price[],
  day: IsoDate,
): Price | null {
  let found: Price | null = null

  for (const price of prices) {
    if (price.validFrom <= day && (found === null || price.validFrom > found.validFrom)) {
      found = price
    }
  }

  return found
}

/**
 * Where a price stands on a day, as the office writes it beside the price:
 * "Kommt" for one that begins later, "Gilt" for the one of the day, "Vorher"
 * for one another has replaced.
 */
export type PriceStanding = 'coming' | 'current' | 'earlier'

export function priceStanding<Price extends { readonly validFrom: IsoDate }>(
  price: Price,
  prices: readonly Price[],
  day: IsoDate,
): PriceStanding {
  if (price.validFrom > day) {
    return 'coming'
  }

  return priceOn(prices, day) === price ? 'current' : 'earlier'
}
