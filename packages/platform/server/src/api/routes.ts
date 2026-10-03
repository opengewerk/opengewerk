import { RequestMethod } from '@nestjs/common'
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants'

import {
  OPERATOR_METADATA,
  PERMISSION_METADATA,
  PUBLIC_METADATA,
  SESSION_METADATA,
} from './authorization.js'

// Every route a module registers, with what it asks of whoever calls it. Not a
// list kept by hand: the controllers come out of the module itself, so a
// controller added later is included whether or not anybody remembers a test.
//
// It is part of the kit because the question is the same in every
// application: which route declares no right, and which answers without an
// identity. The first has to be none. The second an application holds as a
// list, so that adding one is a red test and therefore a decision.

const writingMethods = new Map<RequestMethod, string>([
  [RequestMethod.POST, 'POST'],
  [RequestMethod.PUT, 'PUT'],
  [RequestMethod.PATCH, 'PATCH'],
  [RequestMethod.DELETE, 'DELETE'],
])

/** One route, by method and path, and what stands in front of it. */
export interface Route {
  /** `POST /staff/:id`, the way a log line spells it. */
  readonly name: string
  readonly writes: boolean
  /** The right it declares, where it declares one. */
  readonly permission: string | undefined
  readonly isPublic: boolean
  readonly needsSessionOnly: boolean
  readonly needsOperator: boolean
}

/** The routes of these controllers, as a module lists them under `controllers`. */
export function routesOf(controllers: readonly unknown[]): Route[] {
  const routes: Route[] = []

  for (const controller of controllers) {
    const prototype = (controller as { prototype: Record<string, unknown> }).prototype
    const base = Reflect.getMetadata(PATH_METADATA, controller as object) as string

    for (const name of Object.getOwnPropertyNames(prototype)) {
      if (name === 'constructor') {
        continue
      }

      const handler = prototype[name]
      if (typeof handler !== 'function') {
        continue
      }

      const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined
      if (method === undefined) {
        continue
      }

      const path = Reflect.getMetadata(PATH_METADATA, handler) as string
      const verb = writingMethods.get(method)

      routes.push({
        name: `${verb ?? 'GET'} /${base}${path === '/' ? '' : `/${path}`}`,
        writes: verb !== undefined,
        permission: Reflect.getMetadata(PERMISSION_METADATA, handler) as string | undefined,
        isPublic: Reflect.getMetadata(PUBLIC_METADATA, handler) === true,
        needsSessionOnly: Reflect.getMetadata(SESSION_METADATA, handler) === true,
        needsOperator: Reflect.getMetadata(OPERATOR_METADATA, handler) === true,
      })
    }
  }

  return routes
}

/** The routes that say nothing about what they need, which the guard refuses. */
export function undeclared(routes: readonly Route[]): Route[] {
  return routes.filter(
    (route) =>
      route.permission === undefined &&
      !route.isPublic &&
      !route.needsSessionOnly &&
      !route.needsOperator,
  )
}

/**
 * The first segment of the path of a route, the part a shell is told apart by:
 * `staff` for `POST /staff/:id`.
 */
export function firstSegmentOf(route: Route): string {
  const path = route.name.slice(route.name.indexOf(' ') + 1)

  return path.split('/')[1] ?? ''
}

/**
 * The routes that lie under none of these first segments.
 *
 * The server, the service worker and the development server of an interface
 * each leave a list of paths to the server and answer every other one with a
 * shell (`foundationPaths`, and the list of the application). A route outside
 * the list is answered with HTML where a program expects JSON, so the list is
 * held against the routes, and against these and not a copy of them.
 */
export function outsideOf(paths: readonly string[], routes: readonly Route[]): Route[] {
  return routes.filter((route) => !paths.includes(firstSegmentOf(route)))
}
