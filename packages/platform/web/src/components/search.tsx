import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { LucideIcon } from 'lucide-react'
import { Fragment, useCallback, useEffect, useRef, useState } from 'react'

/**
 * The search over the records of an application (opengewerk-haustechnik#125),
 * as the foundation draws it: the field in the header of the office, the
 * field over the start on site, and the hits in their groups under either.
 *
 * What is searched and how is the application's (ADR 0010): it hands in its
 * kinds of hits with their words and symbols, and a function that finds them,
 * on its server or on the device. The foundation knows no kind, no record and
 * no address, and an application that hands in no source has no search.
 */

/** A kind of hit: the group it stands in, in the order the application gives. */
export interface SearchKind {
  readonly key: string
  /** The title over the group, as a plural: "Räume". */
  readonly title: string
  readonly icon: LucideIcon
}

/** One hit, in the words the application gives it. */
export interface SearchHit {
  /** The key of its kind. */
  readonly kind: string
  /** Unique among the hits of its kind. */
  readonly id: string
  readonly title: string
  /** What says where it is or what it is, the line under the title. */
  readonly detail: string
  /** The address it opens. */
  readonly to: string
  /**
   * Where a hit opens that the entry it is found in cannot show, said under
   * it: the hit then opens with a plain link and leaves this entry.
   */
  readonly away?: string
}

/** What a search found. */
export interface SearchFound {
  /** At most as many of a kind as the application shows, the best first. */
  readonly hits: readonly SearchHit[]
  /** The kinds with more hits than these, and never how many. */
  readonly more: readonly string[]
  /** Where it was searched, when that is worth saying: without a network, say. */
  readonly note: string | null
}

/** What an application searches, handed in where the foundation draws a search. */
export interface SearchSource {
  /** Tells two sources apart in the cache of the answers. */
  readonly key: string
  /** The hint in the empty field. */
  readonly placeholder: string
  /** What the search looks for, said at the foot of the hits in the office. */
  readonly about: string
  /** The fewest characters a search is asked with. */
  readonly shortest: number
  /** The kinds, in the order their groups stand. */
  readonly kinds: readonly SearchKind[]
  /** Finds what the words say. A refusal carries the sentence to show. */
  readonly find: (words: string, signal: AbortSignal) => Promise<SearchFound>
}

/** The sentences of the foundation around the hits. */
export const searchWords = {
  label: 'Suche',
  hits: 'Treffer der Suche',
  nothing: (words: string) => `Nichts gefunden für „${words}“.`,
  more: 'Weitere Treffer: genauer suchen.',
  waiting: 'Wird gesucht …',
  failed: 'Die Suche ist nicht gelungen.',
  clear: 'Suche leeren',
  close: 'Suche schließen',
  choose: 'wählen',
  open: 'Eingabe öffnet',
} as const

/** How long typing rests before the words are asked, in milliseconds. */
const resting = 200

/**
 * The text of a search field and the words asked: the words follow the text
 * once typing rests, trimmed and with runs of spaces made one.
 */
export function useSearchWords() {
  const [text, setText] = useState('')
  const [words, setWords] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timer.current !== null) {
        clearTimeout(timer.current)
      }
    },
    [],
  )

  const type = useCallback((value: string) => {
    setText(value)

    if (timer.current !== null) {
      clearTimeout(timer.current)
    }

    timer.current = setTimeout(() => {
      setWords(value.trim().replace(/\s+/g, ' '))
    }, resting)
  }, [])

  const clear = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current)
    }

    setText('')
    setWords('')
  }, [])

  return { text, words, type, clear }
}

/** Where a search stands for the words asked. */
export type SearchState =
  | { readonly state: 'idle' }
  | { readonly state: 'waiting' }
  | { readonly state: 'found'; readonly found: SearchFound }
  | { readonly state: 'failed'; readonly message: string }

/** The origin an address is read against, which no address of this server names. */
const ownOrigin = 'https://own.invalid'

