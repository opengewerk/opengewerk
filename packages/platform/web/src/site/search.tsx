import { Link } from '@tanstack/react-router'
import clsx from 'clsx'
import { ChevronRight, Monitor, Search, X } from 'lucide-react'
import { useId } from 'react'
import type { ReactNode } from 'react'

import {
  Marked,
  searchGroups,
  searchWords,
  useSearch,
  useSearchWords,
} from '../components/search.js'
import type { SearchHit, SearchKind, SearchSource } from '../components/search.js'
import { SiteText, SiteTrouble } from './kit.js'

/**
 * The search on site (opengewerk-haustechnik#125), the boards "Suche vor Ort,
 * mit Netz" and "ohne Netz": a field at the size of the site, and once words
 * are typed the hits in their groups in place of what stood under it, the
 * children. Emptying the field brings them back.
 *
 * What is searched, and where, is the application's (`SearchSource`): a hit
 * the device cannot show here says where it opens (`away`) and leaves this
 * entry with a plain link.
 */
export function SiteSearch({
  source,
  children,
}: {
  readonly source: SearchSource
  readonly children: ReactNode
}) {
  const { text, words, type, clear } = useSearchWords()
  const state = useSearch(source, words)
  const fieldId = useId()

  return (
    <>
      <div className="relative">
        <label htmlFor={fieldId} className="sr-only">
          {searchWords.label}
        </label>
        <Search
          size={22}
          strokeWidth={2}
          aria-hidden="true"
          className="pointer-events-none absolute top-[15px] left-[13px] text-ink-muted"
        />
        <input
          id={fieldId}
          type="search"
          enterKeyHint="search"
          autoComplete="off"
          value={text}
          placeholder={source.placeholder}
          onChange={(event) => {
            type(event.target.value)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              clear()
            }
          }}
          className={clsx(
            'h-[52px] w-full rounded-[5px] border border-line-strong bg-input pl-[46px] text-[17px] text-ink [&::-webkit-search-cancel-button]:appearance-none',
            text === '' ? 'pr-3' : 'pr-[52px]',
          )}
        />
        {text === '' ? null : (
          <button
            type="button"
            aria-label={searchWords.clear}
            onClick={clear}
            className="absolute top-1 right-1 flex size-11 items-center justify-center text-ink-muted cursor-pointer"
          >
            <X size={20} strokeWidth={2.2} aria-hidden="true" />
          </button>
        )}
      </div>

      {state.state === 'idle' ? (
        children
      ) : (
        <section aria-label={searchWords.hits} className="flex flex-col gap-3">
          {state.state === 'waiting' ? <SiteText muted>{searchWords.waiting}</SiteText> : null}
          {state.state === 'failed' ? <SiteTrouble>{state.message}</SiteTrouble> : null}
          {state.state === 'found' ? (
            <>
              {searchGroups(source.kinds, state.found).map((group) => (
                <SiteHitGroup
                  key={group.kind.key}
                  kind={group.kind}
                  hits={group.hits}
                  more={group.more}
                  words={words}
                />
              ))}
              {state.found.hits.length === 0 ? (
                <div role="status">
                  <SiteText muted>{searchWords.nothing(words)}</SiteText>
                </div>
              ) : null}
              {state.found.note === null ? null : (
                <SiteText muted size={15}>
                  {state.found.note}
                </SiteText>
              )}
            </>
          ) : null}
        </section>
      )}
    </>
  )
}

/** The hits of one kind: small capitals over rows a thumb hits. */
function SiteHitGroup({
  kind,
  hits,
  more,
  words,
}: {
  readonly kind: SearchKind
  readonly hits: readonly SearchHit[]
  readonly more: boolean
  readonly words: string
}) {
  const Icon = kind.icon
  const titleId = useId()

  return (
    <div className="flex flex-col gap-1">
      <p
        id={titleId}
        className="font-condensed text-[14px] font-semibold tracking-[1.1px] text-ink-faint uppercase"
      >
        {kind.title}
      </p>
      <ul aria-labelledby={titleId} className="flex flex-col">
        {hits.map((hit) => {
          const inner = (
            <>
              <Icon
                size={22}
                strokeWidth={2}
                aria-hidden="true"
                className="shrink-0 text-ink-muted"
              />
              <span className="min-w-0 grow">
                <span className="block text-[17px] font-semibold [overflow-wrap:anywhere]">
                  <Marked text={hit.title} words={words} />
                </span>
                <span className="mt-0.5 block text-[15px] leading-[1.35] text-ink-muted">
                  <Marked text={hit.detail} words={words} />
                </span>
                {hit.away === undefined ? null : (
                  <span className="mt-[3px] flex items-center gap-1.5 text-[14px] font-semibold text-ink-muted">
                    <Monitor size={16} strokeWidth={2} aria-hidden="true" />
                    {hit.away}
                  </span>
                )}
              </span>
              <ChevronRight
                size={20}
                strokeWidth={2.2}
                aria-hidden="true"
                className="shrink-0 text-ink-faint"
              />
            </>
          )
          const look =
            'flex min-h-14 items-center gap-3 border-b border-row px-0.5 py-2 text-ink no-underline'

          return (
            <li key={hit.id}>
              {hit.away === undefined ? (
                <Link to={hit.to} className={look}>
                  {inner}
                </Link>
              ) : (
                <a href={hit.to} className={look}>
                  {inner}
                </a>
              )}
            </li>
          )
        })}
      </ul>
      {more ? (
        <SiteText muted size={15}>
          {searchWords.more}
        </SiteText>
      ) : null}
    </div>
  )
}
