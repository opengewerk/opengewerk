import type { Id, TenantOwned } from '@opengewerk/platform-domain'

import { type ArticleId, priceCentsMax } from './article.js'
import type { SupplierId } from './supplier.js'

export type SupplierMarkupId = Id<'supplier-markup'>
export type ArticleMarkupId = Id<'article-markup'>

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
