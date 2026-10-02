import { Check, Clock, RefreshCw, TriangleAlert, WifiOff } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useState } from 'react'
import type { ReactNode } from 'react'

import { Button } from '../components/button.js'
import { Panel } from '../components/panel.js'
import { clockTime } from '../format.js'
import { NothingToDecide, useDecisions } from '../sync/decisions.js'
import { useSync, useSyncStatus } from '../sync/provider.js'

/** One line of the state on site: a symbol and a sentence, 16 pixels. */
function SiteStateLine({
  icon: Icon,
  tone,
  strong = false,
  children,
}: {
  readonly icon: LucideIcon
  readonly tone: 'done' | 'waiting' | 'conflict'
  readonly strong?: boolean
  readonly children: ReactNode
}) {
  const colour =
    tone === 'done' ? 'text-done' : tone === 'waiting' ? 'text-waiting' : 'text-conflict'

  return (
    <li className="flex items-center gap-2.5">
      <Icon size={20} strokeWidth={2.3} aria-hidden="true" className={`shrink-0 ${colour}`} />
      <span
        className={`text-[16px] leading-[1.4] ${strong ? `font-semibold ${colour}` : 'text-ink'}`}
      >
        {children}
      </span>
    </li>
  )
}

/**
 * The list somebody has to work through on site, the board "Konflikte", and
 * the only screen of the site that is allowed to be empty and still worth
 * opening: when this device last exchanged, what waits on it, what is to
 * decide, and a way to try again. The application mounts it at its address.
 */
export function ConflictScreen() {
  const client = useSync()
  const status = useSyncStatus()
  const { made, cards, empty } = useDecisions()
  const { conflicts, refused, pending, lastSyncedAt } = status
  const offline = status.state === 'offline'
  const [working, setWorking] = useState(false)

  return (
    <div className="flex min-w-0 flex-col gap-3 p-4">
      <div>
        <p className="font-condensed text-[15px] font-semibold tracking-[1.2px] text-ink-faint uppercase">
          Abgleich
        </p>
        <h1 className="mt-0.5 text-[27px] leading-[1.15] font-bold">Konflikte</h1>
      </div>

      <Panel>
        <ul aria-label="Stand des Abgleichs" className="flex flex-col gap-2">
          <SiteStateLine icon={Check} tone="done">
            {lastSyncedAt
              ? `Zuletzt abgeglichen um ${clockTime(lastSyncedAt)}.`
              : 'Noch nicht abgeglichen.'}
          </SiteStateLine>
          {offline ? (
            <SiteStateLine icon={WifiOff} tone="waiting">
              Keine Verbindung. Übertragen wird, sobald wieder Netz da ist.
            </SiteStateLine>
          ) : null}
          {pending > 0 ? (
            <SiteStateLine icon={Clock} tone="waiting">
              {pending === 1
                ? '1 Änderung wartet auf dem Gerät.'
                : `${String(pending)} Änderungen warten auf dem Gerät.`}
            </SiteStateLine>
          ) : null}
          {refused ? (
            <SiteStateLine icon={TriangleAlert} tone="conflict" strong>
              Eine Änderung wurde abgelehnt und wartet auf eine Entscheidung.
            </SiteStateLine>
          ) : null}
          {conflicts.length > 0 ? (
            <SiteStateLine icon={TriangleAlert} tone="conflict" strong>
              {conflicts.length === 1
                ? 'Ein Konflikt wartet auf eine Entscheidung.'
                : `${String(conflicts.length)} Konflikte warten auf eine Entscheidung.`}
            </SiteStateLine>
          ) : null}
        </ul>
      </Panel>

      {made}

      {empty ? (
        <Panel title="Keine Konflikte">
          <NothingToDecide />
        </Panel>
      ) : (
        cards
      )}

      <Button
        wide
        height={52}
        icon={RefreshCw}
        disabled={working}
        onClick={() => {
          setWorking(true)
          void client.synchronise().finally(() => {
            setWorking(false)
          })
        }}
      >
        Erneut versuchen
      </Button>
    </div>
  )
}
