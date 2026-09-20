import { RequestMethod } from '@nestjs/common'
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants'
import type { Permission } from '@opengewerk/domain'
import { describe, expect, it } from 'vitest'

import { authenticationPath, createAuthentication } from '../authentication/authentication.js'
import { Database } from '../database/database.js'
import { ApiModule } from './api.module.js'
import { PERMISSION_METADATA, PUBLIC_METADATA, SESSION_METADATA } from './authorization.js'
import { noIdentities } from './test-identity.js'

/**
 * Walks every route the module registers and reports the ones that declare no
 * right. Not a list kept by hand: the controllers come out of the module
 * itself, so a controller added later is included whether or not anybody
 * remembers this file.
 */

const writingMethods = new Map<RequestMethod, string>([
  [RequestMethod.POST, 'POST'],
  [RequestMethod.PUT, 'PUT'],
  [RequestMethod.PATCH, 'PATCH'],
  [RequestMethod.DELETE, 'DELETE'],
])

interface Route {
  readonly name: string
  readonly writes: boolean
  readonly permission: Permission | undefined
  readonly isPublic: boolean
  readonly needsSessionOnly: boolean
}

function routesOf(controllers: readonly unknown[]): Route[] {
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
        permission: Reflect.getMetadata(PERMISSION_METADATA, handler) as Permission | undefined,
        isPublic: Reflect.getMetadata(PUBLIC_METADATA, handler) === true,
        needsSessionOnly: Reflect.getMetadata(SESSION_METADATA, handler) === true,
      })
    }
  }

  return routes
}

const database = Database.connect('postgres://unused')

/**
 * Built, not connected. `createAuthentication` reads its configuration and
 * hands back a handle; nothing here calls it, and nothing in this file touches
 * the database either. It is needed because the first run setup is registered
 * only on an open instance, and a module built without it would walk a
 * routing table that is missing exactly the two routes worth looking at.
 */
const authentication = createAuthentication({
  database,
  secret: 'x'.repeat(64),
  trustedOrigins: ['https://opengewerk.example.de'],
})

const controllers = ApiModule.create(database, noIdentities, { authentication }).controllers ?? []

/** The same module on a closed instance, where the setup is left out. */
const whenClosed = ApiModule.create(database, noIdentities).controllers ?? []

describe('every route', () => {
  it('is registered in the first place', () => {
    // Without this the checks below would pass on an empty list, and an empty
    // list is the one result that proves nothing.
    const routes = routesOf(controllers)

    expect(routes.length).toBeGreaterThanOrEqual(10)
    expect(routes.filter((route) => route.writes).length).toBeGreaterThanOrEqual(5)
  })

  it('declares the right it needs, writing ones above all', () => {
    const undeclared = routesOf(controllers)
      .filter(
        (route) => route.permission === undefined && !route.isPublic && !route.needsSessionOnly,
      )
      .map((route) => route.name)

    expect(undeclared).toEqual([])
  })

  /**
   * The exception to the rule above, held as a list on purpose. A route
   * without a right is refused, a public one is not, so the second kind is
   * the one worth counting: adding one turns this test red, which makes it a
   * decision instead of a line in a diff nobody looked at twice.
   */
  it('that answers without an identity is the health check or the first run setup', () => {
    const publicRoutes = routesOf(controllers)
      .filter((route) => route.isPublic)
      .map((route) => route.name)
      .sort()

    expect(publicRoutes).toEqual(['GET /health', 'GET /setup', 'POST /setup'])
  })

  /**
   * The one public route that writes, and the list is held by hand for the
   * same reason as the one above.
   *
   * It has to be public: it creates the first account on the instance, so
   * there is nobody to authenticate at the moment it runs, and that is the
   * whole problem it exists to solve. What stands in for authentication is the
   * state of the data. `create_first_tenant` refuses unless the instance is
   * empty, under a lock rather than after a look, so the route answers exactly
   * once in the life of an installation.
   *
   * A second entry here would be a public route that writes for some other
   * reason, and there is no other reason.
   */
  it('that answers without an identity writes only where there is nobody to ask yet', () => {
    const writingAndPublic = routesOf(controllers)
      .filter((route) => route.isPublic && route.writes)
      .map((route) => route.name)

    expect(writingAndPublic).toEqual(['POST /setup'])
  })

  /**
   * `CLOSED=true` hands no authentication to the module, and without one the
   * setup controller is not registered at all. Checked on the routing table
   * rather than on a response, because "the route is not there" and "the route
   * is there and refuses" are two different promises and this is the stronger
   * one.
   */
  it('of the first run setup does not exist on a closed instance', () => {
    const names = routesOf(whenClosed).map((route) => route.name)

    expect(names).not.toContain('GET /setup')
    expect(names).not.toContain('POST /setup')
    expect(names).toContain('GET /health')
  })

  /**
   * The third kind, and held as a list for the same reason as the second.
   *
   * These need somebody signed in but no business, so they cannot ask for a
   * right: a right comes from a membership and a membership is per business,
   * which is exactly what has not been decided yet at this point. All four are
   * about that moment and nothing else. A fifth one turns this red, and it
   * should, because the next route that "only needs a session" is far more
   * likely to be one that forgot to say which business it means.
   */
  it('that needs a session but no business is one of the four around signing in', () => {
    const sessionOnly = routesOf(controllers)
      .filter((route) => route.needsSessionOnly)
      .map((route) => route.name)
      .sort()

    expect(sessionOnly).toEqual([
      'DELETE /auth/devices/:sessionId',
      'GET /auth/devices',
      'GET /auth/tenants',
      'POST /auth/sign-out',
      'POST /auth/tenant',
    ])
  })

  /**
   * better-auth's own routes are mounted as middleware, in front of Nest and
   * outside the guard, because a route that hands out a session cannot ask for
   * one. That is defensible exactly as long as nothing of ours shares the
   * prefix: a controller under it would be outside the guard without anybody
   * meaning it to, and no other test here would notice.
   */
  it('of ours never lives under the path the authentication handler is mounted on', () => {
    const underneath = routesOf(controllers)
      .map((route) => route.name)
      .filter((name) => name.includes(` ${authenticationPath}`))

    expect(underneath).toEqual([])
  })

  it('that issues a document asks for the right to issue, not the right to write', () => {
    const issuing = routesOf(controllers).find((route) => route.name.endsWith('/issue'))

    expect(issuing?.permission).toBe('document.issue')
  })

  it('that creates a customer asks for the right to create, not the right to write', () => {
    // The same shape as the line above, for the second place where one
    // subject has two writing rights. It also fixes the reason the audit log
    // records: the guard takes it from the route, so a customer that appears
    // out of nowhere says so in the log rather than looking like an edit.
    const byName = new Map(routesOf(controllers).map((route) => [route.name, route.permission]))

    expect(byName.get('POST /customers')).toBe('customer.create')
    expect(byName.get('PATCH /customers/:id')).toBe('customer.write')
    expect(byName.get('DELETE /customers/:id')).toBe('customer.write')
  })
})
