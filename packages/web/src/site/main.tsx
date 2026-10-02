import { QueryProvider, queries } from '@opengewerk/platform-web/session'
import { RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { Root } from '../app/root.js'
import { startTheme } from '../app/theme.js'
import { startServiceWorker } from '../entry/register.js'
import { siteRouter } from './router.js'
import '@opengewerk/platform-web/styles/index.css'

/**
 * The site entry point, `/m`.
 *
 * The same three steps as the office and one difference: the device identity
 * travels with the choice of business, which turns the session into the long
 * one. A phone in a van is a registered device; a desk somebody walks away
 * from is not.
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
      <Root entry="site">
        <RouterProvider router={siteRouter} />
      </Root>
    </QueryProvider>
  </StrictMode>,
)
