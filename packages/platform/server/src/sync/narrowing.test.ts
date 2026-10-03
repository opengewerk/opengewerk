import { describe, expect, it } from 'vitest'

import { fingerprintOf } from './narrowing.js'

// The fingerprint a pull names for an entity it narrowed. A device compares it
// with the one it kept and drops what it holds when the two differ, so the
// value has to follow the set and nothing else.

const first = '01929c5e-7a3b-7c00-8000-000000000001'
const second = '01929c5e-7a3b-7c00-8000-000000000002'

describe('the fingerprint of what a device holds', () => {
  it('is the same for the same set, in whatever order it comes', () => {
    expect(fingerprintOf([second, first])).toBe(fingerprintOf([first, second]))
  })

  it('is another one for a set with one id more or less', () => {
    expect(fingerprintOf([first])).not.toBe(fingerprintOf([first, second]))
    expect(fingerprintOf([])).not.toBe(fingerprintOf([first]))
  })

  /**
   * The values devices already hold. A change to how it is worked out would
   * make every device drop what it holds and fetch it again on its next pull,
   * which is a decision and not a refactoring.
   */
  it('is worked out as devices already hold it', () => {
    expect(fingerprintOf([first, second])).toBe('7b50fb05efbce021')
    expect(fingerprintOf([])).toBe('e3b0c44298fc1c14')
  })
})
