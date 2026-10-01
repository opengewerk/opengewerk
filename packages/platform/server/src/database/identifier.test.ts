import { describe, expect, it } from 'vitest'

import { isUuid, newId } from './identifier.js'

describe('a key minted at the edge', () => {
  it('is a UUIDv7, sorted by the moment it was made', () => {
    const first = newId<'probe'>()
    const second = newId<'probe'>()

    expect(isUuid(first)).toBe(true)
    // The version sits in the first digit of the third group.
    expect(first.split('-')[2]?.[0]).toBe('7')
    expect(first < second).toBe(true)
  })

  /**
   * Asked before a value from a request goes into a query. PostgreSQL refuses
   * a malformed uuid with an error that aborts the transaction, and inside a
   * sync run that is every other operation of the transmission as well.
   */
  it('tells a key from anything else a request might carry', () => {
    expect(isUuid('0198c5a2-7b1e-7c3a-9f00-3d2e1a4b5c6d')).toBe(true)
    expect(isUuid('0198C5A2-7B1E-7C3A-9F00-3D2E1A4B5C6D')).toBe(true)

    for (const not of [
      '',
      'probe',
      '0198c5a2-7b1e-7c3a-9f00',
      "' or 1=1 --",
      12,
      null,
      undefined,
    ]) {
      expect(isUuid(not), String(not)).toBe(false)
    }
  })
})
