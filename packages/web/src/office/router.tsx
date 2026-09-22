import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router'

import { ConflictScreen } from '../app/conflicts.js'
import { OfficeShell } from './shell.js'
import { AccountScreen } from './screens/account.js'
import { CustomerList, CustomerScreen } from './screens/customers.js'
import { DocumentScreen } from './screens/documents.js'
import { InstallationScreen } from './screens/installations.js'
import { JobList, JobScreen } from './screens/jobs.js'
import { LetterheadScreen } from './screens/letterhead.js'
import { SiteScreen } from './screens/sites.js'
import { StaffScreen } from './screens/staff.js'
import { TaxScreen } from './screens/taxes.js'
import { TextSnippetScreen } from './screens/text-snippets.js'

/**
 * The routes of the office, written out rather than generated from file names.
 *
 * Two reasons. The tree is small enough to read in one screen, and generated
 * routing needs a plugin that writes a file into the repository, which is one
 * more thing that can be out of date in a checkout.
 *
 * The paths are German because the address bar is something a person reads.
 * The parameters are not: `$customerId` is an identifier in the code and never
 * appears in a URL, only its value does.
 */
const root = createRootRoute({ component: OfficeShell })

const routes = [
  createRoute({ getParentRoute: () => root, path: '/', component: CustomerList }),
  createRoute({
    getParentRoute: () => root,
    path: '/kunden/$customerId',
    component: CustomerScreen,
  }),
  createRoute({ getParentRoute: () => root, path: '/objekte/$siteId', component: SiteScreen }),
  createRoute({
    getParentRoute: () => root,
    path: '/anlagen/$installationId',
    component: InstallationScreen,
  }),
  createRoute({ getParentRoute: () => root, path: '/auftraege', component: JobList }),
  createRoute({ getParentRoute: () => root, path: '/auftraege/$jobId', component: JobScreen }),
  createRoute({
    getParentRoute: () => root,
    path: '/belege/$documentId',
    component: DocumentScreen,
  }),
  createRoute({
    getParentRoute: () => root,
    path: '/textbausteine',
    component: TextSnippetScreen,
  }),
  createRoute({ getParentRoute: () => root, path: '/konflikte', component: ConflictScreen }),
  createRoute({ getParentRoute: () => root, path: '/konto', component: AccountScreen }),
  createRoute({ getParentRoute: () => root, path: '/zugaenge', component: StaffScreen }),
  createRoute({ getParentRoute: () => root, path: '/briefkopf', component: LetterheadScreen }),
  createRoute({ getParentRoute: () => root, path: '/steuern', component: TaxScreen }),
]

export const officeRouter = createRouter({
  routeTree: root.addChildren(routes),
  // Everything a screen reads comes out of the sync client, which holds it in
  // memory. There is nothing to wait for between routes, so there is nothing
  // to show while waiting.
  defaultPendingMs: 0,
})
