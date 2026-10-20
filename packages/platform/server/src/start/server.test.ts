import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Controller, type DynamicModule, Get, Header, Module, Post, Req } from '@nestjs/common'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { toNodeHandler } from 'better-auth/node'
import type { Request, RequestHandler } from 'express'
import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'

import { PublicRoute } from '../api/authorization.js'
import { ClosedIdentitySource } from '../api/closed-identity.js'
import { AcceptsBody } from '../api/origin.js'
import { sentByHand } from '../api/probe-sending.js'
import { ProbeModule } from '../authentication/probe-application.js'
import { Database } from '../database/database.js'
import { createServer, largestAuthenticationBodyBytes } from './server.js'

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
  mkdirSync(join(directory, 'assets'))
  writeFileSync(join(directory, 'index.html'), '<!doctype html><title>Schreibtisch</title>')
  writeFileSync(join(directory, 'm', 'index.html'), '<!doctype html><title>Unterwegs</title>')
  writeFileSync(join(directory, 'assets', 'office-abc123.js'), 'console.log(1)')
  writeFileSync(join(directory, 'service-worker.js'), 'self.addEventListener("fetch", () => {})')
  writeFileSync(join(directory, 'manifest.webmanifest'), '{"name":"Probe"}')

  return directory
}

/**
 * A stand-in for the authentication behind better-auth's own adapter for
 * Node, so that what it says it was handed is what better-auth would read:
 * its path and its body, as text. It counts how often it was asked.
 */
function echoingAuthentication(): { readonly handler: RequestHandler; asked(): number } {
  let asked = 0
  const handler = toNodeHandler(async (incoming: globalThis.Request) => {
    asked += 1

    return Response.json({ path: new URL(incoming.url).pathname, body: await incoming.text() })
  }) as RequestHandler

  return { handler, asked: () => asked }
}

