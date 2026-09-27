import type { LookupAddress } from 'node:dns'

import { describe, expect, it } from 'vitest'

import { checkedLookup, endpointProblem, endpointReachable } from './post.js'

/**
 * The server posts to whatever address a device subscribed with, so the
 * address is held to the internet, over HTTPS on its port (#284), like the
 * mail server of a business since GHSA-5664-h6fc-v729.
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
