import type { Id, IsoDate, TenantOwned } from '@opengewerk/platform-domain'

import { type ArticleId, type ArticlePriceId, priceCentsMax } from './article.js'
import type { PriceBase } from './document-line.js'
import type { SupplierId } from './supplier.js'

export type SupplierMarkupId = Id<'supplier-markup'>
export type ArticleMarkupId = Id<'article-markup'>
export type ArticlePriceOriginId = Id<'article-price-origin'>
export type SellingPriceRunId = Id<'selling-price-run'>

/**
 * The markup on material (#463), decided on 28.09.2026: an article's selling
 * price is its main supplier's purchase price and a markup, the way the
 * business calculates. In basis points, hundredths of a percent, so that
 * 22,5 % is a whole number: 2250.
 *
 * The business sets one under "Einstellungen" (the setting
 * `material.markup_basis_points`, from a day on like every setting), a
 * supplier may have its own, and an article either its own or a fixed selling
 * price. The narrower one wins. None of them is a device's business: like the
 * purchase prices they stay at the routes of the office and never travel.
 */
export const markupLimits = { basisPoints: 100_000 } as const

/** A supplier's own markup on what it sells, in place of the business's. */
export interface SupplierMarkup extends TenantOwned {
  readonly id: SupplierMarkupId
  readonly supplierId: SupplierId
  readonly basisPoints: number
}

/**
 * What an article says about its selling price: fixed, as somebody entered
 * it, or following the purchase price with a markup of its own. An article
 * without one follows its purchase price with the markup of its supplier or
 * of the business.
 */
export interface ArticleMarkup extends TenantOwned {
  readonly id: ArticleMarkupId
  readonly articleId: ArticleId
  /** A selling price that stays until somebody enters another. */
  readonly fixed: boolean
  /** The article's own markup; null when the price is fixed. */
  readonly basisPoints: number | null
}

/**
 * What a selling price that follows a purchase price came from: the purchase
 * price, of the same price unit, and the markup. Only the office reads it.
 */
export interface ArticlePriceOrigin extends TenantOwned {
  readonly id: ArticlePriceOriginId
  readonly articlePriceId: ArticlePriceId
  readonly purchaseCents: number
  readonly basisPoints: number
}

/**
 * Selling prices still to be worked out anew after a markup changed: of one
 * supplier's articles, or of the whole business where `supplierId` is null,
 * from a day on. One per business at a time.
 */
export interface SellingPriceRun extends TenantOwned {
  readonly id: SellingPriceRunId
  readonly supplierId: SupplierId | null
  readonly fromDay: IsoDate
  readonly requestedBy: string
}

/** What is wrong with a markup in basis points, as a sentence, or null. */
export function markupProblem(value: unknown): string | null {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > markupLimits.basisPoints
  ) {
    return 'Ein Aufschlag liegt zwischen 0 und 1.000 % und hat höchstens zwei Stellen nach dem Komma.'
  }

  return null
}

/**
 * The selling price from a purchase price and a markup, rounded to the cent,
 * half a cent up, and for the same price unit as the purchase price. Null
 * where it would be more than a price may be.
 */
export function sellingCentsOf(purchaseCents: number, basisPoints: number): number | null {
  // Whole numbers throughout: the largest product is far below 2^53.
  const cents = Math.floor((purchaseCents * (10_000 + basisPoints) + 5_000) / 10_000)

  return cents > priceCentsMax ? null : cents
}

/**
 * The markup that makes an article's selling price: its own, else its
 * supplier's, else the business's. Null for a fixed price, and where no
 * markup is set at all; then no selling price comes from a purchase price.
 */
export function markupOf(
  article: Pick<ArticleMarkup, 'fixed' | 'basisPoints'> | null | undefined,
  supplier: number | null,
  business: number | null,
): number | null {
  if (article?.fixed === true) {
    return null
  }

  return article?.basisPoints ?? supplier ?? business
}

/** A price from a day on: the amount and how many units it is for. */
export interface DatedPrice {
  readonly validFrom: IsoDate
  readonly cents: number
  readonly priceBase: PriceBase
}

/** A selling price that follows a purchase price, with what it came from. */
export interface FollowedPrice extends DatedPrice {
  readonly purchaseCents: number
  readonly basisPoints: number
}

/**
 * What the selling prices of an article that follows its purchase price
 * become from a day on (#463): on that day and on the day of every later
 * purchase price of its main supplier, the purchase price with the markup, in
 * its price unit. A price that is what applies already makes no new one.
 *
 * Says which held selling prices from that day on give way and which new
 * ones come. Nothing changes without a markup or without any purchase price
 * from that day on: no selling price comes from nothing, and none goes for it.
 * Before the day nothing changes either; a price never applies backwards.
 */
export function followedPrices(
  from: IsoDate,
  purchases: readonly DatedPrice[],
  selling: readonly (DatedPrice & { readonly id: string })[],
  markup: number | null,
): { readonly removed: readonly string[]; readonly added: readonly FollowedPrice[] } {
  const byDay = [...purchases].sort((left, right) => left.validFrom.localeCompare(right.validFrom))
  const purchaseOn = (day: IsoDate): DatedPrice | undefined =>
    byDay.filter((price) => price.validFrom <= day).at(-1)
  const days = [
    from,
    ...new Set(byDay.filter((price) => price.validFrom > from).map((price) => price.validFrom)),
  ]

  if (markup === null || !days.some((day) => purchaseOn(day) !== undefined)) {
    return { removed: [], added: [] }
  }

  const held = [...selling].sort((left, right) => left.validFrom.localeCompare(right.validFrom))
  let last: DatedPrice | undefined = held.filter((price) => price.validFrom < from).at(-1)
  const wanted: FollowedPrice[] = []

  for (const day of days) {
    const purchase = purchaseOn(day)
    const cents = purchase === undefined ? null : sellingCentsOf(purchase.cents, markup)

    if (purchase === undefined || cents === null) {
      continue
    }

    if (last?.cents === cents && last.priceBase === purchase.priceBase) {
      continue
    }

    last = {
      validFrom: day,
      cents,
      priceBase: purchase.priceBase,
    }
    wanted.push({ ...last, purchaseCents: purchase.cents, basisPoints: markup })
  }

  const kept = new Set<string>()
  const added = wanted.filter((price) => {
    const same = held.find(
      (heldPrice) =>
        heldPrice.validFrom === price.validFrom &&
        heldPrice.cents === price.cents &&
        heldPrice.priceBase === price.priceBase,
    )

    if (same !== undefined) {
      kept.add(same.id)
    }

    return same === undefined
  })
  const removed = held
    .filter((price) => price.validFrom >= from && !kept.has(price.id))
    .map((price) => price.id)

  return { removed, added }
}
