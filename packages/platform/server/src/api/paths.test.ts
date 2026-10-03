import { foundationPaths } from '@opengewerk/platform-domain'
import { describe, expect, it } from 'vitest'

import { type Authentication, authenticationPath } from '../authentication/authentication.js'
import { authenticationParts } from '../authentication/module.js'
import { probeAccess } from '../authentication/probe-application.js'
import { firstSegmentOf, outsideOf, routesOf } from './routes.js'

// The paths the foundation leaves to its server, held against its routes. A
// shell answers every other path, on the server and in the service worker,
// so a route outside the list would answer a program with HTML.

/**
 * Every controller the foundation hands an application, those of an open
 * instance included: only whether a handle is handed in decides which they
 * are, and nothing here calls it.
 */
const controllers = authenticationParts({
  access: probeAccess,
  authentication: {} as Authentication,
}).controllers

const routes = routesOf(controllers)

describe('the paths of the foundation', () => {
  it('are looked for in the routes of every controller it hands an application', () => {
    // An empty walk would find no route outside the list either.
    expect(routes.length).toBeGreaterThanOrEqual(20)
    expect(routes.map((route) => route.name)).toContain('POST /setup')
    expect(routes.map((route) => route.name)).toContain('GET /instance/tenants')
  })

  it('hold every route of the foundation', () => {
    expect(outsideOf(foundationPaths, routes).map((route) => route.name)).toEqual([])
  })

  it('hold the authentication itself, which is mounted beside the controllers', () => {
    expect(foundationPaths).toContain(authenticationPath.split('/')[1])
  })

  it('hold nothing that no route answers', () => {
    const answered = new Set([
      ...routes.map(firstSegmentOf),
      authenticationPath.split('/')[1] ?? '',
    ])

    expect(foundationPaths.filter((path) => !answered.has(path))).toEqual([])
  })

  it('are told apart by the first segment of a route, and only by it', () => {
    const route = routes.find((each) => each.name.startsWith('DELETE /staff/'))

    expect(route && firstSegmentOf(route)).toBe('staff')
    expect(outsideOf(['staf'], route ? [route] : [])).toHaveLength(1)
    expect(outsideOf(['staff'], route ? [route] : [])).toEqual([])
  })
})