/**
 * Whether an address leads somewhere on this server: a path from its root,
 * and not one that names another host (`//`, `/\`) or a scheme. A hit leads
 * there with a plain link or `location.assign`, which run whatever scheme
 * they are given; so the place they are given addresses is checked here and
 * not trusted to every application.
 *
 * A browser drops tabs and line breaks from an address before it reads it,
 * and `/<tab>/host` becomes `//host`: an address with a space or a control
 * character in it is refused outright. What is left is read as a browser
 * reads it, against an origin of its own, and has to stay on that origin.
 */
export function isOwnAddress(to: string): boolean {
  if (
    !to.startsWith('/') ||
    /\s/.test(to) ||
    [...to].some((character) => {
      const code = character.charCodeAt(0)

      return code < 0x20 || code === 0x7f
    })
  ) {
    return false
  }

  try {
    return new URL(to, ownOrigin).origin === ownOrigin
  } catch {
    return false
  }
}

/** What was found, without a hit that would lead off this server. */
function ownHitsOnly(found: SearchFound): SearchFound {
  return { ...found, hits: found.hits.filter((hit) => isOwnAddress(hit.to)) }
}

/**
 * Asks the source for the words, once they are long enough. The question goes
 * out whether or not the browser thinks it is online: the source decides
 * where it searches, and without a network that is the device. What was found
 * for the last words stays while the next are asked. A hit whose address
 * leads off this server is left out (`isOwnAddress`).
 */
export function useSearch(source: SearchSource, words: string): SearchState {
  const asked = words.length >= source.shortest
  const answer = useQuery({
    queryKey: ['search', source.key, words],
    queryFn: ({ signal }) => source.find(words, signal),
    select: ownHitsOnly,
    enabled: asked,
    networkMode: 'always',
    retry: false,
    staleTime: 0,
    gcTime: 60_000,
    placeholderData: keepPreviousData,
  })

  if (!asked) {
    return { state: 'idle' }
  }

  if (answer.data !== undefined) {
    return { state: 'found', found: answer.data }
  }

  if (answer.isError) {
    return {
      state: 'failed',
      message:
        answer.error instanceof Error && answer.error.message !== ''
          ? answer.error.message
          : searchWords.failed,
    }
  }

  return { state: 'waiting' }
}

/** The hits by kind, in the order of the kinds, and each kind only where it has a hit. */
export function searchGroups(
  kinds: readonly SearchKind[],
  found: SearchFound,
): readonly {
  readonly kind: SearchKind
  readonly hits: readonly SearchHit[]
  readonly more: boolean
}[] {
  return kinds.flatMap((kind) => {
    const hits = found.hits.filter((hit) => hit.kind === kind.key)

    return hits.length === 0 ? [] : [{ kind, hits, more: found.more.includes(kind.key) }]
  })
}

/** Where the words stand in a text, as pieces: false outside, true inside, regardless of case. */
export function markedPieces(text: string, words: string): readonly (readonly [string, boolean])[] {
  const needle = words.toLocaleLowerCase('de')

  if (needle === '') {
    return [[text, false]]
  }

  const haystack = text.toLocaleLowerCase('de')
  const pieces: [string, boolean][] = []
  let from = 0

  // The lower case of a text is as long as the text for the letters a name or
  // a number holds; where it is not, the text is shown without a mark.
  if (haystack.length !== text.length) {
    return [[text, false]]
  }

  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, from)) {
    if (at > from) {
      pieces.push([text.slice(from, at), false])
    }

    pieces.push([text.slice(at, at + needle.length), true])
    from = at + needle.length
  }

  if (from < text.length) {
    pieces.push([text.slice(from), false])
  }

  return pieces
}

/** A text with the words searched for marked in it, as the boards draw them. */
export function Marked({ text, words }: { readonly text: string; readonly words: string }) {
  return (
    <>
      {markedPieces(text, words).map(([piece, inside], index) =>
        inside ? (
          <mark key={index} className="bg-waiting-fill px-px text-inherit">
            {piece}
          </mark>
        ) : (
          <Fragment key={index}>{piece}</Fragment>
        ),
      )}
    </>
  )
}
