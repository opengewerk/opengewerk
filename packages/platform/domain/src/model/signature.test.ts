import { describe, expect, it } from 'vitest'

import { longestSignaturePath, signatureBox, signaturePathIsValid } from './signature.js'

describe('the box of a signature', () => {
  it('stays what every stored signature is measured in', () => {
    // A signature keeps its points and not the box they were drawn in. A box
    // of another size would print every one stored so far at a new size, or
    // cut it off.
    expect(signatureBox).toEqual({ width: 1000, height: 400 })
    expect(longestSignaturePath).toBe(40_000)
  })
})

describe('a signature path', () => {
  it('is moves and lines in whole units, inside the box', () => {
    expect(signaturePathIsValid('M10,20L30,40L35,42')).toBe(true)
    expect(signaturePathIsValid('M10,20L30,40M500,100L600,120')).toBe(true)
    expect(signaturePathIsValid('M0,0L1000,400')).toBe(true)
    expect(signaturePathIsValid('M5,6')).toBe(true)
  })

  it('carries nothing else, because it goes straight into an SVG', () => {
    for (const path of [
      '',
      'M10,20L30,40"/><script>alert(1)</script>',
      'm10,20l30,40',
      'M10.5,20L30,40',
      'M-10,20L30,40',
      'L10,20',
      'M10,20 L30,40',
      'M10,20C30,40,50,60,70,80',
      'M10,20L30,40\n',
      'M12345,1',
      // Five digits, even for a point inside the box: the check of a table
      // that keeps signatures takes at most four, and a path it refuses would
      // take a whole transmission with it.
      'M00001,1',
    ]) {
      expect(signaturePathIsValid(path), path).toBe(false)
    }
  })

  it('stays inside the box', () => {
    expect(signaturePathIsValid('M1000,400L0,0')).toBe(true)
    expect(signaturePathIsValid('M1001,20L30,40')).toBe(false)
    expect(signaturePathIsValid('M10,401L30,40')).toBe(false)
    expect(signaturePathIsValid('M10,20L30,40L1001,400')).toBe(false)
    expect(signaturePathIsValid('M10,20L30,40L1000,401')).toBe(false)
  })

  it('is no longer than one transmission takes', () => {
    const longest = `M1,1${'L1,1'.repeat((longestSignaturePath - 4) / 4)}`

    expect(longest).toHaveLength(longestSignaturePath)
    expect(signaturePathIsValid(longest)).toBe(true)
    expect(signaturePathIsValid(`${longest}L1,1`)).toBe(false)
  })
})
