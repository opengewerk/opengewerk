import { ApplicationProvider } from '@opengewerk/platform-web'
import type { ReactNode } from 'react'

import { application } from './application.js'

/**
 * A screen inside this application, for a test that renders one screen and
 * not a whole entry. Every screen the foundation draws a part of asks what
 * the application is called and what it calls a business (ADR 0010), as the
 * sign out in a header does and the gate before it. `Root` puts the same
 * value over both entries.
 */
export function InApplication({ children }: { readonly children: ReactNode }) {
  return <ApplicationProvider application={application}>{children}</ApplicationProvider>
}
