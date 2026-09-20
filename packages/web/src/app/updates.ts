/**
 * A new version of the application is on the device and waiting.
 *
 * Waiting, not applied. `registerType` is `prompt` for one reason: swapping
 * the code under somebody who is filling in a form in a cellar loses what they
 * typed, and on the site entry that is the normal situation rather than an
 * edge case. So the service worker holds the new build and the interface
 * offers it, at a moment the person picks.
 *
 * A module with a subscription rather than a React hook, so that the one
 * import of the virtual service worker module stays in `main.tsx`. Everything
 * else in the package has to keep working in a test, where that module does
 * not exist.
 */

let apply: (() => void) | null = null
const listeners = new Set<() => void>()

export function offerUpdate(swap: () => void): void {
  apply = swap

  for (const listener of listeners) {
    listener()
  }
}

export function subscribeToUpdates(listener: () => void): () => void {
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
  }
}

export function updateWaiting(): boolean {
  return apply !== null
}

export function applyUpdate(): void {
  apply?.()
}
