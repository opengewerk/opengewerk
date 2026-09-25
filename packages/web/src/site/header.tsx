import { Link, useMatchRoute } from '@tanstack/react-router'
import { ChevronLeft, WifiOff } from 'lucide-react'
import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { useSyncStatus } from '../sync/provider.js'

/**
 * Where the header of a screen goes: a place in the shell between the strips
 * and the stopwatch, as every board on the page "Baustelle" draws it. A screen
 * knows its title, the shell knows the order, and the portal joins the two.
 */
const HeaderSlot = createContext<HTMLElement | null>(null)

export const HeaderSlotProvider = HeaderSlot.Provider

/** One step up from wherever this is, or nothing on the three screens of the tabs. */
export function useWayBack(): { readonly to: string; readonly label: string } | null {
  const matchRoute = useMatchRoute()
  const onJob = matchRoute({ to: '/auftraege/$jobId' })
  const onReport = matchRoute({ to: '/auftraege/$jobId/berichte/$documentId' })
  const onBoard = matchRoute({ to: '/auftraege/$jobId/verteiler/$boardId' })
  const onProtocol = matchRoute({ to: '/auftraege/$jobId/pruefprotokolle/$recordId' })
  const onFiles = matchRoute({ to: '/auftraege/$jobId/dateien' })
  const onCircuit = matchRoute({
    to: '/auftraege/$jobId/verteiler/$boardId/stromkreise/$circuitId',
  })
  const onEntry =
    matchRoute({ to: '/zeiten/$day/nachtragen' }) ||
    matchRoute({ to: '/zeiten/$day/korrigieren/$entryId' })
  // The circuit goes back to its board, everything else below a job back to
  // the job, the job back to the list.
  const underJob = onReport || onBoard || onProtocol || onFiles

  // A late entry or a correction goes back to its day.
  if (onEntry) {
    return { to: `/zeiten/${onEntry.day}`, label: 'Zurück zu den Zeiten' }
  }

  if (onCircuit) {
    return {
      to: `/auftraege/${onCircuit.jobId}/verteiler/${onCircuit.boardId}`,
      label: 'Zurück zum Verteiler',
    }
  }

  if (underJob) {
    return { to: `/auftraege/${underJob.jobId}`, label: 'Zurück zum Auftrag' }
  }

  return onJob ? { to: '/', label: 'Zurück zu den Aufträgen' } : null
}

/**
 * The slate header of a screen below the tabs: the way back, the title and a
 * line under it, and "Offline" while nothing gets through. The screens of the
 * tabs have none, their title stands in the page, as on the boards.
 *
 * The way back is a button of its own and not only the gesture of the phone:
 * a screen opened from a notification has no history to go back through, and
 * then the gesture leaves the application.
 */
export function SiteHeader({
  title,
  sub,
}: {
  readonly title: ReactNode
  readonly sub?: ReactNode
}) {
  const slot = useContext(HeaderSlot)
  const back = useWayBack()
  const offline = useSyncStatus().state === 'offline'

  const header = (
    <header className="flex min-h-16 items-center gap-1.5 bg-top px-3 py-2.5 text-top-ink">
      {back ? (
        <Link
          to={back.to}
          aria-label={back.label}
          className="flex size-11 shrink-0 items-center justify-center rounded-control text-top-ink"
        >
          <ChevronLeft size={24} strokeWidth={2.2} aria-hidden="true" />
        </Link>
      ) : null}
      <div className={back ? 'min-w-0 grow leading-[1.2]' : 'min-w-0 grow px-1 leading-[1.2]'}>
        <h1 className="text-[18px] font-semibold [overflow-wrap:anywhere]">{title}</h1>
        {sub ? <p className="text-[13px] text-top-muted">{sub}</p> : null}
      </div>
      {offline ? (
        <span className="inline-flex shrink-0 items-center gap-[5px] rounded-[3px] bg-offline px-2 py-1 text-[13px] font-semibold text-on-offline">
          <WifiOff size={13} strokeWidth={2.4} aria-hidden="true" />
          Offline
        </span>
      ) : null}
    </header>
  )

  // Without a shell around it, in a test of one screen, the header stands in
  // place; the title is still there to be found.
  return slot ? createPortal(header, slot) : header
}
