import { Link } from '@tanstack/react-router'
import { ChevronLeft, WifiOff } from 'lucide-react'
import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { useSyncStatus } from '../sync/provider.js'

/**
 * Where the header of a screen goes: a place in the frame between the strips
 * and what the application shows under it, as every board of the site draws
 * it. A screen knows its title, the frame knows the order, and the portal
 * joins the two.
 */
const HeaderSlot = createContext<HTMLElement | null>(null)

export const HeaderSlotProvider = HeaderSlot.Provider

/** One step up from a screen: where it leads, and what a reader hears it called. */
export interface WayBack {
  readonly to: string
  readonly label: string
}

/**
 * The slate header of a screen below the tabs: the way back, the title and a
 * line under it, and "Offline" while nothing gets through. The screens of the
 * tabs have none, their title stands in the page, as on the boards.
 *
 * The way back is a button of its own and not only the gesture of the phone:
 * a screen opened from a notification has no history to go back through, and
 * then the gesture leaves the application. Where it leads from which screen
 * is the application's to say (ADR 0010), which has the routes; a screen of
 * the tabs is given none.
 */
export function SiteHeader({
  title,
  sub,
  back = null,
}: {
  readonly title: ReactNode
  readonly sub?: ReactNode
  readonly back?: WayBack | null
}) {
  const slot = useContext(HeaderSlot)
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

  // Without a frame around it, in a test of one screen, the header stands in
  // place; the title is still there to be found.
  return slot ? createPortal(header, slot) : header
}
