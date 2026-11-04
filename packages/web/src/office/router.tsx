import {
  InstanceLogScreen,
  InstanceOperatorsScreen,
  InstanceSettingsScreen,
  InstanceTenantsScreen,
} from '@opengewerk/platform-web/instance'
import { AuditLogScreen, SettingsScreen, SyncScreen } from '@opengewerk/platform-web/office'
import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  Outlet,
} from '@tanstack/react-router'

import { InstanceShell } from './instance/shell.js'
import { OfficeShell } from './shell.js'
import { BackupScreen } from './screens/backup.js'
import {
  CustomerList,
  CustomerScreen,
  EditCustomerScreen,
  NewCustomerScreen,
} from './screens/customers.js'

/**
 * The screens that come when somebody opens them, not with the first page
 * (#831). The first bundle holds the shell and the list of customers, the
 * first page, with what that list takes along; every other screen is a part
 * of its own. Until then every screen came with the first page, and with the
 * defects of #311 the office went past its budget. The service worker holds
 * every part from the first visit on, so a screen opens without a network as
 * well, and the router waits for the part before it draws the screen.
 */
const screens = {
  account: () => import('./screens/account.js'),
  articles: () => import('./screens/articles.js'),
  deadlineSettings: () => import('./screens/deadline-settings.js'),
  deadlines: () => import('./screens/deadlines.js'),
  documentList: () => import('./screens/document-list.js'),
  documents: () => import('./screens/documents.js'),
  installations: () => import('./screens/installations.js'),
  appliances: () => import('./screens/appliances.js'),
  labelLanding: () => import('./screens/label-landing.js'),
  instructions: () => import('./screens/instructions.js'),
  jobs: () => import('./screens/jobs.js'),
  serviceCall: () => import('./screens/service-call.js'),
  emergencySurcharges: () => import('./screens/emergency-surcharges.js'),
  onCall: () => import('./screens/on-call.js'),
  letterhead: () => import('./screens/letterhead.js'),
  numberRanges: () => import('./screens/number-ranges.js'),
  markupSetting: () => import('./screens/markup-setting.js'),
  paymentTerm: () => import('./screens/payment-term.js'),
  planning: () => import('./screens/planning.js'),
  tags: () => import('./screens/tags.js'),
  protocols: () => import('./screens/protocols.js'),
  defects: () => import('./screens/defects.js'),
  reportFields: () => import('./screens/report-fields.js'),
  sites: () => import('./screens/sites.js'),
  staff: () => import('./screens/staff.js'),
  suppliers: () => import('./screens/suppliers.js'),
  imports: () => import('./screens/imports.js'),
  stock: () => import('./screens/stock.js'),
  people: () => import('./screens/people.js'),
  structure: () => import('./screens/structure.js'),
  pvStructure: () => import('./screens/pv-structure.js'),
  tasks: () => import('./screens/tasks.js'),
  absences: () => import('./screens/absences.js'),
  holidays: () => import('./screens/holidays.js'),
  privacy: () => import('./screens/privacy.js'),
  mailSettings: () => import('./screens/mail-settings.js'),
  taxes: () => import('./screens/taxes.js'),
  textSnippets: () => import('./screens/text-snippets.js'),
  gridOperators: () => import('./screens/grid-operators.js'),
  fundingPrograms: () => import('./screens/funding-programs.js'),
  maintenanceContracts: () => import('./screens/maintenance-contracts.js'),
  prospects: () => import('./screens/prospects.js'),
  pipeline: () => import('./screens/pipeline.js'),
  time: () => import('./screens/time.js'),
}

