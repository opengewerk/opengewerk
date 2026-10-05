// What the screens of the office are built from, as an entry of its own:
// `@opengewerk/platform-web/office`.
//
// The office is the entry with a mouse and a keyboard, where a screen is
// dense and a list is a table (ADR 0004). An application writes its screens
// out of these pieces and names in them what only it knows: its records, its
// columns, the settings a tenant has. Nothing in here is drawn for the site,
// which has its own pieces under `/site`, so that a phone on site never loads
// a table it will not show.

// What every screen of the office sits in: the header with the tenant and the
// person, the strips, the navigation beside the screen and behind "Menü" on a
// phone. An application hands in its entries and mounts the frame as the
// route over its screens.
export { OfficeFrame } from './frame.js'
export type { OfficeFrameProps } from './frame.js'
export type { NavigationBadge, NavigationEntry, NavigationGroup } from './navigation.js'
// The person with their menu, for a frame of an application's own, and the
// place in the header a screen that is worked in puts its path into.
export { PathSlot, PersonMenu } from './top-bar.js'
// The tenants of the person signed in and the switch between them, for the
// header and for a screen that lists them.
export { switchTenant, useTenants } from './tenants.js'

// What somebody looks after about their own account: light or dark, the
// second factor, the passkeys, the password and the devices. An application
// adds its own cards as children.
export { AccountScreen } from './account.js'
export { PasskeysPanel } from './passkeys.js'

// Who works in the tenant, with which roles, on which devices, and the
// invitations still open: a settings screen, under the key `zugaenge`.
export { StaffScreen } from './staff.js'

// The change log of a tenant, under the settings at `auditLogPath` and behind
// the button "Änderungen" at a record, and the pieces the log of the instance
// is drawn from as well. What its records, fields and values are called the
// application says in its value (`audit`), the rules are made from it once.
export {
  auditLogPath,
  AuditLogScreen,
  ChangeFacts,
  ChangesButton,
  FieldList,
  FieldsTable,
  PersonCell,
} from './audit-log.js'
export { auditWords, useAuditWords } from './audit-words.js'
export type { AuditNames, AuditScreenWords, AuditWords } from './audit-words.js'

// The deadlines of a tenant: the list, with what is due, the card for one
// deadline and a word when the engine has not gone through them, and their
// settings per kind under the key `fristen`. Its records, its columns, the
// way to a source and its words the application hands in as properties.
export { DeadlineListScreen } from './deadlines.js'
export type {
  DeadlineCandidate,
  DeadlineColumn,
  DeadlineListProps,
  DeadlineListWords,
  DeadlinePeople,
} from './deadlines.js'
export { DeadlineSettingsScreen } from './deadline-settings.js'
export type { DeadlineSettingsProps } from './deadline-settings.js'
export {
  changeDeadline,
  deadlineKinds,
  deadlineList,
  deadlineRun,
  deadlineSettings,
  markDeadlineDone,
  reopenDeadline,
  setDeadlineSetting,
} from './deadline-requests.js'
export type {
  DeadlineChange,
  DeadlineFilter,
  DeadlineKindView,
  DeadlinePerson,
  DeadlineRunView,
  DeadlineSettingChange,
  DeadlineView,
} from './deadline-requests.js'

// The people to talk to at a record, as the card on its screen: the list,
// the form for a new one, the pencil to change one and the question before
// one is taken away. What a contact hangs on, who may keep one and the words
// that name its records the application hands in; the pieces both entries
// share are under `/contacts`.
export { ContactsPanel } from './contacts.js'
export type { ContactsPanelProps, ContactsPanelWords } from './contacts.js'

// "Abgleich": what is to decide about the exchange, the conflicts and the entry
// the server refused, beside the state of the exchange. What a record is
// called and what other way out of a conflict there is, the application says
// in its value (`records`).
export { SyncScreen } from './sync-screen.js'

// The frame of a screen, its head with the path, the facts of a record, the
// two columns of one, the chips of a list, a remark in a box.
export {
  Chip,
  Crumbs,
  Empty,
  FactList,
  FilterSelect,
  Key,
  NoteBox,
  PageHead,
  RecordColumns,
  Screen,
} from './kit.js'
export type { Crumb, Fact, NoteTone, PageHeadProps } from './kit.js'

// A list at every width: cards on a phone, a table from a tablet on, a
// preview beside it on a wide screen and the whole record beside it on a
// very wide one. Its card and what it says before its first entry stand on
// their own as well, for a list an application draws itself.
export { EmptyState, entries, lastChanged, ListCard, ListScreen, SortChoice } from './list.js'
export type {
  ListChoice,
  ListColumn,
  ListEmpty,
  ListFacets,
  ListFilter,
  ListScreenProps,
  ListSort,
} from './list.js'

// The settings: the overview with a tile for each screen the application
// lists, the frame of one such screen, and the pieces its cards are made of.
export {
  Saved,
  SettingsHistory,
  SettingsPage,
  SettingsScreen,
  SettingsState,
  SettingsText,
  useSettingsEntries,
} from './settings.js'
