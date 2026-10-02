// What the screens on site are built from, as an entry of its own:
// `@opengewerk/platform-web/site`.
//
// The site is the entry with a finger, held in one hand, often without a
// network (ADR 0004): 17 pixels of text and rows a thumb hits. What an
// application calls that entry is its own business; in the code it is the
// site. Nothing in here is drawn for the office.

// What every screen on site sits in: the strips, the header of a screen, the
// tabs where the thumb is and the menu behind the last of them. An
// application hands in its tabs and mounts the frame as the route over its
// screens.
export { SiteFrame } from './frame.js'
export type { SiteFrameProps, SiteTab } from './frame.js'
// The slate header of a screen below the tabs, with the way back the
// application names.
export { SiteHeader } from './header.js'
export type { WayBack } from './header.js'

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

// The camera reading codes: the reader of the browser or one loaded on
// demand, the picture, a frame every few milliseconds, and the sentences a
// screen says when it cannot read. Where camera and reader come from is a
// context, so that a test puts its own in.
export { ScanningContext, useCodeReading } from './camera.js'
export type { CameraWords, Scanning } from './camera.js'
export type { CodeReader } from './barcode.js'

// Where somebody signs, with a finger or a pen. The picture of a signature
// is shown in both entries and sits at the root of the package.
export { SignaturePad } from './signature-pad.js'

// "Konflikte": the state of the exchange, what is to decide and a way to try
// again, the one screen of the site that may be empty. What a record is
// called and what other way out of a conflict there is, the application says
// in its value (`records`).
export { ConflictScreen } from './conflicts.js'
