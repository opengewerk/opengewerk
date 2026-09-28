import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router'

import { ConflictScreen } from '../app/conflicts.js'
import { SiteBoardScreen, SiteCircuitScreen } from './screens/boards.js'
import { SiteInverterScreen, SitePvStringScreen } from './screens/pv.js'
import { SiteScannerScreen } from './screens/scanner.js'
import { SiteInstallationScreen } from './screens/installation.js'
import { SiteLabelScanScreen } from './screens/label-scanner.js'
import { SiteFilesScreen } from './screens/files.js'
import { SiteJobList, SiteJobScreen, SiteJobsLayout } from './screens/jobs.js'
import { SiteNoteScreen } from './screens/notes.js'
import { SiteProtocolScreen } from './screens/protocol.js'
import { SiteReportScreen } from './screens/report.js'
import { SiteTimeEntryScreen, SiteTimeScreen } from './screens/time.js'
import { SiteShell } from './shell.js'

/**
 * The routes of the site entry.
 *
 * The boards and circuits hang below the job, although they belong to the
 * installation: on site they are reached from the job somebody is working
 * on, and the way back has to lead there. The test protocols do the same, and
 * so do the inverters and strings of a PV system (#300). An installation a QR
 * label opened (#308) has the same structure below itself, since there may be
 * no job to hang it under; `structureRoutes` makes both sets from one list.
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

/**
 * The list and a job, which stand side by side on a tablet held across
 * (`SiteJobsLayout`), and one after the other on a phone.
 */
const jobs = createRoute({ getParentRoute: () => root, id: 'jobs', component: SiteJobsLayout })

/** The screens of an installation's structure, below a job or below the installation itself. */
function structureRoutes(prefix: '/auftraege/$jobId' | '/anlagen/$installationId') {
  return [
    createRoute({
      getParentRoute: () => root,
      path: `${prefix}/verteiler/$boardId`,
      component: SiteBoardScreen,
    }),
    createRoute({
      getParentRoute: () => root,
      path: `${prefix}/verteiler/$boardId/stromkreise/$circuitId`,
      component: SiteCircuitScreen,
    }),
    createRoute({
      getParentRoute: () => root,
      path: `${prefix}/wechselrichter/$inverterId`,
      component: SiteInverterScreen,
    }),
    createRoute({
      getParentRoute: () => root,
      path: `${prefix}/wechselrichter/$inverterId/strings/$stringId`,
      component: SitePvStringScreen,
    }),
    createRoute({
      getParentRoute: () => root,
      path: `${prefix}/wechselrichter/$inverterId/strings/$stringId/scannen`,
      component: SiteScannerScreen,
    }),
  ]
}

const routes = [
  jobs.addChildren([
    createRoute({ getParentRoute: () => jobs, path: '/', component: SiteJobList }),
    createRoute({
      getParentRoute: () => jobs,
      path: '/auftraege/$jobId',
      component: SiteJobScreen,
    }),
  ]),
  createRoute({
    getParentRoute: () => root,
    path: '/auftraege/$jobId/berichte/$documentId',
    component: SiteReportScreen,
  }),
  ...structureRoutes('/auftraege/$jobId'),
  // The tab "Scannen" and the installation a QR label opens (#308).
  createRoute({ getParentRoute: () => root, path: '/scannen', component: SiteLabelScanScreen }),
  createRoute({
    getParentRoute: () => root,
    path: '/anlagen/$installationId',
    component: SiteInstallationScreen,
  }),
  ...structureRoutes('/anlagen/$installationId'),
  createRoute({
    getParentRoute: () => root,
    path: '/auftraege/$jobId/pruefprotokolle/$recordId',
    component: SiteProtocolScreen,
  }),
  createRoute({
    getParentRoute: () => root,
    path: '/auftraege/$jobId/dateien',
    component: SiteFilesScreen,
  }),
  createRoute({
    getParentRoute: () => root,
    path: '/auftraege/$jobId/notiz',
    component: SiteNoteScreen,
  }),
  createRoute({ getParentRoute: () => root, path: '/zeiten', component: SiteTimeScreen }),
  createRoute({ getParentRoute: () => root, path: '/zeiten/$day', component: SiteTimeScreen }),
  createRoute({
    getParentRoute: () => root,
    path: '/zeiten/$day/nachtragen',
    component: SiteTimeEntryScreen,
  }),
  createRoute({
    getParentRoute: () => root,
    path: '/zeiten/$day/korrigieren/$entryId',
    component: SiteTimeEntryScreen,
  }),
  createRoute({ getParentRoute: () => root, path: '/konflikte', component: ConflictScreen }),
]

export const siteRouter = createRouter({
  routeTree: root.addChildren(routes),
  basepath: '/m',
  defaultPendingMs: 0,
})
