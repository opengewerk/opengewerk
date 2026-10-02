import {
  InstanceOperatorsScreen,
  InstanceSettingsScreen,
  InstanceTenantsScreen,
} from '@opengewerk/platform-web/instance'
import { SettingsScreen } from '@opengewerk/platform-web/office'
import { createRootRoute, createRoute, createRouter, Outlet } from '@tanstack/react-router'

import { InstanceShell } from './instance/shell.js'
import { InstanceLogScreen } from './instance/log.js'
import { OfficeShell } from './shell.js'
import { AccountScreen } from './screens/account.js'
import {
  ArticleListScreen,
  ArticleScreen,
  EditArticleScreen,
  NewArticleScreen,
} from './screens/articles.js'
import { AuditLogScreen } from './screens/audit-log.js'
import { BackupScreen } from './screens/backup.js'
import {
  CustomerList,
  CustomerScreen,
  EditCustomerScreen,
  NewCustomerScreen,
} from './screens/customers.js'
import { DeadlineSettingsScreen } from './screens/deadline-settings.js'
import { DeadlineListScreen } from './screens/deadlines.js'
import { DocumentList } from './screens/document-list.js'
import { DocumentScreen } from './screens/documents.js'
import { InstallationList, InstallationScreen } from './screens/installations.js'
import { LabelLandingScreen } from './screens/label-landing.js'
import { InstructionsScreen } from './screens/instructions.js'
import { JobList, JobScreen } from './screens/jobs.js'
import { LetterheadScreen } from './screens/letterhead.js'
import { NumberRangesScreen } from './screens/number-ranges.js'
import { PaymentTermScreen } from './screens/payment-term.js'
import { TagsScreen } from './screens/tags.js'
import { ProtocolScreen } from './screens/protocols.js'
import { ReportFieldsScreen } from './screens/report-fields.js'
import { SiteList, SiteScreen } from './screens/sites.js'
import { StaffScreen } from './screens/staff.js'
import {
  EditSupplierScreen,
  NewSupplierScreen,
  SupplierList,
  SupplierScreen,
} from './screens/suppliers.js'
import { BoardScreen, CircuitScreen } from './screens/structure.js'
import { InverterScreen, PvStringScreen } from './screens/pv-structure.js'
import { SyncScreen } from './screens/sync.js'
import { TaskListScreen } from './screens/tasks.js'
import { MailSettingsScreen } from './screens/mail-settings.js'
import { TaxScreen } from './screens/taxes.js'
import { TextSnippetScreen } from './screens/text-snippets.js'
import { TimeScreen } from './screens/time.js'

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
 *
 * The settings all live under `/einstellungen`, so that the one entry in the
 * navigation stays lit on every one of them. They are routes side by side and
 * not nested, because none of them shares a frame with the others.
 *
 * Two frames under the root: the office of the business, and since #188 the
 * area of the instance under `/instanz`, with a navigation and a header of
 * its own, because nothing in it belongs to a business.
 */
const root = createRootRoute({ component: Outlet })

const office = createRoute({ getParentRoute: () => root, id: 'office', component: OfficeShell })

const instance = createRoute({
  getParentRoute: () => root,
  path: '/instanz',
  component: InstanceShell,
})

const instanceRoutes = [
  createRoute({ getParentRoute: () => instance, path: '/', component: InstanceTenantsScreen }),
  createRoute({
    getParentRoute: () => instance,
    path: '/einstellungen',
    component: InstanceSettingsScreen,
  }),
  createRoute({
    getParentRoute: () => instance,
    path: '/betreiber',
    component: InstanceOperatorsScreen,
  }),
  createRoute({ getParentRoute: () => instance, path: '/protokoll', component: InstanceLogScreen }),
]

