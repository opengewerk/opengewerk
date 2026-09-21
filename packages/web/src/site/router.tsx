import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router'

import { ConflictScreen } from '../app/conflicts.js'
import { SiteJobList, SiteJobScreen } from './screens/jobs.js'
import { SiteReportScreen } from './screens/report.js'
import { SiteShell } from './shell.js'

/**
 * The routes of the site entry, four of them.
 *
 * `basepath` is what makes this a second application at `/m` rather than a
 * section of the first. The two are separate documents with separate bundles,
 * which is how the budget for the first load on site can mean anything: the
 * phone never downloads the office's tables.
 *
 * The conflict screen is the same component the office uses. Deciding a
 * conflict has to be possible on the device that caused it, and a second
 * implementation of that screen would be a second chance to get it wrong.
 */
const root = createRootRoute({ component: SiteShell })

const routes = [
  createRoute({ getParentRoute: () => root, path: '/', component: SiteJobList }),
  createRoute({ getParentRoute: () => root, path: '/auftraege/$jobId', component: SiteJobScreen }),
  createRoute({
    getParentRoute: () => root,
    path: '/auftraege/$jobId/berichte/$documentId',
    component: SiteReportScreen,
  }),
  createRoute({ getParentRoute: () => root, path: '/konflikte', component: ConflictScreen }),
]

export const siteRouter = createRouter({
  routeTree: root.addChildren(routes),
  basepath: '/m',
  defaultPendingMs: 0,
})
