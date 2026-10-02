import { Link, Outlet, useRouterState } from '@tanstack/react-router'
import clsx from 'clsx'
import { Menu, RefreshCw } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useCallback, useState } from 'react'
import type { ReactNode } from 'react'

import { BrandMark } from '../components/brand-mark.js'
import { Shell } from '../components/surface.js'
import { EntrySuggestion } from '../shell/suggestion.js'
import { UpdateBar } from '../shell/update-bar.js'
import { SyncStatusBar } from '../sync/bar.js'
import { useSyncStatus } from '../sync/provider.js'
import { ActionSlotProvider } from './action-bar.js'
import { HeaderSlotProvider } from './header.js'
import { SiteMenu } from './menu.js'

/**
 * One place among the tabs: where it leads, what it is called, its symbol.
 * Which places there are is the application's to say (ADR 0010); the
 * conflicts and the menu the frame adds itself.
 */
export interface SiteTab {
  readonly to: string
  readonly label: string
  readonly icon: LucideIcon
  /**
   * Further paths that light the tab: the screens it leads on to, which is
   * where their way back ends.
   */
  readonly also?: readonly string[]
}

export interface SiteFrameProps {
  readonly tabs: readonly SiteTab[]
  /**
   * What the application shows on every screen under the header of the
   * screen: something that runs and must not run on unnoticed.
   */
  readonly underHeader?: ReactNode
  /** Rows of the application in the menu, for this device. */
  readonly menu?: ReactNode
}

/**
 * What every screen on site sits in, as the boards of the site draw it: the
 * strips, the header of a screen below the tabs, what the application keeps
 * in view under it, the screen, and the tabs at the bottom where the thumb
 * is. From 1024 pixels, a tablet held across, the tabs stand as a rail on the
 * left instead, as on the board "Tablet quer". The screen itself is the route
 * below this one.
 *
 * `entry="site"` is the whole of the difference in density: 60 pixel controls
 * and 17 pixel text, from the same components the office uses. Nothing here
 * is a second copy of anything, which is the point of one code base with two
 * entry points.
 */
export function SiteFrame({ tabs, underHeader, menu }: SiteFrameProps) {
  // The header of a screen is drawn into this place through a portal, see
  // `SiteHeader`; the element only exists once the frame is mounted.
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  // The bar at the foot of a form, see `SiteActionBar`.
  const [actionSlot, setActionSlot] = useState<HTMLElement | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const openMenu = useCallback(() => {
    setMenuOpen(true)
  }, [])
  const closeMenu = useCallback(() => {
    setMenuOpen(false)
  }, [])
  const places = usePlaces(tabs)

  return (
    <Shell entry="site">
      <HeaderSlotProvider value={slot}>
        <ActionSlotProvider value={actionSlot}>
          {/* From 1024 pixels a frame as on the board "Tablet quer": the bars on
            top, the rail and the screen below, and only the screen scrolls,
            so the rail keeps "Menü" in reach whatever stands above it. */}
          <div className="group/site flex min-h-dvh flex-col lg:h-dvh">
            {/* The strips first, in the order of the board of the strips on
              site, then the header of the screen, then what the application
              keeps in view under them on every screen. */}
            <SyncStatusBar
              conflictsLink={(className) => (
                <Link to={conflictsPath} className={className}>
                  Ansehen
                </Link>
              )}
            />
            <UpdateBar />
            <EntrySuggestion here="site" />
            <div ref={setSlot} />
            {underHeader}

            <div className="flex grow items-start lg:min-h-0 lg:items-stretch">
              <Rail places={places} menuOpen={menuOpen} onMenu={openMenu} />
              <main id="inhalt" className="min-w-0 grow lg:overflow-y-auto">
                <Outlet />
              </main>
            </div>

            {/* The bar of a form stands where the thumb is, over the tabs, which
              give way to it on a phone as they do on the boards. */}
            <div ref={setActionSlot} className="sticky bottom-0 z-20 empty:hidden" />
            <Tabs places={places} menuOpen={menuOpen} onMenu={openMenu} />
            <SiteMenu open={menuOpen} onClose={closeMenu}>
              {menu}
            </SiteMenu>
          </div>
        </ActionSlotProvider>
      </HeaderSlotProvider>
    </Shell>
  )
}

/** Where what waits to be decided is looked at, the last of the places. */
const conflictsPath = '/konflikte'

interface Place {
  readonly to: string
  readonly label: string
  readonly icon: LucideIcon
  readonly active: boolean
  /** Waiting conflicts, as a red figure on the tab. */
  readonly badge?: number
}

/**
 * The places of the application and the conflicts after them, each lit on
 * its own path, on the paths below it and on the paths it names besides: a
 * tab stays lit on every screen it leads on to.
 */
function usePlaces(tabs: readonly SiteTab[]): readonly Place[] {
  const { conflicts } = useSyncStatus()
  const path = useRouterState({ select: (state) => state.location.pathname })
  // Below a path is what follows it after a slash. The first place lives at
  // `/`, which every path starts with, and is lit there alone: nothing
  // follows `/` after a second slash.
  const under = (prefix: string) => path === prefix || path.startsWith(`${prefix}/`)

  return [
    ...tabs.map((tab) => ({
      to: tab.to,
      label: tab.label,
      icon: tab.icon,
      active: under(tab.to) || (tab.also ?? []).some(under),
    })),
    {
      to: conflictsPath,
      label: 'Konflikte',
      icon: RefreshCw,
      active: under(conflictsPath),
      badge: conflicts.length,
    },
  ]
}

/** The figure on "Konflikte" is drawn, and said in words. */
function spoken(place: Place): string | undefined {
  if (!place.badge) {
    return undefined
  }

  return `${place.label}, ${place.badge === 1 ? 'einer wartet' : `${String(place.badge)} warten`}`
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

interface PlacesProps {
  readonly places: readonly Place[]
  readonly menuOpen: boolean
  readonly onMenu: () => void
}

/** The tabs at the bottom, below 1024 pixels. */
function Tabs({ places, menuOpen, onMenu }: PlacesProps) {
  const tab =
    'relative flex min-h-16 flex-1 basis-0 flex-col items-center justify-center gap-[3px] text-[13px] no-underline'

  return (
    <nav
      aria-label="Bereiche"
      className="sticky bottom-0 z-20 flex border-t border-line bg-surface group-has-[[data-action-bar]]/site:hidden lg:hidden"
    >
      {places.map((item) => (
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
function Rail({ places, menuOpen, onMenu }: PlacesProps) {
  const item = 'relative flex min-h-16 flex-col items-center gap-1 py-2.5 text-[13px] no-underline'

  return (
    <nav
      aria-label="Bereiche"
      className="hidden w-[88px] shrink-0 flex-col overflow-y-auto border-r border-line bg-surface py-3 lg:flex"
    >
      <div className="flex justify-center pt-1.5 pb-3.5 text-ink">
        <BrandMark size={30} />
      </div>
      {places.map((place) => (
        <Link
          key={place.to}
          to={place.to}
          aria-current={place.active ? 'page' : undefined}
          aria-label={spoken(place)}
          className={clsx(
            item,
            place.active ? 'font-semibold text-copper-text' : 'font-medium text-ink-muted',
          )}
        >
          <place.icon size={24} strokeWidth={2} aria-hidden="true" />
          {place.label}
          {place.badge ? <Badge value={place.badge} className="top-1.5 right-[18px]" /> : null}
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
