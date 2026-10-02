import { TriangleAlert, WifiOff } from 'lucide-react'
import type { ReactNode } from 'react'

import { Strip, stripAction } from '../components/strip.js'
import { useEntry } from '../components/surface.js'
import { useSync, useSyncStatus } from './provider.js'

/**
 * The strip over every screen on both entries, when there is something to do.
 *
 * A person who left the cellar has to be able to tell at a glance whether
 * what they wrote down has arrived, and a conflict has to be in the way until
 * somebody decides it. Everything arrived is no strip at all: an application
 * says so quietly where it shows the state of the sync (#217). A strip that
 * is always there teaches people to stop reading strips.
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

  // Waiting changes with nothing gone wrong are no missing connection: that
  // is every change for the moment between the outbox and the server, and a
  // strip saying "Keine Verbindung." over a send that works was the result
  // (#223). A real failure always leaves its reason in `trouble`.
  if (status.state === 'offline' && status.trouble !== null) {
    const why = status.trouble
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
