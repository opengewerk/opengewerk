import type { ArticleImportId } from './article-import.js'
import {
  lineUnits,
  type LineUnit,
  lumpSumPriceBaseProblem,
  type PriceBase,
  priceBaseProblem,
} from './document-line.js'
import {
  eanProblem,
  type Id,
  type IsoDate,
  stockLimits,
  type Synced,
  type TenantOwned,
} from '@opengewerk/platform-domain'
import type { SupplierId } from './supplier.js'

export type ArticleId = Id<'article'>
export type ArticlePriceId = Id<'article-price'>
export type SupplierArticleId = Id<'supplier-article'>
export type PurchasePriceId = Id<'purchase-price'>
export type ListPriceId = Id<'list-price'>

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
  /**
   * The import from DATANORM that created the article (#297), whose stored
   * files prove what it came with; null for one the office entered.
   */
  readonly importId: ArticleImportId | null
  /**
   * The commercial guarantee of durability the producer gives for the article
   * (#433), in half years, so that 2,5 years is a whole number: more than two
   * years, entered by hand once the producer has told the business about it.
   * With the producer and the model identifier it fills the label of annex II
   * to Implementing Regulation (EU) 2025/1960. All three or none.
   */
  readonly durabilityHalfYears: number | null
  /** The producer, as the field "Brand/Trademark" of the label shows it. */
  readonly durabilityProducer: string | null
  /** The model the guarantee is for, as the field "Model identifier" of the label shows it. */
  readonly durabilityModel: string | null
}

/** A selling price from a day on. The price of a day is the latest that began by then. */
export interface ArticlePrice extends Synced {
  readonly id: ArticlePriceId
  readonly articleId: ArticleId
  readonly validFrom: IsoDate
  /** The price of `priceBase` units. */
  readonly unitPriceCents: number
  /**
   * How many units the price is for (#456), as a wholesaler prices cable ties
   * per 100. A position that takes the price takes it with its price unit.
   */
  readonly priceBase: PriceBase
  /** The import the price came with (#297), null for one entered by hand. */
  readonly importId: ArticleImportId | null
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
  /**
   * The supplier's discount group of the article (#297), as DATANORM names
   * it. Kept, and reckoned in with purchasing and costing in Phase 4
   * (decided on 27.09.2026).
   */
  readonly discountGroup: string | null
  /** The import that last set the link (#297), null for one entered by hand. */
  readonly importId: ArticleImportId | null
  /**
   * Whether the supplier is the article's main supplier (#463), the one whose
   * purchase price makes the selling price: the first that brought it, until
   * somebody chooses another. Exactly one link of an article is.
   */
  readonly main: boolean
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
  /** The price of `priceBase` units. */
  readonly unitPriceCents: number
  /** How many units the price is for (#456), as the supplier's catalogue prices it. */
  readonly priceBase: PriceBase
  /** The import the price came with (#297), null for one entered by hand. */
  readonly importId: ArticleImportId | null
}

/**
 * The supplier's list price from a day on (#297): what its catalogue asks
 * before the business's discount, as DATANORM gives it with the price flag
 * 1. Read like a purchase price by the owner and the office only; an import
 * may take it over as the selling price as well.
 */
export interface ListPrice extends TenantOwned {
  readonly id: ListPriceId
  readonly supplierArticleId: SupplierArticleId
  readonly validFrom: IsoDate
  /** The price of `priceBase` units. */
  readonly unitPriceCents: number
  readonly priceBase: PriceBase
  readonly importId: ArticleImportId | null
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
  discountGroup: 20,
} as const

/**
 * The bounds of a guarantee of durability (#433): more than two years and in
 * half years, as the guidelines of the Commission allow 2,5 but not 2,4, at
 * most fifty, and producer and model short enough for their fields of the
 * label, which print at 9 point beside each other on 95 millimetres.
 */
export const durabilityLimits = { halfYearsMin: 5, halfYearsMax: 100, text: 20 } as const

/** The three fields of a guarantee of durability, which come and go together. */
export const durabilityFields = [
  'durabilityHalfYears',
  'durabilityProducer',
  'durabilityModel',
] as const

/** The years of a guarantee as the label and the office write them: "5", "2,5". */
export function durabilityYears(halfYears: number): string {
  return halfYears % 2 === 0 ? String(halfYears / 2) : `${String((halfYears - 1) / 2)},5`
}

/** The half years in years as somebody types them, "5", "2,5" or "2.5", or null for anything else. */
export function halfYearsOf(text: string): number | null {
  const match = /^(\d{1,2})(?:[,.](0|5))?$/.exec(text.trim())

  return match ? Number(match[1]) * 2 + (match[2] === '5' ? 1 : 0) : null
}

/** The most a price may be, in cents: 999.999,99 euros for one unit. */
export const priceCentsMax = 99_999_999

/**
 * The copper of an article at a supplier, as the second record of DATANORM
 * carries it (#297, #462): the base the list price already holds, in euros
 * for 100 kg, and the weight in grams for 1000 of the article's units, a
 * kilometre of a cable or a thousand pieces. Checked against a real delivery
 * on 30.10.2026: the same in a catalogue priced per 100 and per piece, and
 * 9.6 kg for a kilometre of H05V-U 1, the known copper figure.
 */
