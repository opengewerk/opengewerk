import { Link, useNavigate } from '@tanstack/react-router'
import clsx from 'clsx'
import { ArrowDown, ArrowUp, Search } from 'lucide-react'
import { Fragment, useEffect, useId, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'

import { isNarrow, useBand } from '../components/band.js'
import {
  Marked,
  searchGroups,
  searchWords,
  useSearch,
  useSearchWords,
} from '../components/search.js'
import type { SearchHit, SearchSource, SearchState } from '../components/search.js'

/**
 * The search in the header of the office (opengewerk-haustechnik#125), the
 * boards "Suche nach Name, Nummer und Kennzeichen" and "Suche am Telefon":
 * from 1024 pixels a field in the header, under 1024 a magnifier there that
 * opens the search over the screen. Strg K (Cmd K on a Mac) goes into it from
 * any screen of the office.
 *
 * The hits stand in their groups, the first one chosen; the arrow keys choose
 * another and Enter opens it. What is searched is the application's
 * (`SearchSource`).
 */
export function OfficeSearch({ source }: { readonly source: SearchSource }) {
  return isNarrow(useBand()) ? <PhoneSearch source={source} /> : <HeaderSearch source={source} />
}

/** Strg K or Cmd K, from anywhere in the office. */
function isTheShortcut(event: globalThis.KeyboardEvent): boolean {
  return (event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'k'
}

/**
 * The hit chosen with the keyboard, and opening one. The choice belongs to the
 * words it was made for: new words choose the first hit again.
 */
function useChoice(words: string, state: SearchState, onOpened: () => void) {
  const navigate = useNavigate()
  const [chosen, setChosen] = useState({ words, index: 0 })
  const hits = state.state === 'found' ? orderedHits(state) : []
  const index = chosen.words === words ? Math.min(chosen.index, Math.max(hits.length - 1, 0)) : 0

  const open = (hit: SearchHit) => {
    onOpened()

    if (hit.away === undefined) {
      void navigate({ to: hit.to })
    } else {
      globalThis.location.assign(hit.to)
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (hits.length === 0) {
        return
      }

      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      setChosen({ words, index: (index + step + hits.length) % hits.length })
    } else if (event.key === 'Enter') {
      const hit = hits[index]

      if (hit !== undefined) {
        event.preventDefault()
        open(hit)
      }
    }
  }

  return { chosen: hits[index] ?? null, open, onKeyDown }
}

/** The hits in the order their groups show them, which is the order the arrow keys walk. */
function orderedHits(state: Extract<SearchState, { state: 'found' }>): readonly SearchHit[] {
  return state.found.hits
}

function optionId(list: string, hit: SearchHit): string {
  return `${list}-${hit.kind}-${hit.id}`
}

/** The field in the header from 1024 pixels, and the hits under it. */
function HeaderSearch({ source }: { readonly source: SearchSource }) {
  const { text, words, type, clear } = useSearchWords()
  const [open, setOpen] = useState(false)
  const field = useRef<HTMLInputElement>(null)
  const frame = useRef<HTMLDivElement>(null)
  const state = useSearch(source, words)
  const fieldId = useId()
  const listId = useId()
  const close = () => {
    setOpen(false)
    clear()
    field.current?.blur()
  }
  const choice = useChoice(words, sortedFor(source, state), close)
  const shown = open && state.state !== 'idle'
  // The list stands only with a hit; before, the field controls nothing yet.
  const listed = shown && choice.chosen !== null

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (isTheShortcut(event)) {
        event.preventDefault()
        field.current?.focus()
        setOpen(true)
      }
    }

    document.addEventListener('keydown', onKey)

    return () => {
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  useEffect(() => {
    if (!shown) {
      return
    }

    const onPointer = (event: PointerEvent) => {
      if (frame.current && !frame.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    document.addEventListener('pointerdown', onPointer)

    return () => {
      document.removeEventListener('pointerdown', onPointer)
    }
  }, [shown])

  return (
    <div ref={frame} className="relative w-[300px] shrink-0">
      <label htmlFor={fieldId} className="sr-only">
        {searchWords.label}
      </label>
      <input
        ref={field}
        id={fieldId}
        type="search"
        role="combobox"
        aria-expanded={listed}
        aria-controls={listed ? listId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={
          listed && choice.chosen ? optionId(listId, choice.chosen) : undefined
        }
        autoComplete="off"
        value={text}
        placeholder={source.placeholder}
        onChange={(event) => {
          type(event.target.value)
          setOpen(true)
        }}
        onFocus={() => {
          setOpen(true)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            close()
          } else {
            choice.onKeyDown(event)
          }
        }}
        className="h-8 w-full rounded-control border border-top-line bg-top-input pr-16 pl-2.5 text-[13px] text-top-ink placeholder:text-top-muted [&::-webkit-search-cancel-button]:appearance-none"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute top-1.5 right-[7px] flex gap-[3px]"
      >
        <kbd className="rounded-[3px] border border-top-line px-[5px] py-px font-condensed text-[11px] font-semibold text-top-muted">
          Strg
        </kbd>
        <kbd className="rounded-[3px] border border-top-line px-[5px] py-px font-condensed text-[11px] font-semibold text-top-muted">
          K
        </kbd>
      </span>

      {shown ? (
        <>
          {/* The screen under the hits steps back, as the board draws it;
              a click on it closes the search like any click outside. */}
          <div
            aria-hidden="true"
            className="fixed inset-x-0 top-[52px] bottom-0 z-30 bg-[rgb(15_20_27/0.35)]"
          />
          <div className="absolute top-[calc(100%+4px)] left-[-70px] z-40 w-[520px] rounded-[6px] border border-line bg-surface py-1.5 text-ink shadow-[0_12px_32px_rgb(15_20_27/0.28)]">
            <SearchHits
              source={source}
              state={sortedFor(source, state)}
              words={words}
              listId={listId}
              chosen={choice.chosen}
              onOpen={close}
              size="header"
            />
            <div className="flex items-center gap-2 border-t border-line px-3 pt-2 pb-1 text-[12px] text-ink-faint">
              <span>
                {state.state === 'found' ? (state.found.note ?? source.about) : source.about}
              </span>
              <span className="grow" />
              <span className="flex items-center">
                <ArrowUp size={12} strokeWidth={2.2} aria-hidden="true" />
                <ArrowDown size={12} strokeWidth={2.2} aria-hidden="true" />
                <span className="ml-1">{searchWords.choose}</span>
              </span>
              <span>{searchWords.open}</span>
            </div>
          </div>
        </>
      ) : null}
    </div>
  )
}

/**
 * Below 1024 pixels: the magnifier in the header, and the search over the
 * screen once it is pressed. The magnifier and Escape close it again.
 */
function PhoneSearch({ source }: { readonly source: SearchSource }) {
  const { text, words, type, clear } = useSearchWords()
  const [open, setOpen] = useState(false)
  const field = useRef<HTMLInputElement>(null)
  const state = useSearch(source, words)
  const fieldId = useId()
  const listId = useId()
  const close = () => {
    setOpen(false)
    clear()
  }
  const choice = useChoice(words, sortedFor(source, state), close)

  useEffect(() => {
    if (open) {
      field.current?.focus()
    }
  }, [open])

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (isTheShortcut(event)) {
        event.preventDefault()
        setOpen(true)
      }
    }

    document.addEventListener('keydown', onKey)

    return () => {
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  return (
    <>
      <button
        type="button"
        aria-label={searchWords.label}
        aria-expanded={open}
        onClick={() => {
          if (open) {
            close()
          } else {
            setOpen(true)
          }
        }}
        className={clsx(
          'flex size-11 shrink-0 items-center justify-center rounded-control text-top-ink cursor-pointer',
          open && 'bg-top-input',
        )}
      >
        <Search size={21} strokeWidth={2.1} aria-hidden="true" />
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label={searchWords.label}
          className="fixed inset-x-0 top-14 bottom-0 z-40 flex flex-col bg-surface text-ink"
        >
          <div className="px-4 pt-3 pb-2">
            <label htmlFor={fieldId} className="sr-only">
              {searchWords.label}
            </label>
            <input
              ref={field}
              id={fieldId}
              type="search"
              role="combobox"
              aria-expanded={choice.chosen !== null}
              aria-controls={choice.chosen === null ? undefined : listId}
              aria-autocomplete="list"
              aria-activedescendant={choice.chosen ? optionId(listId, choice.chosen) : undefined}
              autoComplete="off"
              value={text}
              placeholder={source.placeholder}
              onChange={(event) => {
                type(event.target.value)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault()
                  close()
                } else {
                  choice.onKeyDown(event)
                }
              }}
              className="h-12 w-full rounded-control border border-line-strong bg-input px-3 text-[16px] text-ink [&::-webkit-search-cancel-button]:appearance-none"
            />
          </div>
          <div className="min-h-0 grow overflow-y-auto">
            {state.state === 'idle' ? null : (
              <SearchHits
                source={source}
                state={sortedFor(source, state)}
                words={words}
                listId={listId}
                chosen={choice.chosen}
                onOpen={close}
                size="phone"
              />
            )}
          </div>
          <p className="border-t border-line px-4 pt-2.5 pb-3.5 text-[13px] text-ink-faint">
            {state.state === 'found' ? (state.found.note ?? source.about) : source.about}
          </p>
        </div>
      ) : null}
    </>
  )
}

/**
 * The hits in the order the groups stand in: the kinds in the order of the
 * source, so that the arrow keys walk down the list the eye reads.
 */
function sortedFor(source: SearchSource, state: SearchState): SearchState {
  if (state.state !== 'found') {
    return state
  }

  const hits = searchGroups(source.kinds, state.found).flatMap((group) => group.hits)

  return { state: 'found', found: { ...state.found, hits } }
}

/** The groups of hits, or why there are none. */
function SearchHits({
  source,
  state,
  words,
  listId,
  chosen,
  onOpen,
  size,
}: {
  readonly source: SearchSource
  readonly state: SearchState
  readonly words: string
  readonly listId: string
  readonly chosen: SearchHit | null
  readonly onOpen: () => void
  readonly size: 'header' | 'phone'
}) {
  const inset = size === 'header' ? 'px-3' : 'px-4'

  if (state.state === 'waiting') {
    return <p className={clsx(inset, 'py-2 text-[14px] text-ink-muted')}>{searchWords.waiting}</p>
  }

  if (state.state === 'failed') {
    return (
      <p role="alert" className={clsx(inset, 'py-2 text-[14px] font-semibold text-conflict')}>
        {state.message}
      </p>
    )
  }

  if (state.state !== 'found') {
    return null
  }

  const groups = searchGroups(source.kinds, state.found)

  if (groups.length === 0) {
    return (
      <p role="status" className={clsx(inset, 'py-2 text-[14px] text-ink-muted')}>
        {searchWords.nothing(words)}
      </p>
    )
  }

  return (
    <div id={listId} role="listbox" aria-label={searchWords.hits}>
      {groups.map((group, position) => {
        const titleId = `${listId}-${group.kind.key}`
        const Icon = group.kind.icon

        return (
          <Fragment key={group.kind.key}>
            {position > 0 ? (
              <div
                aria-hidden="true"
                className={clsx('h-px bg-line', size === 'phone' && 'mx-4')}
              />
            ) : null}
            <div role="group" aria-labelledby={titleId} className="py-1.5">
              <div
                id={titleId}
                className={clsx(
                  inset,
                  'py-1 font-condensed font-semibold tracking-[1.1px] text-ink-faint uppercase',
                  size === 'header' ? 'text-[12px]' : 'text-[13px]',
                )}
              >
                {group.kind.title}
              </div>
              {group.hits.map((hit) => {
                const look = clsx(
                  'flex items-center text-ink no-underline',
                  size === 'header' ? 'gap-2.5 px-3 py-[7px]' : 'min-h-[52px] gap-3 px-4 py-1.5',
                  chosen === hit && 'bg-selected',
                )
                const inner = (
                  <>
                    <Icon
                      size={size === 'header' ? 16 : 18}
                      strokeWidth={2}
                      aria-hidden="true"
                      className="shrink-0 text-ink-muted"
                    />
                    <span className="min-w-0 grow leading-[1.3]">
                      <span
                        className={clsx(
                          'block [overflow-wrap:anywhere]',
                          size === 'header' ? 'text-[14px]' : 'text-[16px]',
                        )}
                      >
                        <Marked text={hit.title} words={words} />
                      </span>
                      <span
                        className={clsx(
                          'block text-ink-faint',
                          size === 'header' ? 'text-[12px]' : 'text-[14px]',
                        )}
                      >
                        <Marked text={hit.detail} words={words} />
                      </span>
                      {hit.away === undefined ? null : (
                        <span
                          className={clsx(
                            'block font-semibold text-ink-muted',
                            size === 'header' ? 'text-[12px]' : 'text-[14px]',
                          )}
                        >
                          {hit.away}
                        </span>
                      )}
                    </span>
                  </>
                )
                const common = {
                  id: optionId(listId, hit),
                  role: 'option',
                  'aria-selected': chosen === hit,
                  className: look,
                  onClick: onOpen,
                } as const

                return hit.away === undefined ? (
                  <Link key={hit.id} to={hit.to} {...common}>
                    {inner}
                  </Link>
                ) : (
                  <a key={hit.id} href={hit.to} {...common}>
                    {inner}
                  </a>
                )
              })}
              {group.more ? (
                <p className={clsx(inset, 'py-1 text-[12px] text-ink-faint')}>{searchWords.more}</p>
              ) : null}
            </div>
          </Fragment>
        )
      })}
    </div>
  )
}
