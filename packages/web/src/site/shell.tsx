import { Link, Outlet, useMatchRoute } from '@tanstack/react-router'

import { Shell } from '../components/index.js'
import { SyncStatusBar, UpdateBar } from '../app/sync-bar.js'
import { EntrySuggestion } from '../app/suggestion.js'
import { useSyncStatus } from '../sync/provider.js'

/**
 * What every screen on site sits in.
 *
 * `entry="site"` is the whole of the difference in density: 60 pixel controls
 * and 17 pixel text, from the same components the office uses. Nothing here
 * is a second copy of anything, which is the point of one code base with two
 * entry points.
 *
 * Navigation is two things and sits at the bottom, where a thumb is. Anything
 * more than two would be a menu, and a menu on a roof is a thing people get
 * wrong once and then stop using.
 */
export function SiteShell() {
  const { conflicts } = useSyncStatus()
  const matchRoute = useMatchRoute()
  const onJob = matchRoute({ to: '/auftraege/$jobId' })
  const onReport = matchRoute({ to: '/auftraege/$jobId/berichte/$documentId' })
  const onBoard = matchRoute({ to: '/auftraege/$jobId/verteiler/$boardId' })
  const onCircuit = matchRoute({
    to: '/auftraege/$jobId/verteiler/$boardId/stromkreise/$circuitId',
  })
  const underJob = onReport || onBoard
  // One step up from wherever this is: the circuit goes back to its board,
  // everything else below a job back to the job, the job back to the list.
  const back = onCircuit
    ? {
        to: `/auftraege/${onCircuit.jobId}/verteiler/${onCircuit.boardId}`,
        label: 'Zurück zum Verteiler',
      }
    : underJob
      ? { to: `/auftraege/${underJob.jobId}`, label: 'Zurück zum Auftrag' }
      : onJob
        ? { to: '/', label: 'Zurück zu den Aufträgen' }
        : null

  return (
    <Shell entry="site">
      <div className="min-h-dvh flex flex-col">
        <UpdateBar />
        <SyncStatusBar
          conflictsLink={
            <Link
              to="/konflikte"
              className="inline-flex items-center h-control min-h-tap px-3 rounded-control bg-surface text-ink font-semibold"
            >
              Ansehen
            </Link>
          }
        />

        {/*
          The way back, and only when there is one. A phone has a back gesture,
          but a screen opened from a notification has no history to go back
          through, and then the gesture leaves the application.
        */}
        {back ? (
          <nav aria-label="Zurück" className="px-4 py-2">
            <Link
              to={back.to}
              className="inline-flex items-center h-control min-h-tap px-3 rounded-control text-body font-semibold text-copper-text"
            >
              {back.label}
            </Link>
          </nav>
        ) : null}

        <main id="inhalt" className="grow">
          <Outlet />
        </main>

        <nav
          aria-label="Bereiche"
          className="sticky bottom-0 border-t border-line bg-surface-sunken"
        >
          <ul className="flex">
            {[
              { to: '/', label: 'Aufträge', exact: true },
              {
                to: '/konflikte',
                label:
                  conflicts.length > 0 ? `Konflikte (${String(conflicts.length)})` : 'Konflikte',
                exact: false,
              },
            ].map((item) => (
              <li key={item.to} className="grow">
                <Link
                  to={item.to}
                  activeOptions={item.exact ? { exact: true } : undefined}
                  activeProps={{
                    className:
                      'flex items-center justify-center h-control min-h-tap text-body font-semibold text-ink bg-surface',
                  }}
                  inactiveProps={{
                    className:
                      'flex items-center justify-center h-control min-h-tap text-body font-medium text-ink-muted',
                  }}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <EntrySuggestion here="site" />
      </div>
    </Shell>
  )
}
