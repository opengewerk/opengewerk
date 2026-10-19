// What stands around the screens of both entries, as an entry of its own:
// `@opengewerk/platform-web/shell`.
//
// The two entries of ADR 0004 are two documents from one code base. What
// both of them need around their screens is here: which entry suits a device
// and the offer to switch, and a new version of the service worker taken at a
// moment that costs nobody anything.

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

// A new version that waits: the application hands over the registration of
// its service worker, and the page takes the version by itself as it opens,
// when it is hidden or when the address changes, never while something holds
// it and never without a network (opengewerk-haustechnik#465).
export { holdUpdates, takeUpdates, updatesHeld } from './updates.js'
export type { UpdateRegistration, UpdateSurroundings } from './updates.js'
export { useHoldUpdates, useUpdateOnNavigation } from './update-hooks.js'