const AccountScreen = lazyRouteComponent(screens.account, 'AccountScreen')
const ArticleListScreen = lazyRouteComponent(screens.articles, 'ArticleListScreen')
const ArticleScreen = lazyRouteComponent(screens.articles, 'ArticleScreen')
const EditArticleScreen = lazyRouteComponent(screens.articles, 'EditArticleScreen')
const NewArticleScreen = lazyRouteComponent(screens.articles, 'NewArticleScreen')
const DeadlineSettingsScreen = lazyRouteComponent(
  screens.deadlineSettings,
  'DeadlineSettingsScreen',
)
const DeadlineListScreen = lazyRouteComponent(screens.deadlines, 'DeadlineListScreen')
const DocumentList = lazyRouteComponent(screens.documentList, 'DocumentList')
const DocumentScreen = lazyRouteComponent(screens.documents, 'DocumentScreen')
const InstallationList = lazyRouteComponent(screens.installations, 'InstallationList')
const InstallationScreen = lazyRouteComponent(screens.installations, 'InstallationScreen')
const ApplianceRegisterScreen = lazyRouteComponent(screens.appliances, 'ApplianceRegisterScreen')
const ApplianceScreen = lazyRouteComponent(screens.appliances, 'ApplianceScreen')
const NewApplianceScreen = lazyRouteComponent(screens.appliances, 'NewApplianceScreen')
const LabelLandingScreen = lazyRouteComponent(screens.labelLanding, 'LabelLandingScreen')
const InstructionsScreen = lazyRouteComponent(screens.instructions, 'InstructionsScreen')
const JobList = lazyRouteComponent(screens.jobs, 'JobList')
const JobScreen = lazyRouteComponent(screens.jobs, 'JobScreen')
const NewServiceCallScreen = lazyRouteComponent(screens.serviceCall, 'NewServiceCallScreen')
const EmergencySurchargesScreen = lazyRouteComponent(
  screens.emergencySurcharges,
  'EmergencySurchargesScreen',
)
const OnCallScreen = lazyRouteComponent(screens.onCall, 'OnCallScreen')
const LetterheadScreen = lazyRouteComponent(screens.letterhead, 'LetterheadScreen')
const NumberRangesScreen = lazyRouteComponent(screens.numberRanges, 'NumberRangesScreen')
const MarkupSettingScreen = lazyRouteComponent(screens.markupSetting, 'MarkupSettingScreen')
const PaymentTermScreen = lazyRouteComponent(screens.paymentTerm, 'PaymentTermScreen')
const PlanningScreen = lazyRouteComponent(screens.planning, 'PlanningScreen')
const TagsScreen = lazyRouteComponent(screens.tags, 'TagsScreen')
const ProtocolScreen = lazyRouteComponent(screens.protocols, 'ProtocolScreen')
const DefectScreen = lazyRouteComponent(screens.defects, 'DefectScreen')
const ReportFieldsScreen = lazyRouteComponent(screens.reportFields, 'ReportFieldsScreen')
const SiteList = lazyRouteComponent(screens.sites, 'SiteList')
const SiteScreen = lazyRouteComponent(screens.sites, 'SiteScreen')
const StaffScreen = lazyRouteComponent(screens.staff, 'StaffScreen')
const EditSupplierScreen = lazyRouteComponent(screens.suppliers, 'EditSupplierScreen')
const NewSupplierScreen = lazyRouteComponent(screens.suppliers, 'NewSupplierScreen')
const SupplierList = lazyRouteComponent(screens.suppliers, 'SupplierList')
const SupplierScreen = lazyRouteComponent(screens.suppliers, 'SupplierScreen')
const ImportScreen = lazyRouteComponent(screens.imports, 'ImportScreen')
const NewImportScreen = lazyRouteComponent(screens.imports, 'NewImportScreen')
const StockList = lazyRouteComponent(screens.stock, 'StockList')
const StockStoreScreen = lazyRouteComponent(screens.stock, 'StockStoreScreen')
const NewPersonFileScreen = lazyRouteComponent(screens.people, 'NewPersonFileScreen')
const PeopleList = lazyRouteComponent(screens.people, 'PeopleList')
const PersonFileScreen = lazyRouteComponent(screens.people, 'PersonFileScreen')
const BoardScreen = lazyRouteComponent(screens.structure, 'BoardScreen')
const CircuitScreen = lazyRouteComponent(screens.structure, 'CircuitScreen')
const InverterScreen = lazyRouteComponent(screens.pvStructure, 'InverterScreen')
const PvStringScreen = lazyRouteComponent(screens.pvStructure, 'PvStringScreen')
const TaskListScreen = lazyRouteComponent(screens.tasks, 'TaskListScreen')
const AbsencePersonScreen = lazyRouteComponent(screens.absences, 'AbsencePersonScreen')
const AbsencesScreen = lazyRouteComponent(screens.absences, 'AbsencesScreen')
const HolidaysScreen = lazyRouteComponent(screens.holidays, 'HolidaysScreen')
const PrivacyScreen = lazyRouteComponent(screens.privacy, 'PrivacyScreen')
const MailSettingsScreen = lazyRouteComponent(screens.mailSettings, 'MailSettingsScreen')
const TaxScreen = lazyRouteComponent(screens.taxes, 'TaxScreen')
const TextSnippetScreen = lazyRouteComponent(screens.textSnippets, 'TextSnippetScreen')
const GridOperatorList = lazyRouteComponent(screens.gridOperators, 'GridOperatorList')
const GridOperatorScreen = lazyRouteComponent(screens.gridOperators, 'GridOperatorScreen')
const NewGridOperatorScreen = lazyRouteComponent(screens.gridOperators, 'NewGridOperatorScreen')
const FundingProgramList = lazyRouteComponent(screens.fundingPrograms, 'FundingProgramList')
const ProspectList = lazyRouteComponent(screens.prospects, 'ProspectList')
const ProspectScreen = lazyRouteComponent(screens.prospects, 'ProspectScreen')
const NewProspectScreen = lazyRouteComponent(screens.prospects, 'NewProspectScreen')
const EditProspectScreen = lazyRouteComponent(screens.prospects, 'EditProspectScreen')
const SalesScreen = lazyRouteComponent(screens.pipeline, 'SalesScreen')
const MaintenanceContractList = lazyRouteComponent(
  screens.maintenanceContracts,
  'MaintenanceContractList',
)
const MaintenanceContractScreen = lazyRouteComponent(
  screens.maintenanceContracts,
  'MaintenanceContractScreen',
)
const NewMaintenanceContractScreen = lazyRouteComponent(
  screens.maintenanceContracts,
  'NewMaintenanceContractScreen',
)
const EditMaintenanceContractScreen = lazyRouteComponent(
  screens.maintenanceContracts,
  'EditMaintenanceContractScreen',
)
const FundingProgramScreen = lazyRouteComponent(screens.fundingPrograms, 'FundingProgramScreen')
const NewFundingProgramScreen = lazyRouteComponent(
  screens.fundingPrograms,
  'NewFundingProgramScreen',
)
const TimeScreen = lazyRouteComponent(screens.time, 'TimeScreen')

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
  // The register of appliances of a site and an appliance with its protocols (#303).
  createRoute({
    getParentRoute: () => office,
    path: '/objekte/$siteId/geraete',
    component: ApplianceRegisterScreen,
  }),
  createRoute({
    getParentRoute: () => office,
    path: '/objekte/$siteId/geraete/neu',
    component: NewApplianceScreen,
  }),
  createRoute({
    getParentRoute: () => office,
    path: '/geraete/$applianceId',
    component: ApplianceScreen,
  }),
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
  // A defect or complaint (#311), at its job or its installation.
  createRoute({
    getParentRoute: () => office,
    path: '/maengel/$defectId',
    component: DefectScreen,
  }),
  createRoute({ getParentRoute: () => office, path: '/auftraege', component: JobList }),
  createRoute({
    getParentRoute: () => office,
    path: '/auftraege/service',
    component: NewServiceCallScreen,
  }),
  createRoute({ getParentRoute: () => office, path: '/plantafel', component: PlanningScreen }),
  createRoute({
    getParentRoute: () => office,
    path: '/plantafel/bereitschaft',
    component: OnCallScreen,
  }),
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
  // The stores and their stock (#298), on the screens of the foundation.
  createRoute({ getParentRoute: () => office, path: '/lager', component: StockList }),
  createRoute({
    getParentRoute: () => office,
    path: '/lager/$storeId',
    component: StockStoreScreen,
  }),
  // The files of the people (#287), on the screens of the foundation. The new
  // one before the one with an id, as with the suppliers.
  createRoute({ getParentRoute: () => office, path: '/mitarbeiter', component: PeopleList }),
  createRoute({
    getParentRoute: () => office,
    path: '/mitarbeiter/neu',
    component: NewPersonFileScreen,
  }),
  createRoute({
    getParentRoute: () => office,
    path: '/mitarbeiter/$personId',
    component: PersonFileScreen,
  }),
  // Leave and sickness (#288), for whoever keeps absences.
  createRoute({ getParentRoute: () => office, path: '/abwesenheiten', component: AbsencesScreen }),
  createRoute({
    getParentRoute: () => office,
    path: '/abwesenheiten/$personId',
    component: AbsencePersonScreen,
  }),
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
  // An import from DATANORM (#297): the files of a delivery, then one import.
  createRoute({
    getParentRoute: () => office,
    path: '/lieferanten/$supplierId/import',
    component: NewImportScreen,
  }),
  createRoute({
    getParentRoute: () => office,
    path: '/lieferanten/$supplierId/import/$importId',
    component: ImportScreen,
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
  // The grid operators (#306), the new one before the one with an id.
  createRoute({
    getParentRoute: () => office,
    path: '/netzbetreiber',
    component: GridOperatorList,
  }),
  createRoute({
    getParentRoute: () => office,
    path: '/netzbetreiber/neu',
    component: NewGridOperatorScreen,
  }),
  createRoute({
    getParentRoute: () => office,
    path: '/netzbetreiber/$gridOperatorId',
    component: GridOperatorScreen,
  }),
  // The funding programmes (#307), the new one before the one with an id.
  createRoute({
    getParentRoute: () => office,
    path: '/foerderprogramme',
    component: FundingProgramList,
  }),
  createRoute({
    getParentRoute: () => office,
    path: '/foerderprogramme/neu',
    component: NewFundingProgramScreen,
  }),
  createRoute({
    getParentRoute: () => office,
    path: '/foerderprogramme/$fundingProgramId',
    component: FundingProgramScreen,
  }),
  // The pipeline and the leads (#312).
  createRoute({ getParentRoute: () => office, path: '/vertrieb', component: SalesScreen }),
  createRoute({ getParentRoute: () => office, path: '/leads', component: ProspectList }),
  createRoute({ getParentRoute: () => office, path: '/leads/neu', component: NewProspectScreen }),
  createRoute({
    getParentRoute: () => office,
    path: '/leads/$prospectId',
    component: ProspectScreen,
  }),
  createRoute({
    getParentRoute: () => office,
    path: '/leads/$prospectId/bearbeiten',
    component: EditProspectScreen,
  }),
  // The maintenance contracts (#294); a new one comes out of an issued quote.
  createRoute({
    getParentRoute: () => office,
    path: '/wartungsvertraege',
    component: MaintenanceContractList,
  }),
  createRoute({
    getParentRoute: () => office,
    path: '/wartungsvertraege/neu/$quoteId',
    component: NewMaintenanceContractScreen,
  }),
  createRoute({
    getParentRoute: () => office,
    path: '/wartungsvertraege/$contractId',
    component: MaintenanceContractScreen,
  }),
  createRoute({
    getParentRoute: () => office,
    path: '/wartungsvertraege/$contractId/bearbeiten',
    component: EditMaintenanceContractScreen,
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
    path: '/einstellungen/aufschlag',
    component: MarkupSettingScreen,
  }),
  createRoute({
    getParentRoute: () => office,
    path: '/einstellungen/notdienst',
    component: EmergencySurchargesScreen,
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
    path: '/einstellungen/feiertage',
    component: HolidaysScreen,
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
    path: '/einstellungen/datenschutz',
    component: PrivacyScreen,
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
