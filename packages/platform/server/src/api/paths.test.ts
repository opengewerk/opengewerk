import { auditRights, foundationPaths, rightsCatalogue } from '@opengewerk/platform-domain'
import { probeAuditVocabulary } from '@opengewerk/platform-domain/testing'
import { describe, expect, it } from 'vitest'

import { auditLogParts } from '../audit/controller.js'
import { backupStatusParts } from '../backup/controller.js'
import { type Authentication, authenticationPath } from '../authentication/authentication.js'
import { authenticationParts } from '../authentication/module.js'
import { probeAccess, probeCatalogue } from '../authentication/probe-application.js'
import { type DeadlineRules, deadlineParts } from '../deadlines/deadlines.controller.js'
import { fileParts } from '../files/controller.js'
import type { MailServers } from '../mail/server-settings.js'
import { mailSettingsParts } from '../mail/settings.controller.js'
import { pushParts, type PushRules } from '../push/push.controller.js'
import { serverSync } from '../sync/apply.js'
import { syncParts } from '../sync/controller.js'
import {
  letterLines,
  letters,
  notes,
  probeSyncAccess,
  probeSyncRoutes,
  probeSyncRules,
  shelves,
} from '../sync/probe-sync.js'
import { syncTables } from '../sync/tables.js'
import { HealthController } from './health.controller.js'
import { firstSegmentOf, outsideOf, routesOf } from './routes.js'

// The paths the foundation leaves to its server, held against its routes. A
// shell answers every other path, on the server and in the service worker,
// so a route outside the list would answer a program with HTML.

/**
 * Every controller the foundation hands an application, those of an open
 * instance included: only whether a handle is handed in decides which they
 * are, and nothing here calls it. The health check beside them, which an
 * application lists in its module itself, the change log, the file store and
 * the last backup, the mail server, push and the deadlines, and the sync,
 * which an application whose devices work without a network registers. The
 * rules of an application are no business of a route's path, so they are
 * empty here.
 */
const controllers = [
  HealthController,
  ...authenticationParts({
    access: probeAccess,
    authentication: {} as Authentication,
  }).controllers,
  ...syncParts({
    access: probeSyncAccess,
    routes: probeSyncRoutes(
      serverSync({
        rules: probeSyncRules,
        tables: syncTables({ shelves, notes, letters, letterLines }),
      }),
    ),
  }).controllers,
  ...auditLogParts({
    access: { catalogue: rightsCatalogue([...probeCatalogue.rights, auditRights.read]) },
    vocabulary: probeAuditVocabulary,
  }).controllers,
  ...fileParts({ access: probeAccess, upload: 'notes.write' }).controllers,
  ...backupStatusParts({ access: probeAccess, read: 'members.read', directory: null }).controllers,
  ...mailSettingsParts({
    access: probeAccess,
    rights: { status: 'members.read', read: 'members.read', write: 'membership.write' },
    servers: {} as MailServers,
  }).controllers,
  ...pushParts({ access: probeAccess, rights: { write: 'notes.write' }, rules: {} as PushRules })
    .controllers,
  ...deadlineParts({
    access: probeAccess,
    rights: {
      read: 'members.read',
      write: 'notes.write',
      settingsRead: 'members.read',
      settingsWrite: 'membership.write',
    },
    rules: {} as DeadlineRules,
  }).controllers,
]

const routes = routesOf(controllers)

describe('the paths of the foundation', () => {
  it('are looked for in the routes of every controller it hands an application', () => {
    // An empty walk would find no route outside the list either.
    expect(routes.length).toBeGreaterThanOrEqual(20)
    expect(routes.map((route) => route.name)).toContain('POST /setup')
    expect(routes.map((route) => route.name)).toContain('GET /instance/tenants')
    expect(routes.map((route) => route.name)).toContain('GET /health')
    expect(routes.map((route) => route.name)).toContain('POST /sync')
    expect(routes.map((route) => route.name)).toContain('GET /audit/changes')
    expect(routes.map((route) => route.name)).toContain('PUT /files/:sha256')
    expect(routes.map((route) => route.name)).toContain('GET /settings/backup')
    expect(routes.map((route) => route.name)).toContain('PUT /settings/mail/server')
    expect(routes.map((route) => route.name)).toContain('PUT /push/subscription')
    expect(routes.map((route) => route.name)).toContain('GET /deadlines/run')
    expect(routes.map((route) => route.name)).toContain('PUT /settings/deadlines/:kind')
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
