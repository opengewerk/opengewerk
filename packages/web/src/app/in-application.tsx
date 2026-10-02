import { ApplicationProvider } from '@opengewerk/platform-web'
import type { ReactNode } from 'react'

import { officeApplication } from '../office/application.js'

/**
 * A screen inside this application, for a test that renders one screen and
 * not a whole entry. Every screen the foundation draws a part of asks what
 * the application is called and what it calls a business (ADR 0010), as the
 * sign out in a header does and the gate before it.
 *
 * The value is the one the office hands in, which is the shared one and the
 * settings of a business: a test of a screen on site finds everything in it
 * the site has, and one of a settings screen its list.
 */
export function InApplication({ children }: { readonly children: ReactNode }) {
  return <ApplicationProvider application={officeApplication}>{children}</ApplicationProvider>
}
