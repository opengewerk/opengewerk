import 'fake-indexeddb/auto'

import type { OperationId } from '@opengewerk/domain'
import { render, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { rememberAccount } from '../session/remembered.js'
import { SyncClient } from '../sync/client.js'
import { deleteLocalStore, openLocalStore, storesOnDevice } from '../sync/store.js'
import { TestServer } from '../sync/test-server.js'
import { SignOutButton } from './sign-out.js'

/**
 * Signing out takes what the device holds of every business with it (#186),
 * and asks first when something has not reached the server.
 */

let asked: string[]

/** A business that has been open on this device, with a customer in its store. */
async function kept(tenantId: string, unsent = false): Promise<void> {
  const store = await openLocalStore(tenantId)

  await store.write('customers', [{ id: 'c-1', name: 'Familie Berg', kind: 'private' }])

  if (unsent) {
    await store.queue({
      id: 'o-1' as OperationId,
      entity: 'customers',
      recordId: 'c-2',
      kind: 'create',
      baseVersion: null,
      patches: [{ field: 'name', from: null, to: 'Meyer' }],
      recordedAt: new Date('2026-09-23T08:00:00.000Z'),
      deviceId: 'geraet',
    })
  }

  store.close()
}

beforeEach(async () => {
  for (const tenant of await storesOnDevice()) {
    await deleteLocalStore(tenant)
  }

  asked = []
  vi.stubGlobal('fetch', (path: string) => {
    asked.push(path)

    return Promise.resolve(new Response('{}', { headers: { 'Content-Type': 'application/json' } }))
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('signing out', () => {
  it('takes the store of every business on this device with it, then ends the session', async () => {
    await kept('t-nord')
    await kept('t-sued')
    rememberAccount({
      userId: 'u-1',
      email: 'max@nord.example.de',
      name: 'Max',
      tenantId: 't-nord' as never,
      twoFactorEnabled: false,
    })
    const signedOut = vi.fn()

    render(<SignOutButton client={null} onSignedOut={signedOut} />)
    await userEvent.click(screen.getByRole('button', { name: 'Abmelden' }))

    await waitFor(() => {
      expect(signedOut).toHaveBeenCalled()
    })
    expect(await storesOnDevice()).toEqual([])
    expect(asked).toContain('/auth/sign-out')
  })

  it('asks before changes that never reached the server are lost', async () => {
    await kept('t-nord', true)
    const signedOut = vi.fn()

    render(<SignOutButton client={null} onSignedOut={signedOut} />)
    await userEvent.click(screen.getByRole('button', { name: 'Abmelden' }))

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Auf diesem Gerät liegen noch 1 Änderung, die den Server nicht erreicht haben.',
    )
    expect(await storesOnDevice()).toEqual(['t-nord'])
    expect(signedOut).not.toHaveBeenCalled()

    // Staying keeps everything.
    await userEvent.click(screen.getByRole('button', { name: 'Angemeldet bleiben' }))
    expect(await storesOnDevice()).toEqual(['t-nord'])

    await userEvent.click(screen.getByRole('button', { name: 'Abmelden' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Trotzdem abmelden' }))

    await waitFor(() => {
      expect(signedOut).toHaveBeenCalled()
    })
    expect(await storesOnDevice()).toEqual([])
  })

  it('sends first when it can, and then asks nothing', async () => {
    const server = new TestServer()
    const client = await SyncClient.start({
      store: await openLocalStore('t-west'),
      transport: server,
      writer: server,
      deviceId: 'geraet',
      entities: ['customers'],
      onSignedOut: () => {},
    })

    server.offline = true
    await client.create('customers', { kind: 'private', name: 'Meyer' })
    expect(client.status().pending).toBe(1)
    server.offline = false

    const signedOut = vi.fn()

    render(<SignOutButton client={client} onSignedOut={signedOut} />)
    await userEvent.click(screen.getByRole('button', { name: 'Abmelden' }))

    await waitFor(() => {
      expect(signedOut).toHaveBeenCalled()
    })
    expect(server.operations()).toHaveLength(1)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(await storesOnDevice()).toEqual([])
  })
})
