import { RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { Boot } from '../app/boot.js'
import { queries, QueryProvider } from '../app/queries.js'
import { startServiceWorker } from '../entry/register.js'
import { siteRouter } from './router.js'
import '../styles/index.css'

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

startServiceWorker()

createRoot(mount).render(
  <StrictMode>
    <QueryProvider client={queries}>
      <Boot entry="site">
        <RouterProvider router={siteRouter} />
      </Boot>
    </QueryProvider>
  </StrictMode>,
)
