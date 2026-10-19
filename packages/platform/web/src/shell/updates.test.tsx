import 'fake-indexeddb/auto'

import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import { render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { probeRules } from '../probe-application.js'
import { SyncClient } from '../sync/client.js'
import { openLocalStore } from '../sync/store.js'
import { TestServer } from '../sync/test-server.js'
import { standInWorker } from './test-updates.js'
import { useUpdateOnNavigation } from './update-hooks.js'
import { addressChanged, holdUpdates, updatesHeld } from './updates.js'

/**
 * When a new version of the application is taken (opengewerk-haustechnik#465):
 * by the page itself, as it opens, when it is hidden or when the address
 * changes, and never while something holds it or without a network.
 */

let device: ReturnType<typeof standInWorker> | null = null

function aDevice(options?: Parameters<typeof standInWorker>[0]) {
  device = standInWorker(options)

  return device
}

afterEach(() => {
  device?.forget()
  device = null
})

const skipWaiting = { type: 'SKIP_WAITING' }

describe('a new version', () => {
  it('is taken as the page opens, when it was waiting already', () => {
    const page = aDevice({ waiting: true })

    page.start()

    expect(page.sent).toEqual([skipWaiting])
    // Once, although the page hears both that another worker controls it and
    // that the worker it asked is active.
    expect(page.reloads).toBe(1)
  })

  it('waits while the page is shown, and is taken once it is hidden', () => {
    const page = aDevice()

    page.start()
    page.arrive()
    page.show()

    expect(page.sent).toEqual([])

    page.hide()

    expect(page.sent).toEqual([skipWaiting])
    expect(page.reloads).toBe(1)
  })

  it('is taken at the next change of address', () => {
    const page = aDevice()

    page.start()
    page.arrive()

    expect(page.reloads).toBe(0)

    addressChanged()

    expect(page.sent).toEqual([skipWaiting])
    expect(page.reloads).toBe(1)
  })

  it('is taken on a page no worker controls, once the new one is active', () => {
    const page = aDevice({ waiting: true, controlled: false })

    page.start()

    expect(page.reloads).toBe(1)
  })

  it('is left alone while something holds it, and taken at the next moment after it is let go', () => {
    const page = aDevice({ waiting: true })
    const release = holdUpdates()

    page.start()
    page.hide()
    addressChanged()

    expect(page.sent).toEqual([])

    page.show()
    release()

    // Letting go on a page that is looked at is no moment: whoever just saved
    // is still there.
    expect(page.sent).toEqual([])

    page.hide()

    expect(page.sent).toEqual([skipWaiting])
    expect(page.reloads).toBe(1)
  })

  it('is taken as the last hold is let go while the page is hidden, since nobody looks', () => {
    const page = aDevice()
    const form = holdUpdates()
    const pad = holdUpdates()

    page.start()
    page.arrive()
    page.hide()
    form()

    expect(page.sent).toEqual([])

    pad()

    expect(page.sent).toEqual([skipWaiting])
    expect(page.reloads).toBe(1)
  })

  it('is left alone without a network, and taken when it comes back while nobody looks', () => {
    const page = aDevice({ waiting: true })

    page.offline()
    page.start()
    page.hide()
    addressChanged()

    expect(page.sent).toEqual([])

    page.online()

    expect(page.sent).toEqual([skipWaiting])
    expect(page.reloads).toBe(1)
  })

  it('waits for the next moment when the network comes back while the page is looked at', () => {
    const page = aDevice()

    page.offline()
    page.start()
    page.arrive()
    addressChanged()
    page.online()

    expect(page.sent).toEqual([])

    addressChanged()

    expect(page.reloads).toBe(1)
  })

  it('is kept back by whatever was typed, until the address changes', () => {
    const page = aDevice()
    const field = document.createElement('input')

    document.body.append(field)
    page.start()
    page.arrive()
    field.dispatchEvent(new Event('input', { bubbles: true }))

    expect(updatesHeld()).toBe(true)

    page.hide()

    expect(page.sent).toEqual([])

    addressChanged()

    expect(updatesHeld()).toBe(false)
    expect(page.reloads).toBe(1)

    field.remove()
  })

  it('reloads no page because another page took it, only at a moment of its own', () => {
    const page = aDevice()

    page.start()
    page.arrive()
    page.takenElsewhere()

    expect(page.reloads).toBe(0)

    page.hide()

    // Nothing waits any more, so nothing is sent: the page is loaded anew.
    expect(page.sent).toEqual([])
    expect(page.reloads).toBe(1)
  })

  it('is looked for every hour and whenever the page is shown again, while there is a network', () => {
    vi.useFakeTimers()

    try {
      const page = aDevice()
      const hour = 60 * 60 * 1000

      page.start()

      expect(page.registration.update).not.toHaveBeenCalled()

      vi.advanceTimersByTime(hour)

      expect(page.registration.update).toHaveBeenCalledTimes(1)

      page.hide()
      page.show()

      expect(page.registration.update).toHaveBeenCalledTimes(2)

      page.offline()
      vi.advanceTimersByTime(hour)
      page.hide()
      page.show()

      expect(page.registration.update).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('a change of address in the router', () => {
  /** The least a frame is: the hook, a link, and the screen under it. */
  function Frame() {
    useUpdateOnNavigation()

    return (
      <>
        <Link to="/zwei">Zwei</Link>
        <Outlet />
      </>
    )
  }

  function router() {
    const root = createRootRoute({ component: Frame })

    return createRouter({
      routeTree: root.addChildren([
        createRoute({ getParentRoute: () => root, path: '/', component: () => <h1>Eins</h1> }),
        createRoute({ getParentRoute: () => root, path: '/zwei', component: () => <h1>Zwei</h1> }),
      ]),
      history: createMemoryHistory({ initialEntries: ['/'] }),
    })
  }

  it('takes a version that waits once the next screen stands, and not at the address the page opens at', async () => {
    const page = aDevice()

    page.start()
    page.arrive()
    render(<RouterProvider router={router()} />)

    await screen.findByRole('heading', { name: 'Eins' })

    expect(page.reloads).toBe(0)

    await userEvent.click(screen.getByRole('link', { name: 'Zwei' }))
    await screen.findByRole('heading', { name: 'Zwei' })

    expect(page.sent).toEqual([skipWaiting])
    expect(page.reloads).toBe(1)
  })
})

describe('the outbox', () => {
  async function client(server: TestServer) {
    return await SyncClient.start({
      store: await openLocalStore('over-a-new-version'),
      transport: server,
      writer: server,
      rules: probeRules,
      deviceId: 'device',
      entities: ['shelves', 'notes'],
      onSignedOut: () => {},
    })
  }

  /**
   * It lies in the storage of the device and not in the page, so the reload
   * that takes the version leaves it where it is, and the page of the new
   * version finds it and sends it.
   */
  it('stays on the device when a version is taken, for the page after the reload', async () => {
    const server = new TestServer()

    // The server is out of reach, the network is not.
    server.offline = true

    const before = await client(server)

    await before.create('shelves', { name: 'Hall', kind: 'wood' })
    // The round the change started, which holds the version while it tries.
    await before.synchronise()

    expect(before.status().pending).toBe(1)

    const page = aDevice({ waiting: true })

    page.start()

    expect(page.reloads).toBe(1)

    before.stop()

    const after = await client(server)

    expect(after.status().pending).toBe(1)
    expect(after.list('shelves').map((entry) => entry['name'])).toEqual(['Hall'])

    after.stop()
  })
})
