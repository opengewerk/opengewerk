import { Link, Outlet } from '@tanstack/react-router'
import { useCallback, useState } from 'react'

import { Shell } from '../components/index.js'
import { SyncStatusBar, UpdateBar } from '../app/sync-bar.js'
import { EntrySuggestion } from '../app/suggestion.js'
import { Drawer, Sidebar } from './navigation.js'
import { BackupBar } from './screens/backup.js'
import { TopBar } from './top-bar.js'

/**
 * What every office screen sits in, as drawn on the canvas: the header in
 * slate, under it whatever strip has something to say, then the navigation
 * beside the screen. Below 1024 px the navigation moves into a drawer behind
 * "Menü" in the header.
 *
 * The strips come before the navigation and the content, in the order of the
 * board "Leisten im Büro", and none of them can be dismissed. They only appear when there is something to
 * do: a conflict, a refused entry, no connection, a new version, a backup that
 * is overdue. That everything arrived is said quietly in the navigation under
 * "Abgleich" instead; a green bar over every screen said nothing most of the
 * time and took the space of a table row (#217).
 */
export function OfficeShell() {
  const [drawer, setDrawer] = useState(false)
  const openDrawer = useCallback(() => {
    setDrawer(true)
  }, [])
  const closeDrawer = useCallback(() => {
    setDrawer(false)
  }, [])

  return (
    <Shell entry="office">
      <div className="flex min-h-dvh flex-col">
        <a
          href="#inhalt"
          // The first thing Tab reaches, and invisible until it is reached. A
          // keyboard user otherwise walks through the whole navigation on every
          // screen to get to the table they came for.
          className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-2 focus:p-2 focus:bg-surface focus:border focus:border-line-strong focus:rounded-control"
        >
          Zum Inhalt springen
        </a>

        <TopBar menuOpen={drawer} onMenu={openDrawer} />

        {/* In the order of the board "Leisten im Büro": what cannot wait first,
            the offers last. */}
        <SyncStatusBar
          conflictsLink={(className) => (
            <Link to="/konflikte" className={className}>
              Ansehen
            </Link>
          )}
        />
        <BackupBar />
        <UpdateBar />
        <EntrySuggestion here="office" />

        {/* The screen as tall as the window, so that a list can fill it to
            the bottom with its pages at the foot, as the list boards do. */}
        <div className="flex flex-1">
          <Sidebar />
          <main id="inhalt" className="flex min-w-0 flex-1 flex-col">
            <Outlet />
          </main>
        </div>

        <Drawer open={drawer} onClose={closeDrawer} />
      </div>
    </Shell>
  )
}
