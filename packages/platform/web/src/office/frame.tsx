import { Link, Outlet } from '@tanstack/react-router'
import { useCallback, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import { Shell } from '../components/surface.js'
import { useHeadingFocus } from '../shell/heading-focus.js'
import { EntrySuggestion } from '../shell/suggestion.js'
import { UpdateBar } from '../shell/update-bar.js'
import { SyncStatusBar } from '../sync/bar.js'
import { Drawer, Sidebar } from './navigation.js'
import type { NavigationEntry, NavigationGroup } from './navigation.js'
import { PathSlot, TopBar } from './top-bar.js'

/** An application with nothing of its own at the foot. */
const nothingOfItsOwn: readonly NavigationEntry[] = []

export interface OfficeFrameProps {
  /**
   * What the application offers beside every screen, in its groups, with what
   * the person may not use left out. The two entries at the foot, the
   * exchange with the server and the settings, the frame adds itself. A
   * group without a title stands before the others as its entries alone.
   */
  readonly navigation: readonly NavigationGroup[]
  /**
   * What the application visits rather than works in, a catalogue for
   * instance: entries at the foot, before the two of the frame and as quiet
   * as they are, with what the person may not use left out.
   */
  readonly foot?: readonly NavigationEntry[]
  /**
   * Whether the screen of this address is one that is worked in rather than
   * passed through. From 1024 pixels it takes the width of the navigation and
   * puts its path into the header (`PathSlot`), as `structure_page()` of the
   * canvas does; narrower, nothing changes, the navigation is behind "Menü"
   * anyway. Which screens those are, the application knows.
   */
  readonly focus?: boolean
  /**
   * Further strips of the application over every screen, for something of
   * its own that somebody has to act on. They stand after the strip of the
   * exchange and before the two offers.
   */
  readonly strips?: ReactNode
}

/**
 * What every office screen sits in, as drawn on the canvas: the header in
 * slate, under it whatever strip has something to say, then the navigation
 * beside the screen. Below 1024 px the navigation moves into a drawer behind
 * "Menü" in the header. The screen itself is the route below this one.
 *
 * The strips come before the navigation and the content, in the order of the
 * board "Leisten im Büro", and none of them can be dismissed. They only appear
 * when there is something to do: a conflict, a refused entry, no connection,
 * what the application adds, a new version. That everything arrived is said
 * quietly in the navigation under "Abgleich" instead; a green bar over every
 * screen said nothing most of the time and took the space of a table row
 * (#217).
 */
export function OfficeFrame({
  navigation,
  foot = nothingOfItsOwn,
  focus = false,
  strips,
}: OfficeFrameProps) {
  const [drawer, setDrawer] = useState(false)
  const openDrawer = useCallback(() => {
    setDrawer(true)
  }, [])
  const closeDrawer = useCallback(() => {
    setDrawer(false)
  }, [])
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  const frame = useRef<HTMLDivElement>(null)

  useHeadingFocus(frame)

  return (
    <Shell entry="office">
      {/* `--sticky-top` is the height of the top bar, under which the head of
          a table stays while the page scrolls (#272): 56 pixels, and 52 from
          1024 on, as `TopBar` has it. */}
      <div
        ref={frame}
        className="flex min-h-dvh flex-col [--sticky-top:3.5rem] lg:[--sticky-top:52px]"
      >
        <a
          href="#inhalt"
          // The first thing Tab reaches, and invisible until it is reached. A
          // keyboard user otherwise walks through the whole navigation on every
          // screen to get to the table they came for.
          className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-2 focus:p-2 focus:bg-surface focus:border focus:border-line-strong focus:rounded-control"
        >
          Zum Inhalt springen
        </a>

        <TopBar menuOpen={drawer} onMenu={openDrawer} focus={focus} onSlot={setSlot} />

        {/* In the order of the board "Leisten im Büro": what cannot wait first,
            the offers last. */}
        <SyncStatusBar
          conflictsLink={(className) => (
            <Link to="/konflikte" className={className}>
              Ansehen
            </Link>
          )}
        />
        {strips}
        <UpdateBar />
        <EntrySuggestion here="office" />

        {/* The screen as tall as the window, so that a list can fill it to
            the bottom with its pages at the foot, as the list boards do. */}
        <div className="flex flex-1">
          {focus ? null : <Sidebar groups={navigation} foot={foot} />}
          <main id="inhalt" className="flex min-w-0 flex-1 flex-col">
            <PathSlot.Provider value={focus ? slot : null}>
              <Outlet />
            </PathSlot.Provider>
          </main>
        </div>

        <Drawer open={drawer} onClose={closeDrawer} groups={navigation} foot={foot} />
      </div>
    </Shell>
  )
}
