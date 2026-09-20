import { useState } from 'react'

import { Button } from '../components/index.js'
import type { Entry } from '../entry/entry.js'
import {
  entryPath,
  readTraits,
  rememberedEntry,
  rememberEntry,
  suggestionFor,
} from '../entry/entry.js'

const other: Readonly<Record<Entry, string>> = {
  office: 'Büroansicht',
  site: 'Baustellenansicht',
}

/**
 * The offer to switch to the entry point this device actually suits.
 *
 * A suggestion, which is what ADR 0004 asks for, and also the only version
 * that survives two bundles: redirecting a phone from the office would have it
 * download the office application first and the site one second, and the
 * budget for a first load on site would be the sum of both.
 *
 * It is a real link and not a router navigation, because the two entries are
 * two documents. Staying is remembered as well as leaving, so nobody is asked
 * twice: being offered the site app every morning at a desk is how a
 * suggestion becomes something people learn to click away without reading.
 */
export function EntrySuggestion({ here }: { readonly here: Entry }) {
  const [suggested, setSuggested] = useState(() =>
    suggestionFor(here, readTraits(), rememberedEntry()),
  )

  if (!suggested) {
    return null
  }

  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-3 px-4 py-2 bg-surface-sunken border-b border-line text-body"
    >
      <span className="grow">
        {suggested === 'site'
          ? 'Das sieht nach einem Gerät für die Baustelle aus.'
          : 'Das sieht nach einem Arbeitsplatz aus. Im Büro ist mehr zu sehen.'}
      </span>
      <a
        href={entryPath[suggested]}
        className="inline-flex items-center justify-center h-control min-h-tap px-4 rounded-control text-body font-semibold bg-copper-solid text-on-copper"
        onClick={() => {
          rememberEntry(suggested)
        }}
      >
        {`Zur ${other[suggested]}`}
      </a>
      <Button
        tone="quiet"
        onClick={() => {
          rememberEntry(here)
          setSuggested(null)
        }}
      >
        Hier bleiben
      </Button>
    </div>
  )
}
