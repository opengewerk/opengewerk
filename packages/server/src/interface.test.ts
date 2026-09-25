import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import express from 'express'
import type { Express } from 'express'
import request from 'supertest'
import { beforeAll, describe, expect, it } from 'vitest'

import { interfacePath, serveInterface } from './interface.js'
import { sendSecurityHeaders, shellPolicy } from './security-headers.js'

/**
 * A built interface, as small as one can be and still have two shells.
 *
 * The two documents are what the whole file is about: a request under `/m` has
 * to come back with the site shell and everything else with the office shell,
 * and telling them apart is the one thing a single fallback cannot do.
 */
function builtInterface(): string {
  const directory = mkdtempSync(join(tmpdir(), 'opengewerk-interface-'))

  mkdirSync(join(directory, 'm'))
  mkdirSync(join(directory, 'assets'))
  writeFileSync(join(directory, 'index.html'), '<!doctype html><title>Büro</title>')
  writeFileSync(join(directory, 'm', 'index.html'), '<!doctype html><title>Baustelle</title>')
  writeFileSync(join(directory, 'assets', 'office-abc123.js'), 'console.log(1)')
  writeFileSync(join(directory, 'service-worker.js'), 'self.addEventListener("fetch", () => {})')

  return directory
}

let application: Express

beforeAll(() => {
  application = express()

  application.get('/customers', (_request, response) => {
    response.json([{ name: 'Meyer' }])
  })

  serveInterface(application, builtInterface())
})

describe('where the server looks for a built interface', () => {
  it('finds nothing when neither place has one', () => {
    const empty = mkdtempSync(join(tmpdir(), 'opengewerk-empty-'))
    const wasAt = process.cwd()

    try {
      process.chdir(empty)

      expect(interfacePath()).toBeNull()
    } finally {
      process.chdir(wasAt)
    }
  })

  it('finds nothing when only one of the two shells is there', () => {
    // Half a build. Saying so at start and serving the API beats answering
    // one half of the addresses and 404ing the other, which looks like a
    // routing fault in an application that was simply never built whole.
    const half = mkdtempSync(join(tmpdir(), 'opengewerk-half-'))
    const wasAt = process.cwd()

    mkdirSync(join(half, 'interface'))
    writeFileSync(join(half, 'interface', 'index.html'), '<!doctype html>')

    try {
      process.chdir(half)

      expect(interfacePath()).toBeNull()
    } finally {
      process.chdir(wasAt)
    }
  })
})

