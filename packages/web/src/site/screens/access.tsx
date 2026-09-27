import type { RecordState } from '@opengewerk/domain'
import { Eye, EyeOff, KeyRound } from 'lucide-react'
import { useState } from 'react'

import { Button, Panel } from '../../components/index.js'
import { maybeText, text } from '../../sync/fields.js'
import { useRelated, useSync } from '../../sync/provider.js'

/**
 * "Zugang zum Objekt" on the site (#286), the board "Baustelle-Zugang": the
 * ways into the site of the job, each value hidden until tapped. The values
 * are on this device only for a technician on an open job there, and they go
 * when the job is closed; the owner and the office see the card in the
 * office. Every showing leaves a row through the outbox, which reaches the
 * server with the next exchange when there is no network now.
 */
export function SiteAccessPanel({ siteId }: { readonly siteId: string }) {
  const client = useSync()
  const accesses = useRelated('site_accesses', 'siteId', siteId)
  const [shown, setShown] = useState<ReadonlySet<string>>(new Set())
  const held = accesses.filter((access) => access['valueState'] !== undefined)

  if (held.length === 0) {
    return null
  }

  const sorted = [...held].sort((left, right) =>
    text(left, 'designation').localeCompare(text(right, 'designation'), 'de'),
  )

  function show(access: RecordState) {
    const id = String(access['id'])

    setShown((current) => new Set(current).add(id))
    // The trace first and without waiting: the value is on the screen now,
    // and the row goes whenever the network is there.
    void client.create('site_access_reveals', {
      siteAccessId: id,
      revealedAt: new Date().toISOString(),
    })
  }

  function hide(id: string) {
    setShown((current) => {
      const next = new Set(current)

      next.delete(id)

      return next
    })
  }

  return (
    <Panel title="Zugang zum Objekt">
      <div className="flex flex-col gap-3">
        {sorted.map((access) => {
          const id = String(access['id'])
          const state = String(access['valueState'])
          const value = typeof access['value'] === 'string' ? access['value'] : null

          return (
            <div key={id} className="flex flex-col gap-1.5 border-b border-row pb-3">
              <span className="flex items-center gap-2 text-[17px] font-semibold [overflow-wrap:anywhere]">
                <KeyRound
                  size={17}
                  strokeWidth={2.2}
                  aria-hidden="true"
                  className="shrink-0 text-ink-muted"
                />
                {text(access, 'designation')}
              </span>
              {state === 'unreadable' ? (
                <p className="text-[15px] leading-[1.4] text-waiting">
                  Nicht mehr lesbar. Das Büro trägt den Wert neu ein.
                </p>
              ) : state === 'readable' && value !== null ? (
                shown.has(id) ? (
                  <>
                    <span className="numeric font-condensed text-[26px] font-semibold tracking-[1.5px] [overflow-wrap:anywhere]">
                      {value}
                    </span>
                    <Button tone="quiet" wide height={48} icon={EyeOff} onClick={() => hide(id)}>
                      Verbergen
                    </Button>
                  </>
                ) : (
                  <>
                    <span
                      aria-label="verdeckt"
                      className="text-[20px] tracking-[4px] text-ink-muted"
                    >
                      ••••••
                    </span>
                    <Button
                      wide
                      height={48}
                      icon={Eye}
                      aria-label={`${text(access, 'designation')} anzeigen`}
                      onClick={() => show(access)}
                    >
                      Anzeigen
                    </Button>
                  </>
                )
              ) : null}
              {maybeText(access, 'hint') ? (
                <p className="text-[15px] leading-[1.45] text-ink-muted">{text(access, 'hint')}</p>
              ) : null}
            </div>
          )
        })}
        <p className="text-[14px] leading-[1.45] text-ink-muted">
          Jedes Anzeigen wird festgehalten, ohne Netz beim nächsten Abgleich. Nach dem Abschluss des
          Auftrags verschwindet der Zugang von diesem Gerät.
        </p>
      </div>
    </Panel>
  )
}
