import { describe, expect, it } from 'vitest'

import { generatePassword } from './password.js'

/**
 * The password an unattended installation gets when nobody thought of one.
 *
 * Every check here is about a way of getting this wrong that leaves something
 * that still looks like a password: an alphabet with a character nobody can
 * read back, a draw that never reaches the end of the alphabet, or a length
 * that the command it is made for would refuse.
 */

/** What the command insists on for a password somebody chose. */
const shortestPassword = 12

describe('a generated password', () => {
  it('comes in five groups of five, so it can be read across a room', () => {
    expect(generatePassword()).toMatch(/^[0-9a-z]{5}(-[0-9a-z]{5}){4}$/)
  })

  it('is longer than the floor the command keeps for a chosen one', () => {
    expect(generatePassword().length).toBeGreaterThan(shortestPassword)
  })

  /**
   * The four characters that are missing on purpose. Each of them has a twin
   * in most terminal faces, and this password is read off a terminal and typed
   * into a browser by hand: `i` and `l` against `1`, `o` against `0`, `u`
   * against `v`.
   */
  it('leaves out every character that could be mistaken for another', () => {
    const drawn = new Set(
      Array.from({ length: 200 }, () => generatePassword())
        .join('')
        .replaceAll('-', ''),
    )

    for (const ambiguous of ['i', 'l', 'o', 'u']) {
      expect(drawn.has(ambiguous)).toBe(false)
    }
  })

  /**
   * The check that catches a remainder where a mask belongs.
   *
   * Thirty two characters and a byte masked with 31 gives every one of them
   * the same chance. `% 31` would look just as right, would produce passwords
   * that pass every other test here, and would never once draw the last
   * character while drawing the first one twice as often. Two hundred
   * passwords are five thousand characters, so a character that can be drawn
   * is drawn.
   */
  it('reaches every character of its alphabet', () => {
    const drawn = new Set(
      Array.from({ length: 200 }, () => generatePassword())
        .join('')
        .replaceAll('-', ''),
    )

    expect([...drawn].sort().join('')).toBe('0123456789abcdefghjkmnpqrstvwxyz')
  })

  it('is a different one every time', () => {
    const drawn = new Set(Array.from({ length: 50 }, () => generatePassword()))

    expect(drawn.size).toBe(50)
  })
})
