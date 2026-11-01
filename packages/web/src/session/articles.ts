import type { IsoDate, LineUnit, Metal, PricedMetal, PriceBase } from '@opengewerk/domain'
import { request } from '@opengewerk/platform-web/sync'

/**
 * The articles of the business (#296), read and kept straight at the routes:
 * the catalogue is too big for a device, which holds only the frequent ones
 * through the sync. What a supplier sells, and the purchase prices, never
 * travel at all, and a purchase price comes back as `null` for whoever may
 * not read it.
 */

/** One row of the list "Artikel". */
export interface ArticleRow {
  readonly id: string
  readonly number: string
  readonly designation: string
  readonly description: string | null
  readonly unit: LineUnit
  readonly groupOfGoods: string | null
  readonly frequent: boolean
  /** The selling price of today, or of the day asked for, or null without one. */
  readonly priceCents: number | null
  /** How many units that price is for (#456), null without a price. */
  readonly priceBase: PriceBase | null
  /** The first supplier, and how many there are in all. */
  readonly supplierName: string | null
  readonly suppliers: number
}

export interface ArticlePage {
  readonly total: number
  readonly rows: readonly ArticleRow[]
}

export interface ArticleQuery {
  readonly search: string
  readonly frequent: boolean
  readonly group: string
  readonly sort: 'number' | 'designation'
  readonly offset: number
  readonly limit: number
  /** The day of the selling price, today when left out: a position's document date. */
  readonly on?: IsoDate
  /** Only the articles with exactly this EAN, what a scan on site looks for (#263). */
  readonly ean?: string
}

/** A price from a day on, selling or purchase. */
export interface PriceView {
  readonly id: string
  readonly validFrom: IsoDate
  /**
   * What a selling price that follows the purchase price came from (#463),
   * for whoever may read purchase prices; null for one entered by hand.
   */
  readonly origin?: { readonly purchaseCents: number; readonly basisPoints: number } | null
  /** The import it came with, null for one entered by hand or worked out. */
  readonly importId?: string | null
  /** The price of `priceBase` units. */
  readonly unitPriceCents: number
  /** How many units the price is for (#456). */
  readonly priceBase: PriceBase
}

export interface SupplierLinkView {
  readonly id: string
  readonly supplierId: string
  readonly supplierName: string
  readonly supplierNumber: string | null
  /** The main supplier, whose purchase price makes the selling price (#463). */
  readonly main: boolean
  /** The supplier's own markup, for whoever may read purchase prices. */
  readonly markup: number | null
  /** Null for whoever may not read purchase prices, not an empty list. */
  readonly purchasePrices: readonly PriceView[] | null
  /** The metal of the article at this supplier (#462), for whoever reads purchase prices. */
  readonly metals?: readonly LinkMetal[] | null
}

export interface ArticleView {
  readonly id: string
  readonly number: string
  readonly designation: string
  readonly description: string | null
  readonly ean: string | null
  readonly unit: LineUnit
  readonly groupOfGoods: string | null
  readonly frequent: boolean
  readonly prices: readonly PriceView[]
  readonly suppliers: readonly SupplierLinkView[]
  /** How the selling price comes about (#463), for whoever may read purchase prices. */
  readonly pricing: ArticlePricing | null
}

/**
 * How an article's selling price comes about (#463): fixed, or following the
 * purchase price of its main supplier with the markup that applies, its own
 * or the supplier's or the business's; `markup` is null where none does.
 */
export interface ArticlePricing {
  readonly fixed: boolean
  readonly basisPoints: number | null
  readonly markup: number | null
  readonly source: 'article' | 'supplier' | 'business' | null
  /** What applies without a markup of its own: the main supplier's, else the business's. */
  readonly inherited: number | null
  readonly business: number | null
  /** The article's word on the markup on the metal surcharge (#462), null for the supplier's. */
  readonly markupOnMetal?: boolean | null
  /** What applies without a word of its own, and whose word that is. */
  readonly metalInherited?: boolean
  readonly metalInheritedFrom?: 'supplier' | 'business'
}

/** The fields of an article as the form sends them. */
export interface ArticleFields {
  readonly number: string
  readonly designation: string
  readonly description: string
  readonly ean: string
  readonly unit: LineUnit
  readonly groupOfGoods: string
  readonly frequent: boolean
}

export interface PriceFields {
  readonly unitPriceCents: number
  readonly priceBase: PriceBase
  readonly validFrom: IsoDate
}

