import { ConflictScreen } from '@opengewerk/platform-web/site'
import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
} from '@tanstack/react-router'

import { SiteJobList, SiteJobsLayout } from './screens/jobs.js'
import { SiteTimeEntryScreen, SiteTimeScreen } from './screens/time.js'
import { SiteShell } from './shell.js'

/**
 * The screens that come when somebody opens them, not with the first page
 * (#831). The first page on site is the list of open jobs, and the budget of
 * ADR 0004 measures what the phone fetches before it shows it: the shell with
 * its stopwatch and the list. A job and everything that opens from it are
 * parts of their own. The service worker holds every part from the first
 * visit on, so a screen opens without a network all the same, and the router
 * waits for the part before it draws the screen.
 */
const screens = {
  job: () => import('./screens/job.js'),
  boards: () => import('./screens/boards.js'),
  pv: () => import('./screens/pv.js'),
  scanner: () => import('./screens/scanner.js'),
  installation: () => import('./screens/installation.js'),
  labelScanner: () => import('./screens/label-scanner.js'),
  files: () => import('./screens/files.js'),
  notes: () => import('./screens/notes.js'),
  defects: () => import('./screens/defects.js'),
  callInstructions: () => import('./screens/call-instructions.js'),
  invoice: () => import('./screens/invoice.js'),
  onCall: () => import('./screens/on-call.js'),
  protocol: () => import('./screens/protocol.js'),
  appliances: () => import('./screens/appliances.js'),
  report: () => import('./screens/report.js'),
  leave: () => import('./screens/leave.js'),
  timeAccount: () => import('./screens/time-account.js'),
  appointments: () => import('./screens/appointments.js'),
}

const SiteJobScreen = lazyRouteComponent(screens.job, 'SiteJobScreen')
const SiteBoardScreen = lazyRouteComponent(screens.boards, 'SiteBoardScreen')
const SiteCircuitScreen = lazyRouteComponent(screens.boards, 'SiteCircuitScreen')
const SiteInverterScreen = lazyRouteComponent(screens.pv, 'SiteInverterScreen')
const SitePvStringScreen = lazyRouteComponent(screens.pv, 'SitePvStringScreen')
const SiteScannerScreen = lazyRouteComponent(screens.scanner, 'SiteScannerScreen')
const SiteInstallationScreen = lazyRouteComponent(screens.installation, 'SiteInstallationScreen')
const SiteLabelScanScreen = lazyRouteComponent(screens.labelScanner, 'SiteLabelScanScreen')
const SiteFilesScreen = lazyRouteComponent(screens.files, 'SiteFilesScreen')
const SiteNoteScreen = lazyRouteComponent(screens.notes, 'SiteNoteScreen')
const SiteDefectScreen = lazyRouteComponent(screens.defects, 'SiteDefectScreen')
const SiteNewDefectScreen = lazyRouteComponent(screens.defects, 'SiteNewDefectScreen')
const SiteInstructionsScreen = lazyRouteComponent(
  screens.callInstructions,
  'SiteInstructionsScreen',
)
const SiteInvoiceScreen = lazyRouteComponent(screens.invoice, 'SiteInvoiceScreen')
const SiteNewCallScreen = lazyRouteComponent(screens.onCall, 'SiteNewCallScreen')
const SiteProtocolScreen = lazyRouteComponent(screens.protocol, 'SiteProtocolScreen')
const SiteAppliancesScreen = lazyRouteComponent(screens.appliances, 'SiteAppliancesScreen')
const SiteNewApplianceScreen = lazyRouteComponent(screens.appliances, 'SiteNewApplianceScreen')
const SiteReportScreen = lazyRouteComponent(screens.report, 'SiteReportScreen')
const SiteLeaveRequestScreen = lazyRouteComponent(screens.leave, 'SiteLeaveRequestScreen')
const SiteLeaveScreen = lazyRouteComponent(screens.leave, 'SiteLeaveScreen')
const SiteTimeAccountScreen = lazyRouteComponent(screens.timeAccount, 'SiteTimeAccountScreen')
const SiteAppointmentsScreen = lazyRouteComponent(screens.appointments, 'SiteAppointmentsScreen')

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
  // A delivery note (#299), read and signed on the same screen as a report.
  createRoute({
    getParentRoute: () => root,
    path: '/auftraege/$jobId/lieferscheine/$documentId',
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
  // The appliances of the site of a job, tested one after another (#303).
  createRoute({
    getParentRoute: () => root,
    path: '/auftraege/$jobId/geraete',
    component: SiteAppliancesScreen,
  }),
  createRoute({
    getParentRoute: () => root,
    path: '/auftraege/$jobId/geraete/neu',
    component: SiteNewApplianceScreen,
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
  // A defect of the job and a new one (#311).
  createRoute({
    getParentRoute: () => root,
    path: '/auftraege/$jobId/maengel/neu',
    component: SiteNewDefectScreen,
  }),
  createRoute({
    getParentRoute: () => root,
    path: '/auftraege/$jobId/maengel/$defectId',
    component: SiteDefectScreen,
  }),
  // A service call taken on call (#293).
  createRoute({
    getParentRoute: () => root,
    path: '/einsatz/neu',
    component: SiteNewCallScreen,
  }),
  // The instructions at the door and the invoice made on site of a service call (#292).
  createRoute({
    getParentRoute: () => root,
    path: '/auftraege/$jobId/belehrung',
    component: SiteInstructionsScreen,
  }),
  createRoute({
    getParentRoute: () => root,
    path: '/auftraege/$jobId/rechnungen/$documentId',
    component: SiteInvoiceScreen,
  }),
  createRoute({ getParentRoute: () => root, path: '/zeiten', component: SiteTimeScreen }),
  // One's own leave, under "Zeiten" (#288).
  createRoute({ getParentRoute: () => root, path: '/urlaub', component: SiteLeaveScreen }),
  createRoute({
    getParentRoute: () => root,
    path: '/urlaub/beantragen',
    component: SiteLeaveRequestScreen,
  }),
  // One's own time account, under "Zeiten" (#289).
  createRoute({ getParentRoute: () => root, path: '/zeitkonto', component: SiteTimeAccountScreen }),
  createRoute({ getParentRoute: () => root, path: '/termine', component: SiteAppointmentsScreen }),
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
