import type { DynamicModule } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { toNodeHandler } from 'better-auth/node'
import type { RequestHandler } from 'express'

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

/** better-auth as the handler of the authentication, for an instance that is open. */
export function authenticationHandler(authentication: Authentication): RequestHandler {
  return toNodeHandler(authentication) as RequestHandler
}

/**
 * The HTTP server of an instance: the module of the application, and what
 * stands in front of its routes in every application of the organisation
 * (ADR 0010), in the order that is part of the matter.
 *
 * The security headers first, so that every answer carries them, those of the
 * authentication included. The authentication before the body parser, and
 * that order is not a preference: Express reads the stream once, and a parser
 * in front would leave better-auth an empty body on every sign in, which looks
 * like a wrong password. Its routes are mounted in front of Nest and outside
 * the guard because a route that hands out a session cannot ask for one; what
 * protects them is their own layer, the rate limits and the origin check.
 * Then JSON and nothing else as a body, and no header telling every caller
 * which framework serves it. The interface last: its fallback leaves every
 * path of the server to the routes of the application and answers the rest
 * with the shell of its entry.
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
    application.use(authenticationPath, parts.authenticationHandler)
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
