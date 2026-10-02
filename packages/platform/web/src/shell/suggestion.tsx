import { Monitor, Smartphone } from 'lucide-react'
import { useState } from 'react'

import { useApplication } from '../application.js'
import { Strip, stripAction } from '../components/strip.js'
import type { Entry } from '../components/surface.js'
import { entryPath, readTraits, rememberedEntry, rememberEntry, suggestionFor } from './entry.js'

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
 *
 * What the two entries are called is the application's (ADR 0010): the second
 * one is named after where its people work when they are not at a desk. So
 * both sentences and both links are its own.
 */
export function EntrySuggestion({ here }: { readonly here: Entry }) {
  const { entry: sentences } = useApplication().sentences
  const [suggested, setSuggested] = useState(() =>
    suggestionFor(here, readTraits(), rememberedEntry()),
  )

  if (!suggested) {
    return null
  }

  return (
    <Strip
      tone="info"
      icon={suggested === 'site' ? Smartphone : Monitor}
      actions={
        <>
          <a
            href={entryPath[suggested]}
            className={stripAction('link', 'info', here)}
            onClick={() => {
              rememberEntry(suggested)
            }}
          >
            {sentences.goTo[suggested]}
          </a>
          <button
            type="button"
            className={stripAction('quiet', 'info', here)}
            onClick={() => {
              rememberEntry(here)
              setSuggested(null)
            }}
          >
            Hier bleiben
          </button>
        </>
      }
    >
      {sentences.suits[suggested]}
    </Strip>
  )
}
