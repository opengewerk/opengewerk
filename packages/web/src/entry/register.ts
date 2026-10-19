import { takeUpdates } from '@opengewerk/platform-web/shell'
import { registerSW } from 'virtual:pwa-register'

/**
 * Registers the service worker and hands its registration to the foundation,
 * which takes a new build by itself at a moment that costs nobody anything
 * (opengewerk-haustechnik#465): as the page opens, when it is hidden, when the
 * address changes, never while something holds it and never without a
 * network.
 *
 * The one place in the package that imports the virtual module the plugin
 * provides. It exists only while vite is running, so everything else has to
 * stay clear of it or no test in this package would resolve its imports.
 *
 * `onNeedReload` does nothing on purpose. Left out, the plugin would load
 * every open page anew once the new worker takes over, a page with a
 * half-filled form among them; the foundation loads only the page that asked
 * and lets the others wait for a moment of their own.
 */
export function startServiceWorker(): void {
  registerSW({
    immediate: true,
    onRegisteredSW(_url, registration) {
      if (registration) {
        takeUpdates(registration)
      }
    },
    onNeedReload() {},
  })
}
