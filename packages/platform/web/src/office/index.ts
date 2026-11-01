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
// The search in the header, for a frame of an application's own: the frame
// here draws it when it is handed a source (`search`).
export { OfficeSearch } from './search.js'
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
// The same, where an access has one role and is made and changed in a dialog,
// with what the application keeps beside a membership as a column and as a
// part of the dialogs. An application shows one of the two.
export { StaffDialogsScreen } from './staff-dialogs.js'
export type {
  StaffAdditions,
  StaffAdditionsPart,
  StaffDialogsScreenProps,
} from './staff-dialogs.js'

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
// settings per kind under the key `fristen`. Its records, its columns, its
// filters, the way to a source and its words the application hands in as
// properties; the list is narrowed and paged on the server.
export { DeadlineListScreen } from './deadlines.js'
export type {
  DeadlineCandidate,
  DeadlineColumn,
  DeadlineListFilter,
  DeadlineListProps,
  DeadlineListWords,
  DeadlinePeople,
} from './deadlines.js'
export { DeadlineSettingsScreen } from './deadline-settings.js'
export type { DeadlineSettingsProps } from './deadline-settings.js'

// The number ranges and the backups among the settings (opengewerk-haustechnik#127):
// the screens, and the line at the top of the office when a backup is behind.
// Which sequences there are and what each says, the application says.
export { changeNumberRange, NumberRangesScreen, numberRanges } from './number-ranges.js'
export type { NumberRangesProps, NumberRangeView, NumberRangeWords } from './number-ranges.js'
export { BackupBar, backupIsBehind, backupQuery, BackupScreen, backupStatus } from './backup.js'
export type { BackupWords } from './backup.js'
export {
  changeDeadline,
  deadlineKinds,
  deadlinePage,
  deadlinePagePath,
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
  DeadlinePageView,
  DeadlinePerson,
  DeadlineQuestion,
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

// The stores, their stock and its bookings (ADR 0011, opengewerk#298).
export { StoreScreen, StoresScreen } from './stock.js'
export type {
  StockArticleChoice,
  StockPaths,
  StockScreenProps,
  StockWords,
  StoreScreenProps,
} from './stock.js'
export type { ContactsPanelProps, ContactsPanelWords } from './contacts.js'

// The files of the people with working time and qualifications, and the own
// file under "Konto" (ADR 0016, opengewerk#287).
export { NewPersonScreen, OwnFilePanel, PeopleScreen, PersonScreen } from './people.js'
export type { PeoplePaths, PeopleScreenProps, PeopleWords, PersonScreenProps } from './people.js'

// The card of the label of a record, in the side column of its page: the
// valid label with its QR code, printing it for a label printer or a sheet,
// blocking it, and making one where there is none. What a label hangs on,
// who may make and block one and at which routes, the application says, and
// every sentence that speaks to the reader.
export { LabelCard } from './label-card.js'
export type { CardLabel, LabelCardProps, LabelCardWords } from './label-card.js'

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

// A table somebody kept in a spreadsheet, taken over in a few steps: the
// steps, the file with its sheets, its columns with the field each of them
// is, and the two requests a table travels in. Which fields there are and
// what the rows become, the application says.
export { ColumnsPanel, readTableFile, sendTable, Steps, TableFilePanel } from './tables.js'
export type { ColumnsPanelProps, StepsProps, TableFilePanelProps } from './tables.js'
// And the other way: a list going out as a table, "Als Tabelle" in its head,
// with the file made by the route of the list from what its filter shows.
export { tableExportWords, useTableExport } from './table-export.js'

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

// How a tenant sends mail: its mail server for whoever may see it, with the
// signature under every message, and one sentence for everybody else. What
// goes out through it and what a signature may hold, the application says.
export { MailServerSection, MailStatusSection, SignaturePreviews } from './mail-server.js'
export type { MailServerWords, MailStatusWords, SignatureCase } from './mail-server.js'

// Push on this device and the occasions for every device, as a card of the
// account. The occasions the server names, the sentences the application.
export { PushPanel } from './push-panel.js'
export type { PushPanelProps, PushPanelWords } from './push-panel.js'

// The help beside a screen: the question mark in the header, the entry in the
// navigation below 1024 pixels, and the drawer with the text of the screen
// that stands. The frame draws all three when it is handed a source (`help`).
export { helpLabel } from './help.js'
export type { HelpLink, HelpSource } from './help.js'