const signIn = '/api/auth/sign-in/email'

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
  outbox(@Req() incoming: Request): { read: boolean } {
    return { read: incoming.body !== undefined }
  }

  /** What a list of people looks like to a browser, without a session to ask for. */
  @Get('echo/people')
  @PublicRoute()
  people(): readonly { name: string; email: string }[] {
    return [{ name: 'Probe Leitung', email: 'leitung@example.org' }]
  }

  /** A route that says itself what a browser may keep of it. */
  @Get('echo/own')
  @PublicRoute()
  @Header('Cache-Control', 'private, no-store')
  own(): { name: string } {
    return { name: 'Probe Leitung' }
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

  it('hands the authentication every body as it was sent, read in front of it up to a limit', async () => {
    const authentication = echoingAuthentication()
    const { app } = await started({
      authenticationHandler: authentication.handler,
      serverPaths: [],
      interfaceDirectory: null,
    })
    const sent = '{"email":"leitung@probe.example.org","name":"Jürgen Weiß"}'
    const answer = await request(app.getHttpServer())
      .post(signIn)
      .set('Content-Type', 'application/json')
      .send(sent)
      .expect(200)

    expect(answer.body).toEqual({ path: signIn, body: sent })

    // Without a length as well, the way a proxy may pass a body on.
    const unannounced = await sentByHand(
      app.getHttpServer(),
      signIn,
      { 'content-type': 'application/json' },
      [sent.slice(0, 20), sent.slice(20)],
      true,
    )

    expect(unannounced?.status).toBe(200)
    expect(JSON.parse(unannounced?.text ?? 'null')).toEqual({ path: signIn, body: sent })

    // And up to the limit itself, to the byte.
    const largest = JSON.stringify({ token: 'x'.repeat(largestAuthenticationBodyBytes - 12) })

    expect(Buffer.byteLength(largest)).toBe(largestAuthenticationBodyBytes)
    expect(
      (
        await request(app.getHttpServer())
          .post(signIn)
          .set('Content-Type', 'application/json')
          .send(largest)
          .expect(200)
      ).body,
    ).toEqual({ path: signIn, body: largest })
    expect(authentication.asked()).toBe(3)
  })

  /**
   * Its handler would read any body whole before anybody is known. A body
   * over the limit is answered in front of it and goes nowhere: one whose
   * length says so before a byte of it is read, one without a length once it
   * runs over, while the sender is still sending.
   */
  it('refuses a body over the limit of the authentication, announced or counted, and hands it to nobody', async () => {
    const authentication = echoingAuthentication()
    const { app } = await started({
      authenticationHandler: authentication.handler,
      serverPaths: [],
      interfaceDirectory: null,
    })
    const refusal = 'Diese Anfrage ist zu groß für die Anmeldung.'
    const tooLarge = await request(app.getHttpServer())
      .post(signIn)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ token: 'x'.repeat(largestAuthenticationBodyBytes) }))

    expect(tooLarge.status).toBe(413)
    expect(tooLarge.body).toEqual({ statusCode: 413, message: refusal })

    // Ten megabytes announced, ten bytes sent: the answer does not wait for the rest.
    const announced = await sentByHand(
      app.getHttpServer(),
      signIn,
      { 'content-type': 'application/json', 'content-length': String(10 * 1024 * 1024) },
      ['{"email":"'],
      false,
    )

    expect(announced?.status).toBe(413)

    // No length, and a sender that does not stop: refused once it runs over.
    const counted = await sentByHand(
      app.getHttpServer(),
      signIn,
      { 'content-type': 'application/json' },
      Array.from({ length: 64 }, () => 'x'.repeat(16 * 1024)),
      false,
    )

    expect(counted?.status).toBe(413)
    expect(JSON.parse(counted?.text ?? 'null')).toEqual({ statusCode: 413, message: refusal })
    expect(authentication.asked()).toBe(0)
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
      authenticationHandler: echoingAuthentication().handler,
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

  /**
   * The outbox is the one JSON body its route reads itself, after the guards
   * and with a limit of its own (the tests of the sync hold both). In front of
   * the routes it is passed by unread; every other body is read there, up to
   * the 100 kB of a form.
   */
  it('leaves the outbox of a device to its route unread, and reads every other body up to that of a form', async () => {
    const { app } = await started(
      { authenticationHandler: null, serverPaths: [], interfaceDirectory: null },
      EchoModule.around(module),
    )
    const server = app.getHttpServer()
    // Twice what every other route reads.
    const large = { text: 'x'.repeat(200 * 1024) }

    expect((await request(server).post('/sync').send(large).expect(201)).body).toEqual({
      read: false,
    })
    await request(server).post('/echo/json').send(large).expect(413)
    // Only where the outbox goes, and only the way it is sent there.
    await request(server).put('/sync').send(large).expect(413)
    await request(server).post('/sync/conflicts').send(large).expect(413)
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

/**
 * What a browser may keep of an answer (opengewerk-haustechnik#360). Signing
 * out empties the stores of the device and cannot reach the HTTP cache of the
 * browser, so nothing private may go there: `no-store` is what every answer
 * starts with. The built files of the interface are the same for everybody
 * and keep what they had, as does a route that says itself.
 */
describe('the cache of a browser', () => {
  async function instance() {
    const { app } = await started(
      {
        authenticationHandler: echoingAuthentication().handler,
        serverPaths: ['probe', 'echo'],
        interfaceDirectory: builtInterface(),
      },
      EchoModule.around(module),
    )

    return app.getHttpServer()
  }

  it('keeps no answer of the API or of the authentication, a refusal included', async () => {
    const server = await instance()
    const answers = {
      people: await request(server).get('/echo/people').expect(200),
      refused: await request(server).get('/probe/members').expect(401),
      unknown: await request(server).get('/echo/nothing').expect(404),
      session: await request(server)
        .post('/api/auth/sign-in/email')
        .set('Content-Type', 'application/json')
        .send('{}')
        .expect(200),
    }

    expect(answers.people.text).toContain('Probe Leitung')
    expect(
      Object.fromEntries(
        Object.entries(answers).map(([name, answer]) => [name, answer.headers['cache-control']]),
      ),
    ).toEqual({ people: 'no-store', refused: 'no-store', unknown: 'no-store', session: 'no-store' })
  })

  it('leaves the built files of the interface and a route that says itself what they have', async () => {
    const server = await instance()
    const kept = async (path: string) =>
      (await request(server).get(path).expect(200)).headers['cache-control']

    expect({
      asset: await kept('/assets/office-abc123.js'),
      office: await kept('/'),
      site: await kept('/m/regale/1'),
      shell: await kept('/index.html'),
      worker: await kept('/service-worker.js'),
      manifest: await kept('/manifest.webmanifest'),
      own: await kept('/echo/own'),
    }).toEqual({
      asset: 'public, max-age=31536000, immutable',
      office: 'no-cache',
      site: 'no-cache',
      shell: 'no-cache',
      worker: 'no-cache',
      manifest: 'no-cache',
      own: 'private, no-store',
    })
  })
})
