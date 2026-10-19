/**
 * A new version of the application, taken by the page itself at a moment
 * that costs nobody anything (opengewerk-haustechnik#465).
 *
 * The service worker installs a new build beside the one that runs and lets
 * it wait (`registerType: 'prompt'`). Until #465 a strip offered it and
 * somebody had to press a button; a page that stayed open, the tablet on the
 * wall of a plant room, stayed on the old build for days. Now the page takes
 * it at one of three moments:
 *
 * - as it opens, when the version was waiting already: nothing can have been
 *   typed yet;
 * - when the page is hidden: nobody is looking at it;
 * - when the address changes: the screen goes then anyway.
 *
 * Never while something holds it (`holdUpdates`): a form with what has not
 * been saved, a signature on its pad, the outbox on its way to the server,
 * anything typed since the address last changed, and the camera or the
 * picker a file input opened, which hides the page while it is open. What is
 * let go while the page is hidden is taken then, since nobody looks. Never
 * without a network:
 * a page without one stays on its version, and takes the new one when the
 * network comes back while nobody looks, or at the next moment.
 *
 * Taking it is `SKIP_WAITING` to the waiting worker and one reload once the
 * new worker controls the page. The reload is not optional: a page of the old
 * build fetches its screens lazily, address by address
 * (opengewerk-haustechnik#374), and the new worker holds only the pieces of
 * the new one.
 *
 * Without React, and without the virtual module the plugin of the build
 * provides, which exists only while vite runs: the application imports that
 * in its registration and hands the registration over.
 */

/** What of a service worker registration taking a version reads. A test stands in for it. */
export type UpdateRegistration = Pick<ServiceWorkerRegistration, 'active' | 'waiting' | 'update'>

/** What of the browser beyond the page taking a version uses, so a test can stand in for it. */
export interface UpdateSurroundings {
  /** Says when another worker controls the page: `navigator.serviceWorker`. */
  readonly workers?: Pick<ServiceWorkerContainer, 'addEventListener' | 'removeEventListener'>
  /** Loads the page anew: `location.reload`. */
  readonly reload?: () => void
}

/** How often a page that stays open asks the server for a new version. */
const lookEvery = 60 * 60 * 1000

/**
 * How long a page that is shown again waits for what a file input delivers
 * before it takes the camera or the picker for given up. A browser without the
 * event `cancel` says nothing when it is, and the `change` of one that
 * delivers may come a moment after the page is shown.
 */
const pickerGrace = 2 * 1000

const holds = new Set<object>()

let taking: {
  readonly navigated: () => void
  readonly unheld: () => void
  readonly stop: () => void
} | null = null

/**
 * Keeps a new version from being taken until the function it hands back is
 * called. For whatever a reload would cost: a form with what has not been
 * saved, a signature on its pad. Letting go is a moment only while the page
 * is hidden; on a page somebody looks at, whoever just saved is still there,
 * and the version comes at the next moment.
 */
export function holdUpdates(): () => void {
  const hold = {}

  holds.add(hold)

  return () => {
    if (holds.delete(hold) && holds.size === 0) {
      taking?.unheld()
    }
  }
}

/** Whether something holds a new version back right now. */
export function updatesHeld(): boolean {
  return holds.size > 0
}

/**
 * The address changed: one of the moments. What was typed on the screen that
 * went is let go first, since the screen took it with it.
 */
export function addressChanged(): void {
  taking?.navigated()
}

/**
 * From now on a version that waits in this registration is taken by itself,
 * at the moments the head of this file names, and the first of them is now.
 *
 * Besides it looks for a new version every hour and whenever the page is
 * shown again. The browser looks only when a page is loaded, and a page that
 * stays open for days would otherwise never hear of one.
 *
 * Answers with the function that stops all of it, for a test.
 */
