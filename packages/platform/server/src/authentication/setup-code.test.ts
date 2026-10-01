import { describe, expect, it } from 'vitest'

import {
  normalizeSetupCode,
  SetupAttempts,
  setupAttemptLimits,
  setupCodesMatch,
} from './setup-code.js'

/**
 * The code the first run asks for (#215), without HTTP: how it is compared and
 * how often a wrong one may be tried. The route itself is in
 * `api/setup.test.ts`.
 */

describe('a setup code', () => {
  it('is compared in capitals, without spaces and dashes', () => {
    expect(normalizeSetupCode(' k7q4-9pxm ')).toBe('K7Q49PXM')
    expect(normalizeSetupCode('K7Q4 - 9PXM')).toBe('K7Q49PXM')
    expect(normalizeSetupCode('k7q4\t9pxm')).toBe('K7Q49PXM')
  })

  it('matches the code of the instance however it was typed, and nothing else', () => {
    expect(setupCodesMatch('k7q4 9pxm', 'K7Q4-9PXM')).toBe(true)
    expect(setupCodesMatch('K7Q49PXM', 'K7Q4-9PXM')).toBe(true)

    expect(setupCodesMatch('K7Q4-9PXN', 'K7Q4-9PXM')).toBe(false)
    expect(setupCodesMatch('K7Q4-9PX', 'K7Q4-9PXM')).toBe(false)
    expect(setupCodesMatch('K7Q4-9PXM-A', 'K7Q4-9PXM')).toBe(false)
    expect(setupCodesMatch('', 'K7Q4-9PXM')).toBe(false)
  })
})

/** A clock the test moves by hand. */
function clock(start = 1_000_000) {
  let now = start

  return {
    read: () => now,
    advance: (ms: number) => {
      now += ms
    },
  }
}

describe('the attempts at a setup code', () => {
  it('are five wrong ones per address and quarter of an hour, a hundred overall', () => {
    expect(setupAttemptLimits).toEqual({ perAddress: 5, overall: 100, windowMs: 15 * 60_000 })
  })

  it('refuse an address after its fifth wrong code, and no other address', () => {
    const time = clock()
    const attempts = new SetupAttempts(setupAttemptLimits, time.read)

    for (let attempt = 1; attempt <= 5; attempt++) {
      expect(attempts.refuses('203.0.113.1')).toBe(false)
      attempts.failed('203.0.113.1')
    }

    expect(attempts.refuses('203.0.113.1')).toBe(true)
    expect(attempts.refuses('203.0.113.2')).toBe(false)
  })

  /**
   * The limit that holds against somebody with many addresses. Every address
   * stays under its own limit here, and the next one is refused all the same.
   */
  it('refuse every address once the wrong codes of all of them reach the overall limit', () => {
    const time = clock()
    const attempts = new SetupAttempts({ perAddress: 5, overall: 10, windowMs: 60_000 }, time.read)

    for (let address = 1; address <= 10; address++) {
      expect(attempts.refuses(`203.0.113.${String(address)}`)).toBe(false)
      attempts.failed(`203.0.113.${String(address)}`)
    }

    expect(attempts.refuses('198.51.100.1')).toBe(true)
  })

  it('forget a wrong code once it is older than the window', () => {
    const time = clock()
    const attempts = new SetupAttempts({ perAddress: 2, overall: 10, windowMs: 60_000 }, time.read)

    attempts.failed('203.0.113.1')
    time.advance(30_000)
    attempts.failed('203.0.113.1')

    expect(attempts.refuses('203.0.113.1')).toBe(true)

    // The first one has run out, the second has not.
    time.advance(30_001)
    expect(attempts.refuses('203.0.113.1')).toBe(false)

    attempts.failed('203.0.113.1')
    expect(attempts.refuses('203.0.113.1')).toBe(true)

    time.advance(60_001)
    expect(attempts.refuses('203.0.113.1')).toBe(false)
  })
})