describe('the interface the server hands out', () => {
  it('answers the root with the office shell', async () => {
    const answer = await request(application).get('/')

    expect(answer.status).toBe(200)
    expect(answer.text).toContain('Büro')
  })

  it('answers a deep link into the office with the office shell', async () => {
    // The office is a single page application: `/kunden/<id>` is a route
    // inside the document, not a file, and the server has never heard of it.
    const answer = await request(application).get('/kunden/018f-abc')

    expect(answer.text).toContain('Büro')
  })

  it('answers anything under /m with the site shell', async () => {
    const answer = await request(application).get('/m/auftraege/018f-abc')

    // The reason there are two fallbacks and not one. A deep link into the
    // site entry answered with the office shell opens a desk interface, with
    // 34 pixel controls, on a phone held in one hand in a cellar.
    expect(answer.text).toContain('Baustelle')
  })

  it('answers a HEAD for a page like the GET, only without the body', async () => {
    // A monitor that checks whether the installation is up often asks with
    // HEAD. Answered with a 404, a running office looks like one that is
    // gone.
    for (const path of ['/', '/kunden/018f-abc', '/m/', '/m/auftraege/018f-abc']) {
      const answer = await request(application).head(path)

      expect([path, answer.status, answer.type]).toEqual([path, 200, 'text/html'])
      expect(answer.text).toBeUndefined()
    }
  })

  it('answers /m itself with the site shell', async () => {
    expect((await request(application).get('/m')).text).toContain('Baustelle')
  })

  it('answers an office path that merely starts with an m with the office shell', async () => {
    // The site entry is `/m` and what lies under it, the same line the
    // service worker draws. A prefix of one letter would hand the phone
    // interface to every office route beginning with it, `/material` the
    // first of them.
    for (const path of ['/material', '/mitarbeiter/018f-abc', '/m-irgendwas']) {
      const answer = await request(application).get(path)

      expect([path, answer.text]).toEqual([path, expect.stringContaining('Büro')])
    }
  })

  it('answers a file that is not there with a 404 and not with a shell', async () => {
    // A name with an extension is a file, and no route of either entry ends
    // in one. Answered with a shell and a 200, a missing icon looks like one
    // that is there: the browser takes the HTML for the image and says
    // nothing. That is how the image of 0.1.0 shipped without its brand files
    // and nothing noticed (#213).
    for (const path of [
      '/brand/favicon.ico',
      '/brand/opengewerk-app-icon-192.png',
      '/manifest.webmanifest',
      '/m/manifest.webmanifest',
      '/assets/office-000000.js',
    ]) {
      const answer = await request(application).get(path)

      expect([path, answer.status]).toEqual([path, 404])
      expect(answer.text).not.toContain('Büro')
      expect(answer.text).not.toContain('Baustelle')
    }
  })

  it('still answers every path without an extension with the shell of its entry', async () => {
    // What a person opens is a screen: a route, a deep link, the link out of
    // an invitation or a password reset. Their last segment carries no dot,
    // and a dot further up does not make the path a file.
    const token = 'Ab3-dE_5'.repeat(5) + 'xyz'

    for (const [path, shell] of [
      ['/kunden/018f-abc', 'Büro'],
      ['/einstellungen/e-mail', 'Büro'],
      [`/einladung/${token}`, 'Büro'],
      [`/passwort/${token}`, 'Büro'],
      ['/v1.2/kunden', 'Büro'],
      ['/m/', 'Baustelle'],
      ['/m/auftraege/018f-abc/berichte/018f-def', 'Baustelle'],
    ] as const) {
      const answer = await request(application).get(path)

      expect([path, answer.status]).toEqual([path, 200])
      expect([path, answer.text]).toEqual([path, expect.stringContaining(shell)])
    }
  })

  it('still hands out a file that is there', async () => {
    const asset = await request(application).get('/assets/office-abc123.js').expect(200)

    expect(asset.text).toBe('console.log(1)')
  })

  it('never hands a shell to something the API owns', async () => {
    // Without this a mistyped API path comes back as HTML, and the failure
    // reads to a client like the server returning a document for JSON.
    expect((await request(application).get('/sync')).status).toBe(404)
    expect((await request(application).get('/api/auth/get-session')).status).toBe(404)
  })

  it('leaves a route the API really has alone', async () => {
    const answer = await request(application).get('/customers')

    expect(answer.status).toBe(200)
    expect(answer.body).toEqual([{ name: 'Meyer' }])
  })

  it('lets a hashed file be kept for a year and a shell for no time at all', async () => {
    const asset = await request(application).get('/assets/office-abc123.js')
    const shell = await request(application).get('/')

    // Every built file carries a hash in its name. The shells must not be
    // cached: they are what points at the hashed names, and a cached shell is
    // an installation that never updates.
    expect(asset.headers['cache-control']).toBe('public, max-age=31536000, immutable')
    expect(shell.headers['cache-control']).toBe('no-cache')
  })

  it('never lets the service worker be kept like a hashed file', async () => {
    const worker = await request(application).get('/service-worker.js')

    // It carries no hash and it is what decides which build a device runs. A
    // year of caching on this one file is an installation that keeps starting
    // the version it had the day somebody first opened it.
    expect(worker.headers['cache-control']).toBe('no-cache')
  })

  it('reads each shell once instead of touching the disk per request', async () => {
    // The fallback answers every address that is not the API's. A handler that
    // reached for the disk would turn a flood of requests for nonsense paths
    // into disk work, which is what CodeQL calls an unrated file system
    // access and what an operator would call a bad afternoon.
    //
    // On an interface of its own, because this takes a shell away from under
    // the server: every other test here asks for a complete build, and
    // `/index.html` would otherwise be a file that is not there.
    const own = express()
    const directory = builtInterface()

    serveInterface(own, directory)

    const first = await request(own).get('/')

    rmSync(join(directory, 'index.html'))

    const afterwards = await request(own).get('/kunden/018f-abc')

    expect(first.text).toContain('Büro')
    expect(afterwards.text).toBe(first.text)
  })

  it('never reaches a file outside the built interface', async () => {
    // Both spellings, because they take different paths through the stack:
    // the plain one is normalised away before anything sees it, the encoded
    // one reaches the static middleware as a name and has to be refused
    // there. Either way what comes back is a 404, never a file from the
    // machine the server runs on.
    for (const path of ['/../package.json', '/..%2f..%2fpackage.json']) {
      const answer = await request(application).get(path)

      expect([path, answer.status]).toEqual([path, 404])
      expect(answer.text).not.toContain('opengewerk')
      expect(answer.text).not.toContain('dependencies')
    }
  })
})

describe('the security headers (#131)', () => {
  /**
   * The shells are the documents script runs in, so they carry the policy,
   * both on the fallback that answers a navigation and on the file the
   * service worker keeps: offline, a navigation is answered from what it
   * kept, headers and all.
   */
  it('put the policy on both shells, however they are asked for', async () => {
    for (const path of [
      '/',
      '/auftraege/1',
      '/m',
      '/m/auftraege/1',
      '/index.html',
      '/m/index.html',
    ]) {
      const answer = await request(application).get(path).expect(200)

      expect([path, answer.headers['content-security-policy']]).toEqual([path, shellPolicy])
    }
  })

  it('allow nothing from elsewhere, no framing, no plugins and no inline script', () => {
    expect(shellPolicy).toContain("script-src 'self'")
    expect(shellPolicy).not.toContain('unsafe-inline')
    expect(shellPolicy).not.toContain('unsafe-eval')
    expect(shellPolicy).toContain("frame-ancestors 'none'")
    expect(shellPolicy).toContain("object-src 'none'")
    expect(shellPolicy).toContain("connect-src 'self'")
  })

  it('go on every answer, the API included, set in one place', async () => {
    const guarded = express()

    sendSecurityHeaders(guarded)
    guarded.get('/health', (_request, response) => {
      response.json({ status: 'ok' })
    })

    const answer = await request(guarded).get('/health').expect(200)

    expect(answer.headers).toMatchObject({
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'x-frame-options': 'DENY',
      'strict-transport-security': 'max-age=31536000',
      'cross-origin-opener-policy': 'same-origin',
      'cross-origin-resource-policy': 'same-origin',
    })
    // A policy for script is the shells' business, not an answer's with JSON.
    expect(answer.headers['content-security-policy']).toBeUndefined()
  })
})
