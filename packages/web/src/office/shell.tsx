import { Link, Outlet } from '@tanstack/react-router'
import type { ReactNode } from 'react'

import { Shell } from '../components/index.js'
import { useMay } from '../app/queries.js'
import { SyncStatusBar, UpdateBar } from '../app/sync-bar.js'
import { EntrySuggestion } from '../app/suggestion.js'
import { useSyncStatus } from '../sync/provider.js'

/**
 * The navigation of the office, and it is a real `<nav>` with real links.
 *
 * `activeProps` rather than a class worked out from the current path: the
 * router already knows which one is active, and it also sets `aria-current`,
 * which is what a screen reader uses to say "you are here".
 */
function Navigation() {
  const { conflicts } = useSyncStatus()
  // Only the owner administers accounts, so for everybody else the entry is
  // not there. A courtesy and not the gate: the routes behind it ask the
  // membership on every request, and typing the address reaches a screen whose
  // every call is refused.
  const administers = useMay('membership.read')
  // The office reads the letterhead as well, since it writes the documents it
  // ends up on. Changing it is the owner's, and the screen says so.
  const readsSettings = useMay('settings.read')
  // Whoever reads documents reads the texts they are written from.
  const readsDocuments = useMay('document.read')

  const items: readonly { readonly to: string; readonly label: ReactNode }[] = [
    { to: '/', label: 'Kunden' },
    { to: '/auftraege', label: 'Aufträge' },
    ...(readsDocuments ? [{ to: '/textbausteine', label: 'Textbausteine' as ReactNode }] : []),
    {
      to: '/konflikte',
      label: conflicts.length > 0 ? `Konflikte (${String(conflicts.length)})` : 'Konflikte',
    },
    ...(readsSettings ? [{ to: '/briefkopf', label: 'Briefkopf' as ReactNode }] : []),
    ...(readsSettings ? [{ to: '/steuern', label: 'Steuern' as ReactNode }] : []),
    ...(administers ? [{ to: '/zugaenge', label: 'Zugänge' as ReactNode }] : []),
    { to: '/konto', label: 'Konto' },
  ]

  return (
    <nav aria-label="Hauptbereiche" className="border-b border-line bg-surface-sunken">
      <ul className="flex flex-wrap items-center gap-1 px-4 py-2">
        {items.map((item) => (
          <li key={item.to}>
            <Link
              to={item.to}
              // `exact` on the root, or every path would light it up as well:
              // the customer list lives at `/`, and `/auftraege` starts with it.
              activeOptions={item.to === '/' ? { exact: true } : undefined}
              activeProps={{
                className:
                  'inline-flex items-center h-control min-h-tap px-3 rounded-control text-body font-semibold bg-surface text-ink border border-line-strong',
              }}
              inactiveProps={{
                className:
                  'inline-flex items-center h-control min-h-tap px-3 rounded-control text-body font-medium text-ink-muted border border-transparent',
              }}
            >
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}

/**
 * What every office screen sits in.
 *
 * The bars come before the navigation and before the content, in that order,
 * and none of them can be dismissed. A conflict has to be visible from
 * whichever screen somebody happens to be on, because the screen they are on
 * is the one where they would otherwise keep working on stale data.
 */
export function OfficeShell() {
  return (
    <Shell entry="office">
      <a
        href="#inhalt"
        // The first thing Tab reaches, and invisible until it is reached. A
        // keyboard user otherwise walks through the whole navigation on every
        // screen to get to the table they came for.
        className="sr-only focus:not-sr-only focus:absolute focus:m-2 focus:p-2 focus:bg-surface focus:border focus:border-line-strong focus:rounded-control"
      >
        Zum Inhalt springen
      </a>

      <EntrySuggestion here="office" />
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
      <Navigation />

      <main id="inhalt" className="mx-auto w-full max-w-6xl">
        <Outlet />
      </main>
    </Shell>
  )
}
