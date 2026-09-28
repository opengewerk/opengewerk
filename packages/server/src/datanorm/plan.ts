import {
  articleLimits,
  type ImportPrice,
  type ImportSample,
  type ImportSummary,
  importSummaryLimits,
  type IsoDate,
  type LineUnit,
  type PriceBase,
  priceCentsMax,
} from '@opengewerk/domain'

import type { CatalogueArticle } from './catalogue.js'
import type { ReadDelivery } from './read.js'
import type { PriceKind } from './records.js'

/**
 * What an import of one supplier would do (#297), worked out from the files
 * and from what the business holds, before a single row is written. The same
 * plan is the preview and, worked out again inside the transaction, the
 * takeover: nothing the office saw is written from memory.
 *
 * The rules, as decided on 27 and 28.09.2026:
 *
 * - An article the supplier sells already is found by the supplier's number,
 *   and only its prices and its discount group change. Its texts are the
 *   business's own and stay as they are.
 * - An article the supplier does not sell yet is found by its EAN among the
 *   articles of the business and gets the supplier added; otherwise it is a
 *   new article, under the supplier's number, or with the short code of the
 *   supplier appended where the business uses that number already.
 * - A list price becomes the supplier's list price and, where the office
 *   chose so, the selling price; a net price becomes the purchase price. A
 *   price that is what the business holds already writes nothing.
 * - An article the files delete loses the supplier, not its existence.
 * - A price never applies backwards; the day comes from the options.
 */

/** A price the business holds: the one in effect on the day the import's prices begin. */
export interface HeldPrice {
  readonly id: string
  readonly validFrom: IsoDate
  readonly cents: number
  readonly priceBase: PriceBase
  /** Whether an import wrote it. Only such a selling price gives way on its own day. */
  readonly fromImport: boolean
}

export interface HeldArticle {
  readonly id: string
  readonly number: string
  readonly designation: string
  readonly unit: LineUnit
  readonly ean: string | null
}

export interface HeldLink {
  readonly id: string
  readonly articleId: string
  readonly supplierNumber: string
  readonly discountGroup: string | null
}

/** What the business holds, as far as an import of one supplier needs to know it. */
export interface Holdings {
  /** The articles that are not deleted, the oldest first, so that an EAN finds the oldest. */
  readonly articles: ReadonlyMap<string, HeldArticle>
  /** The links of the supplier, by the supplier's number. */
  readonly links: ReadonlyMap<string, HeldLink>
  /** List and purchase prices in effect, by link. */
  readonly listPrices: ReadonlyMap<string, HeldPrice>
  readonly purchasePrices: ReadonlyMap<string, HeldPrice>
  /** Selling prices in effect, by article. */
  readonly sellingPrices: ReadonlyMap<string, HeldPrice>
}

export interface PlanOptions {
  readonly validFrom: IsoDate
  readonly listAsSelling: boolean
  /** Appended to a number the business uses already: the supplier's own, or one from its name. */
  readonly shortCode: string
  readonly newId: () => string
}

export interface NewArticle {
  readonly id: string
  readonly number: string
  readonly designation: string
  readonly description: string | null
  readonly unit: LineUnit
  readonly ean: string | null
  readonly groupOfGoods: string | null
}

export interface NewLink {
  readonly id: string
  readonly articleId: string
  readonly supplierNumber: string
  readonly discountGroup: string | null
}

export interface NewPrice {
  /** The link for a list or purchase price, the article for a selling price. */
  readonly ownerId: string
  readonly cents: number
  readonly priceBase: PriceBase
  /** The price of the same day it takes the place of. */
  readonly replaces: string | null
}

export interface ImportPlan {
  readonly articles: readonly NewArticle[]
  readonly links: readonly NewLink[]
  readonly discountGroups: readonly { readonly linkId: string; readonly discountGroup: string }[]
  readonly removedLinks: readonly string[]
  readonly listPrices: readonly NewPrice[]
  readonly purchasePrices: readonly NewPrice[]
  readonly sellingPrices: readonly NewPrice[]
  readonly summary: ImportSummary
}

/** Files that cannot be taken over at all, in words for the office. */
export class ImportRefused extends Error {}

interface Offered {
  readonly kind: PriceKind
  readonly cents: number
  readonly priceBase: PriceBase
}

type Problem = ImportSummary['problemLines'][number]

