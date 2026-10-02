import { startTheme } from '@opengewerk/platform-web'
import { QueryProvider, queries } from '@opengewerk/platform-web/session'
import { RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { Root } from '../app/root.js'
import { startServiceWorker } from '../entry/register.js'
import { officeApplication } from './application.js'
import { officeRouter } from './router.js'
import '@opengewerk/platform-web/styles/index.css'

/**
 * The office entry point, `/`.
 *
 * The gate comes first and the router second, which is the order of ADR 0006:
 * no screen is ever rendered without a business behind it, so no screen has to
 * remember to ask for one.
 */
const mount = document.getElementById('app')

if (!mount) {
  throw new Error('Die Seite hat kein Element mit der Kennung app.')
}

// Light or dark as this device chose, before anything is drawn: the gate
// comes first and must already have the right ground.
startTheme()
startServiceWorker()

createRoot(mount).render(
  <StrictMode>
    <QueryProvider client={queries}>
      <Root entry="office" application={officeApplication}>
        <RouterProvider router={officeRouter} />
      </Root>
    </QueryProvider>
  </StrictMode>,
)
