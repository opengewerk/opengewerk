import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import type { ReactNode } from 'react'

/**
 * A screen inside a router of its own, for a test that renders one screen and
 * not the whole entry. Every screen with a link needs a router around it, and
 * the settings have links at their side since #219. The router knows no route
 * but its root, which shows the screen for any address; a link leads nowhere
 * in a test, and none of them follows one.
 */
export function InRouter({
  children,
  at = '/',
}: {
  readonly children: ReactNode
  /** The address the screen is opened at, for a screen that reads its own. */
  readonly at?: string
}) {
  const root = createRootRoute({ component: () => children })
  const router = createRouter({
    routeTree: root,
    history: createMemoryHistory({ initialEntries: [at] }),
  })

  return <RouterProvider router={router} />
}
