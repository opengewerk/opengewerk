import {
  type IsoDate,
  type LineUnit,
  lineUnits,
  type PriceBase,
  priceBaseOf,
  priceOn,
  type RecordState,
} from '@opengewerk/domain'
import { maybeText, text, useRecords, useSyncStatus } from '@opengewerk/platform-web/sync'
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import { type ArticleRow, articlePage } from '../session/articles.js'

/** An article a search found, as a line takes it over (#296). */
export interface FoundArticle {
  readonly id: string
  readonly number: string
  readonly designation: string
  readonly description: string | null
  readonly unit: LineUnit
  /** The selling price on the day asked for, or null without one. */
  readonly priceCents: number | null
  /** How many units that price is for (#456); one without a price. */
  readonly priceBase: PriceBase
  readonly frequent: boolean
}

export interface ArticleSearch {
  readonly found: readonly FoundArticle[]
  /** How many there are in all, of which `found` shows the first. */
  readonly total: number
  /**
   * Where the search looked: in the whole catalogue on the server, or in the
   * articles on the device, the frequent ones and those of the last 90 days.
   */
  readonly where: 'catalogue' | 'device'
  readonly pending: boolean
  /**
   * Whether the device is without a connection as far as it knows: the
   * browser says so, or the last exchange with the server failed. The flag of
   * the browser alone says online on a network that answers nothing, and a
   * search would then wait for an answer that never comes; the header says
   * "Offline" on the same grounds.
   */
  readonly offline: boolean
}

function unitOf(record: RecordState): LineUnit {
  return lineUnits.find((unit) => unit === record['unit']) ?? 'piece'
}

/** The articles on the device, each with its selling price on the day. */
function held(
  articles: readonly RecordState[],
  prices: readonly RecordState[],
  day: IsoDate,
): FoundArticle[] {
  const byArticle = new Map<
    string,
    { validFrom: IsoDate; unitPriceCents: number; priceBase: PriceBase }[]
  >()

  for (const price of prices) {
    const key = text(price, 'articleId')
    const list = byArticle.get(key) ?? []

    list.push({
      validFrom: text(price, 'validFrom'),
      unitPriceCents: typeof price['unitPriceCents'] === 'number' ? price['unitPriceCents'] : 0,
      priceBase: priceBaseOf(price['priceBase']),
    })
    byArticle.set(key, list)
  }

  return articles
    .map((article) => {
      const id = text(article, 'id')
      const price = priceOn(byArticle.get(id) ?? [], day)

      return {
        id,
        number: text(article, 'number'),
        designation: text(article, 'designation'),
        description: maybeText(article, 'description'),
        unit: unitOf(article),
        priceCents: price?.unitPriceCents ?? null,
        priceBase: price?.priceBase ?? 1,
        frequent: article['frequent'] === true,
      }
    })
    .sort((left, right) =>
      left.number.localeCompare(right.number, 'de', { numeric: true, sensitivity: 'base' }),
    )
}

/** An article of the catalogue on the server as a line takes it over. */
function foundOf(row: ArticleRow): FoundArticle {
  return {
    id: row.id,
    number: row.number,
    designation: row.designation,
    description: row.description,
    unit: row.unit,
    priceCents: row.priceCents,
    priceBase: row.priceBase ?? 1,
    frequent: row.frequent,
  }
}

/** Whether the device counts itself without a connection; see `ArticleSearch.offline`. */
function useOffline(): boolean {
  const status = useSyncStatus()

  return !status.online || status.trouble !== null
}

/** Whether an article on the device answers a search: its number, its name or its EAN. */
function matches(article: FoundArticle, ean: string | null, wanted: string): boolean {
  const needle = wanted.toLocaleLowerCase('de')

  return [article.number, article.designation, ean ?? ''].some((value) =>
    value.toLocaleLowerCase('de').includes(needle),
  )
}

/**
 * The articles a search finds (#296): with a connection in the whole
 * catalogue on the server, the first `limit` of them with the selling price of
 * `day`; without one, or when the server does not answer, in the articles on
 * the device. With nothing typed, the ones on the device, which is what a
 * choice offers before anybody types.
 */
export function useArticleSearch(search: string, day: IsoDate, limit: number): ArticleSearch {
  const offline = useOffline()
  const articles = useRecords('articles')
  const prices = useRecords('article_prices')
  const wanted = search.trim()
  const remote = useQuery({
    queryKey: ['articles', 'search', wanted, day, limit],
    queryFn: () =>
      articlePage({
        search: wanted,
        frequent: false,
        group: '',
        sort: 'number',
        offset: 0,
        limit,
        on: day,
      }),
    enabled: !offline && wanted !== '',
    staleTime: 30_000,
    retry: false,
  })
  const local = useMemo(() => {
    const eans = new Map(
      articles.map((article) => [text(article, 'id'), maybeText(article, 'ean')]),
    )

    return held(articles, prices, day).filter(
      (article) => wanted === '' || matches(article, eans.get(article.id) ?? null, wanted),
    )
  }, [articles, prices, day, wanted])

  if (wanted !== '' && !offline && !remote.isError) {
    return {
      found: (remote.data?.rows ?? []).map(foundOf),
      total: remote.data?.total ?? 0,
      where: 'catalogue',
      pending: remote.isPending,
      offline,
    }
  }

  return {
    found: local.slice(0, limit),
    total: local.length,
    where: 'device',
    pending: false,
    offline,
  }
}

/** What a scanned EAN finds (#263). */
export type EanLookup =
  | { readonly state: 'searching' }
  | { readonly state: 'found'; readonly articles: readonly FoundArticle[] }
  /**
   * No article has the EAN: none on the device, and without a connection
   * that is as far as the device can look, or none in the whole catalogue.
   */
  | { readonly state: 'unknown'; readonly where: 'device' | 'catalogue' }

/** How many articles with one EAN stand as a choice; more than one is rare already. */
const sameEanShown = 8

/**
 * The articles with exactly this EAN, for a scan on site (#263): those on the
 * device first, which is at once and also without a connection, then with a
 * connection those of the whole catalogue. A server that does not answer
 * leaves what the device knows, as the search does.
 */
export function useEanLookup(ean: string, day: IsoDate): EanLookup {
  const offline = useOffline()
  const articles = useRecords('articles')
  const prices = useRecords('article_prices')
  const local = useMemo(
    () =>
      held(
        articles.filter((article) => maybeText(article, 'ean') === ean),
        prices,
        day,
      ),
    [articles, prices, day, ean],
  )
  const remote = useQuery({
    queryKey: ['articles', 'ean', ean, day],
    queryFn: () =>
      articlePage({
        search: '',
        frequent: false,
        group: '',
        sort: 'number',
        offset: 0,
        limit: sameEanShown,
        on: day,
        ean,
      }),
    enabled: !offline && local.length === 0,
    staleTime: 30_000,
    retry: false,
  })

  if (local.length > 0) {
    return { state: 'found', articles: local.slice(0, sameEanShown) }
  }

  if (offline || remote.isError) {
    return { state: 'unknown', where: 'device' }
  }

  if (remote.isPending) {
    return { state: 'searching' }
  }

  return remote.data.rows.length === 0
    ? { state: 'unknown', where: 'catalogue' }
    : { state: 'found', articles: remote.data.rows.map(foundOf) }
}
