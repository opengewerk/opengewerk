/// <reference lib="webworker" />

import { foundationPaths } from '@opengewerk/platform-domain'
import { createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import type { PrecacheEntry } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'

/** What an application hands its service worker. */
export interface ShellWorker {
  /**
   * What the build put into the cache. The plugin of the build writes the list
   * into the worker of the application, at the one place it looks for, and the
   * application hands it on: a second such place, here, would fail the build.
   */
  readonly precache: readonly (PrecacheEntry | string)[]
  /** What the application is called: the title of a push message that brings none. */
  readonly name: string
  /** The icon beside a push message. */
  readonly icon: string
  /**
   * The first segment of every path the server of the application answers
   * itself, beside those of the foundation (`foundationPaths`), which the
   * worker adds. A navigation to one of them is the server's and never gets
   * a shell.
   */
  readonly serverPaths: readonly string[]
}

/** What the worker takes from Workbox, handed in so that a test can stand in for it. */
export interface Workbox {
  readonly precacheAndRoute: typeof precacheAndRoute
  readonly registerRoute: typeof registerRoute
  readonly NavigationRoute: typeof NavigationRoute
  readonly createHandlerBoundToURL: typeof createHandlerBoundToURL
}

const workbox: Workbox = {
  precacheAndRoute,
  registerRoute,
  NavigationRoute,
  createHandlerBoundToURL,
}

/**
 * Where a path leads, when it leads to a page on this origin, and the start
 * when it leads anywhere else or is no path at all.
 *
 * Read the way a browser reads it and not by its first characters: `/\host`
 * begins like a path and leads to another host, because a browser takes the
 * backslash in an address for a slash. Until #12 the first characters were all
 * that was looked at.
 */
function staysHere(scope: ServiceWorkerGlobalScope, wanted: unknown): URL {
  const start = new URL('/', scope.location.origin)

  if (typeof wanted !== 'string' || !wanted.startsWith('/')) {
    return start
  }

  try {
    const url = new URL(wanted, start)

    return url.origin === start.origin ? url : start
  } catch {
    return start
  }
}

/**
 * A path begins with one of these segments: the segment, and after it a
 * slash, the question mark of a query or nothing. Workbox tests a navigation
 * by its path and its query together, and the server tells its own paths
 * apart by the path alone; until #12 a navigation with a query, such as
 * `/m?x`, was answered here with the other shell than on the server.
 */
function beginsWith(segments: readonly string[]): RegExp {
  // Each segment as it is written, none read as a pattern.
  const written = segments.map((segment) => segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))

  return new RegExp(`^/(?:${written.join('|')})(?:[/?]|$)`)
}

/**
 * The service worker of an application with two entry points, written out
 * rather than generated (ADR 0004, ADR 0010).
 *
 * It does two things and deliberately not a third. It precaches the shell of
 * both entry points so that the application starts without a network, and it
 * answers a navigation from that shell. It does not cache a single answer from
 * the API.
 *
 * That omission is the decision. ADR 0004 says data goes through the sync
 * client of ADR 0005 and not through the HTTP cache, and the reason is what a
 * cached answer would mean away from a desk: a list that looks current, is
 * not, and carries no mark saying so. The sync client knows what it last
 * heard and when, and the strip at the top of the screen says it out loud. A
 * cache in front of it would quietly answer questions the client thought it
 * was asking the server.
 *
 * Beside that it shows push messages, opens what a tap on one names, and
 * takes a new build when the page says so.
 */
export function serveShell(
  scope: ServiceWorkerGlobalScope,
  worker: ShellWorker,
  tools: Workbox = workbox,
): void {
  tools.precacheAndRoute([...worker.precache])

  // A navigation is answered from the shell of the entry it belongs to. Two
  // routes rather than one fallback, because the two entries are two
  // applications as far as the browser is concerned: a deep link into the
  // second entry has to come back with its shell, or the phone opens the
  // office on a screen the size of a hand.
  const secondEntry = beginsWith(['m'])

  tools.registerRoute(
    new tools.NavigationRoute(tools.createHandlerBoundToURL('/m/index.html'), {
      allowlist: [secondEntry],
    }),
  )

  tools.registerRoute(
    new tools.NavigationRoute(tools.createHandlerBoundToURL('/index.html'), {
      denylist: [
        secondEntry,
        // Everything the server answers itself. Without this the shell would
        // be handed back for an API call that happens to look like a
        // navigation, and the failure reads like the server returning HTML.
        beginsWith([...foundationPaths, ...worker.serverPaths]),
      ],
    }),
  )

  // A push message (#284), shown as a notification. What the server sends
  // says only what is due and where a tap leads; the device shows the rest
  // from its own data once the screen is open.
  //
  // Every message is shown: a browser takes a subscription only on the promise
  // that each push becomes something the person sees (`userVisibleOnly`), and
  // one that is not may cost the subscription. A message that cannot be read
  // still says which application it came from.
  scope.addEventListener('push', (event: PushEvent) => {
    let message: { title?: unknown; body?: unknown; url?: unknown; tag?: unknown } = {}

    try {
      message = (event.data?.json() ?? {}) as typeof message
    } catch {
      message = {}
    }

    const url = staysHere(scope, message.url)

    event.waitUntil(
      scope.registration.showNotification(
        typeof message.title === 'string' ? message.title : worker.name,
        {
          body: typeof message.body === 'string' ? message.body : '',
          ...(typeof message.tag === 'string' ? { tag: message.tag } : {}),
          icon: worker.icon,
          data: { url: url.pathname + url.search + url.hash },
        },
      ),
    )
  })

  // A tap on a notification opens the screen it names. A window of the
  // application that is open already takes it, rather than a second one
  // beside it; the address stays on this origin, whatever a message said.
  scope.addEventListener('notificationclick', (event: NotificationEvent) => {
    event.notification.close()

    const url = staysHere(scope, (event.notification.data as { url?: unknown } | null)?.url).href

    event.waitUntil(
      (async () => {
        const windows = await scope.clients.matchAll({ type: 'window', includeUncontrolled: true })
        const open = windows.find((client) => client.url.startsWith(scope.location.origin))

        if (open) {
          await open.focus()
          await open.navigate(url)
        } else {
          await scope.clients.openWindow(url)
        }
      })(),
    )
  })

  // The application asks for the swap, this only performs it. A new version
  // waits here until somebody who is not in the middle of something says go.
  //
  // The origin is checked although only a page inside this worker's scope can
  // reach it at all, so the check can never fail in practice. It is here
  // because "a handler that acts on a message without looking where it came
  // from" is a shape worth never writing: the next message handler will do
  // something more than swap a build, and by then the habit decides. An empty
  // origin is let through because a message from another worker on this
  // origin has one.
  scope.addEventListener('message', (event: ExtendableMessageEvent) => {
    const fromHere = event.origin === '' || event.origin === scope.location.origin

    if (fromHere && (event.data as { type?: string } | undefined)?.type === 'SKIP_WAITING') {
      void scope.skipWaiting()
    }
  })
}
