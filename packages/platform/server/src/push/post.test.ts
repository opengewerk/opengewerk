import type { LookupAddress } from 'node:dns'
import { request } from 'node:http'
import { type AddressInfo, createServer, type Socket } from 'node:net'

import { afterEach, describe, expect, it } from 'vitest'

import { answerOf, checkedLookup, endpointProblem, endpointReachable } from './post.js'

/**
 * The server posts to whatever address a device subscribed with, so the
 * address is held to the internet, over HTTPS on its port, like the mail
 * server of a tenant since GHSA-5664-h6fc-v729.
 */

describe('the address of a push service', () => {
  it('is taken over HTTPS on the internet', () => {
    expect(endpointProblem('https://fcm.googleapis.com/fcm/send/abc:def')).toBeNull()
    expect(endpointProblem('https://web.push.apple.com:443/QGuQyavXutnMH')).toBeNull()
  })

  it('is refused without HTTPS, on another port, with credentials or inside a network', () => {
    expect(endpointProblem('http://push.example.com/abc')).toMatch(/HTTPS/)
    expect(endpointProblem('https://push.example.com:5432/abc')).toMatch(/Port/)
    expect(endpointProblem('https://user:secret@push.example.com/abc')).toMatch(/Zugangsdaten/)
    expect(endpointProblem('https://127.0.0.1/abc')).toMatch(/internen Netz/)
    expect(endpointProblem('https://[::1]/abc')).toMatch(/internen Netz/)
    expect(endpointProblem('https://10.1.2.3/abc')).toMatch(/internen Netz/)
    expect(endpointProblem('kein Ort')).toMatch(/keine Adresse/)
  })

  it('is refused when its name points inside a network, or nowhere', async () => {
    const resolve = (host: string) =>
      Promise.resolve(host === 'intern.example.com' ? ['192.168.1.20'] : ['142.250.185.74'])

    expect(await endpointReachable('https://fcm.googleapis.com/x', resolve)).toBeNull()
    expect(await endpointReachable('https://intern.example.com/x', resolve)).toMatch(
      /internen Netz/,
    )
    expect(
      await endpointReachable('https://nirgends.example.com/x', () =>
        Promise.reject(new Error('ENOTFOUND')),
      ),
    ).toMatch(/gibt es nicht/)
  })
})

describe('the connection', () => {
  function resolving(addresses: readonly LookupAddress[]) {
    return ((
      _host: string,
      _options: unknown,
      callback: (error: Error | null, found: LookupAddress[]) => void,
    ) => {
      callback(null, [...addresses])
    }) as never
  }

  function ask(
    lookup: ReturnType<typeof checkedLookup>,
    all: boolean,
  ): Promise<{ error: NodeJS.ErrnoException | null; address: unknown }> {
    return new Promise((resolve) => {
      ;(
        lookup as unknown as (
          host: string,
          options: { all: boolean },
          callback: (error: NodeJS.ErrnoException | null, address: unknown) => void,
        ) => void
      )('push.example.com', { all }, (error, address) => {
        resolve({ error, address })
      })
    })
  }

  it('goes to an address on the internet, in either form the socket asks for', async () => {
    const lookup = checkedLookup(resolving([{ address: '142.250.185.74', family: 4 }]))

    expect(await ask(lookup, false)).toEqual({ error: null, address: '142.250.185.74' })
    expect(await ask(lookup, true)).toEqual({
      error: null,
      address: [{ address: '142.250.185.74', family: 4 }],
    })
  })

  it('refuses a name with any address inside a network', async () => {
    const lookup = checkedLookup(
      resolving([
        { address: '142.250.185.74', family: 4 },
        { address: '10.0.0.5', family: 4 },
      ]),
    )

    expect((await ask(lookup, false)).error?.code).toBe('EINTERNAL')
  })
})

/**
 * Anybody who may switch on push names the address the job posts to, and the
 * job posts one message after another. A service that answers slowly, byte by
 * byte, must not hold it for longer than one limit.
 */
describe('the answer of a push service', () => {
  const opened: (() => void)[] = []

  afterEach(() => {
    for (const close of opened.splice(0)) {
      close()
    }
  })

  /** A service on this machine that writes `head` and then `drip` every few milliseconds, until the connection is gone. */
  async function service(
    head: string,
    drip: string,
  ): Promise<{ port: number; closed: Promise<void> }> {
    const sockets = new Set<Socket>()
    let closedOnce: () => void = () => undefined
    const closed = new Promise<void>((resolve) => {
      closedOnce = resolve
    })
    const server = createServer((socket) => {
      sockets.add(socket)
      socket.on('error', () => undefined)
      socket.once('data', () => {
        socket.write(head)

        const dripping = setInterval(() => {
          socket.write(drip)
        }, 20)

        socket.on('close', () => {
          clearInterval(dripping)
          closedOnce()
        })
      })
    })

    await new Promise<void>((listening) => {
      server.listen(0, '127.0.0.1', listening)
    })
    opened.push(() => {
      for (const socket of sockets) {
        socket.destroy()
      }

      server.close()
    })

    return { port: (server.address() as AddressInfo).port, closed }
  }

  function post(port: number, limitMs: number) {
    const sent = request({ host: '127.0.0.1', port, method: 'POST', path: '/push' })
    const answer = answerOf(sent, limitMs)

    sent.end(Buffer.from('message'))

    return answer
  }

  it('is there with the head, and the connection is cut while the body still runs', async () => {
    const { port, closed } = await service(
      'HTTP/1.1 429 Too Many Requests\r\nRetry-After: 30\r\nContent-Length: 1000000\r\n\r\n',
      'x',
    )

    await expect(post(port, 2_000)).resolves.toEqual({ status: 429, retryAfter: '30' })
    await closed
  })

  it('is given up at the limit, even when the head keeps coming and never ends', async () => {
    const { port } = await service('HTTP/1.1 201 Created\r\n', 'X-Wait: a\r\n')
    const started = Date.now()

    await expect(post(port, 300)).rejects.toThrow(/nicht rechtzeitig/)
    expect(Date.now() - started).toBeLessThan(2_000)
  })
})
