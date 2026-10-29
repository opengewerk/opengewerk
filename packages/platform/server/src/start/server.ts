import type { DynamicModule, INestApplication } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { toNodeHandler } from 'better-auth/node'
import type { RequestHandler } from 'express'

import { bodiesUpTo } from '../api/body-bytes.js'
import { nameTheClient } from '../api/client-address.js'
import { readJsonBodiesOnly } from '../api/origin.js'
import { sendSecurityHeaders } from '../api/security-headers.js'
import { type Authentication, authenticationPath } from '../authentication/authentication.js'
import { interfacePath, serveInterface } from './shells.js'

/** What a server is put together from, beside the module of the application. */
export interface ServerParts {
  /**
   * What answers under the path of the authentication: better-auth on an
   * instance (`authenticationHandler`), a stand-in in a preview, nothing on a
   * closed instance, where the sign in does not exist.
   */
  readonly authenticationHandler: RequestHandler | null
  /**
   * The first segments of the paths the server of the application answers
   * itself, beside those of the foundation; a shell is never handed back for
   * one of them.
   */
  readonly serverPaths: readonly string[]
  /**
   * Where the built interface lies. Left out, it is looked for where an image
   * and a checkout keep it (`interfacePath`); null serves the API alone.
   */
  readonly interfaceDirectory?: string | null
}

export interface Server {
  readonly application: NestExpressApplication
  /** Where the interface came from, or null where the server answers its API alone. */
  readonly interfaceDirectory: string | null
}

/**
 * better-auth as the handler of the authentication, for an instance that is
 * open, and for the paths it has a route for alone.
 *
 * Its rate limits count by the address and the whole path, in a row each,
 * before its router finds that a path has no route: every made-up path under
 * the authentication was a new row in the database, from anybody, without a
 * session. A path no route answers is answered here, before it gets there.
 */
export function authenticationHandler(authentication: Authentication): RequestHandler {
  const handle = toNodeHandler(authentication) as RequestHandler

  return (request, response, next) => {
    if (!authentication.routes.some((route) => route.test(request.path))) {
      response
        .status(404)
        .json({ statusCode: 404, message: 'Diesen Weg der Anmeldung gibt es nicht.' })

      return
    }

    handle(request, response, next)
  }
}

/**
 * The most a body sent to the authentication may be, in bytes.
 *
 * Its handler reads a body whole, with no limit of its own, and before
 * anybody is known: these are the routes that sign in. What they are sent is
 * an address and a password, a code, a token, and at the most the answer of a
 * passkey to its registration, which asks for no attestation and so stays at
 * a few kilobytes. Sixty-four kilobytes are far above all of it, and nothing
 * larger goes into memory.
 */
export const largestAuthenticationBodyBytes = 64 * 1024

const authenticationBodyTooLarge = 'Diese Anfrage ist zu groß für die Anmeldung.'

/**
 * Mounts the handler of the authentication under its path, behind the limit
 * of its bodies (`bodiesUpTo`) and with the address of the client as this
 * instance determines it (`nameTheClient`), which its limits count by. An
 * instance does it in `createServer`; a test that puts the authentication in
 * front of a module of its own does it here, so that it signs in through the
 * same reading of a body and of an address as an instance.
 */
export function mountAuthentication(application: INestApplication, handler: RequestHandler): void {
  application.use(
    authenticationPath,
    nameTheClient,
    bodiesUpTo(largestAuthenticationBodyBytes, authenticationBodyTooLarge),
    handler,
  )
}

/**
 * The HTTP server of an instance: the module of the application, and what
 * stands in front of its routes in every application of the organisation
 * (ADR 0010), in the order that is part of the matter.
 *
 * The security headers first, so that every answer carries them, those of the
 * authentication included. The authentication before the body parser, and
 * that order is not a preference: Express reads the stream once, and a parser
 * in front would hand better-auth a body it had made something else of. Its
 * bodies are read in front of it up to a limit of their own and handed to it
 * as text, exactly as they were sent (`mountAuthentication`). Its routes are
 * mounted in front of Nest and outside the guard because a route that hands
 * out a session cannot ask for one; what protects them is their own layer,
 * the limit of a body, the rate limits and the origin check. Then JSON and
 * nothing else as a body, and no header telling every caller which framework
 * serves it. The interface last: its fallback leaves every path of the server
 * to the routes of the application and answers the rest with the shell of its
 * entry.
 *
 * No parser of Nest's own, and a log of warnings and errors only: the log of a
 * container is the only one there is, and the route table of every start
 * buries the line that matters.
 */
export async function createServer(module: DynamicModule, parts: ServerParts): Promise<Server> {
  const application = await NestFactory.create<NestExpressApplication>(module, {
    logger: ['error', 'warn'],
    bodyParser: false,
  })
  const express = application.getHttpAdapter().getInstance()

  sendSecurityHeaders(express)

  if (parts.authenticationHandler) {
    mountAuthentication(application, parts.authenticationHandler)
  }

  readJsonBodiesOnly(application)
  express.disable('x-powered-by')

  const directory =
    parts.interfaceDirectory === undefined ? interfacePath() : parts.interfaceDirectory

  if (directory) {
    serveInterface(express, directory, parts.serverPaths)
  }

  return { application, interfaceDirectory: directory }
}
