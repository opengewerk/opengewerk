import { Link, Outlet, useRouterState } from '@tanstack/react-router'
import clsx from 'clsx'
import { Calendar, Clock, Menu, RefreshCw } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useCallback, useState } from 'react'

import { BrandMark, Shell } from '../components/index.js'
import { SyncStatusBar, UpdateBar } from '../app/sync-bar.js'
import { EntrySuggestion } from '../app/suggestion.js'
import { useSyncStatus } from '../sync/provider.js'
import { ActionSlotProvider } from './action-bar.js'
import { HeaderSlotProvider } from './header.js'
import { SiteMenu } from './menu.js'
import { StopwatchBar } from './screens/time.js'

/**
 * What every screen on site sits in, as the boards on the page "Baustelle"
 * draw it: the strips, the header of a screen below the tabs, the stopwatch
 * while it runs, the screen, and the tabs at the bottom where the thumb is.
 * From 1024 pixels, a tablet held across, the tabs stand as a rail on the
 * left instead, as on the board "Tablet quer".
 *
 * `entry="site"` is the whole of the difference in density: 60 pixel controls
 * and 17 pixel text, from the same components the office uses. Nothing here
 * is a second copy of anything, which is the point of one code base with two
 * entry points.
 */
export function SiteShell() {
  // The header of a screen is drawn into this place through a portal, see
  // `SiteHeader`; the element only exists once the shell is mounted.
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  // The bar at the foot of a form, see `SiteActionBar`.
  const [actionSlot, setActionSlot] = useState<HTMLElement | null>(null)
  const [menu, setMenu] = useState(false)
  const openMenu = useCallback(() => {
    setMenu(true)
  }, [])
  const closeMenu = useCallback(() => {
    setMenu(false)
  }, [])

  return (
    <Shell entry="site">
      <HeaderSlotProvider value={slot}>
        <ActionSlotProvider value={actionSlot}>
          {/* From 1024 pixels a frame as on the board "Tablet quer": the bars on
            top, the rail and the screen below, and only the screen scrolls,
            so the rail keeps "Menü" in reach whatever stands above it. */}
          <div className="group/site flex min-h-dvh flex-col lg:h-dvh">
            {/* The strips first, in the order of the board "Leisten auf der
              Baustelle", then the header of the screen, then the stopwatch,
              which runs under them on every screen. */}
            <SyncStatusBar
              conflictsLink={(className) => (
                <Link to="/konflikte" className={className}>
                  Ansehen
                </Link>
              )}
            />
            <UpdateBar />
            <EntrySuggestion here="site" />
            <div ref={setSlot} />
            <StopwatchBar />

            <div className="flex grow items-start lg:min-h-0 lg:items-stretch">
              <Rail menuOpen={menu} onMenu={openMenu} />
              <main id="inhalt" className="min-w-0 grow lg:overflow-y-auto">
                <Outlet />
              </main>
            </div>

            {/* The bar of a form stands where the thumb is, over the tabs, which
              give way to it on a phone as they do on the boards. */}
            <div ref={setActionSlot} className="sticky bottom-0 z-20 empty:hidden" />
            <Tabs menuOpen={menu} onMenu={openMenu} />
            <SiteMenu open={menu} onClose={closeMenu} />
          </div>
        </ActionSlotProvider>
      </HeaderSlotProvider>
    </Shell>
  )
}

interface Tab {
  readonly to: string
  readonly label: string
  readonly icon: LucideIcon
  readonly active: boolean
  /** Waiting conflicts, as a red figure on the tab. */
  readonly badge?: number
}

/**
 * Three places and the menu, as on the boards. "Aufträge" stays lit on every
 * screen of a job, which is where the way back leads. Everybody records their
 * own time, so "Zeiten" is there for every role.
 */