/** The units as the office names them, for the sentences of the preview; as `lineUnitLabel` in the web. */
const unitWords: Readonly<Record<LineUnit, string>> = {
  piece: 'Stück',
  hour: 'Stunden',
  day: 'Tage',
  metre: 'Meter',
  square_metre: 'Quadratmeter',
  cubic_metre: 'Kubikmeter',
  kilogram: 'Kilogramm',
  litre: 'Liter',
  package: 'Pakete',
  flat_rate: 'Pauschal',
}

/** A day as the office reads it, for the sentences of the preview. */
function germanDay(day: IsoDate): string {
  const [year, month, date] = day.split('-')

  return `${date ?? ''}.${month ?? ''}.${year ?? ''}`
}

/** The price of one kind among those offered, as the preview shows it. */
function priceOf(offered: readonly Offered[], kind: PriceKind): ImportPrice | null {
  const found = offered.find((price) => price.kind === kind)

  return found === undefined ? null : { cents: found.cents, priceBase: found.priceBase }
}

function heldPriceOf(held: HeldPrice | undefined): ImportPrice | null {
  return held === undefined ? null : { cents: held.cents, priceBase: held.priceBase }
}

function sameAs(held: HeldPrice | undefined, offered: Offered): boolean {
  return held !== undefined && held.cents === offered.cents && held.priceBase === offered.priceBase
}