const routes = [
  createRoute({ getParentRoute: () => office, path: '/', component: CustomerList }),
  // A path of its own for a new customer, as the board "Neuer Kunde" draws a
  // screen of its own; a fixed segment wins over the parameter beside it.
  createRoute({ getParentRoute: () => office, path: '/kunden/neu', component: NewCustomerScreen }),
  createRoute({
    getParentRoute: () => office,
    path: '/kunden/$customerId',
    component: CustomerScreen,
  }),
  createRoute({
    getParentRoute: () => office,
    path: '/kunden/$customerId/bearbeiten',
    component: EditCustomerScreen,
  }),
  // Sites and installations have lists of their own, as the boards "Objekte"
  // and "Anlagen" draw them (#219).
  createRoute({ getParentRoute: () => office, path: '/objekte', component: SiteList }),
  createRoute({ getParentRoute: () => office, path: '/objekte/$siteId', component: SiteScreen }),
  createRoute({ getParentRoute: () => office, path: '/anlagen', component: InstallationList }),
  createRoute({
    getParentRoute: () => office,
    path: '/anlagen/$installationId',
    component: InstallationScreen,
  }),
  // The address on a QR label (#308), which a phone's camera opens here.
  createRoute({ getParentRoute: () => office, path: '/a/$code', component: LabelLandingScreen }),
  createRoute({
    getParentRoute: () => office,
    path: '/verteiler/$boardId',
    component: BoardScreen,
  }),
  createRoute({
    getParentRoute: () => office,
    path: '/stromkreise/$circuitId',
    component: CircuitScreen,
  }),
  createRoute({
    getParentRoute: () => office,
    path: '/wechselrichter/$inverterId',
    component: InverterScreen,
  }),
  createRoute({
    getParentRoute: () => office,
    path: '/strings/$stringId',
    component: PvStringScreen,
  }),
  createRoute({
    getParentRoute: () => office,
    path: '/pruefprotokolle/$recordId',
    component: ProtocolScreen,
  }),
  createRoute({ getParentRoute: () => office, path: '/auftraege', component: JobList }),
  createRoute({ getParentRoute: () => office, path: '/auftraege/$jobId', component: JobScreen }),
  createRoute({ getParentRoute: () => office, path: '/aufgaben', component: TaskListScreen }),
  createRoute({ getParentRoute: () => office, path: '/fristen', component: DeadlineListScreen }),
  createRoute({ getParentRoute: () => office, path: '/zeiten', component: TimeScreen }),
  // The catalogue and who sells it (#296). A new one and a change each have a
  // page of their own, as for a customer.
  createRoute({ getParentRoute: () => office, path: '/artikel', component: ArticleListScreen }),
  createRoute({ getParentRoute: () => office, path: '/artikel/neu', component: NewArticleScreen }),
  createRoute({
    getParentRoute: () => office,
    path: '/artikel/$articleId',
    component: ArticleScreen,
  }),
  createRoute({
    getParentRoute: () => office,
    path: '/artikel/$articleId/bearbeiten',
    component: EditArticleScreen,
  }),
  createRoute({ getParentRoute: () => office, path: '/lieferanten', component: SupplierList }),
  createRoute({
    getParentRoute: () => office,
    path: '/lieferanten/neu',
    component: NewSupplierScreen,
  }),
  createRoute({
    getParentRoute: () => office,
    path: '/lieferanten/$supplierId',
    component: SupplierScreen,
  }),
  createRoute({
    getParentRoute: () => office,
    path: '/lieferanten/$supplierId/bearbeiten',
    component: EditSupplierScreen,
  }),
  createRoute({ getParentRoute: () => office, path: '/belege', component: DocumentList }),
  createRoute({
    getParentRoute: () => office,
    path: '/belege/$documentId',
    component: DocumentScreen,
  }),
  createRoute({
    getParentRoute: () => office,
    path: '/textbausteine',
    component: TextSnippetScreen,
  }),
  createRoute({ getParentRoute: () => office, path: '/konflikte', component: SyncScreen }),
  createRoute({ getParentRoute: () => office, path: '/konto', component: AccountScreen }),
  createRoute({ getParentRoute: () => office, path: '/einstellungen', component: SettingsScreen }),
  createRoute({
    getParentRoute: () => office,
    path: '/einstellungen/briefkopf',
    component: LetterheadScreen,
  }),
  createRoute({
    getParentRoute: () => office,
    path: '/einstellungen/steuern',
    component: TaxScreen,
  }),
  createRoute({
    getParentRoute: () => office,
    path: '/einstellungen/nummernkreise',
    component: NumberRangesScreen,
  }),
  createRoute({
    getParentRoute: () => office,
    path: '/einstellungen/zahlungsziel',
    component: PaymentTermScreen,
  }),
  createRoute({
    getParentRoute: () => office,
    path: '/einstellungen/tags',
    component: TagsScreen,
  }),
  createRoute({
    getParentRoute: () => office,
    path: '/einstellungen/fristen',
    component: DeadlineSettingsScreen,
  }),
  createRoute({
    getParentRoute: () => office,
    path: '/einstellungen/belehrungen',
    component: InstructionsScreen,
  }),
  createRoute({
    getParentRoute: () => office,
    path: '/einstellungen/regiebericht',
    component: ReportFieldsScreen,
  }),
  createRoute({
    getParentRoute: () => office,
    path: '/einstellungen/e-mail',
    component: MailSettingsScreen,
  }),
  createRoute({
    getParentRoute: () => office,
    path: '/einstellungen/sicherung',
    component: BackupScreen,
  }),
  createRoute({
    getParentRoute: () => office,
    path: '/einstellungen/zugaenge',
    component: StaffScreen,
  }),
  createRoute({
    getParentRoute: () => office,
    path: '/einstellungen/protokoll',
    component: AuditLogScreen,
  }),
]

export const officeRouter = createRouter({
  routeTree: root.addChildren([office.addChildren(routes), instance.addChildren(instanceRoutes)]),
  // Everything a screen reads comes out of the sync client, which holds it in
  // memory. There is nothing to wait for between routes, so there is nothing
  // to show while waiting.
  defaultPendingMs: 0,
})
