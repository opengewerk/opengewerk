import 'fake-indexeddb/auto'

import { workingInHeader } from '@opengewerk/domain'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SyncClient } from '../sync/client.js'
import { openLocalStore } from '../sync/store.js'
import { TestServer } from '../sync/test-server.js'
import { request, workIn } from '../sync/transport.js'
import { switchBusiness } from './businesses.js'

/**
 * What keeps a switch of business from mixing two businesses on one device
 * (#242): every request names the business the page works in, and the switch
 * sends the outbox of the first business before the session moves.
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

describe('the business a page works in', () => {
  it('goes along with every request once the page works in one, and not before', async () => {
    await request('/auth/tenants')
    workIn('t-1')
    await request('/customers')

    expect(heard[0]?.headers[workingInHeader]).toBeUndefined()
    expect(heard[1]?.headers[workingInHeader]).toBe('t-1')
  })
})

describe('the switch to another business', () => {
  it('sends what waits in the outbox of the first before the session moves', async () => {
    server.offline = true
    const client = await SyncClient.start({
      store: await openLocalStore('wechsel-postausgang'),
      transport: server,
      writer: server,
      deviceId: 'office-computer',
      entities: ['customers'],
      onSignedOut: () => {},
    })

    await client.create('customers', { name: 'Meyer', kind: 'private' })
    expect(server.operations()).toHaveLength(0)

    // Back on the network while the round the new customer started may still
    // be failing: the switch has to send it all the same.
    server.offline = false
    await switchBusiness(client, 't-2' as Parameters<typeof switchBusiness>[1])

    const choice = heard.find((call) => call.path === '/auth/tenant')

    expect(choice?.sentSoFar).toBe(1)
    expect(globalThis.location.assign).toHaveBeenCalledWith('/')

    client.stop()
  })
})
