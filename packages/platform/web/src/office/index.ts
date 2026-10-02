// What the screens of the office are built from, as an entry of its own:
// `@opengewerk/platform-web/office`.
//
// The office is the entry with a mouse and a keyboard, where a screen is
// dense and a list is a table (ADR 0004). An application writes its screens
// out of these pieces and names in them what only it knows: its records, its
// columns, the settings a tenant has. Nothing in here is drawn for the site,
// which has its own pieces under `/site`, so that a phone on site never loads
// a table it will not show.

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
// very wide one.
export { entries, lastChanged, ListCard, ListScreen, SortChoice } from './list.js'
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
