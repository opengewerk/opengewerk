import { RotateCw, TriangleAlert, WifiOff } from 'lucide-react'
import { useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'

import { Strip, stripAction, useEntry } from '../components/index.js'
import { useSync, useSyncStatus } from '../sync/provider.js'
import { applyUpdate, subscribeToUpdates, updateWaiting } from './updates.js'

/**
 * The strip over every screen on both entries, when there is something to do.
 *
 * A person who left the cellar has to be able to tell at a glance whether
 * what they wrote down has arrived, and a conflict has to be in the way until
 * somebody decides it. Everything arrived is no strip at all: the office says
 * so quietly under "Abgleich" in the navigation, the site on its conflict
 * screen (#217). A strip that is always there teaches people to stop reading
 * strips.
 *
 * `conflictsLink` draws the way to the conflicts with the classes it is
 * handed, because the two entries route there each in their own router.
 */
export function SyncStatusBar({
  conflictsLink,
}: {
  readonly conflictsLink?: (className: string) => ReactNode
}) {
  const client = useSync()
  const status = useSyncStatus()
  const entry = useEntry()

  // Louder than a conflict, and ahead of one: until the refused entry is
  // decided, nothing queued behind it leaves the device, a decision on a
  // conflict included.
  if (status.state === 'refused') {
    return (
      <Strip
        tone="conflict"
        icon={TriangleAlert}
        urgent
        detail="Bis sie entschieden ist, geht nichts hinaus."
        actions={conflictsLink?.(stripAction('plain', 'conflict', entry))}
      >
        Der Server nimmt eine Änderung nicht an.
      </Strip>
    )
  }

  if (status.state === 'conflict') {
    const count = status.conflicts.length

    return (
      <Strip
        tone="conflict"
        icon={TriangleAlert}
        urgent
        actions={conflictsLink?.(stripAction('plain', 'conflict', entry))}
      >
        {count === 1
          ? 'Ein Konflikt wartet auf eine Entscheidung.'
          : `${String(count)} Konflikte warten auf eine Entscheidung.`}
      </Strip>
    )
  }

  if (status.state === 'offline') {
    const why = status.trouble ?? 'Keine Verbindung.'
    const waiting =
      status.pending > 0
        ? `${String(status.pending)} Änderung${status.pending === 1 ? '' : 'en'} auf dem Gerät.`
        : null
    const retry = (
      <button
        type="button"
        className={stripAction('plain', 'wait', entry)}
        disabled={status.exchanging}
        onClick={() => {
          void client.synchronise()
        }}
      >
        {status.exchanging ? 'Läuft' : 'Erneut versuchen'}
      </button>
    )

    // The office says the count first, as one line; the site names the state
    // in its first sentence and puts the count under it, as the two boards
    // draw it. Without a count, whatever else the reason says goes there.
    const cut = why.indexOf('. ')
    const head = cut < 0 ? why : why.slice(0, cut + 1)
    const rest = cut < 0 ? null : why.slice(cut + 2)

    return entry === 'site' ? (
      <Strip tone="wait" icon={WifiOff} detail={waiting ?? rest} actions={retry}>
        {head}
      </Strip>
    ) : (
      <Strip tone="wait" icon={WifiOff} actions={retry}>
        {waiting ? `${waiting} ${why}` : why}
      </Strip>
    )
  }

  return null
}

/**
 * The offer to take the new version, once the service worker has one ready.
 *
 * Its own strip rather than a corner toast, for the same reason as above: on a
 * phone held in one hand a toast in a corner is a thing that appears and
 * vanishes while somebody is looking at a meter.
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
