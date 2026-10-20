import express from 'express'
import request from 'supertest'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  addressForLimits,
  clientAddress,
  clientAddressHeader,
  limitKey,
  nameTheClient,
  unknownClientAddress,
} from './client-address.js'

/**
 * Where a request comes from, for the limits per address (#215,
 * opengewerk-haustechnik#360). The cases are the ones an installation meets: a
 * proxy on the same machine or in the Docker network in front, one that does
 * not say whom it forwards for, and a client that talks to the instance
 * directly and brings a header of its own.
 */

function requestFrom(peer: string | undefined, forwardedFor?: string | readonly string[]) {
  return {
    socket: { remoteAddress: peer },
    headers: forwardedFor === undefined ? {} : { 'x-forwarded-for': forwardedFor },
  }
}

describe('the address of a client', () => {
  it('is the last entry a proxy in the own network added, not what the client wrote before it', () => {
    expect(clientAddress(requestFrom('127.0.0.1', '203.0.113.9'))).toBe('203.0.113.9')
    expect(clientAddress(requestFrom('::ffff:172.18.0.1', '1.2.3.4, 203.0.113.9'))).toBe(
      '203.0.113.9',
    )
    expect(clientAddress(requestFrom('::1', ['1.2.3.4', '203.0.113.9 ']))).toBe('203.0.113.9')
    expect(clientAddress(requestFrom('172.18.0.1', '1.2.3.4, 2001:db8::7'))).toBe('2001:db8::7')
  })

  /**
   * The connection is then the proxy's, the same for every client behind it.
   * Taken as the address, it would be one counter for all of them, and one
   * stranger filling it would lock everybody out.
   */
  it('is not known when the proxy in front names nobody, or names no address', () => {
    expect(clientAddress(requestFrom('172.18.0.1'))).toBeNull()
    expect(clientAddress(requestFrom('127.0.0.1'))).toBeNull()
    expect(clientAddress(requestFrom('172.18.0.1', ' , '))).toBeNull()
    expect(clientAddress(requestFrom('172.18.0.1', '203.0.113.9, unknown'))).toBeNull()
    expect(clientAddress(requestFrom(undefined))).toBeNull()
  })

  /**
   * A client on the internet that talks to the instance directly writes the
   * header itself. Taken at its word, every request could claim a fresh
   * address and walk around the limit.
   */
  it('is the connection itself when it comes from the internet, whatever the header says', () => {
    expect(clientAddress(requestFrom('203.0.113.9', '10.0.0.1'))).toBe('203.0.113.9')
    expect(clientAddress(requestFrom('203.0.113.9'))).toBe('203.0.113.9')
  })
})

describe('the key a limit per address counts under', () => {
  it('is one for every address of one /64, and another for the next /64', () => {
    expect(limitKey('2001:db8:1:2::1')).toBe('2001:db8:1:2::/64')
    expect(limitKey('2001:DB8:1:2:ffff:ffff:ffff:ffff')).toBe('2001:db8:1:2::/64')
    expect(limitKey('2001:db8:1:3::1')).toBe('2001:db8:1:3::/64')
    expect(limitKey('fe80::1%eth0')).toBe('fe80:0:0:0::/64')
  })

  it('is an IPv4 address as it is, written as IPv6 or not', () => {
    // Cut to their /64, all of these would be one key, `::/64` or `64:ff9b::/64`.
    expect(limitKey('203.0.113.9')).toBe('203.0.113.9')
    expect(limitKey('::ffff:203.0.113.9')).toBe('203.0.113.9')
    expect(limitKey('::ffff:cb00:7109')).toBe('203.0.113.9')
    expect(limitKey('64:ff9b::203.0.113.9')).toBe('203.0.113.9')
    expect(limitKey('::ffff:198.51.100.1')).not.toBe(limitKey('::ffff:203.0.113.9'))
  })

  /**
   * Where nobody named the client, every such request counts under one key:
   * under none, nothing would hold somebody guessing.
   */
  it('is the key of the address of a request, and one shared key where that is not known', () => {
    expect(addressForLimits(requestFrom('2001:db8:1:2::5'))).toBe('2001:db8:1:2::/64')
    expect(addressForLimits(requestFrom('127.0.0.1', '2001:db8:1:2::6'))).toBe('2001:db8:1:2::/64')
    expect(addressForLimits(requestFrom('127.0.0.1'))).toBe(unknownClientAddress)
    expect(addressForLimits(requestFrom('172.18.0.1', 'unknown'))).toBe(unknownClientAddress)
  })
})

/**
 * A proxy that does not append does so for every request. The log hears of it
 * once, with what the proxy lacks, and not once per request.
 */
describe('a request whose address nobody named', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('is said in the log once, with what the proxy lacks', async () => {
    vi.resetModules()

    const fresh = await import('./client-address.js')
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const passing = express()

    passing.use(fresh.nameTheClient, (_incoming, response) => {
      response.end()
    })

    fresh.addressForLimits(requestFrom('203.0.113.9'))
    fresh.addressForLimits(requestFrom('172.18.0.1', '203.0.113.9'))

    expect(warned).not.toHaveBeenCalled()

    fresh.addressForLimits(requestFrom('172.18.0.1'))
    await request(passing).get('/').expect(200)
    fresh.addressForLimits(requestFrom('127.0.0.1'))

    expect(warned).toHaveBeenCalledTimes(1)
    expect(String(warned.mock.calls[0]?.[0])).toContain(
      'proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;',
    )
  })

  it('is said in the log by the header of the authentication as well', async () => {
    vi.resetModules()

    const fresh = await import('./client-address.js')
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const passing = express()

    passing.use(fresh.nameTheClient, (_incoming, response) => {
      response.end()
    })

    await request(passing).get('/').expect(200)
    await request(passing).get('/').expect(200)

    expect(warned).toHaveBeenCalledTimes(1)
  })
})

/**
 * better-auth reads the address from this header and no other. So it may only
 * ever hold what this instance determined: a client that sends one of its own
 * would otherwise choose the counter it is counted in.
 */
describe('the header the authentication reads the address from', () => {
  const echoing = express()

  echoing.use(nameTheClient, (incoming, response) => {
    response.json({ named: incoming.headers[clientAddressHeader] ?? null })
  })

  it('carries the address of the client and replaces whatever the client wrote there', async () => {
    const answer = await request(echoing)
      .get('/')
      .set('x-forwarded-for', '192.0.2.1, 203.0.113.9')
      .set(clientAddressHeader, '192.0.2.1')
      .expect(200)

    expect(answer.body).toEqual({ named: '203.0.113.9' })
  })

  it('says so where the address is not known, whatever the client wrote there', async () => {
    const answer = await request(echoing).get('/').set(clientAddressHeader, '192.0.2.1').expect(200)

    expect(answer.body).toEqual({ named: unknownClientAddress })
  })
})
