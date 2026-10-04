import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Controller, type DynamicModule, Module, Post, Req } from '@nestjs/common'
import type { NestExpressApplication } from '@nestjs/platform-express'
import type { Request, Response } from 'express'
import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'

import { PublicRoute } from '../api/authorization.js'
import { ClosedIdentitySource } from '../api/closed-identity.js'
import { AcceptsBody, largestTransmissionBytes } from '../api/origin.js'
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

/**
 * Routes that say what the server made of a body before they saw it: one that
 * takes JSON like every route, one that lets a form past the guard, so that
 * what a parser did with it shows, and the place a device sends its outbox to.
 */
@Controller()
class EchoController {
  @Post('echo/json')
  @PublicRoute()
  json(@Req() incoming: Request): { body: unknown } {
    return { body: (incoming.body as unknown) ?? null }
  }

  @Post('echo/form')
  @PublicRoute()
  @AcceptsBody(['application/x-www-form-urlencoded'], 'Nur zur Probe.')
  form(@Req() incoming: Request): { body: unknown } {
    return { body: (incoming.body as unknown) ?? null }
  }

  @Post('sync')
  @PublicRoute()
  outbox(@Req() incoming: Request): { characters: number } {
    return { characters: JSON.stringify(incoming.body).length }
  }
}

/** The module of an application with those routes beside its own. */
@Module({})
class EchoModule {
  static around(application: DynamicModule): DynamicModule {
    return { module: EchoModule, imports: [application], controllers: [EchoController] }
  }
}

async function started(
  parts: Parameters<typeof createServer>[1],
  of: DynamicModule = module,
): Promise<{ app: NestExpressApplication; interfaceDirectory: string | null }> {
  const { application, interfaceDirectory } = await createServer(of, parts)

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

  /**
   * The order createServer promises, held on each of its steps
   * (opengewerk-haustechnik#31): the headers stand in front of the
   * authentication, which is mounted in front of everything Nest knows of, so
   * headers set after it would be missing on exactly the answers that hand
   * out a session.
   */
  it('sends the security headers on the answers of the authentication as well', async () => {
    const { app } = await started({
      authenticationHandler: echoingAuthentication(),
      serverPaths: [],
      interfaceDirectory: null,
    })
    const answer = await request(app.getHttpServer())
      .post('/api/auth/sign-in/email')
      .set('Content-Type', 'application/json')
      .send('{}')
      .expect(200)

    expect(answer.headers['x-content-type-options']).toBe('nosniff')
    expect(answer.headers['x-frame-options']).toBe('DENY')
    expect(answer.headers['x-powered-by']).toBeUndefined()
  })

  it('reads a body of JSON for a route, and no form: not even where a route would take one', async () => {
    const { app } = await started(
      { authenticationHandler: null, serverPaths: [], interfaceDirectory: null },
      EchoModule.around(module),
    )
    const server = app.getHttpServer()

    expect(
      (await request(server).post('/echo/json').send({ name: 'Regal 1' }).expect(201)).body,
    ).toEqual({ body: { name: 'Regal 1' } })

    // A form is turned away by the guard at every route that does not ask for one.
    const refused = await request(server).post('/echo/json').type('form').send({ name: 'Regal 1' })

    expect(refused.status).toBe(415)
    expect(refused.body.message).toBe('Diese Anfrage wird nur als JSON angenommen.')

    // Let past the guard, it arrives unread: there is no parser for it.
    expect(
      (await request(server).post('/echo/form').type('form').send({ name: 'Regal 1' }).expect(201))
        .body,
    ).toEqual({ body: null })
  })

  it('takes the outbox of a device up to a limit of its own, and every other body up to that of a form', async () => {
    const { app } = await started(
      { authenticationHandler: null, serverPaths: [], interfaceDirectory: null },
      EchoModule.around(module),
    )
    const server = app.getHttpServer()
    // Twice what every other route reads.
    const large = { text: 'x'.repeat(200 * 1024) }

    expect(
      (await request(server).post('/sync').send(large).expect(201)).body.characters,
    ).toBeGreaterThan(200 * 1024)
    await request(server).post('/echo/json').send(large).expect(413)
    // Only where the outbox goes, and only the way it is sent there.
    await request(server).put('/sync').send(large).expect(413)
    await request(server).post('/sync/conflicts').send(large).expect(413)
    // And not without a limit there either.
    await request(server)
      .post('/sync')
      .send({ text: 'x'.repeat(largestTransmissionBytes) })
      .expect(413)
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
