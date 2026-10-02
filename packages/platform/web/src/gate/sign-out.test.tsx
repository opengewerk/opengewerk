import 'fake-indexeddb/auto'

import type { OperationId, TenantId } from '@opengewerk/platform-domain'
import { render, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { InterfaceApplication } from '../application.js'
import { InProbe, probeApplication, probeRules } from '../probe-application.js'
import { rememberAccount } from '../session/remembered.js'
import { SyncClient } from '../sync/client.js'
import { deleteLocalStore, openLocalStore, storesOnDevice } from '../sync/store.js'
import { TestServer } from '../sync/test-server.js'
import { SignOutButton } from './sign-out.js'

/**
 * Signing out takes what the device holds of every tenant with it (#186),
 * and asks first when something has not reached the server.
 *
 * In between, the application ends what it keeps on the server for this
 * device (ADR 0010). The tests run with an application that belongs to
 * nobody, and with its records.
 */

let asked: string[]

/** A tenant that has been open on this device, with a shelf in its store. */
async function kept(tenantId: string, unsent = false): Promise<void> {
  const store = await openLocalStore(tenantId)

  await store.write('shelves', [{ id: 's-1', name: 'Regal am Fenster' }])

  if (unsent) {
    await store.queue({
      id: 'o-1' as OperationId,
      entity: 'shelves',
      recordId: 's-2',
      kind: 'create',
      baseVersion: null,
      patches: [{ field: 'name', from: null, to: 'Regal an der Tür' }],
      recordedAt: new Date('2026-09-23T08:00:00.000Z'),
      deviceId: 'device',
    })
  }

  store.close()
}

function button(
  onSignedOut: () => void,
  options: { readonly client?: SyncClient; readonly application?: InterfaceApplication } = {},
) {
  return render(
    <InProbe application={options.application}>
      <SignOutButton client={options.client ?? null} onSignedOut={onSignedOut} />
    </InProbe>,
  )
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
  it('takes the store of every tenant on this device with it, then ends the session', async () => {
    await kept('t-nord')
    await kept('t-sued')
    rememberAccount({
      userId: 'u-1',
      email: 'max@nord.example.de',
      name: 'Max',
      tenantId: 't-nord' as TenantId,
      twoFactorEnabled: false,
      signInMethod: 'password',
    })
    const signedOut = vi.fn()

    button(signedOut)
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

    button(signedOut)
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
      rules: probeRules,
      deviceId: 'device',
      entities: ['notes'],
      onSignedOut: () => {},
    })

    server.offline = true
    await client.create('notes', { text: 'Leiter im Flur vergessen' })
    expect(client.status().pending).toBe(1)
    server.offline = false

    const signedOut = vi.fn()

    button(signedOut, { client })
    await userEvent.click(screen.getByRole('button', { name: 'Abmelden' }))

    await waitFor(() => {
      expect(signedOut).toHaveBeenCalled()
    })
    expect(server.operations()).toHaveLength(1)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(await storesOnDevice()).toEqual([])
  })
})

describe('what an application ends for a device at the sign out', () => {
  /**
   * After the data is gone and before the session is: there has to be a
   * session to end something with, and a sign out that left the store behind
   * because something on the server took its time would be the wrong order.
   */
  it('goes after what the device held and before the session', async () => {
    await kept('t-nord')

    const order: string[] = []
    let held: readonly string[] | null = null
    const signedOut = vi.fn()

    vi.stubGlobal('fetch', (path: string) => {
      order.push(path)

      return Promise.resolve(
        new Response('{}', { headers: { 'Content-Type': 'application/json' } }),
      )
    })

    button(signedOut, {
      application: probeApplication({
        beforeSignOut: async () => {
          held = await storesOnDevice()
          order.push('the application')
        },
      }),
    })
    await userEvent.click(screen.getByRole('button', { name: 'Abmelden' }))

    await waitFor(() => {
      expect(signedOut).toHaveBeenCalled()
    })
    expect(held).toEqual([])
    expect(order).toEqual(['the application', '/auth/sign-out'])
  })

  /** Never in the way: whatever goes wrong in it, the session ends all the same. */
  it.each([
    ['fails later', () => Promise.reject(new Error('The server did not take the row off.'))],
    [
      'fails at once',
      () => {
        throw new Error('This browser has no service worker.')
      },
    ],
  ])('signs out all the same when it %s', async (_how, beforeSignOut) => {
    await kept('t-nord')
    const signedOut = vi.fn()

    button(signedOut, { application: probeApplication({ beforeSignOut }) })
    await userEvent.click(screen.getByRole('button', { name: 'Abmelden' }))

    await waitFor(() => {
      expect(signedOut).toHaveBeenCalled()
    })
    expect(asked).toContain('/auth/sign-out')
    expect(await storesOnDevice()).toEqual([])
    expect(screen.queryByRole('alert')).toBeNull()
  })

  /**
   * And never for long. Something that does not answer, as a server behind a
   * network that swallows requests, holds the sign out up for a few seconds
   * and not for ever.
   */
  it('waits for it a few seconds and not for ever', async () => {
    const signedOut = vi.fn()

    button(signedOut, {
      application: probeApplication({ beforeSignOut: () => new Promise(() => {}) }),
    })
    await userEvent.click(screen.getByRole('button', { name: 'Abmelden' }))

    // It is waited for: the session is still there a moment later.
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(signedOut).not.toHaveBeenCalled()
    expect(asked).not.toContain('/auth/sign-out')

    await waitFor(
      () => {
        expect(signedOut).toHaveBeenCalled()
      },
      { timeout: 6_000 },
    )
    expect(asked).toContain('/auth/sign-out')
  }, 10_000)
})