function useTabs(): readonly Tab[] {
  const { conflicts } = useSyncStatus()
  const path = useRouterState({ select: (state) => state.location.pathname })

  return [
    {
      to: '/',
      label: 'Aufträge',
      icon: Calendar,
      active: path === '/' || path.startsWith('/auftraege'),
    },
    { to: '/zeiten', label: 'Zeiten', icon: Clock, active: path.startsWith('/zeiten') },
    {
      to: '/konflikte',
      label: 'Konflikte',
      icon: RefreshCw,
      active: path.startsWith('/konflikte'),
      badge: conflicts.length,
    },
  ]
}

/** The figure on "Konflikte" is drawn, and said in words. */
function spoken(tab: Tab): string | undefined {
  if (!tab.badge) {
    return undefined
  }

  return `${tab.label}, ${tab.badge === 1 ? 'einer wartet' : `${String(tab.badge)} warten`}`
}

function Badge({ value, className }: { readonly value: number; readonly className: string }) {
  return (
    <span
      aria-hidden="true"
      className={clsx(
        'absolute flex h-[19px] min-w-[19px] items-center justify-center rounded-[10px] bg-conflict px-[5px] text-[12px] font-bold text-on-status',
        className,
      )}
    >
      {value}
    </span>
  )
}

/** The tabs at the bottom, below 1024 pixels. */
function Tabs({ menuOpen, onMenu }: { readonly menuOpen: boolean; readonly onMenu: () => void }) {
  const tabs = useTabs()
  const tab =
    'relative flex min-h-16 flex-1 basis-0 flex-col items-center justify-center gap-[3px] text-[13px] no-underline'

  return (
    <nav
      aria-label="Bereiche"
      className="sticky bottom-0 z-20 flex border-t border-line bg-surface group-has-[[data-action-bar]]/site:hidden lg:hidden"
    >
      {tabs.map((item) => (
        <Link
          key={item.to}
          to={item.to}
          aria-current={item.active ? 'page' : undefined}
          aria-label={spoken(item)}
          className={clsx(
            tab,
            item.active ? 'font-semibold text-copper-text' : 'font-medium text-ink-muted',
          )}
        >
          <item.icon size={23} strokeWidth={2} aria-hidden="true" />
          {item.label}
          {item.badge ? <Badge value={item.badge} className="top-[9px] left-[55%]" /> : null}
        </Link>
      ))}
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={menuOpen}
        onClick={onMenu}
        className={clsx(tab, 'font-medium text-ink-muted cursor-pointer')}
      >
        <Menu size={23} strokeWidth={2} aria-hidden="true" />
        Menü
      </button>
    </nav>
  )
}

/** The same places as a rail on the left, from 1024 pixels. */
function Rail({ menuOpen, onMenu }: { readonly menuOpen: boolean; readonly onMenu: () => void }) {
  const tabs = useTabs()
  const item = 'relative flex min-h-16 flex-col items-center gap-1 py-2.5 text-[13px] no-underline'

  return (
    <nav
      aria-label="Bereiche"
      className="hidden w-[88px] shrink-0 flex-col overflow-y-auto border-r border-line bg-surface py-3 lg:flex"
    >
      <div className="flex justify-center pt-1.5 pb-3.5 text-ink">
        <BrandMark size={30} />
      </div>
      {tabs.map((tab) => (
        <Link
          key={tab.to}
          to={tab.to}
          aria-current={tab.active ? 'page' : undefined}
          aria-label={spoken(tab)}
          className={clsx(
            item,
            tab.active ? 'font-semibold text-copper-text' : 'font-medium text-ink-muted',
          )}
        >
          <tab.icon size={24} strokeWidth={2} aria-hidden="true" />
          {tab.label}
          {tab.badge ? <Badge value={tab.badge} className="top-1.5 right-[18px]" /> : null}
        </Link>
      ))}
      <div className="grow" />
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={menuOpen}
        onClick={onMenu}
        className={clsx(item, 'font-medium text-ink-muted cursor-pointer')}
      >
        <Menu size={24} strokeWidth={2} aria-hidden="true" />
        Menü
      </button>
    </nav>
  )
}
