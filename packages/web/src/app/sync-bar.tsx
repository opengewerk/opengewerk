import { useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'

import { Button, SyncBar } from '../components/index.js'
import { useSync, useSyncStatus } from '../sync/provider.js'
import { sinceThen } from './format.js'
import { applyUpdate, subscribeToUpdates, updateWaiting } from './updates.js'

/**
 * The strip that sits above every screen on both entries.
 *
 * A strip and never a popup, and it is not dismissible. A conflict that can be
 * clicked away is a conflict nobody sees, and a conflict nobody sees becomes
 * an invoice with the wrong content, weeks later and out of context. The same
 * goes quieter for the outbox: a person who left the cellar has to be able to
 * tell at a glance whether what they wrote down has arrived.
 */
export function SyncStatusBar({ conflictsLink }: { readonly conflictsLink?: ReactNode }) {
  const client = useSync()
  const status = useSyncStatus()

  // Louder than a conflict, and ahead of one: until the refused entry is
  // decided, nothing queued behind it leaves the device, a decision on a
  // conflict included.
  if (status.state === 'refused') {
    return (
      <SyncBar state="conflict" action={conflictsLink}>
        Der Server nimmt eine Änderung nicht an. Bis sie entschieden ist, geht nichts hinaus.
      </SyncBar>
    )
  }

  if (status.state === 'conflict') {
    const count = status.conflicts.length

    return (
      <SyncBar state="conflict" action={conflictsLink}>
        {count === 1
          ? 'Ein Konflikt wartet auf eine Entscheidung.'
          : `${String(count)} Konflikte warten auf eine Entscheidung.`}
      </SyncBar>
    )
  }

  if (status.state === 'offline') {
    return (
      <SyncBar
        state="offline"
        action={
          <Button
            tone="secondary"
            disabled={status.exchanging}
            onClick={() => {
              void client.synchronise()
            }}
          >
            {status.exchanging ? 'Läuft' : 'Erneut versuchen'}
          </Button>
        }
      >
        {status.pending > 0
          ? `${String(status.pending)} Änderung${status.pending === 1 ? '' : 'en'} auf dem Gerät. ${status.trouble ?? 'Keine Verbindung.'}`
          : (status.trouble ?? 'Keine Verbindung.')}
      </SyncBar>
    )
  }

  return <SyncBar state="synced">{`Alles abgeglichen, ${sinceThen(status.lastSyncedAt)}.`}</SyncBar>
}

/**
 * The offer to take the new version, once the service worker has one ready.
 *
 * Its own strip under the sync bar rather than a corner toast, for the
 * same reason: on a phone held in one hand a toast in a corner is a thing that
 * appears and vanishes while somebody is looking at a meter.
 */
export function UpdateBar() {
  const waiting = useSyncExternalStore(subscribeToUpdates, updateWaiting, () => false)

  if (!waiting) {
    return null
  }

  return (
    <div
      role="status"
      className="flex items-center gap-3 px-4 py-2 min-h-tap bg-surface-sunken border-b border-line text-body"
    >
      <span className="grow">Eine neue Fassung liegt bereit.</span>
      <Button tone="primary" onClick={applyUpdate}>
        Jetzt übernehmen
      </Button>
    </div>
  )
}
