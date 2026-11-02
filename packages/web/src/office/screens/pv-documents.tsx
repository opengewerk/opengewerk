import { Button, Panel } from '@opengewerk/platform-web'
import { date } from '@opengewerk/platform-web/format'
import { request, useSyncStatus } from '@opengewerk/platform-web/sync'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Eye } from 'lucide-react'
import { useState } from 'react'

import { useMay } from '../../app/queries.js'

/** A handover as the server lists it (#305). */
interface PvHandover {
  readonly id: string
  readonly handedOverOn: string
  readonly handedOverBy: string | null
  readonly protocols: number
}

/** Stringplan and component list as the structure stands, printed by the server. */
export function pvPlanAddress(installationId: string): string {
  return `/installations/${encodeURIComponent(installationId)}/pv-plan`
}

function handoversAddress(installationId: string): string {
  return `/installations/${encodeURIComponent(installationId)}/handovers`
}

/** The folder of one handover, as it was frozen. */
export function handoverAddress(installationId: string, handoverId: string): string {
  return `${handoversAddress(installationId)}/${encodeURIComponent(handoverId)}/pdf`
}

const link =
  'inline-flex h-control min-h-tap items-center justify-center gap-[7px] rounded-control border border-control bg-surface px-[14px] text-body text-ink no-underline lg:whitespace-nowrap'

/**
 * The card "Unterlagen für den Betreiber" of a PV system (#305), as the board
 * "PV-Anlage" draws it: the papers as the structure stands, the way to hand
 * them over, and the folder of every handover so far.
 *
 * A handover freezes the folder on the server: what the structure says that
 * day and the newest signed protocols, which nothing done later reaches. So
 * it asks before it does it, and it needs a connection, like the papers.
 */
export function PvDocumentsSection({ installationId }: { readonly installationId: string }) {
  const { online } = useSyncStatus()
  const mayHandOver = useMay('installation.write')
  const queries = useQueryClient()
  const key = ['pv-handovers', installationId]
  const handovers = useQuery({
    queryKey: key,
    queryFn: () => request<readonly PvHandover[]>(handoversAddress(installationId)),
    enabled: online,
  })
  const [asking, setAsking] = useState(false)
  const [working, setWorking] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)

  async function handOver() {
    setWorking(true)
    setTrouble(null)

    try {
      await request<PvHandover>(handoversAddress(installationId), { method: 'POST' })
      await queries.invalidateQueries({ queryKey: key })
      setAsking(false)
    } catch (error) {
      setTrouble(error instanceof Error ? error.message : 'Das hat nicht geklappt.')
    } finally {
      setWorking(false)
    }
  }

  return (
    <Panel title="Unterlagen für den Betreiber">
      <div className="flex flex-col gap-2.5">
        <p className="text-[13px] leading-[1.4] text-ink-muted">
          Stringplan und Komponentenliste entstehen aus der Struktur, wie sie gerade ist. Bei der
          Übergabe hält OpenGewerk die Mappe für den Betreiber fest: Komponenten, Stringplan,
          Ertragsprognose und die letzten unterschriebenen Protokolle, so wie an diesem Tag.
        </p>

        {online ? (
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={pvPlanAddress(installationId)}
              target="_blank"
              rel="noopener noreferrer"
              className={link}
            >
              <Eye size={15} strokeWidth={2.3} aria-hidden="true" />
              Stringplan und Komponentenliste
            </a>
            {mayHandOver && !asking ? (
              <Button
                icon={Check}
                onClick={() => {
                  setAsking(true)
                }}
              >
                Übergeben
              </Button>
            ) : null}
          </div>
        ) : (
          <p className="text-[13px] leading-[1.4] text-ink-muted">
            Die Unterlagen druckt der Server, dafür braucht es Verbindung.
          </p>
        )}

        {asking ? (
          <div className="flex flex-col gap-2 rounded-control border border-line bg-ground px-[11px] py-[9px]">
            <p className="text-[13px] leading-[1.4]">
              Die Mappe wird mit dem heutigen Stand festgehalten und ändert sich danach nicht mehr.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                tone="primary"
                icon={Check}
                disabled={working}
                onClick={() => {
                  void handOver()
                }}
              >
                Jetzt übergeben
              </Button>
              <Button
                disabled={working}
                onClick={() => {
                  setAsking(false)
                  setTrouble(null)
                }}
              >
                Abbrechen
              </Button>
            </div>
          </div>
        ) : null}

        {trouble ? (
          <p role="alert" className="text-[13px] font-semibold text-conflict">
            {trouble}
          </p>
        ) : null}

        {handovers.data && handovers.data.length > 0 ? (
          <ul aria-label="Übergaben" className="flex flex-col gap-2">
            {handovers.data.map((handover) => (
              <li
                key={handover.id}
                className="flex items-center gap-2.5 rounded-control border border-line bg-ground px-[11px] py-[9px]"
              >
                <div className="min-w-0 grow">
                  <a
                    href={handoverAddress(installationId, handover.id)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[14px] font-semibold text-copper-text underline underline-offset-2"
                  >
                    {`Mappe vom ${date(handover.handedOverOn)}`}
                  </a>
                  <div className="text-[13px] text-ink-faint">
                    {[
                      handover.handedOverBy
                        ? `Übergeben von ${handover.handedOverBy}`
                        : 'Übergeben',
                      handover.protocols === 0
                        ? 'ohne Protokoll'
                        : handover.protocols === 1
                          ? 'mit 1 Protokoll'
                          : `mit ${String(handover.protocols)} Protokollen`,
                    ].join(', ')}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : handovers.data ? (
          <p className="text-[13px] leading-[1.4] text-ink-muted">Noch nicht übergeben.</p>
        ) : null}
      </div>
    </Panel>
  )
}
