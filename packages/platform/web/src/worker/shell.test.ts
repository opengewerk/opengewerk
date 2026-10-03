/// <reference lib="webworker" />

import { foundationPaths } from '@opengewerk/platform-domain'
import { describe, expect, it } from 'vitest'

import { serveShell } from './shell.js'
import type { ShellWorker, Workbox } from './shell.js'

// The service worker with an application that belongs to nobody, in a scope
// and with a Workbox that only write down what is asked of them: which shell
// answers which navigation, what a push shows, where a tap leads, and when a
// waiting build takes over.

const origin = 'https://probewerk.example.de'

const probe: ShellWorker = {
  precache: [{ url: '/index.html', revision: 'a1' }, '/assets/office-1a2b.js'],
  name: 'Probewerk',
  icon: '/brand/probe-192.png',
  // One with a character that means something in a pattern, to see it stay a
  // character.
  serverPaths: ['shelves', 'letter-lines', 'a.b'],
}

interface FakeRoute {
  readonly handler: { readonly boundTo: string }
  readonly options: {
    readonly allowlist?: readonly RegExp[]
    readonly denylist?: readonly RegExp[]
  }
}

interface FakeWindow {
  readonly url: string
  readonly focused: number
  readonly navigatedTo: string[]
}

/** A scope and a Workbox that write down what the worker does with them. */
function started(worker: ShellWorker = probe, windows: readonly string[] = []) {
  const listeners = new Map<string, (event: unknown) => void>()
  const precached: unknown[] = []
  const routes: FakeRoute[] = []
  const shown: { title: string; options: NotificationOptions }[] = []
  const opened: string[] = []
  const asked: unknown[] = []
  const waiting: Promise<unknown>[] = []
  const open = windows.map((url) => ({ url, focused: 0, navigatedTo: [] as string[] }))
  let skipped = 0

  const scope = {
    location: new URL(`${origin}/service-worker.js`),
    registration: {
      showNotification: (title: string, options: NotificationOptions) => {
        shown.push({ title, options })
        return Promise.resolve()
      },
    },
    clients: {
      matchAll: (query: unknown) => {
        asked.push(query)
        return Promise.resolve(
          open.map((window) => ({
            url: window.url,
            focus: () => {
              ;(window as { focused: number }).focused += 1
              return Promise.resolve()
            },
            navigate: (url: string) => {
              window.navigatedTo.push(url)
              return Promise.resolve()
            },
          })),
        )
      },
      openWindow: (url: string) => {
        opened.push(url)
        return Promise.resolve(null)
      },
    },
    skipWaiting: () => {
      skipped += 1
      return Promise.resolve()
    },
    addEventListener: (type: string, listener: (event: unknown) => void) => {
      listeners.set(type, listener)
    },
  } as unknown as ServiceWorkerGlobalScope

  const tools = {
    precacheAndRoute: (entries: unknown) => {
      precached.push(entries)
    },
    createHandlerBoundToURL: (url: string) => ({ boundTo: url }),
    NavigationRoute: class {
      constructor(
        readonly handler: { readonly boundTo: string },
        readonly options: FakeRoute['options'] = {},
      ) {}
    },
    registerRoute: (route: FakeRoute) => {
      routes.push(route)
    },
  } as unknown as Workbox

  serveShell(scope, worker, tools)

  /**
   * Which shell answers a navigation, the way Workbox decides it: the first
   * route whose denylist does not hold the path and query and whose allowlist
   * does, and the network where none does.
   */
  function shellFor(address: string): string {
    const url = new URL(address, origin)
    const tested = url.pathname + url.search

    for (const route of routes) {
      const denied = (route.options.denylist ?? []).some((pattern) => pattern.test(tested))
      const allowed = (route.options.allowlist ?? [/./]).some((pattern) => pattern.test(tested))

      if (!denied && allowed) {
        return route.handler.boundTo
      }
    }

    return 'network'
  }

  function dispatch(type: string, event: object) {
    const listener = listeners.get(type)

    if (!listener) {
      throw new Error(`Der Worker hört nicht auf ${type}.`)
    }

    listener({ ...event, waitUntil: (promise: Promise<unknown>) => waiting.push(promise) })
  }

  async function push(data: unknown, unreadable = false) {
    dispatch('push', {
      data:
        data === undefined
          ? null
          : {
              json: () => {
                if (unreadable) {
                  throw new SyntaxError('Unexpected token')
                }
                return data
              },
            },
    })
    await Promise.all(waiting)

    return shown.at(-1)
  }

  async function tap(data: unknown) {
    let closed = 0

    dispatch('notificationclick', {
      notification: {
        data,
        close: () => {
          closed += 1
        },
      },
    })
    await Promise.all(waiting)

    return { closed }
  }

  return {
    precached,
    routes,
    shown,
    opened,
    asked,
    open: open as readonly FakeWindow[],
    shellFor,
    push,
    tap,
    dispatch,
    skipped: () => skipped,
  }
}

