import { useSyncExternalStore } from 'react'

/**
 * Light or dark, chosen on each device and kept there.
 *
 * Light is the ground state on every new device and before anyone signs in,
 * whatever the operating system prefers (#216). A screen is read in daylight
 * on a roof as often as in a cellar, and the choice belongs to whoever holds
 * the device, not to a system setting they may never have looked at.
 *
 * The choice lives in this origin's storage and nowhere else. It is not part
 * of the account: the office desk and the tablet in the cellar of the same
 * person want different things, and the gate has no account to ask anyway.
 */
export type Theme = 'light' | 'dark'

const key = 'opengewerk.theme'

/** What this device chose, or light when it chose nothing or cannot say. */
export function storedTheme(storage: Pick<Storage, 'getItem'> | undefined = safeStorage()): Theme {
  try {
    return storage?.getItem(key) === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

/** Sets the attribute every dark token in `tokens.css` keys on. */
export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement): void {
  root.dataset.theme = theme
}

let current: Theme | undefined
const listeners = new Set<() => void>()

/**
 * Applies the stored choice before the first screen is drawn. An entry point
 * calls this once, ahead of rendering, so the gate already has the ground the
 * person picked last time.
 */
export function startTheme(): void {
  current = storedTheme()
  applyTheme(current)
  // Another tab of the same installation switched: follow it, since both show
  // the same device.
  globalThis.addEventListener('storage', (event: StorageEvent) => {
    if (event.key !== key) {
      return
    }

    current = storedTheme()
    applyTheme(current)
    notify()
  })
}

/**
 * Switches and remembers. A storage that refuses to write, as in some private
 * windows, still switches for this page, which is better than a button that
 * does nothing.
 */
export function chooseTheme(theme: Theme): void {
  try {
    safeStorage()?.setItem(key, theme)
  } catch {
    // Kept for this page only; see above.
  }

  current = theme
  applyTheme(theme)
  notify()
}

function notify(): void {
  for (const listener of listeners) {
    listener()
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
  }
}

function snapshot(): Theme {
  current ??= storedTheme()

  return current
}

/** The current choice and the way to change it, for a switch on a screen. */
export function useTheme(): readonly [Theme, (theme: Theme) => void] {
  const theme = useSyncExternalStore(subscribe, snapshot, () => 'light' as const)

  return [theme, chooseTheme] as const
}

function safeStorage(): Storage | undefined {
  try {
    return globalThis.localStorage
  } catch {
    // Accessing the property itself throws when site data is blocked.
    return undefined
  }
}
