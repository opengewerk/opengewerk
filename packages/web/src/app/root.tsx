import { ApplicationProvider } from '@opengewerk/platform-web'
import type { Entry } from '@opengewerk/platform-web'
import { Boot } from '@opengewerk/platform-web/gate'
import { useState } from 'react'
import type { ReactNode } from 'react'

import { upgradeKeptTenants } from '../session/older-tenants.js'
import { application } from './application.js'

/**
 * The top of both entries: this application over everything, and the gate of
 * the foundation in front of its screens.
 *
 * The gate is the foundation's (ADR 0010) and asks for an account and a
 * business before it draws a single screen of this application, which is the
 * order of ADR 0006. What it says on the way, it says in the words of
 * `application`, and so does every screen behind it that the foundation
 * draws.
 */
export function Root({ entry, children }: { readonly entry: Entry; readonly children: ReactNode }) {
  // Once, before the first question that could read it: a list of businesses
  // an earlier version kept, put into the form the foundation reads.
  useState(() => {
    upgradeKeptTenants()

    return true
  })

  return (
    <ApplicationProvider application={application}>
      <Boot entry={entry}>{children}</Boot>
    </ApplicationProvider>
  )
}
