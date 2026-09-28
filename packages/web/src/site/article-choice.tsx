import type { IsoDate } from '@opengewerk/domain'
import { Plus, WifiOff } from 'lucide-react'
import { useDeferredValue, useState } from 'react'

import { Field } from '../components/index.js'
import { type FoundArticle, useArticleSearch } from '../app/article-search.js'
import { lineUnitLabel } from '../app/labels.js'
import { SiteLabel, SiteText } from './kit.js'

/** How many hits, and how many articles of each group, stand as buttons. */
const shownHits = 8

/** One article to take over: a row as tall as a thumb, the name and what it is counted in. */
function Hit({
  article,
  onPick,
}: {
  readonly article: FoundArticle
  readonly onPick: (article: FoundArticle) => void
}) {
  return (
    <button
      type="button"
      aria-label={`${article.designation} übernehmen`}
      onClick={() => {
        onPick(article)
      }}
      className="flex min-h-[60px] w-full cursor-pointer items-center gap-2.5 rounded-[6px] border border-line bg-ground py-2 pr-2.5 pl-3 text-left text-ink"
    >
      <span className="min-w-0 grow">
        <span className="block text-[17px] leading-[1.3] font-semibold [overflow-wrap:anywhere]">
          {article.designation}
        </span>
        <span className="mt-0.5 block text-[15px] text-ink-muted">
          {`${article.number} · ${lineUnitLabel[article.unit]}`}
        </span>
      </span>
      <Plus size={22} strokeWidth={2.2} aria-hidden="true" className="shrink-0 text-copper-text" />
    </button>
  )
}

function Hits({
  articles,
  onPick,
}: {
  readonly articles: readonly FoundArticle[]
  readonly onPick: (article: FoundArticle) => void
}) {
  return (
    <ul className="flex flex-col gap-2">
      {articles.map((article) => (
        <li key={article.id}>
          <Hit article={article} onPick={onPick} />
        </li>
      ))}
    </ul>
  )
}

/**
 * An article to take into "Material eintragen" (#296), the boards "Material
 * eintragen: einen Artikel suchen" and "Material eintragen ohne Netz": a
 * search, and one tap on a hit fills material and unit. With a network it
 * looks in the whole catalogue; without one in the articles on the device,
 * and before anybody types it offers those, the frequent ones and the ones
 * of the last 90 days. No price stands here: the invoice made from the report
 * takes the one of its date.
 */
export function ArticleChoice({
  day,
  onPick,
}: {
  /** The date of the report. */
  readonly day: IsoDate
  readonly onPick: (article: FoundArticle) => void
}) {
  const [search, setSearch] = useState('')
  const wanted = useDeferredValue(search)
  const found = useArticleSearch(wanted, day, shownHits)
  const held = useArticleSearch('', day, Number.MAX_SAFE_INTEGER)
  const frequent = held.found.filter((article) => article.frequent).slice(0, shownHits)
  const recent = held.found.filter((article) => !article.frequent).slice(0, shownHits)
  const searching = search.trim() !== ''

  function pick(article: FoundArticle) {
    setSearch('')
    onPick(article)
  }

  return (
    <div className="flex flex-col gap-3.5">
      <Field
        label="Artikel suchen"
        type="search"
        autoComplete="off"
        placeholder="Bezeichnung, Nummer oder EAN"
        value={search}
        onChange={(event) => {
          setSearch(event.target.value)
        }}
      />
      {held.offline ? (
        <div className="flex gap-2.5 rounded-[6px] border border-waiting-edge bg-waiting-fill px-3 py-2.5 text-[15px] leading-[1.45] text-ink">
          <WifiOff
            size={18}
            strokeWidth={2.2}
            aria-hidden="true"
            className="mt-0.5 shrink-0 text-waiting"
          />
          <span>
            Ohne Netz sucht die App in den häufigen Artikeln und in denen der letzten 90 Tage. Den
            ganzen Katalog mit Netz.
          </span>
        </div>
      ) : null}
      {searching ? (
        found.pending ? (
          <SiteText muted size={15}>
            Wird gesucht.
          </SiteText>
        ) : found.found.length === 0 ? (
          <SiteText muted size={15}>
            {found.where === 'device'
              ? 'Kein Artikel auf diesem Gerät passt. Den ganzen Katalog gibt es mit Netz.'
              : 'Kein Artikel passt zur Suche.'}
          </SiteText>
        ) : (
          <Hits articles={found.found} onPick={pick} />
        )
      ) : (
        <>
          {frequent.length > 0 ? (
            <div className="flex flex-col gap-2">
              <SiteLabel>Häufig</SiteLabel>
              <Hits articles={frequent} onPick={pick} />
            </div>
          ) : null}
          {recent.length > 0 ? (
            <div className="flex flex-col gap-2">
              <SiteLabel>Zuletzt benutzt</SiteLabel>
              <Hits articles={recent} onPick={pick} />
            </div>
          ) : null}
        </>
      )}
      <SiteText muted size={15}>
        Nicht dabei? Dann das Material unten von Hand eintragen.
      </SiteText>
      <div className="h-px bg-line" />
    </div>
  )
}
