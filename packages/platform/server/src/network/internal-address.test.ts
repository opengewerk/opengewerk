import { describe, expect, it } from 'vitest'

import { isInternalAddress } from './internal-address.js'

/**
 * What counts as inside a network (GHSA-5664-h6fc-v729). Whatever an instance
 * connects to for a tenant has to be outside one, and a request from inside
 * one came through a proxy; both are judged here.
 */

describe('an address', () => {
  it('counts as internal on this machine, in a private network, and next to them', () => {
    for (const address of [
      '127.0.0.1',
      '10.1.2.3',
      '172.20.0.5',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '224.0.0.1',
      '::1',
      '::',
      'fd00::1',
      'fe80::1',
      '::ffff:10.0.0.1',
      '::ffff:7f00:1',
    ]) {
      expect([address, isInternalAddress(address)]).toEqual([address, true])
    }
  })

  it('is judged by the IPv4 address it carries through NAT64', () => {
    expect(isInternalAddress('64:ff9b::a00:1')).toBe(true)
    expect(isInternalAddress('64:ff9b::10.0.0.1')).toBe(true)
    expect(isInternalAddress('64:ff9b::d4e3:fb7')).toBe(false)
  })

  it('counts as outside on the internet, in both families', () => {
    for (const address of ['212.227.15.183', '8.8.8.8', '2001:8d8:fe:53:72ec::1']) {
      expect([address, isInternalAddress(address)]).toEqual([address, false])
    }
  })
})