/** What a supplier sells, as the page of the supplier lists it. */
export interface SupplierArticleRow {
  readonly supplierArticleId: string
  readonly supplierNumber: string | null
  readonly articleId: string
  readonly number: string
  readonly designation: string
  readonly unit: LineUnit
  readonly frequent: boolean
  /** Whether this supplier is the article's main one (#463). */
  readonly main: boolean
  readonly purchase: {
    readonly unitPriceCents: number
    readonly priceBase: PriceBase
    readonly validFrom: IsoDate
  } | null
}

export function articlePage(query: ArticleQuery): Promise<ArticlePage> {
  const parameters = new URLSearchParams({
    offset: String(query.offset),
    limit: String(query.limit),
    sort: query.sort,
  })

  if (query.search.trim() !== '') {
    parameters.set('search', query.search.trim())
  }

  if (query.frequent) {
    parameters.set('frequent', 'true')
  }

  if (query.group !== '') {
    parameters.set('group', query.group)
  }

  if (query.on !== undefined) {
    parameters.set('on', query.on)
  }

  if (query.ean !== undefined) {
    parameters.set('ean', query.ean)
  }

  return request<ArticlePage>(`/articles?${parameters.toString()}`)
}

export function articleGroups(): Promise<readonly string[]> {
  return request<readonly string[]>('/articles/groups')
}

export function articleOf(id: string): Promise<ArticleView> {
  return request<ArticleView>(`/articles/${encodeURIComponent(id)}`)
}

export function createArticle(
  fields: ArticleFields,
  price: PriceFields | null,
): Promise<{ readonly id: string }> {
  return request('/articles', { method: 'POST', body: JSON.stringify({ ...fields, price }) })
}

