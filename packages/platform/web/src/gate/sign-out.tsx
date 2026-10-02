import { LogOut } from 'lucide-react'
import { useState } from 'react'

import { useApplication } from '../application.js'
import { Button } from '../components/button.js'
import { rememberedAccount } from '../session/remembered.js'
import { signOut } from '../session/session.js'
import type { SyncClient } from '../sync/client.js'
import { deleteLocalStore, storesOnDevice, waitingIn } from '../sync/store.js'

/** "1 Änderung" or "3 Änderungen". */
function changes(count: number): string {
  return count === 1 ? '1 Änderung' : `${String(count)} Änderungen`
}

/**
 * Runs what an application handed in, and makes nothing of whatever goes
 * wrong in it, thrown at once or later: it is never in the way of what comes
 * after.
 */
async function quietly(task: (() => Promise<unknown>) | undefined): Promise<void> {
  try {
    await task?.()
  } catch {
    // Whatever it was, the sign out goes on.
  }
}

/**
 * Signing out, and taking along what this device holds (#186).
 *
 * Every store of a tenant on this device goes, with every record in it and
 * every file. A device that is handed on, sold or lost after somebody signed
 * out would otherwise carry the tenant on, readable to anybody who opens the
 * developer tools of the browser.
 *
 * What has not reached the server yet is sent first. When that is not
 * possible, the button says how much would be lost and signs out only once
 * that is confirmed: a sign out in a cellar must not quietly throw away what
 * was written there. The server session is ended after the data is gone, so
 * that a sign out without a network still leaves nothing behind here.
 *
 * In between, the application ends what it keeps on the server for this
 * device (`beforeSignOut`, ADR 0010), while there is a session to do it with.
 */
export function SignOutButton({
  client,
  onSignedOut,
  wide = false,
  row = false,
  icon = false,
}: {
  /** The running sync client, when a tenant is open; its outbox is sent first. */
  readonly client: SyncClient | null
  readonly onSignedOut: () => void
  readonly wide?: boolean
  /**
   * A line in a menu rather than a button: in the menu under the name in the
   * office header, or `large` in the menu sheet on site, 56 pixels for a thumb.
   */
  readonly row?: boolean | 'large'
  /** The door in front of the word, as the head of "Konto" has it. */
  readonly icon?: boolean
}) {
  const application = useApplication()
  const [waiting, setWaiting] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)

  function named(): string[] {
    const kept = rememberedAccount()?.tenantId

    return kept ? [kept] : []
  }

  async function leave() {
    setBusy(true)
    setTrouble(null)

    try {
      const stores = await storesOnDevice(named())

      client?.stop()

      for (const tenant of stores) {
        await deleteLocalStore(tenant)
      }
    } catch {
      setTrouble('Die Daten auf diesem Gerät ließen sich nicht vollständig löschen.')
      setBusy(false)

      return
    }

    // What the application keeps on the server for this device goes first,
    // while there is a session to take it off with, as the row a push
    // message would be sent to (#284). Never longer than a few seconds and
    // never in the way: a server sends nothing to a device whose session has
    // ended anyway.
    await Promise.race([
      quietly(application.beforeSignOut),
      new Promise((resolve) => {
        setTimeout(resolve, 3_000)
      }),
    ])

    // Without a network this fails, and the device is signed out all the
    // same: nothing is left here, and the server ends the session the next
    // time it hears from this browser or when it runs out.
    await signOut().catch(() => undefined)
    onSignedOut()
  }

  async function ask() {
    setBusy(true)
    setTrouble(null)

    try {
      await client?.synchronise()
    } catch {
      // No network. What is left is counted below.
    }

    let unsent = 0

    for (const tenant of await storesOnDevice(named())) {
      unsent += await waitingIn(tenant)
    }

    if (unsent > 0) {
      setWaiting(unsent)
      setBusy(false)

      return
    }

    await leave()
  }

  if (waiting !== null) {
    return (
      <div role="alert" className="flex flex-col gap-3 max-w-md">
        <p className="text-body font-semibold text-conflict">
          {`Auf diesem Gerät liegen noch ${changes(waiting)}, die den Server nicht erreicht haben. Beim Abmelden gehen sie verloren.`}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            tone="secondary"
            wide={wide}
            disabled={busy}
            onClick={() => {
              setWaiting(null)
            }}
          >
            Angemeldet bleiben
          </Button>
          <Button tone="danger" wide={wide} disabled={busy} onClick={() => void leave()}>
            Trotzdem abmelden
          </Button>
        </div>
        {trouble ? <p className="text-body font-semibold text-conflict">{trouble}</p> : null}
      </div>
    )
  }

  return (
    <>
      {row ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => void ask()}
          className={
            row === 'large'
              ? 'flex min-h-14 w-full items-center gap-3 rounded-[6px] px-3.5 text-[17px] text-ink cursor-pointer disabled:opacity-60'
              : 'flex w-full items-center gap-[9px] rounded-control px-3 py-2 text-[14px] leading-[1.2] text-ink cursor-pointer hover:bg-surface-sunken disabled:opacity-60'
          }
        >
          <LogOut size={row === 'large' ? 22 : 16} strokeWidth={1.9} aria-hidden="true" />
          Abmelden
        </button>
      ) : (
        <Button
          tone="secondary"
          wide={wide}
          disabled={busy}
          {...(icon ? { icon: LogOut } : {})}
          onClick={() => void ask()}
        >
          Abmelden
        </Button>
      )}
      {trouble ? (
        <p role="alert" className="text-body font-semibold text-conflict">
          {trouble}
        </p>
      ) : null}
    </>
  )
}