export interface Copper {
  readonly baseEuros: number
  readonly gramsPerThousand: number
}

/** The largest copper figures a link keeps, seven digits each as a catalogue writes them. */
export const copperLimits = { baseEuros: 9_999_999, gramsPerThousand: 999_999_900 } as const

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

  const given = durabilityFields.filter((field) => field in article)

  if (given.length > 0) {
    durabilityProblems(article, given.length, problems)
  }

  // The bound of the stock of the foundation (#298), which holds it in the database too.
  const description = article['description']

  if (typeof description === 'string' && description.trim().length > stockLimits.description) {
    problems['description'] = `Höchstens ${String(stockLimits.description)} Zeichen.`
  }

  return problems
}

/**
 * The EAN in a code the camera read on site (#263), or null when the code is
 * no EAN: a serial number, the address on a QR label, a code of a wholesaler.
 * A UPC-A of twelve digits is the EAN-13 with a leading zero, and some
 * readers give it that way.
 */
export function eanFromScan(code: string): string | null {
  const digits = code.trim()
  const ean = /^\d{12}$/.test(digits) ? `0${digits}` : digits

  return eanProblem(ean) === null ? ean : null
}

/**
 * What is wrong with a guarantee of durability (#433), into `problems`: the
 * three fields come together, and either all are empty or all are set.
 */
function durabilityProblems(
  article: Readonly<Record<string, unknown>>,
  given: number,
  problems: Record<string, string>,
): void {
  const halfYears = article['durabilityHalfYears']
  const texts = (['durabilityProducer', 'durabilityModel'] as const).map((field) => {
    const value = article[field]

    return [field, typeof value === 'string' ? value.trim() : value] as const
  })
  const empty = (halfYears ?? null) === null && texts.every(([, value]) => (value ?? '') === '')

  if (given < durabilityFields.length) {
    problems['durabilityHalfYears'] = 'Dauer, Hersteller und Modellkennung kommen zusammen.'

    return
  }

  if (empty) {
    return
  }

  if (
    typeof halfYears !== 'number' ||
    !Number.isInteger(halfYears) ||
    halfYears < durabilityLimits.halfYearsMin ||
    halfYears > durabilityLimits.halfYearsMax
  ) {
    problems['durabilityHalfYears'] =
      'Mehr als zwei Jahre, ganz oder halb, etwa 3 oder 2,5, und höchstens 50.'
  }

  for (const [field, value] of texts) {
    if (typeof value !== 'string' || value === '') {
      problems[field] =
        field === 'durabilityProducer'
          ? 'Der Hersteller, wie er auf der Kennzeichnung steht.'
          : 'Das Modell, für das die Garantie gilt.'
    } else if (value.length > durabilityLimits.text) {
      problems[field] =
        `Höchstens ${String(durabilityLimits.text)} Zeichen, sonst passt es nicht in sein Feld der Kennzeichnung.`
    }
  }
}

/** What is wrong with the supplier's number for an article, or null. */
export function supplierNumberProblem(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > articleLimits.supplierNumber
    ? `Eine Artikelnummer des Lieferanten hat höchstens ${String(articleLimits.supplierNumber)} Zeichen.`
    : null
}

/**
 * What is wrong with a price from a day on, by field, or nothing: a whole
 * number of cents from nothing to `priceCentsMax`, a day of the calendar,
 * and a price unit of the four steps, when one is given (#456); left out,
 * a price is for one unit.
 */
export function priceProblems(price: {
  readonly unitPriceCents?: unknown
  readonly validFrom?: unknown
  readonly priceBase?: unknown
}): Readonly<Record<string, string>> {
  const problems: Record<string, string> = {}
  const cents = price.unitPriceCents

  if (typeof cents !== 'number' || !Number.isInteger(cents) || cents < 0 || cents > priceCentsMax) {
    problems['unitPriceCents'] = 'Ein Preis liegt zwischen 0 und 999.999,99 €, auf den Cent genau.'
  }

  if (!isCalendarDay(price.validFrom)) {
    problems['validFrom'] = 'Ein Preis gilt ab einem Tag des Kalenders.'
  }

  const base = price.priceBase === undefined ? null : priceBaseProblem(price.priceBase)

  if (base) {
    problems['priceBase'] = base
  }

  return problems
}

/**
 * What is wrong with counting an article in a unit, given the widest price
 * unit among its selling and purchase prices, or null (#456). A lump sum is
 * one of itself, as each of its prices is when it is written; an article with
 * a price for several units becomes one only once those prices are gone.
 */
export function articleUnitProblem(unit: unknown, widestPriceBase: PriceBase): string | null {
  return lumpSumPriceBaseProblem({ unit, priceBase: widestPriceBase }) === null
    ? null
    : 'Eine Pauschale hat keine Preiseinheit, und der Artikel hat Preise für mehrere Einheiten. ' +
        'Erst ohne sie wird er eine Pauschale.'
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
