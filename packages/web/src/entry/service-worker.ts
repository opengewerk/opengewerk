/// <reference lib="webworker" />

import { serverPaths } from '@opengewerk/domain'
import { serveShell } from '@opengewerk/platform-web/worker'

import { applicationName } from '../app/name.js'
import { icons } from './manifest.js'

declare const self: ServiceWorkerGlobalScope

/**
 * The service worker of this application: the foundation's (ADR 0010), handed
 * the name, the icon and the paths of its server. What it does, and what it
 * deliberately leaves alone, is written where it is done, at `serveShell`.
 *
 * The list of the build stands here and nowhere else. The plugin of the build
 * looks for `__WB_MANIFEST` on `self` in this file, writes the list in its
 * place, and refuses a worker that names it twice.
 */
serveShell(self, {
  precache: self.__WB_MANIFEST,
  name: applicationName,
  icon: icons[192],
  serverPaths,
})