export function updateArticle(id: string, fields: Partial<ArticleFields>): Promise<unknown> {
  return request(`/articles/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(fields),
  })
}

export function removeArticle(id: string): Promise<unknown> {
  return request(`/articles/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export function addArticlePrice(id: string, price: PriceFields): Promise<unknown> {
  return request(`/articles/${encodeURIComponent(id)}/prices`, {
    method: 'POST',
    body: JSON.stringify(price),
  })
}

export function removeArticlePrice(id: string, priceId: string): Promise<unknown> {
  return request(`/articles/${encodeURIComponent(id)}/prices/${encodeURIComponent(priceId)}`, {
    method: 'DELETE',
  })
}

export function addArticleSupplier(
  id: string,
  link: {
    readonly supplierId: string
    readonly supplierNumber: string
    readonly price: PriceFields | null
  },
): Promise<unknown> {
  return request(`/articles/${encodeURIComponent(id)}/suppliers`, {
    method: 'POST',
    body: JSON.stringify(link),
  })
}

export function updateArticleSupplier(
  id: string,
  linkId: string,
  supplierNumber: string,
): Promise<unknown> {
  return request(`/articles/${encodeURIComponent(id)}/suppliers/${encodeURIComponent(linkId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ supplierNumber }),
  })
}

export function removeArticleSupplier(id: string, linkId: string): Promise<unknown> {
  return request(`/articles/${encodeURIComponent(id)}/suppliers/${encodeURIComponent(linkId)}`, {
    method: 'DELETE',
  })
}

export function addPurchasePrice(id: string, linkId: string, price: PriceFields): Promise<unknown> {
  return request(
    `/articles/${encodeURIComponent(id)}/suppliers/${encodeURIComponent(linkId)}/prices`,
    { method: 'POST', body: JSON.stringify(price) },
  )
}

export function removePurchasePrice(id: string, linkId: string, priceId: string): Promise<unknown> {
  return request(
    `/articles/${encodeURIComponent(id)}/suppliers/${encodeURIComponent(linkId)}/prices/${encodeURIComponent(priceId)}`,
    { method: 'DELETE' },
  )
}

/**
 * Fixed, or following with a markup of its own, or with null the supplier's
 * or the business's; and whether the markup comes on the metal surcharge
 * (#462), null for the supplier's word.
 */
export function setArticlePricing(
  id: string,
  pricing: {
    readonly fixed: boolean
    readonly basisPoints: number | null
    readonly markupOnMetal?: boolean | null
  },
): Promise<unknown> {
  return request(`/articles/${encodeURIComponent(id)}/pricing`, {
    method: 'PUT',
    body: JSON.stringify(pricing),
  })
}

export function setMainSupplier(id: string, linkId: string): Promise<unknown> {
  return request(
    `/articles/${encodeURIComponent(id)}/suppliers/${encodeURIComponent(linkId)}/main`,
    { method: 'PUT', body: '{}' },
  )
}

/** The metal of an article at one supplier (#462). */
export interface LinkMetal {
  readonly metal: Metal
  readonly baseEuros: number
  readonly gramsPerThousand: number
}

/** All the metal of the article at one supplier; a metal left out is taken off. */
export function setLinkMetals(
  id: string,
  linkId: string,
  metals: readonly LinkMetal[],
): Promise<unknown> {
  return request(
    `/articles/${encodeURIComponent(id)}/suppliers/${encodeURIComponent(linkId)}/metals`,
    { method: 'PUT', body: JSON.stringify({ metals }) },
  )
}

/** The purchase price of an article's main supplier on a day (#463), with the supplier's name. */
export interface MainPurchase {
  readonly cents: number
  readonly priceBase: PriceBase
  readonly supplierName: string
}

/** The metal of the main supplier with its price of the day (#462). */
export interface MetalOnDay {
  readonly supplierName: string
  readonly metals: readonly (PricedMetal & { readonly priceFrom: IsoDate | null })[]
  readonly markupOnMetal: boolean
}

export function purchaseOf(
  articleId: string,
  day: IsoDate,
): Promise<{ readonly purchase: MainPurchase | null; readonly metal?: MetalOnDay | null }> {
  return request<{ readonly purchase: MainPurchase | null; readonly metal?: MetalOnDay | null }>(
    `/articles/${encodeURIComponent(articleId)}/purchase?on=${day}`,
  )
}

/**
 * A supplier's own markup, the business's beside it, and whether prices are
 * still worked out; with them the words of both on the markup on the metal
 * surcharge (#462).
 */
export interface SupplierMarkup {
  readonly basisPoints: number | null
  readonly business: number | null
  readonly markupOnMetal?: boolean | null
  readonly businessOnMetal?: boolean
  readonly pending: boolean
}

export function supplierMarkup(supplierId: string): Promise<SupplierMarkup> {
  return request<SupplierMarkup>(`/suppliers/${encodeURIComponent(supplierId)}/markup`)
}

/** The supplier's own markup and its word on the metal; what is left out stays. */
export function setSupplierMarkup(
  supplierId: string,
  said: { readonly basisPoints?: number | null; readonly markupOnMetal?: boolean | null },
): Promise<unknown> {
  return request(`/suppliers/${encodeURIComponent(supplierId)}/markup`, {
    method: 'PUT',
    body: JSON.stringify(said),
  })
}

/** A supplier's metal price from a day on (#462). */
export interface MetalPriceView {
  readonly id: string
  readonly metal: Metal
  readonly validFrom: IsoDate
  readonly priceCents: number
}

export interface MetalPricePage {
  readonly total: number
  /** The prices that apply today, one per metal. */
  readonly current: readonly string[]
  readonly rows: readonly MetalPriceView[]
}

export function metalPrices(
  supplierId: string,
  offset: number,
  limit: number,
): Promise<MetalPricePage> {
  return request<MetalPricePage>(
    `/suppliers/${encodeURIComponent(supplierId)}/metal-prices?offset=${String(offset)}&limit=${String(limit)}`,
  )
}

export function addMetalPrice(
  supplierId: string,
  price: { readonly metal: Metal; readonly validFrom: IsoDate; readonly priceCents: number },
): Promise<unknown> {
  return request(`/suppliers/${encodeURIComponent(supplierId)}/metal-prices`, {
    method: 'POST',
    body: JSON.stringify(price),
  })
}

export function removeMetalPrice(supplierId: string, priceId: string): Promise<unknown> {
  return request(
    `/suppliers/${encodeURIComponent(supplierId)}/metal-prices/${encodeURIComponent(priceId)}`,
    { method: 'DELETE' },
  )
}

export interface SupplierArticlePage {
  readonly total: number
  readonly rows: readonly SupplierArticleRow[]
}

export function supplierArticles(
  supplierId: string,
  offset: number,
  limit: number,
): Promise<SupplierArticlePage> {
  return request<SupplierArticlePage>(
    `/suppliers/${encodeURIComponent(supplierId)}/articles?offset=${String(offset)}&limit=${String(limit)}`,
  )
}

export function supplierArticleCounts(): Promise<Readonly<Record<string, number>>> {
  return request<Readonly<Record<string, number>>>('/suppliers/article-counts')
}
