import {
  type IsoDate,
  type LineUnit,
  lineUnits,
  priceOn,
  type RecordState,
} from '@opengewerk/domain'
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import { articlePage } from '../session/articles.js'
import { maybeText, text } from '../sync/fields.js'
import { useRecords, useSyncStatus } from '../sync/provider.js'

/** An article a search found, as a line takes it over (#296). */
export interface FoundArticle {
  readonly id: string
  readonly number: string
  readonly designation: string
  readonly description: string | null
  readonly unit: LineUnit
  /** The selling price on the day asked for, or null without one. */
  readonly priceCents: number | null
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
  const byArticle = new Map<string, { validFrom: IsoDate; unitPriceCents: number }[]>()

  for (const price of prices) {
    const key = text(price, 'articleId')
    const list = byArticle.get(key) ?? []

    list.push({
      validFrom: text(price, 'validFrom'),
      unitPriceCents: typeof price['unitPriceCents'] === 'number' ? price['unitPriceCents'] : 0,
    })
    byArticle.set(key, list)
  }

  return articles
    .map((article) => {
      const id = text(article, 'id')

      return {
        id,
        number: text(article, 'number'),
        designation: text(article, 'designation'),
        description: maybeText(article, 'description'),
        unit: unitOf(article),
        priceCents: priceOn(byArticle.get(id) ?? [], day)?.unitPriceCents ?? null,
        frequent: article['frequent'] === true,
      }
    })
    .sort((left, right) =>
      left.number.localeCompare(right.number, 'de', { numeric: true, sensitivity: 'base' }),
    )
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
  const status = useSyncStatus()
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
    enabled: status.online && wanted !== '',
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

  if (wanted !== '' && status.online && !remote.isError) {
    return {
      found: (remote.data?.rows ?? []).map((row) => ({
        id: row.id,
        number: row.number,
        designation: row.designation,
        description: row.description,
        unit: row.unit,
        priceCents: row.priceCents,
        frequent: row.frequent,
      })),
      total: remote.data?.total ?? 0,
      where: 'catalogue',
      pending: remote.isPending,
    }
  }

  return { found: local.slice(0, limit), total: local.length, where: 'device', pending: false }
}
