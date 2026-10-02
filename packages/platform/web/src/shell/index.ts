// What stands around the screens of both entries, as an entry of its own:
// `@opengewerk/platform-web/shell`.
//
// The two entries of ADR 0004 are two documents from one code base. What
// both of them need around their screens is here: which entry suits a device
// and the offer to switch, and the offer to take a new version once the
// service worker has one.

// The two entries: where each lives, which one a device suits, what somebody
// chose, and the strip that offers the other one. What the entries are called
// in that strip is the application's to say (ADR 0010).
export {
  entryChoiceKey,
  entryPath,
  readTraits,
  rememberedEntry,
  rememberEntry,
  suggestedEntry,
  suggestionFor,
} from './entry.js'
export type { DeviceTraits } from './entry.js'
export type { Entry } from '../components/surface.js'
export { EntrySuggestion } from './suggestion.js'

// A new version that waits: the service worker of an application offers it,
// and the strip over a screen lets somebody take it at a moment they pick.
export { applyUpdate, offerUpdate, subscribeToUpdates, updateWaiting } from './updates.js'
export { UpdateBar } from './update-bar.js'