/** Works out what an import would do. Pure: the holdings are read before, the plan is written after. */
export function planImport(
  delivery: ReadDelivery,
  holdings: Holdings,
  options: PlanOptions,
): ImportPlan {
  const { catalogue } = delivery

  if (delivery.files.length === 0) {
    throw new ImportRefused(
      'In den hochgeladenen Dateien ist keine DATANORM-Datei. Eine Datei aus DATANORM beginnt ' +
        'mit ihrem Kopfsatz, der Zeile mit V am Anfang.',
    )
  }

  const currency = catalogue.header?.currency.trim() ?? ''

  if (currency !== '' && currency !== 'EUR') {
    throw new ImportRefused(
      `Die Preise der Dateien sind in ${currency} angegeben. OpenGewerk rechnet in Euro.`,
    )
  }

  const problems: Problem[] = [...catalogue.problems]
  const numbers = new Set<string>()
  const byEan = new Map<string, HeldArticle>()

  for (const article of holdings.articles.values()) {
    numbers.add(article.number.toLowerCase())

    if (article.ean !== null && !byEan.has(article.ean)) {
      byEan.set(article.ean, article)
    }
  }

  // An article carries a supplier once (`supplier_articles_once`): an EAN that
  // finds one the supplier sells already makes a new article instead.
  const sold = new Set([...holdings.links.values()].map((link) => link.articleId))

  const articles: NewArticle[] = []
  const links: NewLink[] = []
  const discountGroups: { linkId: string; discountGroup: string }[] = []
  const removedLinks: string[] = []
  const listPrices: NewPrice[] = []
  const purchasePrices: NewPrice[] = []
  const sellingPrices: NewPrice[] = []
  const counts = { created: 0, linked: 0, updated: 0, unchanged: 0, removed: 0, renumbered: 0 }
  const samples: ImportSample[] = []
  const sampled = new Map<ImportSample['kind'], number>()
  const unknownUnits = new Map<string, number>()
  let articleCount = 0

  const sample = (entry: ImportSample) => {
    const taken = sampled.get(entry.kind) ?? 0

    if (taken < importSummaryLimits.samplesPerKind) {
      sampled.set(entry.kind, taken + 1)
      samples.push(entry)
    }
  }

  /** Offers a price to one of the three tables; says whether it is new. */
  const offer = (
    target: NewPrice[],
    held: HeldPrice | undefined,
    ownerId: string,
    offered: Offered,
  ): boolean => {
    if (sameAs(held, offered)) {
      return false
    }

    target.push({
      ownerId,
      cents: offered.cents,
      priceBase: offered.priceBase,
      replaces: held !== undefined && held.validFrom === options.validFrom ? held.id : null,
    })

    return true
  }

  /** The prices of one article from one supplier; says whether any is new. */
  const offerPrices = (
    article: { readonly id: string; readonly number: string; readonly unit: LineUnit },
    linkId: string,
    offered: readonly Offered[],
    unit: LineUnit | null,
    where: { readonly file: string; readonly line: number },
  ): boolean => {
    if (offered.length === 0) {
      return false
    }

    if (unit !== null && unit !== article.unit) {
      problems.push({
        ...where,
        reason:
          `${article.number} hat bei Ihnen die Einheit ${unitWords[article.unit]}, der Katalog ` +
          `verkauft den Artikel in ${unitWords[unit]}. Seine Preise bleiben, wie sie sind.`,
      })

      return false
    }

    let changed = false

    for (const price of offered) {
      if (price.cents > priceCentsMax) {
        problems.push({
          ...where,
          reason: `Der Preis von ${article.number} ist höher, als OpenGewerk einen Preis nimmt.`,
        })
        continue
      }

      if (price.kind === 'net') {
        changed =
          offer(purchasePrices, holdings.purchasePrices.get(linkId), linkId, price) || changed
        continue
      }

      changed = offer(listPrices, holdings.listPrices.get(linkId), linkId, price) || changed

      if (!options.listAsSelling) {
        continue
      }

      const held = holdings.sellingPrices.get(article.id)

      if (
        held !== undefined &&
        held.validFrom === options.validFrom &&
        !held.fromImport &&
        !sameAs(held, price)
      ) {
        problems.push({
          ...where,
          reason:
            `Für ${article.number} gilt ab dem ${germanDay(options.validFrom)} schon ein ` +
            'eigener Verkaufspreis. Er bleibt.',
        })
      } else {
        changed = offer(sellingPrices, held, article.id, price) || changed
      }
    }

    return changed
  }

  /** The number of a new article: the supplier's, or with the short code where it is taken. */
  const freeNumber = (wanted: string): { number: string; renumbered: boolean } => {
    if (!numbers.has(wanted.toLowerCase())) {
      return { number: wanted, renumbered: false }
    }

    let candidate = `${wanted}-${options.shortCode}`

    for (let next = 2; numbers.has(candidate.toLowerCase()); next += 1) {
      candidate = `${wanted}-${options.shortCode}${String(next)}`
    }

    return { number: candidate, renumbered: true }
  }

  /**
   * The prices the delivery offers for an article: its own, and a newer one
   * of a price file, which takes the place of its own of the same kind. The
   * price base belongs to the article and holds for both.
   */
  const offeredFor = (entry: CatalogueArticle): readonly Offered[] => {
    const own = entry.price
    const change = catalogue.priceChanges.get(entry.number)

    if (change === undefined) {
      return own === null ? [] : [own]
    }

    const newer: Offered = {
      kind: change.kind,
      cents: change.cents,
      priceBase: own?.priceBase ?? 1,
    }

    return own === null || own.kind === change.kind ? [newer] : [own, newer]
  }

  for (const entry of catalogue.articles.values()) {
    const where = { file: entry.file, line: entry.line }

    if (entry.number.length > articleLimits.supplierNumber) {
      problems.push({
        ...where,
        reason: `Die Nummer ${entry.number} ist länger als ${String(articleLimits.supplierNumber)} Zeichen.`,
      })
      continue
    }

    articleCount += 1

    if (entry.unknownUnit !== null) {
      unknownUnits.set(entry.unknownUnit, (unknownUnits.get(entry.unknownUnit) ?? 0) + 1)
    }

    const offered = offeredFor(entry)
    // Four characters in DATANORM; cut to what the column holds, for a file that writes more.
    const discountGroup = entry.discountGroup?.slice(0, articleLimits.discountGroup) ?? null
    const link = holdings.links.get(entry.number)
    const held = link === undefined ? undefined : holdings.articles.get(link.articleId)

    if (link !== undefined && held !== undefined) {
      const changedPrices = offerPrices(held, link.id, offered, entry.unit, where)
      const changedGroup = discountGroup !== null && discountGroup !== link.discountGroup

      if (changedGroup) {
        discountGroups.push({ linkId: link.id, discountGroup })
      }

      if (changedPrices || changedGroup) {
        counts.updated += 1
        sample({
          kind: 'updated',
          supplierNumber: entry.number,
          number: held.number,
          renumbered: false,
          designation: held.designation,
          unit: held.unit,
          listPrice: priceOf(offered, 'list'),
          netPrice: priceOf(offered, 'net'),
          previousListPrice: heldPriceOf(holdings.listPrices.get(link.id)),
        })
      } else {
        counts.unchanged += 1
      }

      continue
    }

    const found = entry.ean === null ? undefined : byEan.get(entry.ean)

    if (found !== undefined && !sold.has(found.id)) {
      const linkId = options.newId()

      sold.add(found.id)
      links.push({
        id: linkId,
        articleId: found.id,
        supplierNumber: entry.number,
        discountGroup,
      })
      offerPrices(found, linkId, offered, entry.unit, where)
      counts.linked += 1
      sample({
        kind: 'linked',
        supplierNumber: entry.number,
        number: found.number,
        renumbered: false,
        designation: found.designation,
        unit: found.unit,
        listPrice: priceOf(offered, 'list'),
        netPrice: priceOf(offered, 'net'),
        previousListPrice: null,
      })
      continue
    }

    const { number, renumbered } = freeNumber(entry.number)

    if (number.length > articleLimits.number) {
      problems.push({
        ...where,
        reason:
          `${entry.number} ist bei Ihnen schon vergeben, und mit dem Kürzel wäre die Nummer ` +
          `länger als ${String(articleLimits.number)} Zeichen.`,
      })
      continue
    }

    const designation = (entry.designation.trim() || entry.number).slice(
      0,
      articleLimits.designation,
    )
    const article: NewArticle = {
      id: options.newId(),
      number,
      designation,
      description: entry.description,
      unit: entry.unit,
      ean: entry.ean,
      groupOfGoods: entry.groupOfGoods?.slice(0, articleLimits.groupOfGoods) ?? null,
    }
    const linkId = options.newId()

    numbers.add(number.toLowerCase())
    sold.add(article.id)
    articles.push(article)
    links.push({
      id: linkId,
      articleId: article.id,
      supplierNumber: entry.number,
      discountGroup,
    })
    offerPrices(article, linkId, offered, null, where)
    counts.created += 1

    if (renumbered) {
      counts.renumbered += 1
    }

    sample({
      kind: 'created',
      supplierNumber: entry.number,
      number,
      renumbered,
      designation,
      unit: entry.unit,
      listPrice: priceOf(offered, 'list'),
      netPrice: priceOf(offered, 'net'),
      previousListPrice: null,
    })
  }

  // A price file without the article: only for an article the supplier sells.
  for (const [number, change] of catalogue.priceChanges) {
    if (catalogue.articles.has(number)) {
      continue
    }

    const where = { file: change.file, line: change.line }
    const link = holdings.links.get(number)
    const held = link === undefined ? undefined : holdings.articles.get(link.articleId)

    if (link === undefined || held === undefined) {
      problems.push({
        ...where,
        reason: `Für ${number} kommt ein Preis, aber den Artikel führt der Lieferant bei Ihnen noch nicht.`,
      })
      continue
    }

    articleCount += 1

    // The price base of the price it follows, which a price file does not say.
    const previous =
      change.kind === 'list'
        ? holdings.listPrices.get(link.id)
        : holdings.purchasePrices.get(link.id)
    const offered: readonly Offered[] = [
      { kind: change.kind, cents: change.cents, priceBase: previous?.priceBase ?? 1 },
    ]

    if (offerPrices(held, link.id, offered, null, where)) {
      counts.updated += 1
      sample({
        kind: 'updated',
        supplierNumber: number,
        number: held.number,
        renumbered: false,
        designation: held.designation,
        unit: held.unit,
        listPrice: priceOf(offered, 'list'),
        netPrice: priceOf(offered, 'net'),
        previousListPrice: heldPriceOf(holdings.listPrices.get(link.id)),
      })
    } else {
      counts.unchanged += 1
    }
  }

  for (const number of catalogue.deletions) {
    const link = holdings.links.get(number)
    const held = link === undefined ? undefined : holdings.articles.get(link.articleId)

    if (link === undefined || catalogue.articles.has(number)) {
      continue
    }

    removedLinks.push(link.id)
    counts.removed += 1
    sample({
      kind: 'removed',
      supplierNumber: number,
      number: held?.number ?? number,
      renumbered: false,
      designation: held?.designation ?? '',
      unit: held?.unit ?? 'piece',
      listPrice: null,
      netPrice: null,
      previousListPrice: null,
    })
  }

  return {
    articles,
    links,
    discountGroups,
    removedLinks,
    listPrices,
    purchasePrices,
    sellingPrices,
    summary: {
      articles: articleCount,
      ...counts,
      shortCode: options.shortCode,
      unknownUnits: [...unknownUnits]
        .map(([text, count]) => ({ text, articles: count }))
        .sort((left, right) => right.articles - left.articles),
      problems: problems.length,
      problemLines: problems.slice(0, importSummaryLimits.problemLines),
      files: delivery.files,
      skipped: delivery.skipped,
      ignored: [...catalogue.ignored].map(([letter, lines]) => ({ letter, lines })),
      fileDate: catalogue.header?.date ?? null,
      samples,
    },
  }
}
