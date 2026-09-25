import { useSyncExternalStore } from 'react'

/**
 * The band of the board "Breiten und Auflösungen" the window is in (#218).
 *
 * S up to 599 pixels, M up to 1023, L up to 1599, XL up to 2399, XXL beyond.
 * Most of what changes between them is style and stays in the stylesheet, at
 * the same breakpoints (`tokens.css`). This is for the few things that change
 * what a screen does, not only how it looks: a list that turns into cards on a
 * phone, a click on a row that selects it from 1600 pixels on instead of
 * opening it, a record that stands beside the list from 2400.
 */
export type Band = 'S' | 'M' | 'L' | 'XL' | 'XXL'

/** Widest first, the first that matches is the band. */
const steps: readonly (readonly [Band, string])[] = [
  ['XXL', '(min-width: 150rem)'],
  ['XL', '(min-width: 100rem)'],
  ['L', '(min-width: 64rem)'],
  ['M', '(min-width: 37.5rem)'],
]

/**
 * From 3000 pixels the record beside a list stands in three columns instead of
 * two, as on the boards at 3440 and 3840 pixels.
 */
const threeColumns = '(min-width: 187.5rem)'

function matcher(): ((query: string) => MediaQueryList) | null {
  return typeof globalThis.matchMedia === 'function'
    ? (query) => globalThis.matchMedia(query)
    : null
}

/**
 * Where the answer is not known, in a test without a window or before the
 * first paint, the band is L: the width every board of the office is drawn at.
 */
const unknown: Band = 'L'

function currentBand(): Band {
  const match = matcher()

  if (!match) {
    return unknown
  }

  for (const [band, query] of steps) {
    if (match(query).matches) {
      return band
    }
  }

  return 'S'
}

function subscribe(onChange: () => void): () => void {
  const match = matcher()

  if (!match) {
    return () => {}
  }

  const lists = [...steps.map(([, query]) => match(query)), match(threeColumns)]

  for (const list of lists) {
    list.addEventListener('change', onChange)
  }

  return () => {
    for (const list of lists) {
      list.removeEventListener('change', onChange)
    }
  }
}

export function useBand(): Band {
  return useSyncExternalStore(subscribe, currentBand, () => unknown)
}

function hasThreeColumns(): boolean {
  return matcher()?.(threeColumns).matches === true
}

/** Whether the window is wide enough for a record in three columns. */
export function useThreeColumns(): boolean {
  return useSyncExternalStore(subscribe, hasThreeColumns, () => false)
}

/** A finger rather than a mouse: the bands below 1024 pixels. */
export function isNarrow(band: Band): boolean {
  return band === 'S' || band === 'M'
}