export function takeUpdates(
  registration: UpdateRegistration,
  surroundings: UpdateSurroundings = {},
): () => void {
  taking?.stop()

  const workers = surroundings.workers ?? navigator.serviceWorker
  const reload =
    surroundings.reload ??
    (() => {
      location.reload()
    })

  // This page asked the waiting worker to take over.
  let asked = false
  let reloaded = false
  // Another page of the application took the version: this one runs a build
  // older than the worker that now controls it, and needs no more than a
  // reload at its next moment.
  let outdated = false
  // Something was typed since the address last changed.
  let typing: (() => void) | null = null
  // A file input whose camera or picker is open, and what holds the version
  // meanwhile.
  let picking: { readonly input: HTMLInputElement; readonly release: () => void } | null = null
  // Gives the picker up once the page has been shown again for a moment.
  let givingUp: ReturnType<typeof setTimeout> | undefined

  function waiting(): ServiceWorker | null {
    // Only beside an active one. On the first visit the worker passes through
    // waiting on its way to being active, and there is nothing to take.
    return registration.active ? registration.waiting : null
  }

  function reloadOnce(): void {
    if (!reloaded) {
      reloaded = true
      reload()
    }
  }

  function moment(): void {
    if (asked || reloaded || holds.size > 0 || !navigator.onLine) {
      return
    }

    const worker = waiting()

    if (worker) {
      asked = true
      // A page no worker controls hears no `controllerchange`; it goes by the
      // state of the worker it asked instead.
      worker.addEventListener('statechange', () => {
        if (worker.state === 'activated') {
          reloadOnce()
        }
      })
      worker.postMessage({ type: 'SKIP_WAITING' })
    } else if (outdated) {
      reloadOnce()
    }
  }

  function look(): void {
    if (navigator.onLine) {
      void registration.update().catch(() => undefined)
    }
  }

  // Every page under the worker hears this, not only the one that asked. The
  // others are not loaded anew under whoever is typing in them: they wait for
  // a moment of their own.
  function controllerChanged(): void {
    if (asked) {
      reloadOnce()
    } else {
      outdated = true
    }
  }

  function visibilityChanged(): void {
    if (document.visibilityState === 'hidden') {
      // The picker hid the page again, an app chooser before the camera:
      // it is still open.
      clearTimeout(givingUp)
      moment()
    } else {
      look()

      if (picking) {
        clearTimeout(givingUp)
        givingUp = setTimeout(picked, pickerGrace)
      }
    }
  }

  // The network is back, or the last hold was let go. A page that is looked
  // at waits for its next moment rather than being loaded anew under
  // somebody's eyes.
  function whileHidden(): void {
    if (document.visibilityState === 'hidden') {
      moment()
    }
  }

  // Whatever is typed into whatever field, a search included. Most forms know
  // nothing of saving, and a reload while the page is hidden would take what
  // was typed with it; leaving the address takes it anyway.
  function typed(): void {
    typing ??= holdUpdates()
  }

  // A file input opens the camera or the picker of the device, which hides the
  // page on a phone; a reload then would lose the photo just taken. Any file
  // input on the page, also a hidden one a button clicks, since that still
  // sends `click` to the input. Held until it delivers or is given up.
  function clicked(event: Event): void {
    const input = event.target

    if (input instanceof HTMLInputElement && input.type === 'file') {
      // Held anew before the one before is let go, which would be a moment.
      const release = holdUpdates()

      picked()
      picking = { input, release }
      input.addEventListener('change', delivered)
      input.addEventListener('cancel', picked)
    }
  }

  // What the input delivered lives in the page now, like what was typed. The
  // browser sends `input` before `change`, which `typed` hears already; this
  // holds as well where it does not, since the change may come while the page
  // is still hidden.
  function delivered(): void {
    typed()
    picked()
  }

  // The camera or the picker delivered or was given up.
  function picked(): void {
    clearTimeout(givingUp)

    if (picking) {
      const { input, release } = picking

      picking = null
      input.removeEventListener('change', delivered)
      input.removeEventListener('cancel', picked)
      release()
    }
  }

  const timer = setInterval(look, lookEvery)

  workers.addEventListener('controllerchange', controllerChanged)
  document.addEventListener('visibilitychange', visibilityChanged)
  document.addEventListener('input', typed, true)
  document.addEventListener('click', clicked, true)
  window.addEventListener('online', whileHidden)

  const current = {
    navigated() {
      typing?.()
      typing = null
      moment()
    },
    unheld: whileHidden,
    stop() {
      if (taking === current) {
        taking = null
      }

      clearInterval(timer)
      workers.removeEventListener('controllerchange', controllerChanged)
      document.removeEventListener('visibilitychange', visibilityChanged)
      document.removeEventListener('input', typed, true)
      document.removeEventListener('click', clicked, true)
      window.removeEventListener('online', whileHidden)
      typing?.()
      typing = null
      picked()
    },
  }

  taking = current

  // As the page opens, before anything can be typed.
  moment()

  return current.stop
}
