import type { Id, IsoDate, TenantOwned } from '@opengewerk/platform-domain'

import { copperLimits, priceCentsMax, type SupplierArticleId } from './article.js'
import type { PriceBase } from './document-line.js'
import type { SupplierId } from './supplier.js'

export type SupplierArticleMetalId = Id<'supplier-article-metal'>
export type SupplierMetalPriceId = Id<'supplier-metal-price'>

/**
 * The metal surcharge (#462), decided on 28.09.2026 after the import of a
 * wholesaler's files: a cable's purchase price holds its metal at a base, and
 * what the wholesaler charges follows the day's metal price. A position puts
 * the difference into its unit price, after the metal price of the main
 * supplier on the document's date, so that a consumer sees one final price as
 * the price indication ordinance asks; the office sees the part.
 *
 * Copper and aluminium first, as the wholesaler quotes them; silver and brass
 * came with the Z records of DATANORM (#782). A metal without a price at the
 * supplier adds nothing, so silver and brass cost nothing until the office
 * enters a price for them.
 */
export const metals = ['copper', 'aluminium', 'silver', 'brass'] as const

export type Metal = (typeof metals)[number]

/** What a metal is called on a screen. */
export const metalNames: Readonly<Record<Metal, string>> = {
  copper: 'Kupfer',
  aluminium: 'Aluminium',
  silver: 'Silber',
  brass: 'Messing',
}

/**
 * The largest figures a metal keeps: the base and the weight as a catalogue
 * writes them, seven digits each, and a metal price up to what a price may
 * be.
 */
export const metalLimits = { ...copperLimits, priceCents: priceCentsMax } as const

/**
 * The metal an article holds at one supplier: the base its purchase price
 * already contains, in euros for 100 kg, and the weight in grams for 1000 of
 * the article's units. From DATANORM or entered by hand; an import writes what
 * its catalogue says. Like the purchase prices, the office's alone.
 */
export interface SupplierArticleMetal extends TenantOwned {
  readonly id: SupplierArticleMetalId
  readonly supplierArticleId: SupplierArticleId
  readonly metal: Metal
  readonly baseEuros: number
  readonly gramsPerThousand: number
}

/**
 * A supplier's price for a metal from a day on, in cents for 100 kg, as the
 * wholesaler shows it in its portal with every surcharge. Entered in the
 * office and never fetched: the figure lies behind the business's login.
 */
export interface SupplierMetalPrice extends TenantOwned {
  readonly id: SupplierMetalPriceId
  readonly supplierId: SupplierId
  readonly metal: Metal
  readonly validFrom: IsoDate
  /** The price of 100 kg. */
  readonly priceCents: number
}

/** What is wrong with the metal of a link, as a sentence, or null. */
export function articleMetalProblem(baseEuros: unknown, gramsPerThousand: unknown): string | null {
  const whole = (value: unknown, most: number) =>
    typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= most

  if (!whole(baseEuros, metalLimits.baseEuros)) {
    return 'Die Basis ist ein ganzer Betrag in Euro je 100 kg.'
  }

  if (!whole(gramsPerThousand, metalLimits.gramsPerThousand)) {
    return 'Das Gewicht ist eine Zahl in kg mit höchstens drei Stellen nach dem Komma.'
  }

  return null
}

/** What is wrong with a metal price in cents for 100 kg, as a sentence, or null. */
export function metalPriceProblem(cents: unknown): string | null {
  if (
    typeof cents !== 'number' ||
    !Number.isInteger(cents) ||
    cents < 1 ||
    cents > metalLimits.priceCents
  ) {
    return 'Der Metallpreis ist ein Betrag in Euro je 100 kg, größer als null.'
  }

  return null
}

/** One metal of an article with the price that applies to it, or none. */
export interface PricedMetal {
  readonly metal: Metal
  readonly baseEuros: number
  readonly gramsPerThousand: number
  /** The supplier's price for 100 kg on the day, null where none was entered by then. */
  readonly centsPerHundredKg: number | null
}

/**
 * The metal surcharge for `priceBase` units, in cents, rounded once, half a
 * cent up: for each metal what the price on the day lies above the base, for
 * its weight, together. A metal without a price adds nothing, nor does one
 * whose price lies below the base: the purchase price already holds the base,
 * and the surcharge never takes anything off it. With a markup the
 * surcharge is marked up before it is rounded.
 *
 * In whole numbers: a price over the base in cents for 100 kg (100,000 g),
 * times grams for 1000 units, is a price for 10^8 units. BigInt, because the
 * largest product of the limits is far beyond 2^53.
 */
export function metalSurchargeCents(
  priced: readonly PricedMetal[],
  priceBase: PriceBase,
  basisPoints = 0,
): number {
  let above = 0n

  for (const metal of priced) {
    if (metal.centsPerHundredKg === null) {
      continue
    }

    const over = metal.centsPerHundredKg - metal.baseEuros * 100

    if (over > 0) {
      above += BigInt(over) * BigInt(metal.gramsPerThousand)
    }
  }

  const marked = above * BigInt(priceBase) * BigInt(10_000 + basisPoints)
  const below = 100_000_000n * 10_000n

  return Number((marked * 2n + below) / (below * 2n))
}

/**
 * Whether the markup also comes on the metal surcharge: the article's word,
 * else its supplier's, else the business's. Off where nobody said anything
 * (decided on 28.09.2026).
 */
export function markupOnMetalOf(
  article: boolean | null | undefined,
  supplier: boolean | null | undefined,
  business: boolean,
): boolean {
  return article ?? supplier ?? business
}

/**
 * A weight as a person types it, in kg for 1000 units with up to three
 * places after the comma, as grams; or the sentence why it is none.
 */
export function gramsFrom(
  input: string,
): { readonly grams: number } | { readonly problem: string } {
  const shaped = /^(\d{1,6})(?:[,.](\d{1,3}))?$/.exec(input.trim())

  if (shaped === null) {
    return { problem: 'Das Gewicht ist eine Zahl in kg mit höchstens drei Stellen nach dem Komma.' }
  }

  const grams = Number(shaped[1]) * 1000 + Number((shaped[2] ?? '').padEnd(3, '0'))
  const problem = articleMetalProblem(0, grams)

  return problem === null ? { grams } : { problem }
}

/** A weight in grams for 1000 units as kg: 43200 is "43,2". */
export function kilogramsLabel(grams: number): string {
  return (grams / 1000).toLocaleString('de-DE', { maximumFractionDigits: 3 })
}