describe('the shell of the service worker', () => {
  it('precaches what the build put into the list, as it was handed', () => {
    const worker = started()

    expect(worker.precached).toEqual([probe.precache])
    expect(worker.precached[0]).not.toBe(probe.precache)
  })

  it('answers a navigation into the second entry with its own shell', () => {
    const worker = started()

    for (const address of ['/m', '/m/', '/m/anlagen/x', '/m?von=etikett', '/m/?x=1']) {
      expect([address, worker.shellFor(address)]).toEqual([address, '/m/index.html'])
    }
  })

  it('answers every other navigation with the shell of the office', () => {
    const worker = started()

    for (const address of [
      '/',
      '/?code=1',
      '/konto',
      '/einstellungen/briefkopf',
      '/a/0000000000000000',
      // Only begins like the second entry.
      '/mx',
      '/m-x',
    ]) {
      expect([address, worker.shellFor(address)]).toEqual([address, '/index.html'])
    }
  })

  it('leaves every path of the foundation to the server, with or without more after it', () => {
    const worker = started()

    for (const path of foundationPaths) {
      for (const address of [`/${path}`, `/${path}/`, `/${path}/x/y`, `/${path}?x=1`]) {
        expect([address, worker.shellFor(address)]).toEqual([address, 'network'])
      }
    }
  })

  it('leaves every path of the application to the server, the way it was written', () => {
    const worker = started()

    for (const address of [
      '/shelves',
      '/shelves/7',
      '/shelves?offset=20',
      '/letter-lines/3',
      '/a.b',
      '/a.b/c',
    ]) {
      expect([address, worker.shellFor(address)]).toEqual([address, 'network'])
    }
  })

  it('takes a path that only begins like one of the server for a screen', () => {
    const worker = started()

    for (const address of ['/shelvesx', '/staffing', '/apis', '/letter', '/axb', '/a-b']) {
      expect([address, worker.shellFor(address)]).toEqual([address, '/index.html'])
    }
  })

  it('keeps the second entry from the shell of the office, even if that one were asked first', () => {
    const worker = started()
    const office = worker.routes.find((route) => route.handler.boundTo === '/index.html')

    expect(office?.options.denylist?.some((pattern) => pattern.test('/m/anlagen/x'))).toBe(true)
    expect(office?.options.denylist?.some((pattern) => pattern.test('/m'))).toBe(true)
    expect(office?.options.denylist?.some((pattern) => pattern.test('/mx'))).toBe(false)
  })

  it('leaves no path to the server but the ones it was given and those of the foundation', () => {
    const worker = started({ ...probe, serverPaths: [] })

    expect(worker.shellFor('/shelves')).toBe('/index.html')
    expect(worker.shellFor('/staff')).toBe('network')
  })
})

