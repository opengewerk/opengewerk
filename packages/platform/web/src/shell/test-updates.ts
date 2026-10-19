import { vi } from 'vitest'

import type { UpdateRegistration } from './updates.js'
import { takeUpdates } from './updates.js'

/** A service worker as far as taking a version asks: its state, and what it is sent. */
class StandInServiceWorker extends EventTarget {
  constructor(
    public state: ServiceWorkerState,
    private readonly heard: (worker: StandInServiceWorker, message: unknown) => void,
  ) {
    super()
  }

  postMessage(message: unknown): void {
    this.heard(this, message)
  }
}

/**
 * A device with the service worker of an application, for the tests of when
 * a new version is taken (opengewerk-haustechnik#465): the registration with
 * its workers, whether the page is shown, and whether there is a network.
 *
 * The waiting worker does on `SKIP_WAITING` what the worker of the build does
 * (`serveShell`): it becomes the active one, and a page it controls hears
 * `controllerchange`. Nothing reloads; the device counts the reloads instead.
 *
 * `forget` stops it and gives the page its own visibility and network back.
 */
export function standInWorker(
  options: {
    /** A version waits already as the page opens. */
    readonly waiting?: boolean
    /** The page is controlled by a worker; not on the first visit. */
    readonly controlled?: boolean
  } = {},
) {
  const controlled = options.controlled ?? true
  const workers = new EventTarget()
  const sent: unknown[] = []
  let reloads = 0
  let shown: DocumentVisibilityState = 'visible'
  let connected = true
  let stop: (() => void) | null = null

  const registration: {
    active: StandInServiceWorker | null
    waiting: StandInServiceWorker | null
    update: () => Promise<void>
  } = {
    active: null,
    waiting: null,
    update: vi.fn(() => Promise.resolve()),
  }

  function activate(worker: StandInServiceWorker): void {
    registration.active = worker
    registration.waiting = null
    worker.state = 'activating'
    worker.dispatchEvent(new Event('statechange'))

    if (controlled) {
      workers.dispatchEvent(new Event('controllerchange'))
    }

    worker.state = 'activated'
    worker.dispatchEvent(new Event('statechange'))
  }

  function heard(worker: StandInServiceWorker, message: unknown): void {
    sent.push(message)

    if (
      registration.waiting === worker &&
      (message as { type?: unknown } | null)?.type === 'SKIP_WAITING'
    ) {
      activate(worker)
    }
  }

  function arrive(): void {
    registration.waiting = new StandInServiceWorker('installed', heard)
  }

  registration.active = new StandInServiceWorker('activated', heard)

  if (options.waiting) {
    arrive()
  }

  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => shown })
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => connected })

  return {
    registration,
    /** What the workers were sent, in order. */
    sent,
    /** How often the page was loaded anew. */
    get reloads(): number {
      return reloads
    },
    /** Takes versions from now on, as the registration of an application does. */
    start(): void {
      stop = takeUpdates(registration as unknown as UpdateRegistration, {
        workers,
        reload: () => {
          reloads += 1
        },
      })
    },
    /** A new build was installed and waits. */
    arrive,
    /** Another page of the application took the version that waits. */
    takenElsewhere(): void {
      if (registration.waiting) {
        activate(registration.waiting)
      }
    },
    hide(): void {
      shown = 'hidden'
      document.dispatchEvent(new Event('visibilitychange'))
    },
    show(): void {
      shown = 'visible'
      document.dispatchEvent(new Event('visibilitychange'))
    },
    offline(): void {
      connected = false
      window.dispatchEvent(new Event('offline'))
    },
    online(): void {
      connected = true
      window.dispatchEvent(new Event('online'))
    },
    forget(): void {
      stop?.()
      stop = null
      Reflect.deleteProperty(document, 'visibilityState')
      Reflect.deleteProperty(navigator, 'onLine')
    },
  }
}
