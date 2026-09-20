import { existsSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

import express from 'express'
import type { Express, Request, Response } from 'express'

/**
 * Serves the built interface from the same process that serves the API.
 *
 * One process and not two. ADR 0004 turned down Next.js partly because a Node
 * server in front of a static bundle is a second process without a job, and
 * that reasoning does not improve when the second process is nginx: an
 * installation would have one more container to configure, one more place for
 * a path to be wrong, and one more thing to update.
 *
 * Two shells and not one. `/m` and everything under it is the site
 * application and has to come back with the site shell; a deep link into it
 * answered with the office shell opens a desk interface on a phone. This is
 * the same decision the service worker makes for a navigation it answers
 * offline, written twice because it has to hold in both places.
 */

/**
 * Where the built files sit inside the image, and where they sit locally.
 *
 * A folder only counts when both shells are in it. A directory with one of
 * them is a build that went wrong, and the honest answer then is that there is
 * no interface: the instance says so once at start and serves its API, rather
 * than answering half the addresses and 404ing the other half.
 */
export function interfacePath(): string | null {
  for (const candidate of [
    // In the image: the web build is copied next to the server's own dist.
    resolve(process.cwd(), 'interface'),
    // In a checkout: straight out of the other package.
    resolve(process.cwd(), '..', 'web', 'dist'),
  ]) {
    const complete =
      existsSync(candidate) &&
      statSync(candidate).isDirectory() &&
      existsSync(join(candidate, 'index.html')) &&
      existsSync(join(candidate, 'm', 'index.html'))

    if (complete) {
      return candidate
    }
  }

  return null
}

/**
 * Paths the API owns. A request for one of these never gets a shell back.
 *
 * Written out rather than derived from the router, because the fallback has to
 * answer before the router does: a shell handed back for a mistyped API path
 * looks to a client like the server returning HTML for JSON, and that is a
 * confusing hour.
 */
const apiPrefixes = [
  'api',
  'auth',
  'customers',
  'sites',
  'installations',
  'jobs',
  'documents',
  'sync',
  'settings',
  'setup',
  'health',
]

function belongsToTheApi(path: string): boolean {
  const first = path.split('/')[1] ?? ''

  return apiPrefixes.includes(first)
}

export function serveInterface(application: Express, directory: string): void {
  /**
   * Both shells, read once and kept.
   *
   * Not read per request, and that is not only about speed. The fallback below
   * answers every address that is not the API's, so a handler that touched the
   * disk would turn any flood of requests for nonsense paths into disk work.
   * There is nothing to re-read: the files come out of a build, and a new
   * build is a new container.
   */
  const officeShell = readFileSync(join(directory, 'index.html'), 'utf8')
  const siteShell = readFileSync(join(directory, 'm', 'index.html'), 'utf8')

  application.use(
    express.static(directory, {
      // Every built file carries a hash in its name, so it can be kept for a
      // year. Three do not, and all three are the ones that point at the
      // hashed names: the two shells and the service worker. Cached, they
      // are an installation that keeps starting the version it had when it
      // was first opened. A browser caps how long it trusts a worker script
      // by itself, which is a safety net and not a reason to serve it with a
      // year on it.
      setHeaders(response: Response, path: string) {
        const pointsAtTheRest =
          path.endsWith('index.html') ||
          path.endsWith('.webmanifest') ||
          path.endsWith('service-worker.js') ||
          path.endsWith('registerSW.js')

        response.setHeader(
          'Cache-Control',
          pointsAtTheRest ? 'no-cache' : 'public, max-age=31536000, immutable',
        )
      },
      // The fallback below does this, per shell. Leaving it on here would
      // answer `/m/auftraege/…` with the office shell, because that is the
      // index this option would find first.
      index: false,
      // And no redirect from `/m` to `/m/` either. With it, the site entry
      // answers its own address with a 301 before the fallback ever sees it,
      // which costs a round trip on exactly the connection that has none to
      // spare. The fallback below answers both spellings directly.
      redirect: false,
    }),
  )

  application.get(/.*/, (request: Request, response: Response, next: () => void) => {
    if (request.method !== 'GET' || belongsToTheApi(request.path)) {
      next()

      return
    }

    response.setHeader('Cache-Control', 'no-cache')
    response.type('html').send(request.path.startsWith('/m') ? siteShell : officeShell)
  })
}
