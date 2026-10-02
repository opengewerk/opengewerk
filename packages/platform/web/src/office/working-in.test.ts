import 'fake-indexeddb/auto'

import { workingInHeader } from '@opengewerk/platform-domain'
import type { TenantId } from '@opengewerk/platform-domain'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { probeRules } from '../probe-application.js'
import { SyncClient } from '../sync/client.js'
import { openLocalStore } from '../sync/store.js'
import { TestServer } from '../sync/test-server.js'
import { request, workIn } from '../sync/transport.js'
import { switchTenant } from './tenants.js'

/**
 * What keeps a switch of tenant from mixing two tenants on one device (#242):
 * every request names the tenant the page works in, and the switch sends the
 * outbox of the first tenant before the session moves.
 */

let heard: { path: string; headers: Record<string, string>; sentSoFar: number }[]
let server: TestServer

beforeEach(() => {
  heard = []
  server = new TestServer()
  vi.stubGlobal('fetch', (path: string, init?: RequestInit) => {
    heard.push({
      path,
      headers: (init?.headers ?? {}) as Record<string, string>,
      sentSoFar: server.operations().length,
    })

    return Promise.resolve(
      new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    )
  })
  vi.spyOn(globalThis.location, 'assign').mockImplementation(() => {})
})

afterEach(() => {
  workIn(null)
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('the tenant a page works in', () => {
  it('goes along with every request once the page works in one, and not before', async () => {
    await request('/auth/tenants')
    workIn('t-1')
    await request('/shelves')

    expect(heard[0]?.headers[workingInHeader]).toBeUndefined()
    expect(heard[1]?.headers[workingInHeader]).toBe('t-1')
  })
})

describe('the switch to another tenant', () => {
  async function clientWithSomethingWaiting(store: string) {
    server.offline = true

    const client = await SyncClient.start({
      store: await openLocalStore(store),
      transport: server,
      writer: server,
      rules: probeRules,
      deviceId: 'desk',
      entities: ['shelves'],
      onSignedOut: () => {},
    })

    await client.create('shelves', { name: 'Regal 9' })
    expect(server.operations()).toHaveLength(0)

    return client
  }

  it('sends what waits in the outbox of the first before the session moves', async () => {
    const client = await clientWithSomethingWaiting('wechsel-postausgang')

    // Back on the network while the round the new shelf started may still be
    // failing: the switch has to send it all the same.
    server.offline = false
    await switchTenant(client, 't-2' as TenantId)

    const choice = heard.find((call) => call.path === '/auth/tenant')

    expect(choice?.sentSoFar).toBe(1)
    // And then the page starts again at the office, in the tenant chosen.
    expect(globalThis.location.assign).toHaveBeenCalledWith('/')

    client.stop()
  })

  /**
   * Without a connection the outbox cannot go, and that does not hold the
   * switch up: what waits stays in the store of the tenant it was written in
   * and goes out after the next switch back.
   */
  it('moves the session all the same when the outbox cannot go', async () => {
    const client = await clientWithSomethingWaiting('wechsel-ohne-netz')

    await switchTenant(client, 't-2' as TenantId)

    const choice = heard.find((call) => call.path === '/auth/tenant')

    expect(choice?.sentSoFar).toBe(0)
    expect(globalThis.location.assign).toHaveBeenCalledWith('/')
    expect(client.status().pending).toBe(1)

    client.stop()
  })

  /**
   * And when the exchange fails outright, with something no round expects:
   * the switch was asked for, and what is in the outbox is still there
   * afterwards.
   */
  it('moves the session all the same when the exchange breaks', async () => {
    const broken = {
      synchronise: () => Promise.reject(new Error('Die Ablage ist nicht lesbar.')),
      status: () => ({ pending: 1 }),
    } as unknown as SyncClient

    await switchTenant(broken, 't-2' as TenantId)

    expect(heard.some((call) => call.path === '/auth/tenant')).toBe(true)
    expect(globalThis.location.assign).toHaveBeenCalledWith('/')
  })

  it('stays where it is when the server does not move the session', async () => {
    vi.stubGlobal('fetch', (path: string) =>
      Promise.resolve(
        new Response(JSON.stringify({ message: 'Nicht in diesem Mandanten.' }), {
          status: path === '/auth/tenant' ? 403 : 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )

    await expect(switchTenant(null, 't-2' as TenantId)).rejects.toThrow()
    expect(globalThis.location.assign).not.toHaveBeenCalled()
  })
})
