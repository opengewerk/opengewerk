import { Strip, stripAction, useEntry } from '@opengewerk/platform-web'
import { RotateCw } from 'lucide-react'
import { useSyncExternalStore } from 'react'

import { applyUpdate, subscribeToUpdates, updateWaiting } from './updates.js'

/**
 * The offer to take the new version, once the service worker has one ready.
 *
 * Its own strip rather than a corner toast, for the same reason as the strip
 * of the sync, which the foundation draws: on a phone held in one hand a toast
 * in a corner is a thing that appears and vanishes while somebody is looking
 * at a meter.
 */
export function UpdateBar() {
  const waiting = useSyncExternalStore(subscribeToUpdates, updateWaiting, () => false)
  const entry = useEntry()

  if (!waiting) {
    return null
  }

  return (
    <Strip
      tone="info"
      // The site board draws this strip without a symbol; the office one with
      // the arrow of a reload.
      icon={entry === 'site' ? undefined : RotateCw}
      actions={
        <button
          type="button"
          className={stripAction('primary', 'info', entry)}
          onClick={applyUpdate}
        >
          Jetzt übernehmen
        </button>
      }
    >
      Eine neue Fassung liegt bereit.
    </Strip>
  )
}
