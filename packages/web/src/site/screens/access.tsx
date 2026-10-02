import type { RecordState } from '@opengewerk/domain'
import { Button, Panel } from '@opengewerk/platform-web'
import { Eye, EyeOff, KeyRound } from 'lucide-react'
import { useRef, useState } from 'react'

import { useMay } from '../../app/queries.js'
import { revealAccess, valueStampOf } from '../../session/site-access.js'
import { maybeText, text } from '../../sync/fields.js'
import { useRelated, useSync } from '../../sync/provider.js'
import { RequestRefused } from '../../sync/transport.js'

/** A value on the screen: null the one on the device, a string the route's, and when it was set. */
interface Shown {
  readonly value: string | null
  readonly stamp: string
}

/**
 * "Zugang zum Objekt" on the site (#286), the board "Auftrag: Zugang zum
 * Objekt": the ways into the site of an open job, each value hidden until
 * tapped. On the device of a technician the values of the sites of their open
 * jobs are there, also without a network, and they go when the job is
 * closed. A showing is written to the outbox before the value appears, and
 * reaches the server with the next exchange; when it cannot be written, the
 * value stays hidden.
 *
 * The owner and the office hold the values of the sites of the open jobs they
 * are assigned to in the same way (#447), and ask the route for any other,
 * with a connection, as in the office; the route keeps who saw it.
 */
export function SiteAccessPanel({ siteId }: { readonly siteId: string }) {
  const client = useSync()
  const may = useMay('site.access')
  const accesses = useRelated('site_accesses', 'siteId', siteId)
  // By access, what is on the screen; missing, the value is hidden.
  const [shown, setShown] = useState<ReadonlyMap<string, Shown>>(new Map())
  const [trouble, setTrouble] = useState<string | null>(null)
  // By access, a showing on its way: its button stays pressed until the
  // showing is written, so that two quick taps make one record (Greptile on
  // #445). The ref answers at once, the state draws the button.
  const pending = useRef(new Set<string>())
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set())
  const held = accesses.filter((access) => access['valueState'] !== undefined)

  if (held.length === 0) {
    return null
  }

  const sorted = [...held].sort((left, right) =>
    text(left, 'designation').localeCompare(text(right, 'designation'), 'de'),
  )

  async function show(access: RecordState) {
    const id = String(access['id'])

    if (pending.current.has(id)) {
      return
    }

    pending.current.add(id)
    setBusy((current) => new Set(current).add(id))

    try {
      await showValue(access)
    } finally {
      pending.current.delete(id)
      setBusy((current) => {
        const next = new Set(current)

        next.delete(id)

        return next
      })
    }
  }

  async function showValue(access: RecordState) {
    const id = String(access['id'])
    const stamp = valueStampOf(access)

    setTrouble(null)

    if (typeof access['value'] === 'string') {
      // The trace first: the value appears once its showing is in the outbox,
      // from where it goes whenever the network is there. A device that
      // cannot write it shows nothing (Greptile on #445).
      const saved = await client
        .create('site_access_reveals', {
          siteAccessId: id,
          revealedAt: new Date().toISOString(),
          // Which value it was: the server takes the showing only for a
          // value this device was handed.
          valueSetAt: maybeText(access, 'valueSetAt'),
        })
        .catch(() => null)

      if (saved?.outcome !== 'queued') {
        setTrouble(
          'Das Anzeigen ließ sich auf diesem Gerät nicht festhalten. Der Wert bleibt verdeckt.',
        )

        return
      }

      setShown((current) => new Map(current).set(id, { value: null, stamp }))

      return
    }

    try {
      const answer = await revealAccess(siteId, id)

      if (answer.state === 'readable') {
        setShown((current) => new Map(current).set(id, { value: answer.value, stamp }))
      } else {
        setTrouble('Nicht mehr lesbar. Das Büro trägt den Wert neu ein.')
      }
    } catch (error) {
      setTrouble(
        error instanceof RequestRefused
          ? error.message
          : 'Keine Verbindung. Auf dem Gerät liegen nur die Werte der offenen Aufträge, denen du zugeordnet bist. Jeden anderen Wert zeigt die Verbindung, dabei wird festgehalten, wer ihn gesehen hat.',
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
          // Only while the access still has the value that was shown.
          const visible =
            asked === undefined || asked.stamp !== valueStampOf(access)
              ? null
              : (asked.value ?? onDevice)

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
                      disabled={busy.has(id)}
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
