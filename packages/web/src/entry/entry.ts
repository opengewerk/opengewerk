import type { Entry } from '../components/index.js'

export type { Entry }

/** Where each entry point lives. The office is the root, the site is under it. */
export const entryPath: Readonly<Record<Entry, string>> = {
  office: '/',
  site: '/m/',
}

/** What the browser says about the thing somebody is holding. */
export interface DeviceTraits {
  /** A finger or a stylus: `(pointer: coarse)`. */
  readonly coarsePointer: boolean
  /** A mouse or a trackpad is available at all: `(any-pointer: fine)`. */
  readonly finePointer: boolean
}

export const entryChoiceKey = 'opengewerk.entry'

/**
 * Which entry point suits this device.
 *
 * Deliberately not a width. ADR 0004 settles that in as many words: the two
 * entries are two input devices, not two screen sizes, and a wide tablet on a
 * roof is still a building site. A breakpoint would send that tablet into the
 * office, where the controls are 34 pixels high and meant for a mouse.
 *
 * A fine pointer wins over a coarse one, because a laptop with a touchscreen
 * has both and is a desk. Neither is the case of a browser that answers no
 * media query, and there the office is the safe guess: it has every screen the
 * site entry has and more.
 */
export function suggestedEntry(traits: DeviceTraits): Entry {
  if (traits.finePointer) {
    return 'office'
  }

  return traits.coarsePointer ? 'site' : 'office'
}

export function readTraits(): DeviceTraits {
  const ask = (query: string) => globalThis.matchMedia?.(query).matches === true

  return { coarsePointer: ask('(pointer: coarse)'), finePointer: ask('(any-pointer: fine)') }
}

/**
 * Reads back the entry somebody decided on, if they ever did.
 *
 * Wrapped in a try because `localStorage` throws rather than returning
 * nothing when a browser is set to refuse storage. An unhandled throw here
 * would take the whole application down before it rendered anything, over a
 * preference.
 */
export function rememberedEntry(
  storage: Storage | undefined = globalThis.localStorage,
): Entry | null {
  try {
    const stored = storage?.getItem(entryChoiceKey)

    return stored === 'office' || stored === 'site' ? stored : null
  } catch {
    return null
  }
}

export function rememberEntry(
  entry: Entry,
  storage: Storage | undefined = globalThis.localStorage,
): void {
  try {
    storage?.setItem(entryChoiceKey, entry)
  } catch {
    // A browser that refuses storage gets asked again next time. That is a
    // small annoyance; failing to start is not.
  }
}

/**
 * The other entry, when it is worth offering, and nothing when it is not.
 *
 * A suggestion and not a redirect, which is what ADR 0004 asks for and also
 * the only version that survives the two bundles: a redirect from the office
 * would have the phone download the office first and the site app second, and
 * the budget for the first load on site would be the sum of both.
 *
 * Once somebody has said which they want, they are never asked again, on
 * either side. Being offered the site app every morning at a desk is how a
 * suggestion turns into something people learn to click away without reading.
 */
export function suggestionFor(
  here: Entry,
  traits: DeviceTraits,
  remembered: Entry | null,
): Entry | null {
  if (remembered !== null) {
    return null
  }

  const suits = suggestedEntry(traits)

  return suits === here ? null : suits
}
