import { request } from '../sync/transport.js'

/**
 * The routes of the stock (ADR 0011, opengewerk#298) as the screens of the
 * office call them: the stores with what is wrong in them, one store with its
 * stock, its bookings page by page, and the bookings the office makes.
 * Quantities are in thousandths of the unit of their article.
 */

/** A store as the list shows it, with the columns of the application beside. */
export interface StoreSummary {
  readonly id: string
  readonly name: string
  readonly location: string | null
  /** Whether it is a vehicle, where the application keeps vehicles. */
  readonly vehicle?: boolean
  readonly plate?: string | null
  readonly articles: number
  readonly belowMinimum: number
  readonly belowZero: number
}

/** An article a store keeps: its place, its minimum and its stock. */
export interface StockRow {
  readonly articleId: string
  readonly number: string
  readonly designation: string
  readonly unit: string
  readonly storeArticleId: string | null
  readonly bin: string | null
  readonly minimumMilli: number | null
  readonly levelMilli: number
}

export interface StoreWithStock {
  readonly id: string
  readonly name: string
  readonly location: string | null
  readonly vehicle?: boolean
  readonly plate?: string | null
  readonly stock: readonly StockRow[]
}

/** A booking as the list of a store shows it, as the database names its fields. */
export interface MovementRow {
  readonly id: string
  readonly kind: string
  readonly quantity_milli: number
  readonly created_at: string
  readonly booked_by: string | null
  readonly reason: string | null
  readonly article_number: string
  readonly article_designation: string
  readonly article_unit: string
  readonly counterpart_name: string | null
  readonly supplier_name: string | null
  /** Columns of the application, such as the job a withdrawal was for. */
  readonly [own: string]: unknown
}

export interface MovementPage {
  readonly total: number
  readonly rows: readonly MovementRow[]
}

const at = (storeId: string) => `/stores/${encodeURIComponent(storeId)}`

export function storesOf(): Promise<StoreSummary[]> {
  return request<StoreSummary[]>('/stores')
}

export function storeOf(storeId: string): Promise<StoreWithStock> {
  return request<StoreWithStock>(at(storeId))
}

export function movementsOf(storeId: string, offset: number, limit: number): Promise<MovementPage> {
  return request<MovementPage>(
    `${at(storeId)}/movements?offset=${String(offset)}&limit=${String(limit)}`,
  )
}

export function newStore(fields: Readonly<Record<string, unknown>>): Promise<StoreSummary> {
  return request<StoreSummary>('/stores', { method: 'POST', body: JSON.stringify(fields) })
}

export function changeStore(
  storeId: string,
  fields: Readonly<Record<string, unknown>>,
): Promise<unknown> {
  return request(at(storeId), { method: 'PATCH', body: JSON.stringify(fields) })
}

export function removeStore(storeId: string): Promise<unknown> {
  return request(at(storeId), { method: 'DELETE' })
}

export function keepArticle(
  storeId: string,
  articleId: string,
  place: { readonly bin: string | null; readonly minimumMilli: number | null },
): Promise<unknown> {
  return request(`${at(storeId)}/articles/${encodeURIComponent(articleId)}`, {
    method: 'PUT',
    body: JSON.stringify(place),
  })
}

export function bookReceipt(
  storeId: string,
  receipt: {
    readonly articleId: string
    readonly quantityMilli: number
    readonly supplierId?: string | null
  },
): Promise<unknown> {
  return request(`${at(storeId)}/receipts`, { method: 'POST', body: JSON.stringify(receipt) })
}

/** Out of this store into another. */
export function bookTransfer(
  storeId: string,
  transfer: {
    readonly articleId: string
    readonly quantityMilli: number
    readonly toStoreId: string
  },
): Promise<unknown> {
  return request(`${at(storeId)}/transfers`, { method: 'POST', body: JSON.stringify(transfer) })
}

export function bookCount(
  storeId: string,
  count: { readonly articleId: string; readonly quantityMilli: number; readonly reason: string },
): Promise<unknown> {
  return request(`${at(storeId)}/counts`, { method: 'POST', body: JSON.stringify(count) })
}
