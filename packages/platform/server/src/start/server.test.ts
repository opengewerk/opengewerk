import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { NestExpressApplication } from '@nestjs/platform-express'
import type { Request, Response } from 'express'
import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'

import { ClosedIdentitySource } from '../api/closed-identity.js'
import { ProbeModule } from '../authentication/probe-application.js'
import { Database } from '../database/database.js'
import { createServer } from './server.js'

// The server of an instance around the module of an application that belongs
// to nobody: what stands in front of its routes, in its order, and the
// interface beside them. No database is asked; the health check is the one
// route that would, and it is not what is looked at here.

const database = Database.connect('postgres://nobody:nobody@127.0.0.1:1/probe')
const module = ProbeModule.create(database, new ClosedIdentitySource())

let running: NestExpressApplication | null = null

afterEach(async () => {
  await running?.close()
  running = null
})

function builtInterface(): string {
  const directory = mkdtempSync(join(tmpdir(), 'server-'))

  mkdirSync(join(directory, 'm'))
  writeFileSync(join(directory, 'index.html'), '<!doctype html><title>Schreibtisch</title>')
  writeFileSync(join(directory, 'm', 'index.html'), '<!doctype html><title>Unterwegs</title>')

  return directory
}

/** A stand-in for the authentication that says what body it was handed. */
function echoingAuthentication(): (request: Request, response: Response) => void {
  return (incoming, response) => {
    let body = ''

    incoming.setEncoding('utf8')
    incoming.on('data', (chunk: string) => {
      body += chunk
    })
    incoming.on('end', () => {
      response.json({ path: incoming.url, body, parsed: incoming.body !== undefined })
    })
  }
}

async function started(
  parts: Parameters<typeof createServer>[1],
): Promise<{ app: NestExpressApplication; interfaceDirectory: string | null }> {
  const { application, interfaceDirectory } = await createServer(module, parts)

  await application.init()
  running = application

  return { app: application, interfaceDirectory }
}

describe('the server of an instance', () => {
  it('sends the security headers on every answer, and does not say what serves it', async () => {
    const { app } = await started({ authenticationHandler: null, serverPaths: [] })
    const answer = await request(app.getHttpServer()).get('/probe/members')

    expect(answer.status).toBe(401)
    expect(answer.headers['x-content-type-options']).toBe('nosniff')
    expect(answer.headers['x-frame-options']).toBe('DENY')
    expect(answer.headers['x-powered-by']).toBeUndefined()
  })

  it('hands the authentication its body unread, in front of the parser', async () => {
    const { app } = await started({
      authenticationHandler: echoingAuthentication(),
      serverPaths: [],
      interfaceDirectory: null,
    })
    const answer = await request(app.getHttpServer())
      .post('/api/auth/sign-in/email')
      .set('Content-Type', 'application/json')
      .send('{"email":"leitung@probe.example.org"}')
      .expect(200)

    expect(answer.body).toEqual({
      path: '/sign-in/email',
      body: '{"email":"leitung@probe.example.org"}',
      parsed: false,
    })
  })

  it('has no authentication at all where none is handed in, as on a closed instance', async () => {
    const { app } = await started({
      authenticationHandler: null,
      serverPaths: [],
      interfaceDirectory: null,
    })

    expect(
      (await request(app.getHttpServer()).post('/api/auth/sign-in/email').send({})).status,
    ).toBe(404)
  })

  it('serves the interface it is given, with a shell for a page and none for a path of the server', async () => {
    const directory = builtInterface()
    const { app, interfaceDirectory } = await started({
      authenticationHandler: null,
      serverPaths: ['probe'],
      interfaceDirectory: directory,
    })

    expect(interfaceDirectory).toBe(directory)
    expect((await request(app.getHttpServer()).get('/regale/1')).text).toContain('Schreibtisch')
    expect((await request(app.getHttpServer()).get('/m/regale/1')).text).toContain('Unterwegs')
    expect((await request(app.getHttpServer()).get('/probe/members')).status).toBe(401)
    expect((await request(app.getHttpServer()).get('/staff')).status).toBe(401)
  })

  it('answers its API alone where there is no interface, and says so', async () => {
    const { app, interfaceDirectory } = await started({
      authenticationHandler: null,
      serverPaths: ['probe'],
      interfaceDirectory: null,
    })

    expect(interfaceDirectory).toBeNull()
    expect((await request(app.getHttpServer()).get('/regale/1')).status).toBe(404)
  })

  it('looks for the interface where an image and a checkout keep it when it is not told', async () => {
    // Neither place exists next to the package of the foundation.
    const { interfaceDirectory } = await started({ authenticationHandler: null, serverPaths: [] })

    expect(interfaceDirectory).toBeNull()
  })
})
