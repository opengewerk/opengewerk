import { registerSW } from 'virtual:pwa-register'

import { offerUpdate } from '../app/updates.js'

/**
 * Registers the service worker and, when a new build arrives, offers it.
 *
 * The one place in the package that imports the virtual module the plugin
 * provides. It exists only while vite is running, so everything else has to
 * stay clear of it or no test in this package would resolve its imports.
 *
 * `onNeedRefresh` rather than an automatic swap. Replacing the code under
 * somebody who is filling in a form in a cellar loses what they typed, and on
 * the site entry that is the normal situation rather than an edge case.
 */
export function startServiceWorker(): void {
  const update = registerSW({
    immediate: true,
    onNeedRefresh() {
      offerUpdate(() => {
        void update(true)
      })
    },
  })
}
