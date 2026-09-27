import type { RecordState } from '@opengewerk/domain'
import { Eye, EyeOff, KeyRound } from 'lucide-react'
import { useState } from 'react'

import { useMay } from '../../app/queries.js'
import { Button, Panel } from '../../components/index.js'
import { revealAccess } from '../../session/site-access.js'
import { maybeText, text } from '../../sync/fields.js'
import { useRelated, useSync } from '../../sync/provider.js'
import { RequestRefused } from '../../sync/transport.js'

/**
 * "Zugang zum Objekt" on the site (#286), the board "Auftrag: Zugang zum
 * Objekt": the ways into the site of the job, each value hidden until tapped.
 * The values of the sites with an open job the device holds are on it, also
 * without a network, and they go when the job is closed: a technician's
 * assigned ones, every open one for the owner and the office. Every showing
 * leaves a row through the outbox, which reaches the server with the next
 * exchange.
 *
 * A value that is not on the device, of a site whose jobs are closed, the
 * owner and the office ask for at the route, with a connection, as in the
 * office; the route keeps who saw it.
 */
export function SiteAccessPanel({ siteId }: { readonly siteId: string }) {
  const client = useSync()
  const may = useMay('site.access')
  const accesses = useRelated('site_accesses', 'siteId', siteId)
  // By access: null shows the value on the device, a string one the route
  // answered with; missing, the value is hidden.
  const [shown, setShown] = useState<ReadonlyMap<string, string | null>>(new Map())
  const [trouble, setTrouble] = useState<string | null>(null)
  const held = accesses.filter((access) => access['valueState'] !== undefined)

  if (held.length === 0) {
    return null
  }

  const sorted = [...held].sort((left, right) =>
    text(left, 'designation').localeCompare(text(right, 'designation'), 'de'),
  )

  async function show(access: RecordState) {
    const id = String(access['id'])

    setTrouble(null)

    if (typeof access['value'] === 'string') {
      setShown((current) => new Map(current).set(id, null))
      // The trace without waiting: the value is on the screen now, and the
      // row goes whenever the network is there.
      void client.create('site_access_reveals', {
        siteAccessId: id,
        revealedAt: new Date().toISOString(),
      })

      return
    }

    try {
      const answer = await revealAccess(siteId, id)

      if (answer.state === 'readable') {
        setShown((current) => new Map(current).set(id, answer.value))
      } else {
        setTrouble('Nicht mehr lesbar. Das Büro trägt den Wert neu ein.')
      }
    } catch (error) {
      setTrouble(
        error instanceof RequestRefused
          ? error.message
          : 'Keine Verbindung. Ohne Netz sind nur die Werte zu offenen Aufträgen auf diesem Gerät.',
      )
    }
  }

  function hide(id: string) {
    setShown((current) => {
      const next = new Map(current)

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
          const onDevice = typeof access['value'] === 'string' ? access['value'] : null
          const asked = shown.get(id)
          const visible = asked === undefined ? null : (asked ?? onDevice)

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
              ) : state === 'readable' && (onDevice !== null || may) ? (
                visible !== null ? (
                  <>
                    <span className="numeric font-condensed text-[26px] font-semibold tracking-[1.5px] [overflow-wrap:anywhere]">
                      {visible}
                    </span>
                    <Button
                      tone="quiet"
                      wide
                      height={48}
                      icon={EyeOff}
                      aria-label={`${text(access, 'designation')} verbergen`}
                      onClick={() => hide(id)}
                    >
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
                      onClick={() => void show(access)}
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
        {trouble ? (
          <p role="alert" className="text-[15px] font-semibold text-conflict">
            {trouble}
          </p>
        ) : null}
        <p className="text-[14px] leading-[1.45] text-ink-muted">
          Jedes Anzeigen wird festgehalten, ohne Netz beim nächsten Abgleich. Nach dem Abschluss des
          Auftrags verschwindet der Wert von diesem Gerät.
        </p>
      </div>
    </Panel>
  )
}
