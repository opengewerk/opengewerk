import { describe, expect, it } from 'vitest'

import { clientAddress } from './client-address.js'

/**
 * Where a request comes from, for the limit on wrong setup codes (#215). The
 * cases are the ones an installation meets: a proxy on the same machine or in
 * the Docker network in front, and a client that talks to the instance
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
  })

  it('is the connection itself when nothing in front says otherwise', () => {
    expect(clientAddress(requestFrom('172.18.0.1'))).toBe('172.18.0.1')
    expect(clientAddress(requestFrom('172.18.0.1', ' , '))).toBe('172.18.0.1')
  })

  /**
   * A client on the internet that talks to the instance directly writes the
   * header itself. Taken at its word, every request could claim a fresh
   * address and walk around the limit.
   */
  it('is the connection itself when it comes from the internet, whatever the header says', () => {
    expect(clientAddress(requestFrom('203.0.113.9', '10.0.0.1'))).toBe('203.0.113.9')
  })
})