describe('a push message', () => {
  it('is shown with its title, its text, its tag and where a tap on it leads', async () => {
    const worker = started()

    expect(
      await worker.push({ title: 'Fällig', body: 'Regal prüfen', url: '/m/regale/3', tag: 'a' }),
    ).toStrictEqual({
      title: 'Fällig',
      options: {
        body: 'Regal prüfen',
        tag: 'a',
        icon: '/brand/probe-192.png',
        data: { url: '/m/regale/3' },
      },
    })
  })

  it('keeps the query and the anchor of where it leads', async () => {
    const worker = started()

    expect((await worker.push({ url: '/m/regale?x=1#oben' }))?.options.data).toStrictEqual({
      url: '/m/regale?x=1#oben',
    })
  })

  it('says which application it came from when it brings no title, and has no tag unless it brings one', async () => {
    const worker = started()

    expect(await worker.push({ body: 'Etwas ist fällig.' })).toStrictEqual({
      title: 'Probewerk',
      options: { body: 'Etwas ist fällig.', icon: '/brand/probe-192.png', data: { url: '/' } },
    })
  })

  it('is still shown when it cannot be read, or brings nothing at all', async () => {
    const worker = started()

    expect(await worker.push({ title: 'x' }, true)).toStrictEqual({
      title: 'Probewerk',
      options: { body: '', icon: '/brand/probe-192.png', data: { url: '/' } },
    })
    expect(await worker.push(undefined)).toStrictEqual({
      title: 'Probewerk',
      options: { body: '', icon: '/brand/probe-192.png', data: { url: '/' } },
    })
    expect(worker.shown).toHaveLength(2)
  })

  it('takes nothing for its text that is not text', async () => {
    const worker = started()

    expect(await worker.push({ title: 7, body: { a: 1 }, tag: false, url: 3 })).toStrictEqual({
      title: 'Probewerk',
      options: { body: '', icon: '/brand/probe-192.png', data: { url: '/' } },
    })
  })

  it('leads nowhere but to this origin, however the address is written', async () => {
    const worker = started()

    for (const url of [
      'https://elsewhere.example.org/x',
      '//elsewhere.example.org/x',
      '/\\elsewhere.example.org/x',
      '\\\\elsewhere.example.org',
      'javascript:alert(1)',
      'm/regale',
      '',
    ]) {
      expect([url, (await worker.push({ url }))?.options.data]).toEqual([url, { url: '/' }])
    }
  })
})

describe('a tap on a notification', () => {
  it('opens a window at the address it names when none of the application is open', async () => {
    const worker = started()
    const { closed } = await worker.tap({ url: '/m/regale/3' })

    expect(closed).toBe(1)
    expect(worker.opened).toEqual([`${origin}/m/regale/3`])
    expect(worker.asked).toEqual([{ type: 'window', includeUncontrolled: true }])
  })

  it('takes a window of the application that is open already, rather than opening a second', async () => {
    const worker = started(probe, [`${origin}/kunden`, `${origin}/m/`])

    await worker.tap({ url: '/m/regale/3' })

    expect(worker.opened).toEqual([])
    expect(worker.open[0]).toMatchObject({ focused: 1, navigatedTo: [`${origin}/m/regale/3`] })
    expect(worker.open[1]).toMatchObject({ focused: 0, navigatedTo: [] })
  })

  it('opens the start when the notification names no address, or one elsewhere', async () => {
    for (const data of [
      null,
      undefined,
      {},
      { url: 4 },
      { url: 'https://elsewhere.example.org/x' },
      { url: '//elsewhere.example.org/x' },
      { url: '/\\elsewhere.example.org/x' },
    ]) {
      const worker = started()

      await worker.tap(data)

      expect([data, worker.opened]).toEqual([data, [`${origin}/`]])
    }
  })
})

describe('a waiting build', () => {
  it('takes over when a page of this origin asks for it', () => {
    const worker = started()

    worker.dispatch('message', { origin, data: { type: 'SKIP_WAITING' } })
    worker.dispatch('message', { origin: '', data: { type: 'SKIP_WAITING' } })

    expect(worker.skipped()).toBe(2)
  })

  it('waits when the message comes from elsewhere or asks for something else', () => {
    const worker = started()

    worker.dispatch('message', {
      origin: 'https://elsewhere.example.org',
      data: { type: 'SKIP_WAITING' },
    })
    worker.dispatch('message', { origin, data: { type: 'CLAIM' } })
    worker.dispatch('message', { origin, data: 'SKIP_WAITING' })
    worker.dispatch('message', { origin, data: undefined })

    expect(worker.skipped()).toBe(0)
  })
})
