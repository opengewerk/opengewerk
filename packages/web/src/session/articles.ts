import type { IsoDate, LineUnit, PriceBase } from '@opengewerk/domain'

import { request } from '../sync/transport.js'

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
}

/** A price from a day on, selling or purchase. */
export interface PriceView {
  readonly id: string
  readonly validFrom: IsoDate
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
  /** Null for whoever may not read purchase prices, not an empty list. */
  readonly purchasePrices: readonly PriceView[] | null
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
