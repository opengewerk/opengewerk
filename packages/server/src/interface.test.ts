import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import express from 'express'
import type { Express } from 'express'
import request from 'supertest'
import { beforeAll, describe, expect, it } from 'vitest'

import { interfacePath, serveInterface } from './interface.js'

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
let served: string

beforeAll(() => {
  application = express()
  served = builtInterface()

  application.get('/customers', (_request, response) => {
    response.json([{ name: 'Meyer' }])
  })

  serveInterface(application, served)
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

  it('answers /m itself with the site shell', async () => {
    expect((await request(application).get('/m')).text).toContain('Baustelle')
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
    const first = await request(application).get('/')

    rmSync(join(served, 'index.html'))

    const afterwards = await request(application).get('/kunden/018f-abc')

    expect(first.text).toContain('Büro')
    expect(afterwards.text).toBe(first.text)
  })

  it('never reaches a file outside the built interface', async () => {
    // Both spellings, because they take different paths through the stack:
    // the plain one is normalised away before anything sees it, the encoded
    // one reaches the static middleware as a name and has to be refused
    // there. Either way what comes back is the shell, never a file from the
    // machine the server runs on.
    for (const path of ['/../package.json', '/..%2f..%2fpackage.json']) {
      const answer = await request(application).get(path)

      expect(answer.text).not.toContain('opengewerk')
      expect(answer.text).not.toContain('dependencies')
    }
  })
})
