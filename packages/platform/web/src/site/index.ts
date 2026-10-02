// What the screens on site are built from, as an entry of its own:
// `@opengewerk/platform-web/site`.
//
// The site is the entry with a finger, held in one hand, often without a
// network (ADR 0004): 17 pixels of text and rows a thumb hits. What an
// application calls that entry is its own business; in the code it is the
// site. Nothing in here is drawn for the office.

// The content of a screen, small capitals over a value, the facts of a
// record, links and rows to tap, the head of a screen of the tabs, and the
// sentences of a card.
export {
  NotSent,
  SiteAnchor,
  SiteFacts,
  SiteLabel,
  SiteLink,
  SiteRow,
  SiteRows,
  SiteScreen,
  SiteText,
  SiteTrouble,
  TitleCount,
  TopTitle,
} from './kit.js'
export type { SiteFact } from './kit.js'

// The bar at the foot of a form, where the thumb is, and the place in a shell
// it is drawn into.
export { actionBarMark, ActionSlotProvider, SiteActionBar, SiteNoTabs } from './action-bar.js'
