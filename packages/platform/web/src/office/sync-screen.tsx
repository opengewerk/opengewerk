import { Check, Clock, RefreshCw, TriangleAlert, WifiOff } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { Button } from '../components/button.js'
import { Panel } from '../components/panel.js'
import { clockTime } from '../format.js'
import { NothingToDecide, useDecisions } from '../sync/decisions.js'
import { useSync, useSyncStatus } from '../sync/provider.js'
import { PageHead, RecordColumns, Screen } from './kit.js'

/** One line of "Stand des Abgleichs": a symbol, what is so, perhaps a time. */
function StateLine({
  icon: Icon,
  tone,
  strong = false,
  aside,
  children,
}: {
  readonly icon: LucideIcon
  readonly tone: 'done' | 'waiting' | 'conflict'
  readonly strong?: boolean
  readonly aside?: string
  readonly children: ReactNode
}) {
  const colour =
    tone === 'done' ? 'text-done' : tone === 'waiting' ? 'text-waiting' : 'text-conflict'

  return (
    <li className="flex items-center gap-2.5">
      <Icon size={18} strokeWidth={2.3} aria-hidden="true" className={`shrink-0 ${colour}`} />
      <span className={`grow text-[14px] ${strong ? `font-semibold ${colour}` : 'text-ink'}`}>
        {children}
      </span>
      {aside ? <span className="numeric text-[13px] text-ink-faint">{aside}</span> : null}
    </li>
  )
}

/**
 * "Stand des Abgleichs", the side card of the board: when this device last
 * exchanged with the system, what waits on it, and what somebody has to decide.
 */
function SyncStateCard() {
  const status = useSyncStatus()
  const { conflicts, refused, pending, lastSyncedAt } = status
  const offline = status.state === 'offline' && status.trouble !== null

  return (
    <Panel title="Stand des Abgleichs">
      <ul className="flex flex-col gap-[9px]">
        <StateLine
          icon={Check}
          tone="done"
          {...(lastSyncedAt ? { aside: clockTime(lastSyncedAt) } : {})}
        >
          {lastSyncedAt ? 'Zuletzt abgeglichen' : 'Noch nicht abgeglichen'}
        </StateLine>
        {offline ? (
          <StateLine icon={WifiOff} tone="waiting">
            Keine Verbindung. Übertragen wird, sobald wieder Netz da ist.
          </StateLine>
        ) : null}
        {pending > 0 ? (
          <StateLine icon={Clock} tone="waiting">
            {pending === 1 ? '1 Vorgang wartet' : `${String(pending)} Vorgänge warten`}
          </StateLine>
        ) : null}
        {refused ? (
          <StateLine icon={TriangleAlert} tone="conflict" strong>
            Eine Änderung abgelehnt, bitte entscheiden
          </StateLine>
        ) : null}
        {conflicts.length > 0 ? (
          <StateLine icon={TriangleAlert} tone="conflict" strong>
            {conflicts.length === 1
              ? '1 Konflikt, bitte entscheiden'
              : `${String(conflicts.length)} Konflikte, bitte entscheiden`}
          </StateLine>
        ) : null}
        {pending === 0 && conflicts.length === 0 && !refused && !offline ? (
          <StateLine icon={Check} tone="done">
            Nichts wartet, nichts zu entscheiden
          </StateLine>
        ) : null}
      </ul>
    </Panel>
  )
}

/**
 * "Abgleich" in the office, the board "Abgleich und Konflikt" (#219): what is
 * to decide at the left, the state of the exchange in a column of 320 pixels
 * at the right, and "Jetzt abgleichen" in the head for whoever does not want
 * to wait for the next round. The application mounts it at its address.
 */
export function SyncScreen() {
  const client = useSync()
  const { exchanging } = useSyncStatus()
  const { made, cards, empty } = useDecisions()

  return (
    <Screen>
      <PageHead
        title="Abgleich"
        sub="Was dieses Gerät mit dem System abgleicht, und was zu entscheiden ist."
        wideActions
        actions={
          <Button
            icon={RefreshCw}
            disabled={exchanging}
            onClick={() => {
              void client.synchronise()
            }}
          >
            Jetzt abgleichen
          </Button>
        }
      />
      {made}
      <RecordColumns
        sideWidth={320}
        main={
          empty ? (
            <Panel title="Keine Konflikte">
              <NothingToDecide />
            </Panel>
          ) : (
            cards
          )
        }
        side={<SyncStateCard />}
      />
    </Screen>
  )
}
