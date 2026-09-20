/// <reference lib="webworker" />

import { createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'

declare const self: ServiceWorkerGlobalScope

/**
 * The service worker, written out rather than generated.
 *
 * It does two things and deliberately not a third. It precaches the shell of
 * both entry points so that the application starts without a network, and it
 * answers a navigation from that shell. It does not cache a single answer from
 * the API.
 *
 * That omission is the decision. ADR 0004 says data goes through the sync
 * client of ADR 0005 and not through the HTTP cache, and the reason is what a
 * cached answer would mean on site: a list that looks current, is not, and
 * carries no mark saying so. The sync client knows what it last heard and
 * when, and the bar at the top of the screen says it out loud. A cache in
 * front of it would quietly answer questions the client thought it was asking
 * the server.
 */

precacheAndRoute(self.__WB_MANIFEST)

/**
 * A navigation is answered from the shell of the entry it belongs to.
 *
 * Two routes rather than one fallback, because the two entries are two
 * applications as far as the browser is concerned: a deep link into the site
 * entry has to come back with the site shell, or the phone opens the office on
 * a screen the size of a hand.
 */
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('/m/index.html'), {
    allowlist: [/^\/m(\/|$)/],
  }),
)

registerRoute(
  new NavigationRoute(createHandlerBoundToURL('/index.html'), {
    denylist: [
      // Everything the server answers itself. Without this the shell would be
      // handed back for an API call that happens to look like a navigation,
      // and the failure reads like the server returning HTML.
      /^\/m(\/|$)/,
      /^\/api(\/|$)/,
      /^\/(auth|customers|sites|installations|jobs|documents|sync|settings|setup|staff|invitation|health)(\/|$)/,
    ],
  }),
)

/**
 * The application asks for the swap, this only performs it. `registerType` is
 * `prompt`, so a new version waits here until somebody who is not in the
 * middle of something says go.
 *
 * The origin is checked although only a page inside this worker's scope can
 * reach it at all, so the check can never fail in practice. It is here because
 * "a handler that acts on a message without looking where it came from" is a
 * shape worth never writing: the next message handler will do something more
 * than swap a build, and by then the habit decides. An empty origin is let
 * through because a message from another worker on this origin has one.
 */
self.addEventListener('message', (event: ExtendableMessageEvent) => {
  const fromHere = event.origin === '' || event.origin === self.location.origin

  if (fromHere && (event.data as { type?: string } | undefined)?.type === 'SKIP_WAITING') {
    void self.skipWaiting()
  }
})
