import { InRouter as Router } from '@opengewerk/platform-web/testing'
import type { ReactNode } from 'react'

import { InApplication } from './in-application.js'

/**
 * A screen of this application inside a router of its own, for a test that
 * renders one screen and not the whole entry.
 *
 * The router is the foundation's helper: it knows no route but its root,
 * which shows the screen for any address. What this adds is the application
 * over it (ADR 0010): the frame of a settings screen lists the settings this
 * application has, and asks the value over it which those are.
 */
export function InRouter({
  children,
  at = '/',
}: {
  readonly children: ReactNode
  /** The address the screen is opened at, for a screen that reads its own. */
  readonly at?: string
}) {
  return (
    <InApplication>
      <Router at={at}>{children}</Router>
    </InApplication>
  )
}
