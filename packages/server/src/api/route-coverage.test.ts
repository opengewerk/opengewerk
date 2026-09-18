import { RequestMethod } from '@nestjs/common'
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants'
import type { Permission } from '@opengewerk/domain'
import { describe, expect, it } from 'vitest'

import { Database } from '../database/database.js'
import { ApiModule } from './api.module.js'
import { PERMISSION_METADATA } from './authorization.js'
import type { IdentitySource } from './identity.js'

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
      })
    }
  }

  return routes
}

const identities: IdentitySource = { identify: async () => null }
const controllers =
  ApiModule.create(Database.connect('postgres://unused'), identities).controllers ?? []

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
      .filter((route) => route.permission === undefined)
      .map((route) => route.name)

    expect(undeclared).toEqual([])
  })

  it('that issues a document asks for the right to issue, not the right to write', () => {
    const issuing = routesOf(controllers).find((route) => route.name.endsWith('/issue'))

    expect(issuing?.permission).toBe('document.issue')
  })
})
